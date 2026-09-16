/**
 * Constantes da tela de catálogo.
 *
 * Arquivo próprio pela mesma regra das outras: módulo com `'use server'` só pode
 * exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/catalogo';

/** Quantos produtos a lista carrega. */
export const LIMITE_DO_CATALOGO = 200;

/**
 * Margem alvo sugerida no simulador, em pontos-base.
 *
 * 20%. É o número que a especificação usa como referência de margem sadia em peça de
 * reposição, e é o campo que a pessoa troca primeiro — fica sugerido, não fixo.
 */
export const MARGEM_ALVO_PADRAO_BP = 2_000;

/** Onde a varredura de preço começa e termina, quando a pessoa não diz. */
export const FAIXA_PADRAO = { deReais: 10, ateReais: 500 } as const;

/** Quantas ocorrências do produto a tela lista. */
export const OCORRENCIAS_NA_TELA = 12;
