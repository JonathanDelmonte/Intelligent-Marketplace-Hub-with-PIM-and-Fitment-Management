/**
 * Tabela de taxas da Shopee.
 *
 * **Levantamento de 11–12/09/2026, `fonte: 'manual'`.** A Shopee não expõe taxa
 * por API sem aprovação de partner na Open Platform (ver matriz de
 * capacidades), então esta tabela é a única fonte até lá — e é por isso que ela
 * carrega `fonte: 'manual'` e gera o aviso `tabela_presumida`.
 *
 * A estrutura tem um degrau em R$ 80: abaixo, comissão maior com taxa fixa
 * pequena; acima, comissão menor com taxa de programa de frete bem maior.
 */
import { percentualParaPontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import type { TabelaDeTaxas } from '../tipos';

/** Onde a comissão cai de ~20% para ~14% e a taxa de frete entra. */
export const LIMIAR_FAIXA_SHOPEE = reaisParaCentavos(80);

const FRETE_PROGRAMA_POR_PESO: readonly { readonly ateGramas: number; readonly valor: number }[] = [
  { ateGramas: 500, valor: 16 },
  { ateGramas: 1000, valor: 20 },
  { ateGramas: 2000, valor: 24 },
  { ateGramas: Number.POSITIVE_INFINITY, valor: 28 },
];

/**
 * Taxa do programa de frete acima do limiar, estimada por peso.
 *
 * A especificação dá a faixa "R$ 16 a R$ 28"; a distribuição por peso abaixo é
 * interpolação minha para o cálculo não depender de um número único, e está
 * marcada como tal.
 */
export function fretePrograma(pesoGramas: number) {
  const faixa = FRETE_PROGRAMA_POR_PESO.find((f) => pesoGramas <= f.ateGramas);
  return reaisParaCentavos(faixa?.valor ?? 28);
}

export const TABELA_SHOPEE_2026_09: TabelaDeTaxas = {
  plataforma: 'shopee',
  vigenteDe: new Date('2026-01-01T00:00:00Z'),
  vigenteAte: null,
  fonte: 'manual',
  rotulo: 'Shopee · tabela geral · levantamento 09/2026',

  comissao: {
    tipo: 'por_faixa_de_preco',
    faixas: [
      { ateExclusivo: LIMIAR_FAIXA_SHOPEE, pontosBase: percentualParaPontosBase(20) },
      { ateExclusivo: null, pontosBase: percentualParaPontosBase(14) },
    ],
  },

  // Até R$ 79,99 a taxa por item é R$ 4. Acima, ela dá lugar à taxa do programa
  // de frete, que entra como acréscimo por depender do peso.
  custoFixoPorUnidade: [
    { ateExclusivo: LIMIAR_FAIXA_SHOPEE, valor: reaisParaCentavos(4) },
    { ateExclusivo: null, valor: reaisParaCentavos(0) },
  ],

  limiarFreteGratisObrigatorio: LIMIAR_FAIXA_SHOPEE,

  acrescimos: [
    {
      codigo: 'shopee_sem_cnpj',
      rotulo: 'adicional por item sem CNPJ',
      quando: 'vendedor_sem_cnpj',
      cobranca: { tipo: 'fixo_por_item', valor: reaisParaCentavos(3) },
    },
    {
      codigo: 'shopee_campanha',
      rotulo: 'adicional de campanha',
      quando: 'em_campanha',
      cobranca: { tipo: 'percentual_do_preco', pontosBase: percentualParaPontosBase(2.5) },
    },
  ],
};
