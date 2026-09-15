/**
 * Constantes da tela de importação.
 *
 * Existe por uma regra do Next que não é óbvia: **arquivo com `'use server'` só
 * pode exportar função assíncrona.** Uma `export const` ali derruba o build
 * inteiro, e a mensagem não ajuda — ela diz "the module has no exports at all",
 * que parece falha de resolução de módulo e não violação de regra.
 *
 * Então o que a ação e a tela compartilham mora aqui, num módulo comum.
 */

/** Rota da tela. Usada pela ação para revalidar e redirecionar. */
export const CAMINHO = '/importar';

/**
 * Quantos jobs a execução manual processa por clique.
 *
 * Poucos de propósito: isso roda **dentro de uma requisição**. Drenar mil jobs
 * aqui daria tempo limite de gateway no meio do trabalho — e job interrompido por
 * tempo limite fica `rodando` no banco até o prazo de execução estourar.
 */
export const LIMITE_DE_PROCESSAMENTO_MANUAL = 10;

/** Quantos jobs a lista mostra. É o número que a seção 7 da especificação pede. */
export const LIMITE_DA_LISTA = 100;
