# Hospedagem: o sistema no ar, de graça

Este é o passo a passo para pôr o sistema na internet, num servidor gratuito da Oracle,
com endereço `https://` e atualização automática: toda mudança que entra no `main` vai
para o ar em cerca de cinco minutos, sem você ligar nada no seu computador. A decisão
e o porquê de cada peça estão no [ADR 0010](./adr/0010-hospedagem-gratuita.md).

Você faz isto **uma vez**. Leva uns 40 minutos, quase todos esperando a Oracle.

Os nomes dos menus abaixo são os do painel da Oracle em inglês, como estavam em
setembro de 2026. Se algum tiver mudado de lugar, a busca do topo do painel acha pelo
nome.

## Como funciona

```
push no main ──► GitHub verifica (tipos, testes, build)  ─┐
             └─► o servidor monta a versão nova          ─┴─► troca ─► confere ─► no ar
```

- **O servidor** é uma máquina da Oracle Cloud (plano Always Free) em São Paulo, com o
  banco, o sistema, a fila, o HTTPS e as cópias de segurança, cada um num contêiner.
- **A publicação** é o próprio GitHub Actions: a cada push, ele manda o código para o
  servidor por SSH, a máquina monta a versão nova enquanto os testes rodam, e só depois
  de tudo passar a versão é trocada.
- **Se algo der errado**, a versão anterior continua no ar (ou volta sozinha, se a nova
  não responder), e o GitHub manda um e-mail dizendo que a publicação falhou.
- **O endereço** é o IP do servidor pelo sslip.io — `https://129-151-10-20.sslip.io` —,
  que é de graça e dispensa comprar domínio. Dá para trocar por um nome mais bonito,
  também grátis (ver [Endereço com nome](#endereço-com-nome-grátis)).

## O que você vai precisar

- A conta do GitHub, que você já tem, com acesso de administrador a este repositório.
- Um cartão, só para a Oracle confirmar que você é uma pessoa. No plano gratuito nada
  é cobrado — é por isso que o passo 2 manda **não** fazer o upgrade.
- O computador com Windows, Mac ou Linux, para gerar a chave de acesso ao servidor.

---

## Passo 1 — Criar a conta na Oracle Cloud

1. Entre direto em <https://signup.cloud.oracle.com/>. É a única página de cadastro da
   nuvem. **Não** é o `profile.oracle.com`: aquele cria a "Oracle Account" de download e
   suporte, que não serve para isto.
2. Preencha país (**Brazil**), nome e e-mail, e clique no link que chega no e-mail.
3. Crie a senha. Em **Customer type**, escolha **Individual**. O **Cloud Account Name**
   é um apelido sem espaço (por exemplo `minhaloja`); ele entra no endereço de login. É
   o nome da conta inteira, não deste sistema: outros projetos cabem na mesma conta —
   só que a cota gratuita é da conta, e eles a dividem.
4. Em **Home Region**, escolha **Brazil East (Sao Paulo)**. **Atenção: a região não
   muda depois**, e os recursos gratuitos só existem nela.
5. **Endereço**, o mesmo da fatura do cartão do item 6. O formulário é exigente com o
   formato, e o botão **Continuar** fica cinza enquanto houver campo em vermelho:
   - **CEP** com o tracinho: `12345-678`, e não `12345678`.
   - **Telefone** só com números, DDD e celular (`11987654321`): sem `+55` — ele vem da
     bandeira ao lado —, sem parênteses, espaço ou tracinho.
6. **Verificação de pagamento.** É obrigatória — sem ela a conta não é criada —, e é só
   verificação: o plano gratuito não cobra. Em **Adicionar método de verificação de
   pagamento**, use um cartão com bandeira (Visa, Mastercard…), de crédito ou de débito
   que não peça senha, e **o número do cartão físico**: cartão virtual (o do aplicativo
   do banco), pré-pago ou de uso único é recusado. Aparece uma cobrança temporária de
   valor simbólico, que é estornada sozinha. Se o banco recusar, confira no aplicativo
   dele se compras online estão liberadas. Depois, marque o **Contrato** e clique em
   **Iniciar minha avaliação gratuita**.

   O nome do botão engana: o cadastro dá **dois** presentes. Um é a avaliação — US$ 300
   de crédito para gastar em 30 dias no que quiser. O outro é o **Always Free**, sem
   prazo: a máquina ARM, o disco e a rede que este sistema usa. Quando os 30 dias
   acabam, some só o que foi pago com o crédito; o Always Free continua — a própria tela
   do cadastro diz que, sem passar para o nível pago, "você continuará a ter acesso aos
   serviços Always Free".
7. Espere o e-mail de conta pronta (de minutos a algumas horas) e entre no painel por
   <https://cloud.oracle.com>, com o Cloud Account Name do item 3.

> **Erro "status=403" ou "falha na ligação ao servidor" no cadastro.** A Oracle bloqueia
> o cadastro quando desconfia da conexão. Na ordem, o que costuma resolver: desligar VPN
> e extensões de bloqueio de anúncio/privacidade; usar outro navegador (Chrome ou Edge)
> numa janela anônima; usar outra rede (os dados do celular, em vez do Wi-Fi). Depois de
> várias tentativas seguidas, esperar algumas horas também ajuda.

## Passo 2 — Um alarme de gasto, e nada de "Upgrade"

A conta fica no plano gratuito (_Free Tier_), e **nesse plano a Oracle não cobra nada**:
o que não é gratuito simplesmente não funciona. É assim que este sistema usa a Oracle
(ADR 0012).

1. **Não clique em _Upgrade your account_ nem em _Add Payment Method_** (em
   **Billing & Cost Management → Upgrade and Manage Payment**). O upgrade para
   "Pay As You Go" é o que abre a porta para cobrança. E só cadastrar um meio de
   pagamento já faz uma pré-autorização grande no cartão — mais de R$ 500, no caso do
   dono —, que volta sozinha, mas assusta. O cartão do cadastro basta: ele serviu para
   provar que você é uma pessoa, e o plano gratuito não precisa dele de novo.
2. **O alarme (opcional, dois minutos).** No menu (☰), **Billing & Cost Management →
   Budgets → Create Budget**: nome e descrição quaisquer, valor `1`, alerta em `1`% do
   orçamento sobre o gasto real (_Actual spend_), com o seu e-mail. No plano gratuito
   ele nunca deveria disparar; se disparar, é sinal de que algo mudou na conta.

**O único cuidado do plano gratuito:** a Oracle pode recolher uma máquina que passa sete
dias ociosa — processador, rede e memória abaixo de 20%. O servidor já vem preparado
para isso: ele segura 25% da memória (que sobra) e deixa de se encaixar na regra
(`servidor/reserva.mjs`). Se mesmo assim a máquina for recolhida um dia, os dados estão
na cópia do Neon (passo 10), e o [recomeço](#quando-algo-dá-errado) leva uns 20 minutos.

## Passo 3 — Gerar a chave de acesso ao servidor (no seu computador)

A chave é um par de arquivos: um **público**, que vai para o servidor, e um **privado**,
que vai para o GitHub e mais nenhum lugar.

**Windows** — abra o **PowerShell** e cole:

```powershell
mkdir -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -C servidor-hub -f "$env:USERPROFILE\.ssh\servidor-hub"
```

**Mac ou Linux** — abra o Terminal e cole:

```sh
ssh-keygen -t ed25519 -C servidor-hub -f ~/.ssh/servidor-hub
```

Quando ele pedir uma senha (_passphrase_), **aperte Enter duas vezes, sem digitar
nada**: com senha, o GitHub não conseguiria usar a chave sozinho.

Saem dois arquivos na pasta `.ssh` do seu usuário:

- `servidor-hub.pub` — o público (vai no passo 4);
- `servidor-hub` — o privado (vai no passo 7). **Não mande para ninguém.**

## Passo 4 — Criar a máquina

A máquina ARM gratuita de São Paulo é disputada: o mais comum é o painel responder **"Out
of capacity"**, sem vaga — e a vaga que abre some em segundos, porque muita gente tem
programa pedindo o tempo todo. Por isso há dois caminhos para criar a máquina: pelo painel
(4.2), que serve quando há vaga, e pelo GitHub (4.3), que pede sozinho até sair. Os dois
começam pela rede.

### 4.1 — A rede, uma vez só

O painel de criar máquina oferece criar a rede junto, mas aí a chave do IP público fica
travada. Crie a rede antes:

1. Abra <https://cloud.oracle.com/networking/vcns?region=sa-saopaulo-1>.
2. **Actions → Start VCN Wizard → Create VCN with Internet Connectivity → Start VCN
   Wizard**.
3. **VCN name**: `rede-hub` — o nome importa, é por ele que o GitHub acha a rede. O resto,
   como vier. **Next → Create**.

### 4.2 — Pelo painel

1. No menu (☰), **Compute → Instances → Create instance**.
2. **Name**: `hub`.
3. **Change shape → Ampere → VM.Standard.A1.Flex**. A setinha (▸) ao lado do nome abre os
   campos: **2** OCPUs e **12** GB. Tem de aparecer a etiqueta _Always Free-eligible_ —
   **sem ela, não crie**: nos primeiros 30 dias o painel deixa criar coisa paga com o
   crédito da avaliação, e ela é desligada quando o crédito acaba. A forma vem antes da
   imagem para a lista de imagens já mostrar as versões ARM.
4. **Change image → Ubuntu → Canonical Ubuntu 24.04**. A 20.04 vem primeiro na lista e
   não recebe mais correção de segurança; a "Minimal" também não serve.
5. **Advanced options**: como vier. Em especial o **Oracle Cloud Agent**, que é por onde a
   Oracle mede o uso da máquina (passo 2).
6. **Next** até **Networking**: **Select existing virtual cloud network** → `rede-hub`;
   **Select existing subnet** → `public subnet-rede-hub`; e ligue **Automatically assign
   public IPv4 address**.
7. **Add SSH keys → Upload public key file (.pub)** → `servidor-hub.pub`. No Windows, ele
   aparece com o ícone do Microsoft Publisher, por causa do `.pub`: é ele mesmo.
8. **Storage**: como vier. Na **Review**, confira três coisas: Canonical Ubuntu 24.04,
   _Public IPv4 address: Yes_ e _SSH keys: ssh-ed25519…_. **Create**.
9. Em um ou dois minutos o estado passa a **Running**. Copie o **Public IP address** — é
   o endereço do servidor.

> **"Out of capacity"**: sem vaga naquele momento. Tentar à mão raramente acerta o
> segundo em que ela abre, e não é motivo para fazer upgrade (passo 2): use o 4.3.

### 4.3 — Pelo GitHub, até sair vaga

O workflow **criar máquina** pede a mesma máquina do 4.2 pela API da Oracle, uma vez por
minuto, dia e noite, e para sozinho quando consegue. Com ela de pé, abre as portas do
passo 5, pega a identidade do passo 6 e abre uma issue no repositório com o IP e o que
colar no passo 7 — e o GitHub avisa por e-mail.

1. **A chave de API da Oracle.** No painel, o bonequinho no canto superior direito →
   **User settings** (ou **My profile**) → **Tokens and keys** → **API keys → Add API
   key**. Deixe **Generate API key pair**, clique em **Download private key** (baixa um
   arquivo `.pem`) e só então em **Add**. Aparece o quadro **Configuration file preview**:
   **Copy**.
2. **Os segredos**, em **Settings → Secrets and variables → Actions → Secrets**:

   | Nome                 | O que colar                                                                          |
   | -------------------- | ------------------------------------------------------------------------------------ |
   | `OCI_CONFIG`         | O quadro inteiro, de `[DEFAULT]` até `key_file=…`.                                   |
   | `OCI_CHAVE`          | O `.pem`, aberto no Bloco de Notas, inclusive as linhas `-----BEGIN…` e `-----END…`. |
   | `SERVIDOR_CHAVE_SSH` | O mesmo do passo 7: o arquivo `servidor-hub`, o privado.                             |

3. **Actions → criar máquina → Run workflow**. Cada execução pede por pouco mais de cinco
   horas, e a seguinte começa sozinha, a cada seis horas. O resumo de cada uma diz quantas
   vezes pediu.

Quando a issue chegar, os passos 5 e 6 já estão feitos: siga do 7. A chave de API não é
mais necessária — apague os segredos `OCI_CONFIG` e `OCI_CHAVE` e a chave no painel.

## Passo 5 — Abrir as portas 80 e 443 na rede da Oracle

Se a máquina veio pelo 4.3, já está feito. A rede da Oracle deixa entrar só o SSH, e o
site precisa das portas da web:

1. Na página da máquina, clique no nome da **Subnet**.
2. Em **Security Lists**, abra a **Default Security List**.
3. **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Destination Port Range**: `80,443`
4. **Add Ingress Rules** para salvar.

O firewall da própria máquina, a publicação abre sozinha.

## Passo 6 — Pegar a identidade do servidor

Se a máquina veio pelo 4.3, a linha está na issue. É o que deixa o GitHub ter certeza de
que está falando com o **seu** servidor, e não com alguém no meio do caminho. No
PowerShell (ou Terminal), com o IP do passo 4:

```sh
ssh-keyscan -t ed25519 129.151.10.20
```

Ele devolve uma linha que começa com o IP e tem `ssh-ed25519 AAAA…`. Copie a linha
inteira.

Para conferir que a chave funciona (opcional):

```sh
ssh -i ~/.ssh/servidor-hub ubuntu@129.151.10.20
```

Se entrar, digite `exit`. No Windows, troque `~/.ssh` por `$env:USERPROFILE\.ssh`.

## Passo 7 — Guardar os segredos e as variáveis no GitHub

No repositório, vá em **Settings → Secrets and variables → Actions**.

Na aba **Secrets**, clique em **New repository secret** para cada um:

| Nome                 | O que colar                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVIDOR_CHAVE_SSH` | O conteúdo inteiro do arquivo `servidor-hub` (o **privado**). Abra no Bloco de Notas e copie tudo, inclusive as linhas `-----BEGIN…` e `-----END…`.                                            |
| `CADASTRO_CODIGO`    | O código que a tela "Criar conta" vai pedir. Pode ser o mesmo do seu `.env` (a linha `CADASTRO_CODIGO`), ou um novo com 12 letras e números ou mais. Guarde: ele também troca senha esquecida. |
| `LLM_API_KEY`        | _(opcional)_ A chave do OpenRouter, a mesma do seu `.env`. Sem ela, o sistema funciona e só a IA fica desligada.                                                                               |
| `BACKUP_NEON_URL`    | _(opcional)_ A cópia fora do servidor — ver o passo 10.                                                                                                                                        |

Na aba **Variables**, clique em **New repository variable** para cada uma:

| Nome                  | O que colar                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `SERVIDOR_ENDERECO`   | O IP do passo 4, por exemplo `129.151.10.20`.                                                  |
| `SERVIDOR_CHAVE_HOST` | A linha do passo 6.                                                                            |
| `SITE_ENDERECO`       | _(opcional)_ Um endereço com nome — ver [Endereço com nome](#endereço-com-nome-grátis).        |

As variáveis da marca e do perfil (`BANCADA_NOME_SISTEMA`, `BANCADA_PERFIL_PADRAO` e as
outras do `.env.example`) são opcionais: sem elas, o servidor usa as mesmas do
`.env.example`.

## Passo 8 — A primeira publicação

1. No repositório, abra a aba **Actions**, clique em **verificar** na lista da esquerda,
   e depois em **Run workflow → Branch: main → Run workflow**.
2. Espere. A primeira vez leva de 10 a 15 minutos: o servidor instala o Docker e monta
   o sistema do zero. As próximas levam uns cinco.
3. Quando os quatro quadrados ficarem verdes, abra o job **publicar**: no resumo aparece
   **✅ No ar em https://…**. Esse é o endereço do sistema.

Se o último passo ("Conferir de fora") falhar logo na primeira vez, o mais comum é o
certificado HTTPS ainda estar sendo emitido: espere uns minutos e abra o endereço. Se
continuar sem abrir, confira as portas do passo 5.

## Passo 9 — Criar a sua conta

Abra o endereço, clique em **Criar conta** e preencha nome, e-mail, uma senha de dez
caracteres ou mais e o código de cadastro (o `CADASTRO_CODIGO` do passo 7). Pronto: o
sistema está no ar, e só entra quem tem conta.

No celular, o menu do navegador tem **Adicionar à tela inicial**: o leitor de código de
barras vira um ícone, como um aplicativo.

## Passo 10 (opcional) — A cópia fora do servidor, no Neon

O servidor copia o banco todo dia às 03:00 e guarda sete dias. Isso protege contra erro
— apagar o que não devia —, mas não contra perder a máquina. Para isso existe a cópia
no Neon, um Postgres gratuito em outra empresa:

1. Crie a conta em <https://neon.com> (plano Free).
2. **Create project**: Postgres **18** (ou 17, se o 18 não estiver na lista), região
   **AWS São Paulo** se houver.
3. No painel do projeto, **Connect**, e copie a _connection string_ (começa com
   `postgresql://`).
4. No GitHub, crie o segredo `BACKUP_NEON_URL` com ela, e rode a publicação de novo
   (passo 8, ou qualquer push).

A partir daí, a cópia das 03:00 também vai para o Neon. Para conferir quando quiser:
**Actions → manutenção → Run workflow → testar-backup**. Toda segunda de manhã esse
teste roda sozinho, e o GitHub manda e-mail se falhar.

---

## No dia a dia

- **Mudança**: entrou no `main`, vai para o ar em uns cinco minutos. O rodapé de toda
  tela diz a versão no ar — "atualizado em 25/09/2026 às 14:05 (3f9c2a1)" —, então dá
  para saber se a mudança já chegou.
- **Publicação que falhou**: o GitHub manda e-mail, e a versão anterior continua no ar.
  O log da aba Actions diz em que passo parou.
- **Os botões do servidor** ficam em **Actions → manutenção → Run workflow**:

  | Botão           | O que faz                                                                          |
  | --------------- | ---------------------------------------------------------------------------------- |
  | `diagnostico`   | Versão no ar, contêineres, saúde, disco, erros do dia e a lista de cópias.         |
  | `reiniciar`     | Reinicia o site e a fila.                                                          |
  | `backup-agora`  | Uma cópia do banco na hora.                                                        |
  | `testar-backup` | Abre a cópia mais nova num banco à parte e conta o que tem nela.                   |
  | `restaurar`     | Volta o banco para uma cópia. Pede o nome da cópia e a palavra `RESTAURAR`.        |

- **Fechar o cadastro**: depois de criar a sua conta, você pode apagar o segredo
  `CADASTRO_CODIGO`; na próxima publicação ninguém mais cria conta. O "esqueci a senha"
  usa o mesmo código e fecha junto.

## Quanto custa

| Peça                                   | Custo                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| Servidor (Oracle Always Free)          | R$ 0 — 2 OCPUs ARM, 12 GB de memória, até 200 GB de disco            |
| Publicação (GitHub Actions)            | R$ 0 — repositório público não paga minuto                           |
| Endereço (sslip.io ou DuckDNS)         | R$ 0                                                                 |
| Cópia fora do servidor (Neon)          | R$ 0 — plano Free                                                    |
| **Mais tarde, se quiser**: domínio próprio `.com.br` | uns R$ 40 por ano                                      |

**Sobre o repositório ser público**: qualquer pessoa pode ler o código — é isso que
deixa o GitHub Actions de graça sem limite de minutos. Nenhum segredo e nenhum dado
estão no repositório: segredos ficam em _Secrets_, dados ficam no servidor. O log das
publicações também é público, e por isso o servidor nunca devolve dado de negócio nele,
só estado e contagem.

## Endereço com nome (grátis)

O endereço do sslip.io funciona, mas é o IP com tracinhos. Para um nome como
`minhaloja.duckdns.org`, também de graça:

1. Entre em <https://www.duckdns.org> com a conta do Google ou do GitHub.
2. Crie o subdomínio (`minhaloja`) e, no campo **current ip**, ponha o IP do servidor.
3. No GitHub, crie a variável `SITE_ENDERECO` = `minhaloja.duckdns.org` e rode a
   publicação.

Há um motivo técnico a mais para o DuckDNS: o certificado HTTPS gratuito (Let's Encrypt)
tem um limite semanal por domínio, e todos os usuários do sslip.io do mundo dividem o
limite de `sslip.io`. O projeto do sslip.io conseguiu limites maiores, e o Caddy tenta
um segundo emissor gratuito (ZeroSSL) quando o primeiro recusa — mas se um dia o
certificado não sair, o DuckDNS resolve, porque cada nome dele conta como domínio
próprio.

Com domínio próprio comprado, é a mesma coisa: aponte o domínio para o IP (registro
`A`) e ponha o nome em `SITE_ENDERECO`.

## Quando algo dá errado

**O job `preparar` diz "O servidor não aceitou a conexão".** Confira o IP em
`SERVIDOR_ENDERECO`, se o segredo `SERVIDOR_CHAVE_SSH` tem o arquivo **privado**
inteiro, e se a máquina está _Running_ no painel da Oracle.

**"Host key verification failed".** A variável `SERVIDOR_CHAVE_HOST` não bate com o
servidor — acontece quando a máquina é recriada. Refaça o passo 6.

**O site não abre, mas a publicação passou até "Trocar a versão no ar".** Quase sempre
são as portas do passo 5. Se estiverem certas, pode ser o certificado: rode
**manutenção → diagnostico** e, se o `caddy` estiver de pé, espere alguns minutos ou
passe para o DuckDNS.

**Criar a máquina dá "Out of capacity".** Ver o passo 4.3.

**O workflow "criar máquina" termina em erro.** A mensagem diz o que conferir: quase
sempre um segredo colado pela metade (o quadro sem uma linha, o `.pem` sem o `-----END…`),
ou a rede com outro nome que não `rede-hub`. Corrija e rode de novo.

**A Oracle avisou que a máquina está ociosa.** Rode **manutenção → diagnostico**. Em
"contêineres", o `reserva` tem de estar `running`; em "disco e memória", a coluna
`used` da linha `Mem:` tem de passar de um quarto do `total`. Se os dois estiverem
certos e o aviso veio mesmo assim, a Oracle mudou a regra, e a reserva precisa ser
revista (ADR 0012).

**Nunca apague `/opt/hub/banco.env` nem `/opt/hub/app.env` no servidor.** O primeiro
tem a senha do banco, que já existe com ela; o segundo, a chave que protege as sessões
e as credenciais guardadas.

**Recomeçar num servidor novo** (a máquina foi recolhida, ou você recriou): crie a
máquina de novo (passos 4 a 6), atualize `SERVIDOR_ENDERECO` e `SERVIDOR_CHAVE_HOST`, e
rode a publicação. O sistema sobe vazio. Para trazer os dados de volta a partir do
Neon, entre no servidor por SSH (passo 6) e rode:

```sh
cd /opt/hub && docker compose run --rm --no-deps -T --entrypoint bash backup -c \
  'pg_dump "$BACKUP_NEON_URL" --format=custom --no-owner --file=/backups/banco-$(date +%Y-%m-%d_%H%M%S).dump'
ls backups
```

Depois, em **manutenção → restaurar**, use o nome do arquivo que apareceu e a palavra
`RESTAURAR`.
