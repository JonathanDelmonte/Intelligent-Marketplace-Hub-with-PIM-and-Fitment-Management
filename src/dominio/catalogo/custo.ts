/**
 * Quando o custo do catálogo deixa de valer (M2).
 *
 * `atualizarCusto` grava `custo_atualizado_em` desde a fase 3, com a nota de que "custo
 * velho é a causa mais comum de margem otimista, e o sistema precisa poder avisar que o
 * custo está defasado". Este arquivo é o aviso.
 *
 * O problema é silencioso por natureza: o fornecedor reajusta, ninguém atualiza a ficha,
 * e a margem continua bonita na tela por meses. Não há erro, não há log — há um número
 * que envelheceu.
 */

/**
 * Quantos dias um custo continua valendo.
 *
 * Trinta. É o ciclo de tabela de fornecedor: lista nova por mês é o comum no ramo de
 * peça de reposição. Número escolhido, não medido — o histórico de preço por fornecedor
 * (7.4) é quem vai permitir medir o intervalo real de reajuste, e aí este número sai de
 * palpite para dado.
 */
export const DIAS_DE_CUSTO_FRESCO = 30;

const UM_DIA_EM_MS = 86_400_000;

/**
 * O custo está defasado?
 *
 * Custo **nunca informado** não é defasado: é ausente, e ausente já tem aviso próprio no
 * M8 ("a margem mostrada é o teto"). Chamar de defasado juntaria dois estados com ações
 * diferentes — um pede cadastro, o outro pede conferência com o fornecedor.
 */
export function custoDefasado(
  custoAtualizadoEm: Date | null,
  agora: Date,
  diasDeFrescor = DIAS_DE_CUSTO_FRESCO,
): boolean {
  if (custoAtualizadoEm === null) return false;
  return agora.getTime() - custoAtualizadoEm.getTime() > diasDeFrescor * UM_DIA_EM_MS;
}

/** Quantos dias tem o custo. `null` quando nunca foi informado. */
export function idadeDoCustoEmDias(custoAtualizadoEm: Date | null, agora: Date): number | null {
  if (custoAtualizadoEm === null) return null;
  return Math.max(0, Math.floor((agora.getTime() - custoAtualizadoEm.getTime()) / UM_DIA_EM_MS));
}
