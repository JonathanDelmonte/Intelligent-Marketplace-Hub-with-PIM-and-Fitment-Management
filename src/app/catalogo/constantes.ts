/**
 * Constantes da tela de catálogo.
 *
 * Arquivo próprio pela mesma regra das outras: módulo com `'use server'` só pode
 * exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/catalogo';

/** O cadastro de produto: uma tela só para ele, com uma pergunta por campo. */
export const CAMINHO_DO_NOVO = '/catalogo/novo';

/** Quantos produtos a lista carrega. */
export const LIMITE_DO_CATALOGO = 200;

/** Quantas ocorrências do produto a tela lista. */
export const OCORRENCIAS_NA_TELA = 12;
