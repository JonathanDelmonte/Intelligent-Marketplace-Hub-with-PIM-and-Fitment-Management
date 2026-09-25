"""Pede a máquina do servidor à Oracle até sair vaga (docs/hospedagem.md, passo 4).

A máquina ARM gratuita de São Paulo vive sem vaga ("Out of capacity"), e a vaga que abre
some em segundos. Clicar em "Create" no painel tem teto: a sessão cai, a tela bloqueia, o
computador dorme. Este programa faz o mesmo pedido pela API da Oracle, uma vez por minuto,
até a máquina existir ou o tempo desta execução acabar — o workflow "criar máquina" o chama
de novo a cada seis horas.

Com a máquina de pé, ele faz o que o guia mandaria fazer à mão: abre as portas 80 e 443 na
rede da Oracle (passo 5) e pega a identidade do servidor (passo 6). O resumo, com o IP e o
que colar no GitHub, vai para o resumo do job e para uma issue.

A máquina é a do guia: `hub`, VM.Standard.A1.Flex com 2 OCPUs e 12 GB, Canonical Ubuntu
24.04, na sub-rede pública da rede `rede-hub`, com IP público e a chave SSH da publicação.
Rodar de novo com a máquina já criada não cria outra: refaz só as portas e o resumo.

O repositório é público, e o log do Actions também: nenhum OCID, chave ou mensagem crua da
Oracle vai para o log. IP e identidade do servidor vão, porque são públicos de qualquer jeito.

Ambiente:
  OCI_CONFIG          o quadro "Configuration file preview" da chave de API da Oracle
  OCI_CHAVE           a chave privada da API (o arquivo .pem)
  SERVIDOR_CHAVE_SSH  a chave SSH privada da publicação; a pública sai dela
  LIMITE_MINUTOS      quanto tempo pedir antes de desistir desta execução (padrão 320)
  INTERVALO_SEGUNDOS  a espera entre um pedido e outro (padrão 60)
  OCI_ENDPOINT_TESTE  só no ensaio: manda todos os pedidos para uma Oracle de mentira
"""

from __future__ import annotations

import configparser
import os
import random
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import oci

NOME = "hub"
FORMA = "VM.Standard.A1.Flex"
OCPUS = 2
MEMORIA_GB = 12
SISTEMA = "Canonical Ubuntu"
VERSAO_DO_SISTEMA = "24.04"
REDE = "rede-hub"
SUBREDE = "public subnet-rede-hub"
USUARIO = "ubuntu"

# (protocolo, porta, para quê). 6 é TCP, 17 é UDP — os números que a Oracle usa.
PORTAS = (
    ("6", 80, "site: http, e o Let's Encrypt conferindo o endereço"),
    ("6", 443, "site: https"),
    ("17", 443, "site: https por HTTP/3"),
)

FUSO = ZoneInfo("America/Sao_Paulo")


class Falha(Exception):
    """Erro que pede ação de alguém: a mensagem diz o que fazer."""


def agora() -> str:
    return datetime.now(FUSO).strftime("%H:%M:%S")


def sem_ocid(texto: str) -> str:
    return re.sub(r"ocid1\.[\w.:-]+", "<ocid>", texto or "")


def escrever_resumo(texto: str) -> None:
    caminho = os.environ.get("GITHUB_STEP_SUMMARY")
    if caminho:
        with open(caminho, "a", encoding="utf-8") as arquivo:
            arquivo.write(texto)


def escrever_saida(chave: str, valor: str) -> None:
    caminho = os.environ.get("GITHUB_OUTPUT")
    if caminho:
        with open(caminho, "a", encoding="utf-8") as arquivo:
            arquivo.write(f"{chave}={valor}\n")


# ── Configuração ──────────────────────────────────────────────────────────────


def ler_config() -> dict[str, str]:
    """O quadro da Oracle é um arquivo de configuração: [DEFAULT], user=, tenancy=…"""
    texto = os.environ.get("OCI_CONFIG", "").replace("\r", "")
    chave = os.environ.get("OCI_CHAVE", "").replace("\r", "").strip()
    if not texto.strip() or not chave:
        raise Falha("faltam os segredos OCI_CONFIG e OCI_CHAVE (docs/hospedagem.md, passo 4)")
    if "[" not in texto:
        texto = "[DEFAULT]\n" + texto
    leitor = configparser.ConfigParser(interpolation=None, inline_comment_prefixes=("#",))
    try:
        leitor.read_string(texto)
    except configparser.Error as erro:
        raise Falha("o segredo OCI_CONFIG não é o quadro que a Oracle mostra ao criar a chave de API") from erro
    secao = dict(leitor.defaults())
    config = {campo: secao.get(campo, "").strip() for campo in ("user", "tenancy", "fingerprint", "region")}
    faltam = [campo for campo, valor in config.items() if not valor]
    if faltam:
        raise Falha(f"o segredo OCI_CONFIG está sem {', '.join(faltam)}: cole o quadro inteiro da Oracle")
    # O log é público: daqui em diante, o GitHub esconde esses valores se aparecerem.
    for valor in (config["user"], config["tenancy"], config["fingerprint"]):
        print(f"::add-mask::{valor}")
    config["key_content"] = chave + "\n"
    try:
        oci.config.validate_config(config)
    except (ValueError, oci.exceptions.InvalidConfig) as erro:
        raise Falha("o segredo OCI_CONFIG tem um valor fora do formato: cole o quadro da Oracle sem mudar nada") from erro
    return config


def chave_publica_ssh(arquivo_chave: str) -> str:
    """A pública sai da privada: um segredo a menos para guardar."""
    resultado = subprocess.run(
        ["ssh-keygen", "-y", "-f", arquivo_chave],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if resultado.returncode != 0 or not resultado.stdout.startswith("ssh-"):
        raise Falha("o segredo SERVIDOR_CHAVE_SSH não é uma chave SSH privada sem senha (docs/hospedagem.md, passo 3)")
    return resultado.stdout.strip()


# ── A Oracle ──────────────────────────────────────────────────────────────────


class Oracle:
    def __init__(self, config: dict[str, str]) -> None:
        extra = {}
        if os.environ.get("OCI_ENDPOINT_TESTE"):
            extra["service_endpoint"] = os.environ["OCI_ENDPOINT_TESTE"]
        self.compartimento = config["tenancy"]
        self.identidade = oci.identity.IdentityClient(config, **extra)
        self.computacao = oci.core.ComputeClient(config, **extra)
        self.rede = oci.core.VirtualNetworkClient(config, **extra)

    def maquina(self) -> oci.core.models.Instance | None:
        instancias = oci.pagination.list_call_get_all_results(
            self.computacao.list_instances, self.compartimento, display_name=NOME
        ).data
        vivas = [i for i in instancias if i.lifecycle_state not in ("TERMINATING", "TERMINATED")]
        return vivas[0] if vivas else None

    def dominio(self) -> str:
        dominios = self.identidade.list_availability_domains(self.compartimento).data
        if not dominios:
            raise Falha("a Oracle não devolveu nenhum availability domain")
        return dominios[0].name

    def imagem(self) -> str:
        imagens = self.computacao.list_images(
            self.compartimento,
            operating_system=SISTEMA,
            operating_system_version=VERSAO_DO_SISTEMA,
            shape=FORMA,
            sort_by="TIMECREATED",
            sort_order="DESC",
        ).data
        comuns = [i for i in imagens if "minimal" not in (i.display_name or "").lower()]
        if not comuns:
            raise Falha(f"a Oracle não tem a imagem {SISTEMA} {VERSAO_DO_SISTEMA} para a {FORMA}")
        return comuns[0].id

    def subrede(self) -> oci.core.models.Subnet:
        redes = self.rede.list_vcns(self.compartimento, display_name=REDE).data
        if not redes:
            raise Falha(f"não achei a rede {REDE}: crie como no passo 4 do guia (Start VCN Wizard)")
        subredes = self.rede.list_subnets(self.compartimento, vcn_id=redes[0].id, display_name=SUBREDE).data
        if not subredes:
            raise Falha(f"não achei a sub-rede {SUBREDE} dentro de {REDE}")
        return subredes[0]

    def pedir(self, dominio: str, imagem: str, subrede: str, chave_publica: str) -> oci.core.models.Instance:
        detalhes = oci.core.models.LaunchInstanceDetails(
            compartment_id=self.compartimento,
            availability_domain=dominio,
            display_name=NOME,
            shape=FORMA,
            shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(ocpus=OCPUS, memory_in_gbs=MEMORIA_GB),
            source_details=oci.core.models.InstanceSourceViaImageDetails(image_id=imagem),
            create_vnic_details=oci.core.models.CreateVnicDetails(subnet_id=subrede, assign_public_ip=True),
            metadata={"ssh_authorized_keys": chave_publica},
            # Como o painel faz: metadados só com o cabeçalho de autorização (IMDSv2).
            instance_options=oci.core.models.InstanceOptions(are_legacy_imds_endpoints_disabled=True),
        )
        # Sem nova tentativa por dentro do SDK: o laço de fora decide quando pedir de novo.
        return self.computacao.launch_instance(detalhes, retry_strategy=oci.retry.NoneRetryStrategy()).data

    def esperar_rodando(self, instancia_id: str) -> oci.core.models.Instance | None:
        """A máquina aceita ainda pode cair antes de rodar; aí devolve None."""
        for _ in range(90):
            instancia = self.computacao.get_instance(instancia_id).data
            if instancia.lifecycle_state == "RUNNING":
                return instancia
            if instancia.lifecycle_state in ("TERMINATING", "TERMINATED"):
                return None
            if instancia.lifecycle_state == "STOPPED":
                raise Falha(f"a máquina {NOME} está parada: ligue no painel da Oracle (Start)")
            time.sleep(10)
        raise Falha("a máquina foi aceita, mas não chegou a rodar em 15 minutos: confira no painel")

    def ip_publico(self, instancia_id: str) -> str:
        for _ in range(30):
            ligacoes = self.computacao.list_vnic_attachments(self.compartimento, instance_id=instancia_id).data
            for ligacao in ligacoes:
                if ligacao.lifecycle_state == "ATTACHED":
                    ip = self.rede.get_vnic(ligacao.vnic_id).data.public_ip
                    if ip:
                        return ip
            time.sleep(10)
        raise Falha("a máquina está rodando, mas sem IP público: confira a sub-rede no painel")

    def abrir_portas(self, subrede: oci.core.models.Subnet) -> list[str]:
        """Acrescenta as regras que faltam; as que já existem ficam como estão."""
        if not subrede.security_list_ids:
            raise Falha(f"a sub-rede {SUBREDE} não tem security list")
        lista_id = subrede.security_list_ids[0]
        resposta = self.rede.get_security_list(lista_id)
        regras = list(resposta.data.ingress_security_rules or [])
        abertas = []
        for protocolo, porta, descricao in PORTAS:
            if any(cobre(regra, protocolo, porta) for regra in regras):
                continue
            faixa = oci.core.models.PortRange(min=porta, max=porta)
            regra = oci.core.models.IngressSecurityRule(
                protocol=protocolo,
                source="0.0.0.0/0",
                source_type="CIDR_BLOCK",
                is_stateless=False,
                description=descricao,
            )
            if protocolo == "6":
                regra.tcp_options = oci.core.models.TcpOptions(destination_port_range=faixa)
            else:
                regra.udp_options = oci.core.models.UdpOptions(destination_port_range=faixa)
            regras.append(regra)
            abertas.append(f"{'TCP' if protocolo == '6' else 'UDP'} {porta}")
        if abertas:
            self.rede.update_security_list(
                lista_id,
                oci.core.models.UpdateSecurityListDetails(ingress_security_rules=regras),
                if_match=resposta.headers.get("etag"),
            )
        return abertas


def explicar(erro: oci.exceptions.ServiceError) -> Falha:
    """O erro da Oracle, sem OCID, e o que fazer com ele."""
    if erro.status == 401:
        return Falha("a Oracle recusou a chave de API: confira OCI_CONFIG e OCI_CHAVE (o .pem baixado junto com o quadro)")
    if erro.status == 404:
        return Falha("a Oracle não achou algo, ou não deu permissão: a chave de API é do usuário administrador da conta?")
    if erro.code == "LimitExceeded":
        return Falha("o limite gratuito já está em uso: há outra máquina ARM na conta?")
    return Falha(f"a Oracle respondeu {erro.status} {erro.code}: {sem_ocid(erro.message)}")


def cobre(regra: oci.core.models.IngressSecurityRule, protocolo: str, porta: int) -> bool:
    if regra.source != "0.0.0.0/0" or regra.protocol not in (protocolo, "all"):
        return False
    if regra.protocol == "all":
        return True
    opcoes = regra.tcp_options if protocolo == "6" else regra.udp_options
    faixa = opcoes.destination_port_range if opcoes else None
    return faixa is None or faixa.min <= porta <= faixa.max


# ── O pedido até sair vaga ────────────────────────────────────────────────────


def pedir_ate_sair_vaga(oracle: Oracle, chave_publica: str) -> tuple[oci.core.models.Instance | None, int]:
    dominio = oracle.dominio()
    imagem = oracle.imagem()
    subrede = oracle.subrede()
    limite = time.monotonic() + float(os.environ.get("LIMITE_MINUTOS", "320")) * 60
    intervalo = float(os.environ.get("INTERVALO_SEGUNDOS", "60"))
    tentativa = 0
    erros_seguidos = 0
    print(f"{agora()} pedindo {NOME}: {FORMA}, {OCPUS} OCPUs, {MEMORIA_GB} GB, {SISTEMA} {VERSAO_DO_SISTEMA}")
    conferir = False
    while time.monotonic() < limite:
        tentativa += 1
        espera = intervalo
        if conferir:
            # O pedido anterior caiu no meio: a Oracle pode ter criado a máquina sem que a
            # resposta chegasse. Pedir de novo faria duas.
            existente = oracle.maquina()
            if existente:
                print(f"{agora()} a máquina existe, do pedido que caiu no meio")
                return oracle.esperar_rodando(existente.id), tentativa
            conferir = False
        try:
            instancia = oracle.pedir(dominio, imagem, subrede.id, chave_publica)
        except oci.exceptions.ServiceError as erro:
            mensagem = sem_ocid(erro.message)
            if erro.status in (500, 503) and "capacity" in mensagem.lower():
                print(f"{agora()} tentativa {tentativa}: sem vaga")
                erros_seguidos = 0
            elif erro.status == 429:
                print(f"{agora()} tentativa {tentativa}: a Oracle pediu calma; a próxima demora mais")
                espera = 5 * intervalo
            elif erro.status and erro.status < 500:
                raise explicar(erro) from erro
            else:
                erros_seguidos += 1
                print(f"{agora()} tentativa {tentativa}: erro da Oracle {erro.status} {erro.code}")
        except (oci.exceptions.RequestException, oci.exceptions.ConnectTimeout, ConnectionError) as erro:
            erros_seguidos += 1
            conferir = True
            print(f"{agora()} tentativa {tentativa}: sem conexão com a Oracle ({type(erro).__name__})")
        else:
            # Aceita. Daqui em diante, nada de pedir outra: um erro enquanto ela sobe sai
            # desta execução, e a próxima encontra a máquina e continua dela.
            print(f"{agora()} tentativa {tentativa}: a Oracle aceitou; esperando a máquina rodar")
            rodando = oracle.esperar_rodando(instancia.id)
            if rodando:
                return rodando, tentativa
            print(f"{agora()} a máquina caiu antes de rodar; pedindo de novo")
        if erros_seguidos >= 15:
            raise Falha("a Oracle respondeu com erro 15 vezes seguidas: confira o status dela e rode de novo")
        time.sleep(espera + random.uniform(0, 5))
    return None, tentativa


# ── Depois de criada ──────────────────────────────────────────────────────────


def identidade_do_servidor(ip: str) -> str:
    """A linha do passo 6. O SSH leva um ou dois minutos para subir numa máquina nova."""
    for _ in range(40):
        resultado = subprocess.run(
            ["ssh-keyscan", "-T", "5", "-t", "ed25519", ip],
            capture_output=True,
            text=True,
            check=False,
        )
        linhas = [linha for linha in resultado.stdout.splitlines() if linha and not linha.startswith("#")]
        if linhas:
            return linhas[0]
        time.sleep(15)
    return ""


def entra_por_ssh(ip: str, identidade: str, arquivo_chave: str) -> bool:
    with tempfile.NamedTemporaryFile("w", suffix=".known_hosts", delete=False) as conhecidos:
        conhecidos.write(identidade + "\n")
    resultado = subprocess.run(
        [
            "ssh", "-i", arquivo_chave,
            "-o", "IdentitiesOnly=yes",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={conhecidos.name}",
            "-o", "ConnectTimeout=20",
            f"{USUARIO}@{ip}", "true",
        ],
        capture_output=True,
        check=False,
    )
    os.unlink(conhecidos.name)
    return resultado.returncode == 0


def resumo(ip: str, identidade: str, portas: list[str], ssh_ok: bool) -> str:
    dono = os.environ.get("GITHUB_REPOSITORY_OWNER", "")
    portas_texto = ", ".join(portas) if portas else "já estavam abertas"
    ssh_texto = "a chave SSH entrou" if ssh_ok else "**a chave SSH não entrou** — confira o segredo SERVIDOR_CHAVE_SSH"
    return f"""## O servidor foi criado

{f"@{dono} " if dono else ""}A máquina `{NOME}` está rodando na Oracle, com o IP **{ip}**.

- Portas do site na rede da Oracle: {portas_texto}.
- Identidade do servidor: {"conferida" if identidade else "**não respondeu** — rode o passo 6 do guia à mão"}; {ssh_texto}.

### O que falta (docs/hospedagem.md, passo 7)

Em **Settings → Secrets and variables → Actions → Variables**, crie:

| Nome | Valor |
| --- | --- |
| `SERVIDOR_ENDERECO` | `{ip}` |
| `SERVIDOR_CHAVE_HOST` | `{identidade or "(a linha do passo 6)"}` |

Confira os segredos `SERVIDOR_CHAVE_SSH` (já está lá) e `CADASTRO_CODIGO`, e rode o workflow
**verificar** em `main` (passo 8). O site fica em https://{ip.replace(".", "-")}.sslip.io.

A chave de API da Oracle (OCI_CONFIG e OCI_CHAVE) não é mais necessária: pode apagar os dois
segredos e a chave no painel da Oracle (User settings → Tokens and keys).
"""


def principal() -> int:
    try:
        config = ler_config()
        chave_ssh = os.environ.get("SERVIDOR_CHAVE_SSH", "").replace("\r", "").strip()
        if not chave_ssh:
            raise Falha("falta o segredo SERVIDOR_CHAVE_SSH (docs/hospedagem.md, passo 7)")
        with tempfile.NamedTemporaryFile("w", suffix=".chave", delete=False) as arquivo:
            arquivo.write(chave_ssh + "\n")
        os.chmod(arquivo.name, 0o600)
        try:
            chave_publica = chave_publica_ssh(arquivo.name)
            oracle = Oracle(config)

            instancia = oracle.maquina()
            tentativas = 0
            if instancia:
                print(f"{agora()} a máquina {NOME} já existe ({instancia.lifecycle_state}); não peço outra")
                instancia = oracle.esperar_rodando(instancia.id)
                if not instancia:
                    raise Falha(f"a máquina {NOME} existe mas está parando: confira no painel")
            else:
                instancia, tentativas = pedir_ate_sair_vaga(oracle, chave_publica)
            if not instancia:
                print(f"{agora()} sem vaga nesta execução; a próxima tenta de novo sozinha")
                escrever_resumo(f"Sem vaga em {tentativas} tentativas, até as {agora()}. A próxima execução começa sozinha.\n")
                escrever_saida("criada", "false")
                return 0

            ip = oracle.ip_publico(instancia.id)
            print(f"{agora()} a máquina está rodando: {ip}")
            portas = oracle.abrir_portas(oracle.subrede())
            print(f"{agora()} portas do site: {', '.join(portas) if portas else 'já estavam abertas'}")
            identidade = identidade_do_servidor(ip)
            ssh_ok = bool(identidade) and entra_por_ssh(ip, identidade, arquivo.name)
            print(f"{agora()} identidade do servidor: {'ok' if identidade else 'sem resposta'}; SSH: {'ok' if ssh_ok else 'não entrou'}")
        finally:
            os.unlink(arquivo.name)

        texto = resumo(ip, identidade, portas, ssh_ok)
        caminho = os.path.join(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()), "servidor-criado.md")
        with open(caminho, "w", encoding="utf-8") as saida:
            saida.write(texto)
        escrever_resumo(texto)
        escrever_saida("criada", "true")
        escrever_saida("resumo", caminho)
        return 0
    except Falha as falha:
        print(f"::error::{falha}")
        return 1
    except oci.exceptions.ServiceError as erro:
        print(f"::error::{explicar(erro)}")
        return 1
    except Exception as erro:  # noqa: BLE001 — o log é público: nada de traceback com endereço e OCID
        print(f"::error::erro inesperado: {type(erro).__name__}: {sem_ocid(str(erro))[:300]}")
        return 1


if __name__ == "__main__":
    sys.exit(principal())
