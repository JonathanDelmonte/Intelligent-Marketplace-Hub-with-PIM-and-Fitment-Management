/**
 * A lateral de navegação (ADR 0009).
 *
 * Seis grupos: o topo do dia a dia, as lojas — cada uma com a área dela —, e o que
 * serve a todas as lojas, uma vez só. O botão "Importar arquivo" fica acima de tudo,
 * porque tudo entra por ele.
 *
 * É o único componente de cliente da casca, por dois motivos:
 *
 * 1. Saber **qual tela está aberta** para marcá-la. Isso depende do caminho da URL, que
 *    no App Router só existe no cliente (`usePathname`) — um layout de servidor não o
 *    recebe, e passar o caminho de cada `page.tsx` obrigaria quinze telas a lembrar.
 * 2. Mostrar **o estado de agora** de cada loja. O layout não se refaz na navegação,
 *    então números vindos dele congelariam; a barra pede o estado de novo a cada troca
 *    de tela (`barra/leitura.ts`). Sem resposta, as lojas continuam na barra, sem
 *    números — a navegação nunca depende da leitura.
 *
 * Nome do sistema vem por propriedade, do servidor: marca é configuração, e este
 * arquivo não pode ler `.env` (ADR 0003).
 *
 * Nas telas de acesso (entrar, criar conta) a barra não aparece: quem ainda não entrou
 * não tem para onde ir (ADR 0011). O nome de quem entrou vem com o estado da barra, e o
 * botão de sair fica embaixo dele — sempre, mesmo quando a leitura falha.
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { sair } from './acesso/acoes';
import { ehCaminhoPublico } from './acesso/caminhos';
import {
  CAMINHO_DO_ESTADO_DA_BARRA,
  lerEstadoDaBarra,
  type EstadoDaBarra,
  type EstadoDaLojaNaBarra,
} from './barra/leitura';
import { IconeDaPorta } from './icones';
import { IDENTIDADE_DA_LOJA } from './lojas/identidade';
import { Selo } from './lojas/selo';
import {
  PORTAS,
  hrefAtual,
  portasDasLojas,
  portasPorGrupo,
  type Porta,
  type PortaDeLoja,
} from './navegacao';
import estilo from './casca.module.css';

/**
 * A inicial do nome do sistema, para o quadrado da marca.
 *
 * Do nome em runtime, e não de um arquivo: instalação sem logo cadastrado é o caso
 * comum, e quadrado vazio é pior que inicial. `toLocaleUpperCase('pt-BR')` porque a
 * inicial pode ser acentuada.
 */
function sigla(nomeSistema: string): string {
  return (nomeSistema.trim()[0] ?? '?').toLocaleUpperCase('pt-BR');
}

const CLASSE_DO_PONTO: Readonly<Record<EstadoDaLojaNaBarra['tipo'], string>> = {
  conectada: `${estilo.ponto} ${estilo.pontoConectada}`,
  planilha: `${estilo.ponto} ${estilo.pontoPlanilha}`,
  sem_dados: `${estilo.ponto} ${estilo.pontoSemDados}`,
};

/** Os grupos, sem o destaque — que vira o botão do alto. */
const GRUPOS_DA_BARRA = portasPorGrupo(PORTAS.filter((p) => !p.destaque));
const DESTAQUE = PORTAS.find((p) => p.destaque) ?? null;
const LOJAS = portasDasLojas();

function Contagem({ valor }: { readonly valor: number | undefined }) {
  if (valor === undefined || valor === 0) return null;
  return <span className={estilo.contagem}>{valor}</span>;
}

function LinhaDaPorta({
  porta,
  atual,
  contagem,
}: {
  readonly porta: Porta;
  readonly atual: boolean;
  readonly contagem: number | undefined;
}) {
  return (
    <Link
      aria-current={atual ? 'page' : undefined}
      className={atual ? `${estilo.porta} ${estilo.portaAtual}` : estilo.porta}
      href={porta.href}
    >
      <IconeDaPorta className={estilo.icone} nome={porta.icone} />
      <span className={estilo.portaRotulo}>{porta.rotulo}</span>
      <Contagem valor={contagem} />
    </Link>
  );
}

function LinhaDaLoja({
  loja,
  atual,
  estado,
}: {
  readonly loja: PortaDeLoja;
  readonly atual: boolean;
  readonly estado: EstadoDaLojaNaBarra | undefined;
}) {
  return (
    <Link
      aria-current={atual ? 'page' : undefined}
      className={atual ? `${estilo.loja} ${estilo.portaAtual}` : estilo.loja}
      href={loja.href}
    >
      <span className={estilo.seloComPonto}>
        <Selo identidade={IDENTIDADE_DA_LOJA[loja.plataforma]} tamanho={26} />
        {estado !== undefined && (
          <span aria-hidden="true" className={CLASSE_DO_PONTO[estado.tipo]} />
        )}
      </span>
      <span className={estilo.lojaTextos}>
        <span className={estilo.portaRotulo}>{loja.rotulo}</span>
        {estado !== undefined && <span className={estilo.lojaLegenda}>{estado.legenda}</span>}
      </span>
      <Contagem valor={estado?.paraPostar} />
    </Link>
  );
}

function Conta({ nome }: { readonly nome: string | null }) {
  return (
    <form action={sair} className={estilo.conta}>
      <span className={estilo.contaNome} title={nome ?? undefined}>
        {nome ?? ''}
      </span>
      <button className={estilo.sair} type="submit">
        Sair
      </button>
    </form>
  );
}

export function Lateral({ nomeSistema }: { readonly nomeSistema: string }) {
  const caminho = usePathname();
  const atual = hrefAtual(caminho);
  const publico = ehCaminhoPublico(caminho);
  const [estado, setEstado] = useState<EstadoDaBarra | null>(null);

  useEffect(() => {
    if (publico) return;
    const controle = new AbortController();
    void fetch(CAMINHO_DO_ESTADO_DA_BARRA, { cache: 'no-store', signal: controle.signal })
      .then((resposta): Promise<unknown> | null => (resposta.ok ? resposta.json() : null))
      .then((corpo) => {
        setEstado(lerEstadoDaBarra(corpo));
      })
      .catch(() => {
        // Abortado pela troca de tela, ou sem rede: fica o que já estava na barra.
      });
    return () => {
      controle.abort();
    };
  }, [caminho, publico]);

  if (publico) return null;

  const estadoDaLoja = (loja: PortaDeLoja) =>
    estado?.lojas.find((l) => l.plataforma === loja.plataforma);

  return (
    <div className={estilo.colunaLateral}>
      <aside className={estilo.lateral}>
        <div className={estilo.marca}>
          <span aria-hidden="true" className={estilo.sigla}>
            {sigla(nomeSistema)}
          </span>
          <span className={estilo.nomeDoSistema}>{nomeSistema}</span>
        </div>

        {DESTAQUE !== null && (
          <Link
            aria-current={atual === DESTAQUE.href ? 'page' : undefined}
            className={estilo.destaque}
            href={DESTAQUE.href}
          >
            <IconeDaPorta nome={DESTAQUE.icone} tamanho={17} />
            <span>{DESTAQUE.rotulo}</span>
          </Link>
        )}

        <nav aria-label="Telas do sistema" className={estilo.navegacao}>
          {GRUPOS_DA_BARRA.map((grupo) => (
            <div className={estilo.grupo} key={grupo.grupo}>
              {grupo.titulo !== null && (
                <h2 className={estilo.grupoTitulo} id={`lateral-${grupo.grupo}`}>
                  {grupo.titulo}
                </h2>
              )}
              <ul
                aria-label={grupo.titulo === null ? 'Dia a dia' : undefined}
                aria-labelledby={grupo.titulo === null ? undefined : `lateral-${grupo.grupo}`}
                className={estilo.portas}
              >
                {grupo.grupo === 'lojas' &&
                  LOJAS.map((loja) => (
                    <li key={loja.href}>
                      <LinhaDaLoja
                        atual={loja.href === atual}
                        estado={estadoDaLoja(loja)}
                        loja={loja}
                      />
                    </li>
                  ))}
                {grupo.portas.map((porta) => (
                  <li key={porta.href}>
                    <LinhaDaPorta
                      atual={porta.href === atual}
                      contagem={porta.href === '/postagem' ? estado?.postarHoje : undefined}
                      porta={porta}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <Conta nome={estado?.conta?.nome ?? null} />
      </aside>
    </div>
  );
}
