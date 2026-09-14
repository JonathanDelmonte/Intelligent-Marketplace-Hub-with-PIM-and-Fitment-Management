/**
 * Scanner determinístico de nicho (M7) — o filtro numérico.
 *
 * A especificação é explícita sobre o posto dele: "o scanner continua existindo,
 * mas desce de posto: ele é o **filtro numérico** que roda sobre o que o M6
 * trouxe, não o descobridor". Então aqui não há busca, não há LLM e não há
 * julgamento — sete cortes sobre números medidos, com o motivo de cada um.
 *
 * ## Subcategoria, nunca categoria
 *
 * "Eletrodomésticos" não diz nada; "correia de secadora Brastemp" diz tudo. Uma
 * média de categoria mistura nichos com dinâmicas opostas e devolve um número que
 * não descreve nenhum deles. A função exige o nome do nicho e recusa vazio — o que
 * não impede ninguém de passar "eletrodomésticos", mas deixa registrado no
 * resultado **sobre o que** o veredito foi dado.
 *
 * ## Número que falta não é número ruim
 *
 * Mesma disciplina da triagem de fornecedor: `null` é "ainda não medi" e vira
 * pendência, não reprovação. Um nicho que falha um corte é descartado; um nicho
 * sem dado precisa de medição, e confundir os dois joga fora oportunidade boa por
 * falta de fonte — que, com a busca do Mercado Livre bloqueada, é o caso comum.
 *
 * ## Tudo em inteiro
 *
 * Markup e frações em pontos-base, dinheiro em centavos. `3x` é `30 000 bp`, e
 * `45%` é `4 500 bp`. Comparar `0.45` com `0.45` em IEEE-754 num corte que decide
 * entrar ou não num nicho é a classe de bug que ninguém acha depois.
 */
import { CORTE_MARKUP_MINIMO, CORTE_TICKET_MINIMO } from '@/dominio/precificacao/margem';
import { formatarBRL, type Centavos } from '@/lib/dinheiro';

/** Os sete cortes da especificação, na ordem em que ela os lista. */
export const CORTES = [
  'markup',
  'share_dos_tres_maiores',
  'volume_do_nicho',
  'ticket_medio',
  'substituibilidade',
  'recorrencia',
  'fracao_em_catalogo',
] as const;
export type Corte = (typeof CORTES)[number];

/** O que se mediu do nicho. `null` em qualquer campo é "ainda não medi". */
export interface MedidasDoNicho {
  /** Subcategoria, nunca categoria. Obrigatório e não vazio. */
  readonly nicho: string;
  /** Markup sobre o custo, em pontos-base. `30 000` é 3x. */
  readonly markupBp: number | null;
  /** Fatia dos três maiores vendedores, em pontos-base. */
  readonly shareDosTresBp: number | null;
  /** Unidades vendidas por mês no nicho. */
  readonly volumeMes: number | null;
  readonly ticketMedio: Centavos | null;
  /**
   * Facilidade de trocar por um genérico mais barato, em pontos-base.
   *
   * Alto é ruim: se há genérico óbvio, volta a ser briga de preço. É estimativa
   * humana, e por isso entra como número informado, não calculado.
   */
  readonly substituibilidadeBp: number | null;
  /** Chance de o cliente voltar a comprar, em pontos-base. Alto é bom. */
  readonly recorrenciaBp: number | null;
  /** Fração dos anúncios do nicho que estão em catálogo no ML, em pontos-base. */
  readonly fracaoEmCatalogoBp: number | null;
}

export interface CriteriosDoScanner {
  readonly markupMinimoBp: number;
  readonly shareMaximoDosTresBp: number;
  readonly volumeMinimoMes: number;
  readonly ticketMinimo: Centavos;
  readonly substituibilidadeMaximaBp: number;
  readonly recorrenciaMinimaBp: number;
  readonly fracaoEmCatalogoMaximaBp: number;
}

/**
 * Os cortes da especificação, com o motivo de cada número.
 *
 * Onde a especificação dá faixa — share dos três maiores em "40–50%" — o padrão é
 * o **meio**, 45%, e é escolha registrada, não número achado. Substituibilidade e
 * recorrência ela descreve em palavras ("baixa", "alta") e não em número; 4 000 e
 * 6 000 são escolha deste projeto, e existem para o corte ser aplicável.
 */
export const CRITERIOS_PADRAO: CriteriosDoScanner = {
  // 3x. Abaixo disso, comissão mais frete mais uma devolução em dez zeram a margem.
  //
  // Vem do módulo de margem, não de um número repetido aqui: a especificação diz
  // que este corte e o do ticket "a tela de preço também usa", e dois números
  // iguais em dois arquivos divergem na primeira mudança.
  markupMinimoBp: CORTE_MARKUP_MINIMO * 10_000,
  // Acima de 45%, alguém tem contrato de fábrica e capital de giro.
  shareMaximoDosTresBp: 4_500,
  // ~30 un/mês: pouco para interessar os grandes, suficiente para um operador só.
  volumeMinimoMes: 30,
  // Abaixo de R$ 80 a taxa fixa come a margem. Mesmo corte do M8, importado.
  ticketMinimo: CORTE_TICKET_MINIMO,
  substituibilidadeMaximaBp: 4_000,
  recorrenciaMinimaBp: 6_000,
  // Catálogo exige reputação verde para ganhar destaque — fechado para conta nova.
  fracaoEmCatalogoMaximaBp: 3_000,
};

export const VEREDITOS_DO_SCANNER = ['garimpar', 'medir', 'descartar'] as const;
export type VereditoDoScanner = (typeof VEREDITOS_DO_SCANNER)[number];

export interface ResultadoDoCorte {
  readonly corte: Corte;
  /** `null` quando o número não foi medido. */
  readonly passou: boolean | null;
  /** O valor medido, em texto legível, ou `null`. */
  readonly valor: string | null;
  /** O corte configurado, em texto legível. */
  readonly limite: string;
  /** Por que este corte existe. Vai para a tela sem tradução. */
  readonly motivo: string;
}

export interface Avaliacao {
  readonly nicho: string;
  readonly veredito: VereditoDoScanner;
  readonly cortes: readonly ResultadoDoCorte[];
  /** Os que reprovaram. Vazio quando nada reprovou. */
  readonly reprovados: readonly Corte[];
  /** Os que não têm número. Cada um é uma medição a fazer. */
  readonly semMedida: readonly Corte[];
  readonly resumo: string;
}

export class NichoInvalido extends Error {
  override readonly name = 'NichoInvalido';
}

const MOTIVO_DO_CORTE: Readonly<Record<Corte, string>> = {
  markup: 'Abaixo de 3x, comissão mais frete mais uma devolução em dez zeram a margem.',
  share_dos_tres_maiores:
    'Share alto dos três maiores significa que alguém tem contrato de fábrica e capital de giro.',
  volume_do_nicho:
    'Volume baixo demais não paga o trabalho; volume alto demais atrai quem tem escala.',
  ticket_medio: 'Abaixo do ticket mínimo, a taxa fixa da plataforma come a margem.',
  substituibilidade: 'Se há genérico óbvio mais barato, volta a ser briga de preço.',
  recorrencia: 'Consumível traz o cliente de volta com custo zero de aquisição.',
  fracao_em_catalogo:
    'Catálogo exige reputação verde para ganhar destaque, e isso é fechado para conta nova.',
};

function porcento(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)}%`;
}

function vezes(bp: number): string {
  return `${(bp / 10_000).toFixed(bp % 10_000 === 0 ? 0 : 1)}x`;
}

/**
 * Avalia um nicho contra os cortes.
 *
 * A ordem das regras é a mesma da triagem de fornecedor, e pelo mesmo motivo:
 *
 * 1. **Reprovou algum corte** → descartar. Um corte é um corte; ter sete não
 *    significa média de sete.
 * 2. **Falta número** → medir. Não é reprovação, e tratar como reprovação joga
 *    fora nicho bom por falta de fonte — que, com a busca do Mercado Livre
 *    bloqueada, é o caso comum e não a exceção.
 * 3. **Passou nos sete** → garimpar.
 */
export function avaliarNicho(
  medidas: MedidasDoNicho,
  criterios: CriteriosDoScanner = CRITERIOS_PADRAO,
): Avaliacao {
  const nicho = medidas.nicho.trim();
  if (nicho === '') {
    throw new NichoInvalido('avaliação sem nicho: o corte é por subcategoria, e ela tem nome');
  }

  const cortes: ResultadoDoCorte[] = [
    {
      corte: 'markup',
      passou: medidas.markupBp === null ? null : medidas.markupBp >= criterios.markupMinimoBp,
      valor: medidas.markupBp === null ? null : vezes(medidas.markupBp),
      limite: `≥ ${vezes(criterios.markupMinimoBp)}`,
      motivo: MOTIVO_DO_CORTE.markup,
    },
    {
      corte: 'share_dos_tres_maiores',
      passou:
        medidas.shareDosTresBp === null
          ? null
          : medidas.shareDosTresBp < criterios.shareMaximoDosTresBp,
      valor: medidas.shareDosTresBp === null ? null : porcento(medidas.shareDosTresBp),
      limite: `< ${porcento(criterios.shareMaximoDosTresBp)}`,
      motivo: MOTIVO_DO_CORTE.share_dos_tres_maiores,
    },
    {
      corte: 'volume_do_nicho',
      passou: medidas.volumeMes === null ? null : medidas.volumeMes >= criterios.volumeMinimoMes,
      valor: medidas.volumeMes === null ? null : `${String(medidas.volumeMes)} un/mês`,
      limite: `≥ ${String(criterios.volumeMinimoMes)} un/mês`,
      motivo: MOTIVO_DO_CORTE.volume_do_nicho,
    },
    {
      corte: 'ticket_medio',
      passou: medidas.ticketMedio === null ? null : medidas.ticketMedio > criterios.ticketMinimo,
      valor: medidas.ticketMedio === null ? null : formatarBRL(medidas.ticketMedio),
      limite: `> ${formatarBRL(criterios.ticketMinimo)}`,
      motivo: MOTIVO_DO_CORTE.ticket_medio,
    },
    {
      corte: 'substituibilidade',
      passou:
        medidas.substituibilidadeBp === null
          ? null
          : medidas.substituibilidadeBp <= criterios.substituibilidadeMaximaBp,
      valor: medidas.substituibilidadeBp === null ? null : porcento(medidas.substituibilidadeBp),
      limite: `≤ ${porcento(criterios.substituibilidadeMaximaBp)}`,
      motivo: MOTIVO_DO_CORTE.substituibilidade,
    },
    {
      corte: 'recorrencia',
      passou:
        medidas.recorrenciaBp === null
          ? null
          : medidas.recorrenciaBp >= criterios.recorrenciaMinimaBp,
      valor: medidas.recorrenciaBp === null ? null : porcento(medidas.recorrenciaBp),
      limite: `≥ ${porcento(criterios.recorrenciaMinimaBp)}`,
      motivo: MOTIVO_DO_CORTE.recorrencia,
    },
    {
      corte: 'fracao_em_catalogo',
      passou:
        medidas.fracaoEmCatalogoBp === null
          ? null
          : medidas.fracaoEmCatalogoBp <= criterios.fracaoEmCatalogoMaximaBp,
      valor: medidas.fracaoEmCatalogoBp === null ? null : porcento(medidas.fracaoEmCatalogoBp),
      limite: `≤ ${porcento(criterios.fracaoEmCatalogoMaximaBp)}`,
      motivo: MOTIVO_DO_CORTE.fracao_em_catalogo,
    },
  ];

  const reprovados = cortes.filter((c) => c.passou === false).map((c) => c.corte);
  const semMedida = cortes.filter((c) => c.passou === null).map((c) => c.corte);

  if (reprovados.length > 0) {
    return {
      nicho,
      veredito: 'descartar',
      cortes,
      reprovados,
      semMedida,
      resumo: `Reprovou ${String(reprovados.length)} de ${String(CORTES.length)} cortes. Um corte é um corte: ter sete não significa média de sete.`,
    };
  }

  if (semMedida.length > 0) {
    return {
      nicho,
      veredito: 'medir',
      cortes,
      reprovados,
      semMedida,
      resumo: `Passou no que dá para medir, e falta(m) ${String(semMedida.length)} número(s). Falta de dado não é reprovação.`,
    };
  }

  return {
    nicho,
    veredito: 'garimpar',
    cortes,
    reprovados,
    semMedida,
    resumo: 'Passou nos sete cortes.',
  };
}

/**
 * Markup em pontos-base a partir de custo e preço de mercado.
 *
 * Separado da avaliação porque é a única medida que o sistema **calcula** em vez
 * de receber: as outras seis vêm de contagem ou de estimativa humana. Custo zero
 * ou negativo devolve `null` — markup sobre custo zero é infinito, e infinito
 * passaria em qualquer corte.
 */
export function markupBpDe(custo: Centavos, precoDeMercado: Centavos): number | null {
  if (custo <= 0) return null;
  return Math.trunc((precoDeMercado * 10_000) / custo);
}

/** Etiqueta do veredito, para a tela não ter texto de estado espalhado. */
export const ETIQUETA_DO_VEREDITO_DO_SCANNER: Readonly<Record<VereditoDoScanner, string>> = {
  garimpar: 'vale garimpar',
  medir: 'falta medir',
  descartar: 'descartado',
};

/** Nome legível de cada corte, para a tela. */
export const NOME_DO_CORTE: Readonly<Record<Corte, string>> = {
  markup: 'markup sobre o custo',
  share_dos_tres_maiores: 'share dos três maiores',
  volume_do_nicho: 'volume do nicho',
  ticket_medio: 'ticket médio',
  substituibilidade: 'substituibilidade',
  recorrencia: 'recorrência',
  fracao_em_catalogo: 'fração em catálogo no ML',
};
