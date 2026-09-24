/**
 * Componentes da tela inicial. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O que decide texto, tom e ordem está em `apresentacao.ts`, com teste. Aqui só há onde
 * cada coisa fica — e o porquê de cada escolha de forma está no cabeçalho de
 * `inicio.module.css`.
 */
import Link from 'next/link';
import { portasPorGrupo } from '../navegacao';
import type { Pendencia, Tom } from './apresentacao';
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
