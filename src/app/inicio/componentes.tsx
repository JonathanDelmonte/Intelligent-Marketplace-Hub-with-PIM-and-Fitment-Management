/**
 * Componentes da tela inicial. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O que decide texto, tom e ordem está em `apresentacao.ts`, com teste. Aqui só há onde
 * cada coisa fica — e o porquê de cada escolha de forma está no cabeçalho de
 * `inicio.module.css`.
 */
import Link from 'next/link';
import { CAMINHO as CAMINHO_DO_ASSISTENTE, PERGUNTAS_PRONTAS } from '../assistente/constantes';
import { IconeDaPorta } from '../icones';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { CAMINHO_DAS_LOJAS, caminhoDaLoja, portasPorGrupo } from '../navegacao';
import type { CartaoDaLoja, Pendencia, Tom } from './apresentacao';
import estilo from './inicio.module.css';

const CLASSE_DO_CARTAO: Readonly<Record<Tom, string>> = {
  agora: `${estilo.cartao} ${estilo.cartaoAgora}`,
  atencao: `${estilo.cartao} ${estilo.cartaoAtencao}`,
  calmo: estilo.cartao,
};

const CLASSE_DA_GRAVIDADE: Readonly<Record<Tom, string>> = {
  agora: `${estilo.gravidade} ${estilo.gravidadeAgora}`,
  atencao: `${estilo.gravidade} ${estilo.gravidadeAtencao}`,
  calmo: `${estilo.gravidade} ${estilo.gravidadeCalmo}`,
};

/**
 * A palavra da gravidade, que é a informação que a cor só reforça.
 *
 * Cor sozinha não informa: quem não distingue vermelho de amarelo veria dois cartões
 * iguais. Por isso a palavra aparece escrita, e a cor é atalho para quem a vê.
 */
const PALAVRA_DA_GRAVIDADE: Readonly<Record<Tom, string>> = {
  agora: 'Agora',
  atencao: 'Atenção',
  calmo: 'Em dia',
};

/**
 * O número do cartão.
 *
 * `—` para leitura que falhou, e não `0`: zero é uma afirmação sobre o banco, e aqui não
 * se sabe. Quantidade zero existe e aparece como zero, em cinza.
 */
function Numero({ quantidade }: { readonly quantidade: number | null }) {
  const fraco = quantidade === null || quantidade === 0;
  return (
    <span className={fraco ? `${estilo.numero} ${estilo.numeroFraco}` : estilo.numero}>
      {quantidade === null ? '—' : quantidade.toLocaleString('pt-BR')}
    </span>
  );
}

/** Os cartões do que pede atenção, na ordem de gravidade que `apresentacao` decidiu. */
export function Cartoes({ itens }: { readonly itens: readonly Pendencia[] }) {
  return (
    <ul className={estilo.cartoes}>
      {itens.map((item) => (
        <li key={item.chave}>
          <Link className={CLASSE_DO_CARTAO[item.tom]} href={item.href}>
            <span className={CLASSE_DA_GRAVIDADE[item.tom]}>{PALAVRA_DA_GRAVIDADE[item.tom]}</span>
            <Numero quantidade={item.quantidade} />
            <span className={estilo.cartaoTitulo}>{item.titulo}</span>
            <span className={estilo.cartaoOQueE}>{item.oQueE}</span>
            <span className={estilo.abrir} aria-hidden="true">
              Abrir →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * O que está zerado, em uma linha recolhida.
 *
 * Fechado por padrão, e é a decisão de layout mais importante desta tela: a referência
 * mostra oito contadores do mesmo tamanho, e no dia comum sete são zero. Continua
 * consultável — o `details` abre — e para de gastar a atenção do cartão urgente.
 */
export function Calmas({ itens }: { readonly itens: readonly Pendencia[] }) {
  if (itens.length === 0) return null;

  return (
    <details className={estilo.calmas}>
      <summary className={estilo.calmasResumo}>
        {itens.length === 1
          ? '1 tela em dia, sem nada esperando'
          : `${String(itens.length)} telas em dia, sem nada esperando`}
      </summary>
      <ul className={estilo.calmasLista}>
        {itens.map((item) => (
          <li key={item.chave}>
            <Link className={estilo.calma} href={item.href}>
              <span className={estilo.calmaTitulo}>{item.titulo}</span> · {item.oQueE}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * As portas do sistema, agrupadas pelo momento de trabalho.
 *
 * Ficam abaixo dos cartões porque respondem outra pergunta: os de cima são "o que eu
 * faço agora", este é "o que este sistema faz". A segunda é a de quem está aprendendo —
 * e a de quem quer ir a uma tela que ninguém está cobrando.
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
                    <span className={estilo.portaTitulo}>{porta.rotulo}</span>
                    <span className={estilo.portaDescricao}>{porta.descricao}</span>
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
      <h2 className={estilo.pergunteTitulo} id="pergunte-titulo">
        <IconeDaPorta nome="assistente" tamanho={20} />
        Pergunte à IA
      </h2>
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
        {PERGUNTAS_PRONTAS.map((p) => (
          <li key={p.id}>
            <Link className={estilo.pronta} href={`${CAMINHO_DO_ASSISTENTE}?pronta=${p.id}`}>
              {p.rotulo}
            </Link>
          </li>
        ))}
      </ul>
      <p className={estilo.pergunteNota}>
        Os números saem do seu banco. A IA só entende a pergunta, e as prontas nem precisam dela.
      </p>
    </section>
  );
}

/** Um cartão por loja, e o de adicionar loja no fim. */
export function Lojas({ cartoes }: { readonly cartoes: readonly CartaoDaLoja[] }) {
  return (
    <ul className={estilo.lojas}>
      {cartoes.map((c) => (
        <li key={c.plataforma}>
          {c.semDados ? (
            <div className={estilo.loja}>
              <div className={estilo.lojaCabecalho}>
                <Selo identidade={IDENTIDADE_DA_LOJA[c.plataforma]} tamanho={34} />
                <span>
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
                <Selo identidade={IDENTIDADE_DA_LOJA[c.plataforma]} tamanho={34} />
                <span>
                  <span className={estilo.lojaNome}>{c.nome}</span>
                  <span className={estilo.lojaLegenda}>{c.legenda}</span>
                </span>
              </div>
              <span className={estilo.lojaValor}>{c.faturamento}</span>
              <span className={estilo.lojaDetalhe}>{c.detalhe}</span>
              {c.participacaoBp !== null && (
                <>
                  <span aria-hidden="true" className={estilo.fatia}>
                    <span
                      className={estilo.fatiaCheia}
                      style={{ width: `${String(c.participacaoBp / 100)}%` }}
                    />
                  </span>
                  <span className={estilo.lojaDetalhe}>{c.participacao}</span>
                </>
              )}
            </Link>
          )}
        </li>
      ))}
      <li>
        <Link className={estilo.adicionarLoja} href={CAMINHO_DAS_LOJAS}>
          <IconeDaPorta nome="adicionar" tamanho={20} />
          <span className={estilo.lojaNome}>Adicionar loja</span>
          <span className={estilo.lojaDetalhe}>
            Shein, AliExpress, Magalu, TikTok Shop: o que falta para cada uma entrar.
          </span>
        </Link>
      </li>
    </ul>
  );
}
