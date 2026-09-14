/**
 * Alerta de conferência de consignação (M11 — 8.10).
 *
 * A especificação diz o que é e por que existe, na mesma frase: "alerta de
 * conferência semanal (**o risco é a loja vender no balcão o que você tem
 * anunciado**)".
 *
 * ## O alerta não é sobre a data, é sobre o que está exposto
 *
 * Um controle de conferência ingênuo compara `conferido_em` com sete dias atrás e
 * pinta de vermelho o que passou. Isso dá o alerta errado: uma linha com zero
 * unidade disponível, sem conferir há um mês, não tem risco nenhum — não há o que
 * a loja venda no balcão e não há o que você venda errado. E uma linha com trinta
 * unidades anunciadas, conferida há oito dias, é a que pode custar uma venda
 * cancelada hoje.
 *
 * Então a urgência combina **tempo** com **exposição**: quantas unidades estão
 * anunciadas em cima de um estoque que ninguém olhou. É a diferença entre um
 * alerta que a pessoa atende e um que ela desliga na terceira semana.
 *
 * ## Nunca conferido não é o mesmo que conferido há muito tempo
 *
 * `conferido_em` nulo é linha que entrou e ninguém nunca olhou. Aparece em faixa
 * própria e no topo, pela mesma razão que pedido sem prazo aparece no topo da fila
 * do dia: a falta do dado é o problema, e enterrar no fim da lista transforma dado
 * faltando em risco esquecido.
 */
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/**
 * De quantos em quantos dias conferir.
 *
 * Sete, que é a palavra da especificação ("semanal"). Fica nomeado e por parâmetro
 * porque parceiro de giro alto merece prazo menor, e essa é decisão do vendedor.
 */
export const INTERVALO_DE_CONFERENCIA_DIAS = 7;

/**
 * A partir de quantas unidades expostas a conferência vencida vira urgente.
 *
 * Uma. Não há número honesto acima de um: uma unidade vendida que não existe é uma
 * venda cancelada, e venda cancelada em conta nova custa reputação, que é o ativo.
 * O número existe para dizer isto por escrito, e para o dia em que alguém quiser
 * afrouxá-lo ter de encarar a frase.
 */
export const UNIDADES_QUE_JA_SAO_RISCO = 1;

export const ESTADOS_DE_CONFERENCIA = ['nunca', 'vencida', 'vence_hoje', 'em_dia'] as const;
export type EstadoDeConferencia = (typeof ESTADOS_DE_CONFERENCIA)[number];

/** Ordem de atenção. Menor aparece primeiro. */
const PESO_DO_ESTADO: Readonly<Record<EstadoDeConferencia, number>> = {
  nunca: 0,
  vencida: 1,
  vence_hoje: 2,
  em_dia: 3,
};

export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDeConferencia, string>> = {
  nunca: 'nunca conferido',
  vencida: 'conferência atrasada',
  vence_hoje: 'conferir hoje',
  em_dia: 'em dia',
};

export interface LinhaDeConsignacao {
  readonly id: string;
  readonly parceiroNome: string;
  readonly skuId: string;
  readonly tituloDoProduto: string | null;
  readonly qtdDisponivel: number;
  readonly conferidoEm: Date | null;
}

export interface ItemDaConferencia extends LinhaDeConsignacao {
  readonly estado: EstadoDeConferencia;
  /** Dias inteiros desde a última conferência. `null` quando nunca houve. */
  readonly diasDesde: number | null;
  /**
   * Há unidade anunciada em cima de estoque não conferido.
   *
   * É o que transforma "conferência atrasada" em "risco de cancelar venda hoje".
   */
  readonly emRisco: boolean;
}

export interface QuadroDeConferencia {
  readonly itens: readonly ItemDaConferencia[];
  readonly porEstado: Readonly<Record<EstadoDeConferencia, number>>;
  /** Unidades expostas em linha que precisa de conferência. O número que importa. */
  readonly unidadesEmRisco: number;
  /** Parceiros com pelo menos uma linha em risco, em ordem alfabética. */
  readonly parceirosEmRisco: readonly string[];
}

/**
 * Dias civis inteiros entre duas datas, no fuso do vendedor.
 *
 * Civis e não de 24 horas: conferido ontem às 23h e agora são 8h da manhã é "um
 * dia", não "zero dias". A pessoa conta em dias de calendário, e o alerta que
 * discorda dela é alerta que ela não entende.
 */
export function diasCivisEntre(de: Date, ate: Date, fuso: string = FUSO_PADRAO): number {
  const [aDe, aAte] = [diaNoFuso(de, fuso), diaNoFuso(ate, fuso)];
  // `Date.UTC` sobre o dia civil já normalizado: a diferença é exata em dias, sem
  // horário de verão no meio para atrapalhar.
  const emDias = (dia: string): number => Date.parse(`${dia}T00:00:00Z`) / 86_400_000;
  return Math.round(emDias(aAte) - emDias(aDe));
}

export interface OpcoesDaConferencia {
  readonly agora?: Date;
  readonly fuso?: string;
  readonly intervaloDias?: number;
}

/** Estado de uma linha, isolado para poder ser testado sozinho. */
export function estadoDaLinha(
  linha: LinhaDeConsignacao,
  opcoes: OpcoesDaConferencia = {},
): { estado: EstadoDeConferencia; diasDesde: number | null } {
  const agora = opcoes.agora ?? new Date();
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const intervalo = opcoes.intervaloDias ?? INTERVALO_DE_CONFERENCIA_DIAS;

  if (linha.conferidoEm === null) return { estado: 'nunca', diasDesde: null };

  const dias = diasCivisEntre(linha.conferidoEm, agora, fuso);
  if (dias > intervalo) return { estado: 'vencida', diasDesde: dias };
  if (dias === intervalo) return { estado: 'vence_hoje', diasDesde: dias };
  return { estado: 'em_dia', diasDesde: dias };
}

/**
 * Monta o quadro de conferência.
 *
 * Ordem: estado primeiro (nunca conferido no topo), e dentro do mesmo estado as
 * **unidades expostas** decrescendo. Duas linhas igualmente atrasadas não são
 * igualmente urgentes: a de trinta unidades anunciadas é a que cancela venda hoje.
 */
export function montarQuadroDeConferencia(
  linhas: readonly LinhaDeConsignacao[],
  opcoes: OpcoesDaConferencia = {},
): QuadroDeConferencia {
  const itens: ItemDaConferencia[] = linhas
    .map((linha) => {
      const { estado, diasDesde } = estadoDaLinha(linha, opcoes);
      return {
        ...linha,
        estado,
        diasDesde,
        emRisco: estado !== 'em_dia' && linha.qtdDisponivel >= UNIDADES_QUE_JA_SAO_RISCO,
      };
    })
    .sort(
      (a, b) =>
        PESO_DO_ESTADO[a.estado] - PESO_DO_ESTADO[b.estado] ||
        b.qtdDisponivel - a.qtdDisponivel ||
        a.parceiroNome.localeCompare(b.parceiroNome, 'pt-BR'),
    );

  const porEstado = Object.fromEntries(
    ESTADOS_DE_CONFERENCIA.map((e) => [e, itens.filter((i) => i.estado === e).length]),
  ) as Record<EstadoDeConferencia, number>;

  const emRisco = itens.filter((i) => i.emRisco);

  return {
    itens,
    porEstado,
    unidadesEmRisco: emRisco.reduce((soma, i) => soma + i.qtdDisponivel, 0),
    parceirosEmRisco: [...new Set(emRisco.map((i) => i.parceiroNome))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    ),
  };
}
