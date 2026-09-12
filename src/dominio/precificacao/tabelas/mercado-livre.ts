/**
 * Tabela de taxas do Mercado Livre.
 *
 * **Estes números são a tabela geral levantada em 11–12/09/2026 e entram como
 * `fonte: 'manual'`.** Taxa de marketplace muda e varia por categoria: confirme a
 * da sua categoria no painel antes de precificar. Quando `listing_prices`
 * responder (ver a matriz de capacidades), a tabela lida da API entra com
 * `fonte: 'm3_api'` e vence esta pela regra de procedência do ADR 0002.
 *
 * A estrutura de custo do ML tem um degrau que domina toda a decisão de preço, e
 * está documentado em `LIMIAR_FRETE_GRATIS_ML`.
 */
import { centavos, percentualParaPontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import type { TabelaDeTaxas } from '../tipos';

/**
 * O degrau do Mercado Livre, e a razão do aviso de zona morta.
 *
 * Abaixo de R$ 79 você paga uma taxa fixa por unidade (~R$ 6 a R$ 6,75) e o
 * **comprador** paga o frete. A partir de R$ 79 a taxa fixa desaparece, mas o
 * frete grátis passa a ser obrigatório e sai do **seu** bolso — R$ 18 a R$ 28 num
 * item leve.
 *
 * Trocar R$ 6,50 por R$ 22 é mau negócio. É por isso que a faixa logo acima do
 * limiar é pior que a faixa logo abaixo, e é por isso que existe
 * `zona_morta_ml`.
 */
export const LIMIAR_FRETE_GRATIS_ML = reaisParaCentavos(79);

/** Fim aproximado da zona morta: abaixo disso o frete grátis não se paga. */
export const FIM_ZONA_MORTA_ML = reaisParaCentavos(120);

/** Faixa em que a margem volta a fazer sentido com frete grátis bancado. */
export const RETOMADA_SAUDAVEL_ML = reaisParaCentavos(140);

/** Frete estimado por peso, quando o vendedor paga e não se sabe o valor. */
const FRETE_ESTIMADO_POR_PESO: readonly { readonly ateGramas: number; readonly valor: number }[] = [
  { ateGramas: 300, valor: 18 },
  { ateGramas: 500, valor: 21 },
  { ateGramas: 1000, valor: 24 },
  { ateGramas: 2000, valor: 28 },
  { ateGramas: 5000, valor: 36 },
  { ateGramas: Number.POSITIVE_INFINITY, valor: 46 },
];

/** Estimativa de frete por peso. Só usada quando não há valor conhecido. */
export function freteEstimadoML(pesoGramas: number) {
  const faixa = FRETE_ESTIMADO_POR_PESO.find((f) => pesoGramas <= f.ateGramas);
  return reaisParaCentavos(faixa?.valor ?? 46);
}

export const TABELA_ML_2026_09: TabelaDeTaxas = {
  plataforma: 'ml',
  vigenteDe: new Date('2026-01-01T00:00:00Z'),
  vigenteAte: null,
  fonte: 'manual',
  rotulo: 'ML · tabela geral · levantamento 09/2026',

  comissao: {
    tipo: 'por_tipo_anuncio',
    // Clássico 10–14% e premium 15–19% conforme a categoria. Os valores abaixo
    // são o meio de cada faixa; categoria com comissão conhecida entra em
    // `porCategoria`, e `listing_prices` substitui os dois quando responder.
    porTipo: {
      classico: percentualParaPontosBase(12),
      premium: percentualParaPontosBase(17),
      catalogo: percentualParaPontosBase(14),
    },
  },

  // Taxa fixa por unidade abaixo do limiar de frete grátis. Acima dele não há
  // taxa fixa — é o outro lado do degrau.
  custoFixoPorUnidade: [
    { ateExclusivo: reaisParaCentavos(29), valor: reaisParaCentavos(6) },
    { ateExclusivo: reaisParaCentavos(50), valor: reaisParaCentavos('6.50') },
    { ateExclusivo: LIMIAR_FRETE_GRATIS_ML, valor: reaisParaCentavos('6.75') },
    { ateExclusivo: null, valor: centavos(0) },
  ],

  limiarFreteGratisObrigatorio: LIMIAR_FRETE_GRATIS_ML,

  acrescimos: [],
};
