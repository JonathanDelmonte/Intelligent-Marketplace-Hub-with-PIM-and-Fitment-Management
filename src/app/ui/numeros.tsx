/**
 * A faixa de números do alto de uma tela, no desenho aprovado na Catálogo e preço.
 *
 * Cada número num cartão: o ícone num quadrado, o nome do número, o número grande e uma
 * nota embaixo. Um cartão por tela pode ser escuro, na cor da lateral: o do número que
 * mais importa ali. `base` é o desenho do pé do cartão (uma barra, uma lista curta),
 * quando o número pede um. Com `href`, o cartão inteiro vira link: o número "4 atrasados"
 * leva aos quatro.
 *
 * Sem estado e sem diretiva: serve às telas de servidor e às de navegador.
 */
import type { ReactNode } from 'react';
import estilo from './numeros.module.css';

/** A cor da nota: subiu (verde), caiu (vermelho), pede atenção (âmbar), ou nada. */
export type TomDoNumero = 'neutro' | 'alta' | 'baixa' | 'atencao';

export interface NumeroDoPainel {
  readonly rotulo: string;
  readonly valor: string;
  /** Texto menor logo depois do número: "unidades", "de 5". */
  readonly resto?: string;
  readonly nota?: string | null;
  readonly tom?: TomDoNumero;
  readonly icone: ReactNode;
  readonly escuro?: boolean;
  readonly base?: ReactNode;
  /** Para onde o cartão leva, quando o número tem uma lista por trás. */
  readonly href?: string;
}

const CLASSE_DA_NOTA: Readonly<Record<TomDoNumero, readonly [string, string]>> = {
  neutro: [estilo.nota, estilo.notaEscura],
  alta: [estilo.notaAlta, estilo.notaAltaEscura],
  baixa: [estilo.notaBaixa, estilo.notaBaixaEscura],
  atencao: [estilo.notaAtencao, estilo.notaAtencaoEscura],
};

export function CartaoDeNumero({ numero }: { readonly numero: NumeroDoPainel }) {
  const escuro = numero.escuro === true;
  const [clara, escura] = CLASSE_DA_NOTA[numero.tom ?? 'neutro'];
  const conteudo = (
    <>
      <div className={estilo.topo}>
        <span className={escuro ? estilo.iconeEscuro : estilo.icone}>{numero.icone}</span>
        <span className={escuro ? estilo.rotuloEscuro : estilo.rotulo}>{numero.rotulo}</span>
      </div>
      <p className={escuro ? estilo.valorEscuro : estilo.valor}>
        {numero.valor}
        {numero.resto === undefined ? null : (
          <span className={escuro ? estilo.restoEscuro : estilo.resto}> {numero.resto}</span>
        )}
      </p>
      {numero.nota === undefined || numero.nota === null ? null : (
        <p className={escuro ? escura : clara}>{numero.nota}</p>
      )}
      {numero.base === undefined ? null : <div className={estilo.base}>{numero.base}</div>}
    </>
  );
  const classe = escuro ? estilo.cartaoEscuro : estilo.cartao;
  return numero.href === undefined ? (
    <div className={classe}>{conteudo}</div>
  ) : (
    <a className={`${classe} ${estilo.cartaoLink}`} href={numero.href}>
      {conteudo}
    </a>
  );
}

export function FaixaDeNumeros({
  rotulo,
  itens,
}: {
  /** O nome da faixa para o leitor de tela: "Todas as lojas nos últimos 30 dias". */
  readonly rotulo: string;
  readonly itens: readonly NumeroDoPainel[];
}) {
  return (
    <section aria-label={rotulo} className={estilo.faixa}>
      {itens.map((numero) => (
        <CartaoDeNumero key={numero.rotulo} numero={numero} />
      ))}
    </section>
  );
}
