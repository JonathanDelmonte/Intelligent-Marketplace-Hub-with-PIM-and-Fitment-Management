/**
 * Constantes da tela de postagem.
 *
 * Arquivo próprio pela mesma regra das outras telas: módulo com `'use server'` só
 * pode exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/postagem';

/** Quantos pedidos a fila carrega. */
export const LIMITE_DA_FILA = 200;

/** Quantas divergências de repasse a seção do fim mostra. */
export const LIMITE_DE_DIVERGENCIAS = 25;
