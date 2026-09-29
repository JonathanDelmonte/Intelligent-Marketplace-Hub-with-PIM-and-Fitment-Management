/**
 * Componentes da tela inicial. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O que decide texto, tom e ordem está em `apresentacao.ts`, com teste. Aqui só há onde
 * cada coisa fica, no desenho aprovado na Catálogo e preço: o porquê de cada escolha de
 * forma está no cabeçalho de `inicio.module.css`.
 */
import Link from 'next/link';
import {
  CAMINHO as CAMINHO_DO_ASSISTENTE,
  PERGUNTAS_PRONTAS,
  PRONTAS_NA_VISAO_GERAL,
} from '../assistente/constantes';
import { IconeDaPorta } from '../icones';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { CAMINHO_DAS_LOJAS, caminhoDaLoja, portasPorGrupo } from '../navegacao';
import { SinalAvancar, SinalCerto, SinalFaisca } from '../ui/sinais';
import type { CartaoDaLoja, Pendencia, Tom } from './apresentacao';
import estilo from './inicio.module.css';

/**
 * A palavra da gravidade, que é a informação que a cor só reforça.
 *
 * Cor sozinha não informa: quem não distingue vermelho de amarelo veria duas linhas
 * iguais. Por isso a palavra fica no leitor de tela e na dica, e a cor é atalho para
 * quem a vê.
 */
const PALAVRA_DA_GRAVIDADE: Readonly<Record<Tom, string>> = {
  agora: 'Agora',
  atencao: 'Atenção',
  calmo: 'Em dia',
};

const CLASSE_DO_PONTO: Readonly<Record<Tom, string>> = {
  agora: estilo.pontoAgora,
  atencao: estilo.pontoAtencao,
  calmo: estilo.pontoCalmo,
};

/**
 * O que fazer hoje: uma linha por tela que pede alguma coisa, na ordem de gravidade que
 * `apresentacao` decidiu, e o que está em dia recolhido no pé.
 *
 * Mora ao lado do gráfico, como o "precisa de você" da área da loja: o número do negócio
 * de um lado, o trabalho do dia do outro. A versão anterior eram cartões com borda
 * colorida de um lado e o rótulo em caixa alta, que o dono apontou como tela feita no
 * automático.
 */
export function OQueFazer({
  resumo,
  ativas,
  calmas,
}: {
  readonly resumo: string;
  readonly ativas: readonly Pendencia[];
  readonly calmas: readonly Pendencia[];
}) {
  return (
    <section aria-labelledby="hoje-titulo" className={estilo.fazer}>
      <h2 className={estilo.blocoTitulo} id="hoje-titulo">
        O que fazer hoje
      </h2>
      <p className={estilo.blocoTexto}>{resumo}</p>
      {ativas.length === 0 ? (
        <p className={estilo.tudoEmDia}>
          <span className={estilo.tudoEmDiaSinal}>
            <SinalCerto tamanho={14} />
          </span>
          Nenhuma tela esperando você.
        </p>
      ) : (
        <ul className={estilo.itens}>
          {ativas.map((item) => (
            <li className={estilo.item} key={item.chave}>
              <span aria-hidden="true" className={CLASSE_DO_PONTO[item.tom]} />
              <span
                className={item.quantidade === null ? estilo.itemNumeroVazio : estilo.itemNumero}
              >
                {item.quantidade === null ? '?' : item.quantidade.toLocaleString('pt-BR')}
              </span>
              <span className={estilo.itemTextos}>
                <span className={estilo.itemTitulo}>
                  <span className="sr-only">{PALAVRA_DA_GRAVIDADE[item.tom]}: </span>
                  {item.titulo}
                </span>
                <span className={estilo.itemDetalhe}>{item.oQueE}</span>
              </span>
              <Link className={estilo.itemAbrir} href={item.href}>
                Abrir
                <SinalAvancar tamanho={12} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {calmas.length === 0 ? null : (
        <details className={estilo.calmas}>
          <summary className={estilo.calmasResumo}>
            {calmas.length === 1
              ? '1 tela em dia, sem nada esperando'
              : `${String(calmas.length)} telas em dia, sem nada esperando`}
          </summary>
          <ul className={estilo.calmasLista}>
            {calmas.map((item) => (
              <li key={item.chave}>
                <Link className={estilo.calma} href={item.href}>
                  <span className={estilo.calmaTitulo}>{item.titulo}</span>
                  <span className={estilo.calmaDetalhe}>{item.oQueE}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * As portas do sistema, agrupadas pelo momento de trabalho.
 *
 * Ficam no pé porque respondem outra pergunta: o alto é "o que eu faço agora", isto é "o
 * que este sistema faz". A segunda é a de quem está aprendendo, e a de quem quer ir a uma
 * tela que ninguém está cobrando.
 */
export function Portas() {
  return (
    <>
      {portasPorGrupo().map((grupo) => (
        <section
          aria-labelledby={`grupo-${grupo.grupo}`}
          className={estilo.grupo}
          key={grupo.grupo}
        >
          <h3 className={estilo.grupoTitulo} id={`grupo-${grupo.grupo}`}>
            {grupo.titulo ?? 'Dia a dia'}
          </h3>
          <ul className={estilo.portas}>
            {grupo.portas
              .filter((porta) => porta.descricao !== null)
              .map((porta) => (
                <li key={porta.href}>
                  <Link className={estilo.porta} href={porta.href}>
                    <span className={estilo.portaIcone}>
                      <IconeDaPorta nome={porta.icone} tamanho={16} />
                    </span>
                    <span className={estilo.portaTextos}>
                      <span className={estilo.portaTitulo}>{porta.rotulo}</span>
                      <span className={estilo.portaDescricao}>{porta.descricao}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * A caixa do assistente, no alto da visão geral.
 *
 * Um formulário GET para `/assistente`: a pergunta viaja na URL e o assistente responde
 * lá. As perguntas prontas são links, e nenhuma gasta a cota de IA.
 */
export function PergunteAIA() {
  return (
    <section aria-labelledby="pergunte-titulo" className={estilo.pergunte}>
      <div className={estilo.pergunteTopo}>
        <span className={estilo.pergunteIcone}>
          <SinalFaisca />
        </span>
        <h2 className={estilo.blocoTitulo} id="pergunte-titulo">
          Pergunte à IA
        </h2>
        <p className={estilo.pergunteNota}>
          Os números saem do seu banco. A IA só entende a pergunta, e as prontas nem precisam dela.
        </p>
      </div>
      <form action={CAMINHO_DO_ASSISTENTE} className={estilo.pergunteLinha} method="get">
        <label className="sr-only" htmlFor="pergunta-inicio">
          Sua pergunta
        </label>
        <input
          className={estilo.pergunteCampo}
          id="pergunta-inicio"
          name="pergunta"
          placeholder="Ex.: qual foi meu faturamento na Shopee?"
          type="text"
        />
        <button className={estilo.pergunteBotao} type="submit">
          Perguntar
        </button>
      </form>
      <ul aria-label="Perguntas prontas" className={estilo.prontas}>
        {PERGUNTAS_PRONTAS.slice(0, PRONTAS_NA_VISAO_GERAL).map((p) => (
          <li key={p.id}>
            <Link className={estilo.pronta} href={`${CAMINHO_DO_ASSISTENTE}?pronta=${p.id}`}>
              {p.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Um cartão por loja, e o de adicionar loja no fim.
 *
 * A barra de cada loja vai na cor dela: é a única cor de loja fora do selo, e é o que
 * faz "o Mercado Livre é dois terços do faturamento" se ler antes do número.
 */
export function Lojas({ cartoes }: { readonly cartoes: readonly CartaoDaLoja[] }) {
  return (
    <ul className={estilo.lojas}>
      {cartoes.map((c) => (
        <li key={c.plataforma}>
          {c.semDados ? (
            <div className={estilo.loja}>
              <div className={estilo.lojaCabecalho}>
                <Selo identidade={IDENTIDADE_DA_LOJA[c.plataforma]} tamanho={32} />
                <span className={estilo.lojaTextos}>
                  <Link className={estilo.lojaNome} href={caminhoDaLoja(c.plataforma)}>
                    {c.nome}
                  </Link>
                  <span className={estilo.lojaLegenda}>{c.legenda}</span>
                </span>
              </div>
              <p className={estilo.lojaDetalhe}>
                Importe a planilha de pedidos, e os números aparecem aqui.
              </p>
              <Link className={estilo.lojaAcao} href={`/importar?loja=${c.plataforma}`}>
                Importar planilha
              </Link>
            </div>
          ) : (
            <Link className={estilo.loja} href={caminhoDaLoja(c.plataforma)}>
              <div className={estilo.lojaCabecalho}>
                <Selo identidade={IDENTIDADE_DA_LOJA[c.plataforma]} tamanho={32} />
                <span className={estilo.lojaTextos}>
                  <span className={estilo.lojaNome}>{c.nome}</span>
                  <span className={estilo.lojaLegenda}>{c.legenda}</span>
                </span>
              </div>
              <span className={estilo.lojaValor}>{c.faturamento}</span>
              <span className={estilo.lojaDetalhe}>{c.detalhe}</span>
              {c.participacaoBp !== null && (
                <span className={estilo.lojaRodape}>
                  <span aria-hidden="true" className={estilo.fatia}>
                    <span
                      className={estilo.fatiaCheia}
                      style={{
                        background: IDENTIDADE_DA_LOJA[c.plataforma].fundo,
                        width: `${String(c.participacaoBp / 100)}%`,
                      }}
                    />
                  </span>
                  <span className={estilo.lojaDetalhe}>{c.participacao}</span>
                </span>
              )}
            </Link>
          )}
        </li>
      ))}
      <li>
        <Link className={estilo.adicionarLoja} href={CAMINHO_DAS_LOJAS}>
          <span className={estilo.adicionarIcone}>
            <IconeDaPorta nome="adicionar" tamanho={18} />
          </span>
          <span className={estilo.lojaNome}>Adicionar loja</span>
          <span className={estilo.lojaDetalhe}>
            Shein, AliExpress, Magalu, TikTok Shop: o que falta para cada uma entrar.
          </span>
        </Link>
      </li>
    </ul>
  );
}
