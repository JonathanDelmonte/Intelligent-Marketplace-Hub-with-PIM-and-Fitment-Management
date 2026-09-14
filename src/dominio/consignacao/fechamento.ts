/**
 * Fechamento de repasse por período, por parceiro (M11 — 8.10).
 *
 * O que a especificação pede em uma linha — "fechamento de repasse por período, por
 * parceiro" — é a conta que decide se a consignação vale a pena e quanto você deve
 * a quem. Ela é simples e tem três formas de dar errado, e as três aparecem aqui.
 *
 * ## 1. Preço de repasse não acordado não vira zero
 *
 * Linha sem `preco_acordado_repasse` é linha em que **ninguém combinou o valor**.
 * Somar zero produziria um fechamento bonito e falso — você deveria dinheiro que o
 * relatório diz que não deve. Então a venda entra na contagem de unidades, fica
 * fora do total a repassar, e é **listada como pendência nomeada**. Fechamento com
 * pendência não é fechamento fechado, e `completo` diz isso.
 *
 * ## 2. O preço de repasse é o do acordo, não o de hoje
 *
 * O valor a repassar por unidade é o que estava combinado **quando vendeu**. Ler o
 * acordo atual e aplicar retroativamente reescreveria o passado a cada mudança de
 * acordo — o mesmo motivo pelo qual o custo do pedido é congelado na venda.
 *
 * ## 3. Período é intervalo fechado de dias civis, no fuso do vendedor
 *
 * "Setembro" é 1 a 30 no fuso de quem vende, não em UTC. Uma venda às 22h do dia 30
 * em São Paulo é dia 1 de outubro em UTC, e cairia no mês errado — erro que aparece
 * como "o fechamento de setembro e o de outubro somados não dão o ano".
 */
import { centavos, somar, type Centavos } from '@/lib/dinheiro';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/** Uma venda de item consignado, do jeito que o pedido a guarda. */
export interface VendaConsignada {
  readonly pedidoId: string;
  readonly skuId: string;
  readonly parceiroNome: string;
  readonly tituloDoProduto: string | null;
  readonly data: Date;
  readonly qtd: number;
  /** Repasse por unidade combinado na venda. `null` quando não houve acordo. */
  readonly repassePorUnidade: Centavos | null;
}

export interface PendenciaDeFechamento {
  readonly pedidoId: string;
  readonly skuId: string;
  readonly tituloDoProduto: string | null;
  readonly qtd: number;
  readonly motivo: string;
}

export interface FechamentoDoParceiro {
  readonly parceiroNome: string;
  readonly unidades: number;
  readonly aRepassar: Centavos;
  /** Vendas que não entraram no total, com o motivo. */
  readonly pendencias: readonly PendenciaDeFechamento[];
  /** Sem pendência nenhuma. Só então o número pode ser pago sem conversa. */
  readonly completo: boolean;
}

export interface Fechamento {
  /** Dia civil de início e de fim, inclusive: `2026-09-01` e `2026-09-30`. */
  readonly de: string;
  readonly ate: string;
  readonly porParceiro: readonly FechamentoDoParceiro[];
  readonly totalARepassar: Centavos;
  readonly unidades: number;
  readonly completo: boolean;
}

export interface OpcoesDoFechamento {
  readonly fuso?: string;
}

/**
 * Fecha o período.
 *
 * `de` e `ate` são dias civis inclusive, no fuso do vendedor. Função pura: recebe
 * as vendas já lidas, devolve a conta. Quem lê do banco é o repositório.
 */
export function fecharPeriodo(
  vendas: readonly VendaConsignada[],
  de: string,
  ate: string,
  opcoes: OpcoesDoFechamento = {},
): Fechamento {
  const fuso = opcoes.fuso ?? FUSO_PADRAO;

  const noPeriodo = vendas.filter((v) => {
    const dia = diaNoFuso(v.data, fuso);
    return dia >= de && dia <= ate;
  });

  const nomes = [...new Set(noPeriodo.map((v) => v.parceiroNome))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );

  const porParceiro = nomes.map((nome): FechamentoDoParceiro => {
    const doParceiro = noPeriodo.filter((v) => v.parceiroNome === nome);

    const comAcordo = doParceiro.filter(
      (v): v is VendaConsignada & { repassePorUnidade: Centavos } => v.repassePorUnidade !== null,
    );
    const pendencias = doParceiro
      .filter((v) => v.repassePorUnidade === null)
      .map((v) => ({
        pedidoId: v.pedidoId,
        skuId: v.skuId,
        tituloDoProduto: v.tituloDoProduto,
        qtd: v.qtd,
        motivo:
          'Sem preço de repasse combinado para este item. Combine o valor e lance à mão — somar zero faria você dever dinheiro que o fechamento diz que não deve.',
      }));

    return {
      parceiroNome: nome,
      // Unidade conta sempre, inclusive a pendente: o parceiro entregou a peça.
      unidades: doParceiro.reduce((soma, v) => soma + v.qtd, 0),
      aRepassar: somar(...comAcordo.map((v) => centavos(v.repassePorUnidade * v.qtd))),
      pendencias,
      completo: pendencias.length === 0,
    };
  });

  return {
    de,
    ate,
    porParceiro,
    totalARepassar: somar(...porParceiro.map((p) => p.aRepassar)),
    unidades: porParceiro.reduce((soma, p) => soma + p.unidades, 0),
    completo: porParceiro.every((p) => p.completo),
  };
}

/** O mês civil de uma data, como par `de`/`ate` para `fecharPeriodo`. */
export function mesDe(data: Date, fuso: string = FUSO_PADRAO): { de: string; ate: string } {
  const dia = diaNoFuso(data, fuso);
  const [ano, mes] = dia.split('-');
  if (ano === undefined || mes === undefined) {
    throw new Error(`dia em formato inesperado: ${dia}`);
  }
  // Dia 0 do mês seguinte é o último do mês corrente, e `Date.UTC` já normaliza a
  // virada de ano. Em UTC de propósito: aqui só se conta dia de calendário.
  const ultimo = new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate();
  return { de: `${ano}-${mes}-01`, ate: `${ano}-${mes}-${String(ultimo).padStart(2, '0')}` };
}
