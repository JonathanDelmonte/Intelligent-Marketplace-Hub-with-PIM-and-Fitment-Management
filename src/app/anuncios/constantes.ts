/**
 * Constantes da tela de anúncio.
 *
 * Arquivo próprio pela mesma regra das outras telas: módulo com `'use server'` só
 * pode exportar função assíncrona. Aqui ele também é o que a rota de download
 * compartilha com a página, para as duas não divergirem de caminho.
 */

/** Rota da tela. */
export const CAMINHO = '/anuncios';

/** Rota que devolve o arquivo de importação. */
export const CAMINHO_DO_ARQUIVO = '/anuncios/baixar';

/** Quantos SKUs a lista de escolha carrega. */
export const LIMITE_DE_CANDIDATOS = 200;

/** Quantidade padrão do formulário. Um é o que não promete estoque que não existe. */
export const QUANTIDADE_PADRAO = 1;
