/**
 * Camada de plataformas — a arquitetura por capacidade do ADR 0001.
 *
 * Nenhum módulo de domínio importa um adaptador concreto. Todos passam pelo
 * `Registro` e perguntam por capacidade.
 */
export * from './capacidades';
export * from './adaptador';
export * from './adaptador-base';
export * from './matriz';
export * from './registro';
export * from './csv';
export { AdaptadorMercadoLivre } from './ml/adaptador';
export { AdaptadorShopee } from './shopee/adaptador';
export { AdaptadorAmazon } from './amazon/adaptador';
