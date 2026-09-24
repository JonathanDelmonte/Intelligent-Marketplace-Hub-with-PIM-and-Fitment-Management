/**
 * Os números do painel de uma loja, ou de todas somadas (ADR 0009).
 *
 * Faturamento, pedidos, ticket médio, margem e repasse de uma janela de dias. O banco
 * soma por loja (`RepositorioDeLojas.somas`), e daqui sai a conta que a tela mostra —
 * pura e testada, porque "margem de 23%" é afirmação sobre dinheiro.
 *
 * ## A janela é de dias inteiros, no fuso do vendedor
 *
 * "Últimos 30 dias" são os 30 dias do calendário até hoje, e não "agora menos 720
 * horas": com a conta em horas, o primeiro dia entraria pela metade, e a soma do
 * gráfico por dia não fecharia com o total do cartão ao lado.
 *
 * ## Margem só sobre o que tem margem
 *
 * Pedido sem custo tem margem nula, nunca zero (`margem-realizada.ts`). A margem do
 * painel é a soma das margens conhecidas sobre o faturamento **desses mesmos
 * pedidos**, e o painel diz quantos ficaram de fora. Dividir pelo faturamento inteiro
 * contaria os pedidos sem custo como margem zero — a margem pareceria pior do que é, e
 * o número certo, que é "falta custo", sumiria.
 */
import { interpretarData } from '@/dominio/pedidos/planilha';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { centavos, pontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';

export const DIAS_DO_PAINEL = 30;

export interface Janela {
  /** Início do primeiro dia, no fuso do vendedor. Incluído. */
  readonly desde: Date;
  /** Início do dia seguinte ao último. Excluído. */
  readonly ate: Date;
  /** Os dias da janela, `2026-09-24`, do mais antigo ao mais recente. */
  readonly dias: readonly string[];
}

/** Soma dias a um dia do calendário, sem passar por fuso: `2026-09-30` + 1 = `2026-10-01`. */
export function somarDias(dia: string, quantidade: number): string {
  const [ano = 0, mes = 1, d = 1] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d + quantidade)).toISOString().slice(0, 10);
}

function inicioDoDia(dia: string, fuso: string): Date {
  const inicio = interpretarData(dia, fuso);
  if (inicio === null) throw new Error(`dia inválido: ${dia}`);
  return inicio;
}

/** Os `quantidade` dias do calendário que terminam no dia de `ultimoDia`. */
export function janelaAte(
  ultimoDia: string,
  quantidade: number = DIAS_DO_PAINEL,
  fuso: string = FUSO_PADRAO,
): Janela {
  const primeiro = somarDias(ultimoDia, -(quantidade - 1));
  const dias = Array.from({ length: quantidade }, (_, i) => somarDias(primeiro, i));
  return {
    desde: inicioDoDia(primeiro, fuso),
    ate: inicioDoDia(somarDias(ultimoDia, 1), fuso),
    dias,
  };
}

/** Os últimos dias até hoje, e a janela do mesmo tamanho logo antes, para comparar. */
export function janelasDoPainel(
  agora: Date,
  quantidade: number = DIAS_DO_PAINEL,
  fuso: string = FUSO_PADRAO,
): { readonly atual: Janela; readonly anterior: Janela } {
  const hoje = diaNoFuso(agora, fuso);
  return {
    atual: janelaAte(hoje, quantidade, fuso),
    anterior: janelaAte(somarDias(hoje, -quantidade), quantidade, fuso),
  };
}

/** O que o banco soma de uma loja numa janela. */
export interface SomaDaLoja {
  readonly plataforma: Plataforma;
  readonly pedidos: number;
  readonly faturamento: Centavos;
  /** Faturamento só dos pedidos com margem conhecida: é sobre ele que a margem se lê. */
  readonly faturamentoComMargem: Centavos;
  readonly margem: Centavos;
  readonly pedidosSemMargem: number;
  /** O que as lojas informaram que vão repassar, nos pedidos que trazem o número. */
  readonly repasse: Centavos;
}

export interface Painel {
  readonly pedidos: number;
  readonly faturamento: Centavos;
  /** `null` sem pedido: ticket de zero pedidos não existe. */
  readonly ticketMedio: Centavos | null;
  /** `null` quando nenhum pedido tem margem conhecida. */
  readonly margemBp: PontosBase | null;
  readonly pedidosSemMargem: number;
  readonly repasse: Centavos;
}

export const PAINEL_VAZIO: Painel = {
  pedidos: 0,
  faturamento: centavos(0),
  ticketMedio: null,
  margemBp: null,
  pedidosSemMargem: 0,
  repasse: centavos(0),
};

/** Soma as lojas dadas — uma, para a área dela; todas, para a visão geral. */
export function somarPainel(somas: readonly SomaDaLoja[]): Painel {
  let pedidos = 0;
  let faturamento = 0;
  let faturamentoComMargem = 0;
  let margem = 0;
  let pedidosSemMargem = 0;
  let repasse = 0;
  for (const s of somas) {
    pedidos += s.pedidos;
    faturamento += s.faturamento;
    faturamentoComMargem += s.faturamentoComMargem;
    margem += s.margem;
    pedidosSemMargem += s.pedidosSemMargem;
    repasse += s.repasse;
  }

  return {
    pedidos,
    faturamento: centavos(faturamento),
    ticketMedio: pedidos === 0 ? null : centavos(Math.round(faturamento / pedidos)),
    margemBp:
      faturamentoComMargem === 0
        ? null
        : pontosBase(Math.trunc((margem * 10_000) / faturamentoComMargem)),
    pedidosSemMargem,
    repasse: centavos(repasse),
  };
}

/**
 * Quanto `atual` mudou sobre `anterior`, em pontos-base. `+1100` é 11% a mais.
 *
 * `null` quando não há base: crescer "infinitos por cento" sobre zero não é número que
 * se mostre, e zero sobre zero não é variação.
 */
export function variacaoBp(atual: number, anterior: number): PontosBase | null {
  if (anterior === 0) return null;
  return pontosBase(Math.trunc(((atual - anterior) * 10_000) / anterior));
}

export interface PontoDaSerie {
  readonly dia: string;
  readonly faturamento: Centavos;
  readonly pedidos: number;
}

/**
 * A série de todos os dias da janela, com zero no dia sem venda.
 *
 * O banco devolve só os dias com pedido. O gráfico precisa de todos — um dia sem venda
 * é um dia, e pulá-lo encolheria o eixo e esconderia justamente o buraco.
 */
export function completarSerie(
  pontos: readonly PontoDaSerie[],
  dias: readonly string[],
): readonly PontoDaSerie[] {
  const porDia = new Map(pontos.map((p) => [p.dia, p]));
  return dias.map((dia) => porDia.get(dia) ?? { dia, faturamento: centavos(0), pedidos: 0 });
}
