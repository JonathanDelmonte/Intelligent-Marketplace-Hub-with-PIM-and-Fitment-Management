/**
 * Constantes da tela de identidade.
 *
 * Arquivo próprio pela mesma regra da tela de jobs: módulo com `'use server'` só
 * pode exportar função assíncrona, e uma `export const` ali derruba o build com a
 * mensagem enganosa "the module has no exports at all".
 */

/** Rota da tela. */
export const CAMINHO = '/identidade';

/** Quantos pares a fila mostra por vez. */
export const LIMITE_DA_FILA = 25;

/**
 * Quantas ocorrências o botão "resolver agora" processa por clique.
 *
 * Poucas de propósito: isso roda **dentro de uma requisição**, e resolução com LLM
 * ligado faz chamada de rede por par. Drenar a base aqui daria tempo limite de
 * gateway no meio do trabalho.
 */
export const LIMITE_DE_RESOLUCAO_MANUAL = 10;
