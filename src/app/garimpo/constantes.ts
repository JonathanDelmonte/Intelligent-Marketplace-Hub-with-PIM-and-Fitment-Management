/**
 * Constantes da tela de garimpo.
 *
 * Arquivo próprio pela mesma regra das outras: módulo com `'use server'` só pode
 * exportar função assíncrona.
 */

/** Rota da tela. A rota é texto que alguém lê, e "prospector" é nome de módulo. */
export const CAMINHO = '/garimpo';

/** Quantos dossiês a tela carrega. */
export const LIMITE_DE_DOSSIES = 25;

/** Quantos achados cada dossiê mostra antes de "e mais N". */
export const ACHADOS_NA_TELA = 5;

/**
 * Teto de passos sugerido no formulário.
 *
 * Vinte. Sete famílias custam um passo cada na abertura, e o resto é a ramificação:
 * cada página lida rende alvo novo. Número escolhido, não medido — o teto que importa
 * é o de reais, e este continua valendo quando uma ferramenta não informa custo.
 */
export const TETO_PASSOS_PADRAO = 20;
