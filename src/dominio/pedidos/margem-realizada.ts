/**
 * Margem realizada e conferência de repasse (M10 — 8.6 e 8.9).
 *
 * A diferença entre este módulo e o M8 é a diferença entre **previsão e fato**. O
 * M8 calcula com tabela de taxas levantada, antes de vender, para decidir preço.
 * Aqui entram os números que a plataforma cobrou de verdade, depois de vender — e
 * a conta que importa é a comparação entre os dois.
 *
 * A especificação diz por que isso é uma entrega e não um relatório: "comparar o
 * que a plataforma disse que ia pagar com o que caiu. **É onde aparecem taxas que
 * você não previu.**"
 *
 * ## Custo desconhecido devolve margem nula, nunca zero
 *
 * Margem sem custo não existe, e chutar custo zero produziria a margem mais
 * bonita possível exatamente quando se sabe menos. Mesma disciplina da proposta de
 * SKU da fase 5, que se recusa a presumir custo a partir de preço de anúncio:
 * preço de anúncio é o que outro cobra.
 *
 * ## Tudo em centavos inteiros
 *
 * Dinheiro é inteiro (ADR 0004) e a margem em pontos-base. Uma diferença de um
 * centavo por pedido, vezes mil pedidos, é o que aparece no fechamento do mês como
 * "não fecha por dez reais e ninguém sabe onde".
 */
import { centavos, pontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';

export interface TaxasRealizadas {
  /** O que o comprador pagou pelo item, sem frete. */
  readonly precoBruto: Centavos;
  readonly taxaComissao: Centavos | null;
  readonly taxaFixa: Centavos | null;
  /** Frete que **você** pagou. Zero é diferente de desconhecido. */
  readonly fretePago: Centavos | null;
  /** O que a plataforma informou que vai repassar. */
  readonly repasseLiquido: Centavos | null;
  /** Custo do item na data da venda. Sem ele não há margem. */
  readonly custoNaVenda: Centavos | null;
  readonly qtd: number;
}

export interface MargemRealizada {
  /** Bruto menos as taxas conhecidas. */
  readonly repasseCalculado: Centavos;
  readonly repasseInformado: Centavos | null;
  /**
   * Informado menos calculado. Negativo significa taxa que você não previu.
   *
   * `null` quando a plataforma não informou repasse — e aí não há o que conferir.
   */
  readonly divergenciaDeRepasse: Centavos | null;
  /** `null` quando o custo é desconhecido. Nunca zero por omissão. */
  readonly margem: Centavos | null;
  readonly margemBp: PontosBase | null;
  /** `true` quando comissão, taxa fixa, frete e custo são todos conhecidos. */
  readonly completo: boolean;
  readonly avisos: readonly string[];
}

/**
 * Divergência a partir da qual vale investigar, em centavos.
 *
 * Um centavo de diferença é arredondamento da plataforma e não é notícia. Dez
 * centavos por pedido, num mês de trezentos pedidos, são trinta reais — e é aí
 * que começa a valer o tempo de olhar. Configurável no chamador.
 */
export const DIVERGENCIA_QUE_IMPORTA = centavos(10);

export function calcularMargemRealizada(taxas: TaxasRealizadas): MargemRealizada {
  const avisos: string[] = [];

  const comissao = taxas.taxaComissao;
  const fixa = taxas.taxaFixa;
  const frete = taxas.fretePago;

  if (comissao === null) avisos.push('Comissão não informada: o repasse calculado está otimista.');
  if (fixa === null) avisos.push('Taxa fixa não informada.');
  if (frete === null) avisos.push('Frete não informado: em item leve é ele que decide a margem.');

  const repasseCalculado = centavos(
    taxas.precoBruto - (comissao ?? 0) - (fixa ?? 0) - (frete ?? 0),
  );

  const repasseInformado = taxas.repasseLiquido;
  const divergenciaDeRepasse =
    repasseInformado === null ? null : centavos(repasseInformado - repasseCalculado);

  // `0 - x` em vez de `-x`: o tipo `Centavos` é marcado, e negação unária sobre
  // tipo marcado é justamente o que o lint recusa — a mesma forma que `margem.ts`
  // já usa. O motivo da regra é bom: negar um valor marcado costuma ser sinal de
  // que alguém está fazendo aritmética de dinheiro fora das funções que validam.
  if (divergenciaDeRepasse !== null && divergenciaDeRepasse < 0 - DIVERGENCIA_QUE_IMPORTA) {
    avisos.push(
      'A plataforma vai repassar menos do que as taxas informadas explicam. É taxa que não estava na conta — vale conferir no extrato.',
    );
  }
  if (divergenciaDeRepasse !== null && divergenciaDeRepasse > DIVERGENCIA_QUE_IMPORTA) {
    avisos.push(
      'A plataforma vai repassar mais do que as taxas informadas explicam. Provavelmente falta uma taxa na planilha, não é bônus.',
    );
  }

  // O repasse informado vence o calculado quando existe: é o que a plataforma
  // efetivamente vai pagar, e a conta de taxas é reconstrução nossa.
  const repasseParaMargem = repasseInformado ?? repasseCalculado;

  const custo = taxas.custoNaVenda;
  if (custo === null) {
    avisos.push(
      'Sem custo na venda não há margem realizada. Informe o custo do item; presumir custo pelo preço de anúncio erraria para o lado otimista.',
    );
    return {
      repasseCalculado,
      repasseInformado,
      divergenciaDeRepasse,
      margem: null,
      margemBp: null,
      completo: false,
      avisos,
    };
  }

  const custoTotal = centavos(custo * Math.max(1, taxas.qtd));
  const margem = centavos(repasseParaMargem - custoTotal);
  const margemBp =
    taxas.precoBruto === 0 ? null : pontosBase(Math.trunc((margem * 10_000) / taxas.precoBruto));

  if (margem < 0) {
    avisos.push('Prejuízo neste pedido: o repasse não cobriu o custo.');
  }

  return {
    repasseCalculado,
    repasseInformado,
    divergenciaDeRepasse,
    margem,
    margemBp,
    completo: comissao !== null && fixa !== null && frete !== null,
    avisos,
  };
}

/** A divergência importa o bastante para entrar em relatório? */
export function divergenciaRelevante(divergencia: Centavos | null): boolean {
  return divergencia !== null && Math.abs(divergencia) > DIVERGENCIA_QUE_IMPORTA;
}
