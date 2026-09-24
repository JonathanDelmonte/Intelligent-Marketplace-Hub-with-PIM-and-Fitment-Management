/**
 * Rótulos de interface para as enumerações de plataforma e de anúncio.
 *
 * Saiu de duas telas no dia em que a terceira precisou — a de catálogo. `ml` é nome de
 * coluna, "Mercado Livre" é o que se lê, e a fronteira entre os dois é o
 * `apresentacao.ts` de cada tela (C.2). O que não dá é cada tela escrever a sua tabela:
 * `anuncios` e `afiliados` já tinham a mesma, e a terceira cópia é a que começa a
 * divergir.
 *
 * Nenhum rótulo aqui é nome de marca do vendedor — são nomes das plataformas onde ele
 * vende, que é dado do mundo (ADR 0003).
 */
import type { ModoFrete, Plataforma, TipoAnuncioML } from '@/dominio/precificacao/tipos';

export const ROTULO_DA_PLATAFORMA: Readonly<Record<Plataforma, string>> = {
  ml: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
};

/**
 * O artigo de cada loja: "o Mercado Livre", "a Shopee".
 *
 * Existe porque a área da loja é uma tela só para todas, e frase montada com "a" fixo
 * escrevia "o que a Mercado Livre pagou". O gênero é do nome, e o nome é dado do mundo.
 */
const ARTIGO_DA_PLATAFORMA: Readonly<Record<Plataforma, 'o' | 'a'>> = {
  ml: 'o',
  shopee: 'a',
  amazon: 'a',
};

/** "o Mercado Livre", "a Shopee". */
export function aLoja(plataforma: Plataforma): string {
  return `${ARTIGO_DA_PLATAFORMA[plataforma]} ${ROTULO_DA_PLATAFORMA[plataforma]}`;
}

/** "do Mercado Livre", "da Shopee". */
export function daLoja(plataforma: Plataforma): string {
  return `d${aLoja(plataforma)}`;
}

/** "no Mercado Livre", "na Shopee". */
export function naLoja(plataforma: Plataforma): string {
  return `n${aLoja(plataforma)}`;
}

/**
 * Tipo de anúncio do ML, com a consequência no nome.
 *
 * É a escolha de precificação mais consequente da plataforma — comissão menor contra
 * parcelamento sem juros bancado —, e um seletor com "clássico / premium / catálogo"
 * seco obriga a decorar qual é qual.
 */
export const ROTULO_DO_TIPO_ANUNCIO_ML: Readonly<Record<TipoAnuncioML, string>> = {
  classico: 'Clássico (comissão menor)',
  premium: 'Premium (parcela sem juros)',
  catalogo: 'Catálogo (disputa por preço)',
};

export const ROTULO_DO_MODO_FRETE: Readonly<Record<ModoFrete, string>> = {
  comprador_paga: 'Comprador paga o frete',
  vendedor_paga: 'Eu pago o frete',
  retirada: 'Retirada no local',
};
