/**
 * Constantes da tela de compatibilidade.
 *
 * Arquivo próprio pela mesma regra das outras telas: módulo com `'use server'` só
 * pode exportar função assíncrona, e uma `export const` ali derruba o build com a
 * mensagem enganosa "the module has no exports at all".
 */

/** Rota da tela. */
export const CAMINHO = '/compatibilidade';

/** Rota que devolve a ficha em planilha. Rota só existe quando a resposta não é HTML. */
export const CAMINHO_DO_ARQUIVO = '/compatibilidade/baixar';

/** Quantas linhas a fila de conferência mostra por vez. */
export const LIMITE_DA_FILA = 25;

/** Quantos aparelhos a lista de cadastro mostra. */
export const LIMITE_DE_APARELHOS = 50;
