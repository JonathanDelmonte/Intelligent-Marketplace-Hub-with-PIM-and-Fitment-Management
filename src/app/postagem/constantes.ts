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

/**
 * Quantas diferenças já conferidas a lista recolhida mostra.
 *
 * Vinte, e não todas: a lista existe para desfazer um clique errado, que é coisa que
 * se percebe na hora — não para virar histórico de conferência.
 */
export const LIMITE_DE_CONFERIDAS = 20;
