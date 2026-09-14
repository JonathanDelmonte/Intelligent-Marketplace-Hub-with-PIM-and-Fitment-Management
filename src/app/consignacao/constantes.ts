/**
 * Constantes da tela de consignação.
 *
 * Arquivo próprio pela mesma regra das outras telas: módulo com `'use server'` só
 * pode exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/consignacao';

/**
 * Quantas linhas do quadro a tela mostra.
 *
 * Consignação é operação de balcão: dezenas de linhas, não milhares. Um teto alto
 * existe só para a página não virar um scroll infinito se alguém importar uma lista
 * grande de parceiro.
 */
export const LIMITE_DO_QUADRO = 200;
