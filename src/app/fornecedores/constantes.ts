/**
 * Constantes da tela de fornecedores.
 *
 * Arquivo próprio pela mesma regra das outras telas: módulo com `'use server'` só
 * pode exportar função assíncrona, e uma `export const` ali derruba o build com a
 * mensagem enganosa "the module has no exports at all".
 */

/** Rota da tela. */
export const CAMINHO = '/fornecedores';

/** Quantos fornecedores a lista mostra. */
export const LIMITE_DA_LISTA = 100;
