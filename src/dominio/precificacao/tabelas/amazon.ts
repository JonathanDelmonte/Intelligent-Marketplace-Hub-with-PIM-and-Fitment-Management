/**
 * Tabela de taxas da Amazon.
 *
 * **Levantamento de 11–12/09/2026, `fonte: 'manual'`.** A SP-API exige plano
 * profissional e registro de developer, então até lá esta tabela é a única
 * fonte — e o aviso `tabela_presumida` acompanha todo cálculo feito com ela.
 *
 * A Amazon é a mais simples das três: comissão por categoria e uma taxa por item
 * que existe só no plano individual.
 */
import { percentualParaPontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import type { TabelaDeTaxas } from '../tipos';

/** Plano individual cobra por item vendido; o profissional cobra mensalidade. */
export const TAXA_POR_ITEM_PLANO_INDIVIDUAL = reaisParaCentavos(2);

export const TABELA_AMAZON_2026_09: TabelaDeTaxas = {
  plataforma: 'amazon',
  vigenteDe: new Date('2026-01-01T00:00:00Z'),
  vigenteAte: null,
  fonte: 'manual',
  rotulo: 'Amazon · plano individual · levantamento 09/2026',

  comissao: {
    tipo: 'por_faixa_de_preco',
    // A comissão da Amazon é por categoria (10–15%), não por faixa de preço. O
    // valor único abaixo é o meio da faixa, e serve de padrão para categoria
    // ainda não cadastrada em `porCategoria`.
    faixas: [{ ateExclusivo: null, pontosBase: percentualParaPontosBase(12.5) }],
  },

  custoFixoPorUnidade: [{ ateExclusivo: null, valor: TAXA_POR_ITEM_PLANO_INDIVIDUAL }],

  limiarFreteGratisObrigatorio: null,

  acrescimos: [],
};
