/**
 * Constantes da tela do leitor.
 *
 * Módulo próprio pela mesma razão da tela de jobs: arquivo com `'use server'` só
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

/**
 * Peso presumido, em gramas, quando não se sabe o do produto.
 *
 * Entra no cálculo de frete do M8. Trezentos gramas é a faixa de um refil de
 * purificador, que é o nicho — e a tela **diz** que está presumindo, porque peso
 * errado muda a faixa de frete e portanto a margem.
 */
export const PESO_PRESUMIDO_GRAMAS = 300;

/** Embalagem presumida: caixa, plástico e fita de um item pequeno. */
export const EMBALAGEM_PRESUMIDA_CENTAVOS = 150;

/**
 * Taxa de devolução presumida, em pontos-base.
 *
 * 2%. Vem do M8 como provisão, e sem histórico de pedido (M10) não há como medir
 * a real. A tela mostra que é presunção.
 */
export const DEVOLUCAO_PRESUMIDA_BP = 200;

/** Quantas leituras a tela lista. */
export const LIMITE_DO_HISTORICO = 30;
