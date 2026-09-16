/**
 * Constantes da tela do leitor.
 *
 * Módulo próprio pela mesma razão da tela de importação: arquivo com `'use server'` só
 * pode exportar função assíncrona.
 */

export const CAMINHO = '/leitor';

/**
 * Intervalo entre tentativas de leitura da câmera.
 *
 * Quatro por segundo. Não é limitação técnica: é bateria. Decodificar a 60
 * quadros por segundo esquenta o aparelho e não lê mais rápido — o gargalo é a
 * mão da pessoa alinhando o código, não o decodificador. Numa sessão de quarenta
 * itens no balcão, a bateria é recurso escasso.
 */
export const INTERVALO_DE_LEITURA_MS = 250;

/*
 * As três presunções do cálculo — peso, embalagem e devolução — saíram daqui para
 * `dominio/precificacao/entrada.ts` quando a tela de catálogo precisou das mesmas. São
 * presunção de negócio, não constante de tela, e duas cópias divergiriam do mesmo jeito
 * que a fonte monoespaçada divergiu.
 */

/** Quantas leituras a tela lista. */
export const LIMITE_DO_HISTORICO = 30;
