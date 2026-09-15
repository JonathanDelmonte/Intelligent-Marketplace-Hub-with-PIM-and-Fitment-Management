/**
 * Constantes da tela do monitor.
 *
 * Arquivo próprio pela mesma regra da tela de importação: módulo com `'use server'`
 * só pode exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/monitor';

/**
 * Quantos eventos a tela carrega por vez.
 *
 * Cem, e não todos: o agrupamento junta por concorrente e semana, então cem eventos
 * viram poucas dezenas de grupos. Acima disso a tela deixa de ser lista de trabalho e
 * passa a ser arquivo histórico, que é outra tela.
 */
export const LIMITE_DE_EVENTOS = 100;

/** Quantas ofertas a tela avalia para o veredito de queda. */
export const LIMITE_DE_QUEDAS = 25;
