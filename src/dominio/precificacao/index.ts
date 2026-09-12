/**
 * M8 — Precificação e margem.
 *
 * Primeiro módulo da ordem de construção, e o único que muda uma decisão de
 * dinheiro no mesmo dia em que existe: nunca mais publicar anúncio com margem
 * negativa, e saber a margem realizada e não a prevista.
 */
export * from './tipos';
export * from './fiscal';
export * from './margem';
export * from './simulador';
export { TABELAS, TabelaDeTaxasAusente, tabelaVigente } from './tabelas';
export {
  FIM_ZONA_MORTA_ML,
  LIMIAR_FAIXA_SHOPEE,
  LIMIAR_FRETE_GRATIS_ML,
  RETOMADA_SAUDAVEL_ML,
  TABELA_AMAZON_2026_09,
  TABELA_ML_2026_09,
  TABELA_SHOPEE_2026_09,
  TAXA_POR_ITEM_PLANO_INDIVIDUAL,
  freteEstimadoML,
  fretePrograma,
} from './tabelas';
