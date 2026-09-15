/**
 * Constantes da tela de perguntas.
 *
 * Arquivo próprio pela mesma regra das outras: módulo com `'use server'` só pode
 * exportar função assíncrona.
 */

/** Rota da tela. */
export const CAMINHO = '/perguntas';

/**
 * Janela da conta de repetição, em dias.
 *
 * Noventa. Dúvida recorrente é sobre o anúncio de **hoje**: cinco perguntas de
 * voltagem há oito meses, num anúncio já corrigido, acusariam para sempre.
 */
export const JANELA_DIAS = 90;

/** Quantas perguntas a tela carrega para contar e para listar. */
export const LIMITE_DE_PERGUNTAS = 500;

/** Quantos exemplos crus a tela mostra por dúvida. */
export const EXEMPLOS_NA_TELA = 3;
