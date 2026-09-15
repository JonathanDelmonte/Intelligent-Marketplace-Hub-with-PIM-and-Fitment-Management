/**
 * Constantes da tela de afiliados.
 *
 * Arquivo próprio pela mesma regra das outras: módulo com `'use server'` só pode
 * exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/afiliados';

/** Quantas ofertas a tela carrega. Publicadas e pendentes, que é o que a fila exige. */
export const LIMITE_DA_FILA = 100;
