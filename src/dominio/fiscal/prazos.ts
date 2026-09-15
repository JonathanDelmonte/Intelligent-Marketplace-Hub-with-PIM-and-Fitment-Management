/**
 * Painel de prazos fiscais (M12 — 9.4).
 *
 * Duas datas mudam a operação de quem vende como PF ou MEI, e as duas caem na
 * primeira semana de janeiro de 2027:
 *
 * - **01/01/2027** — CNPJ passa a ser exigido de pessoa física contribuinte de CBS
 *   (Decreto 12.955/2026).
 * - **04/01/2027** — NF-e de MEI e Simples sem os grupos de IBS/CBS começa a ser
 *   **rejeitada**.
 *
 * ## Por que isto é uma entrega e não um comentário no código
 *
 * Porque o custo de descobrir tarde é assimétrico. O cadastro fiscal de 20 SKUs é
 * uma tarde; de 200 no meio da operação é uma semana perdida em janeiro, com a
 * emissão parada. A entrega não é "avisar no dia" — é mostrar **quanto tempo ainda
 * dá para fazer com calma**, e por isso a urgência é derivada da distância.
 *
 * ## As datas são declaradas, e cada uma diz de onde veio
 *
 * Nenhuma delas foi verificada contra o diário oficial daqui — não há acesso. Elas
 * vêm da especificação, que é onde o dono do repositório as anotou, e cada uma
 * carrega a `base` legal para ser conferível. Se uma data mudar, muda em um lugar.
 *
 * ## Só vale para o regime a que se aplica
 *
 * Prazo que não é seu, na sua tela, é ruído — e ruído é o que faz a pessoa parar de
 * ler a tela onde o prazo que **é** dela vai aparecer. Cada prazo declara os regimes
 * que atinge.
 */
import type { RegimeFiscal } from '@/dominio/precificacao/tipos';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

export const URGENCIAS_DO_PRAZO = ['passou', 'agora', 'este_mes', 'tem_tempo'] as const;
export type UrgenciaDoPrazo = (typeof URGENCIAS_DO_PRAZO)[number];

/**
 * A partir de quantos dias o prazo deixa de ser "agora".
 *
 * Trinta, e o número vem do trabalho que o prazo exige, não do calendário: o
 * cadastro fiscal de um catálogo pequeno é uma tarde, mas descobrir qual NCM usar
 * em cada item não é — e trinta dias é o que dá para fazer isso sem parar a
 * operação.
 */
export const DIAS_QUE_JA_SAO_AGORA = 30;

/** Fim da faixa "este mês": depois disso ainda dá para planejar. */
export const DIAS_DO_HORIZONTE = 90;

/**
 * Comprimento máximo do rótulo curto.
 *
 * Existe porque o rótulo aparece no fim de uma linha da tela inicial, junto com a
 * contagem de dias. Um título de oitenta caracteres ali empurra o resto da frase para
 * a segunda linha e some com o número, que é o que se vai ler.
 */
export const LIMITE_DO_ROTULO_CURTO = 24;

export interface PrazoFiscal {
  readonly id: string;
  /** Dia civil, `2027-01-01`. Comparado como texto, no fuso do vendedor. */
  readonly dia: string;
  readonly titulo: string;
  /** O mesmo prazo em até `LIMITE_DO_ROTULO_CURTO` caracteres, para caber em linha. */
  readonly rotuloCurto: string;
  /** O que acontece se a data chegar sem o preparo feito. */
  readonly consequencia: string;
  /** O que fazer antes. Tem de ser acionável, não informativo. */
  readonly oQueFazer: string;
  /** De onde veio a data, para ser conferível. */
  readonly base: string;
  readonly regimes: readonly RegimeFiscal[];
}

/**
 * Os prazos conhecidos.
 *
 * Lista, não `if`: acrescentar prazo é uma linha, e é assim que a virada de 2028
 * não vai exigir mexer em lógica nenhuma.
 */
export const PRAZOS: readonly PrazoFiscal[] = [
  {
    id: 'cnpj_pf_cbs',
    dia: '2027-01-01',
    titulo: 'CNPJ exigido de pessoa física contribuinte de CBS',
    rotuloCurto: 'CNPJ obrigatório',
    consequencia:
      'Vender como pessoa física deixa de ser possível nas plataformas que exigem nota. Sem CNPJ, a operação para.',
    oQueFazer:
      'Abrir CNPJ (MEI resolve, se a receita couber no teto) antes da virada. Abrir CNPJ leva dias, não horas.',
    base: 'Decreto 12.955/2026',
    regimes: ['cpf'],
  },
  {
    id: 'nfe_ibs_cbs',
    dia: '2027-01-04',
    titulo: 'NF-e sem os grupos de IBS/CBS passa a ser rejeitada',
    rotuloCurto: 'NF-e com IBS e CBS',
    consequencia:
      'Cada nota sai rejeitada até o cadastro fiscal do item estar completo — e nota rejeitada é venda que não pode ser enviada.',
    oQueFazer:
      'Preencher NCM, CST e cClassTrib de cada SKU ativo. Com 20 SKUs é uma tarde; com 200 no meio da operação é uma semana.',
    base: 'Reforma tributária: obrigatoriedade dos grupos de IBS/CBS para MEI e Simples',
    regimes: ['mei', 'simples'],
  },
];

export interface PrazoAvaliado extends PrazoFiscal {
  readonly urgencia: UrgenciaDoPrazo;
  /** Dias civis até a data. Negativo quando já passou. */
  readonly diasRestantes: number;
  /** Este prazo atinge o regime consultado. */
  readonly meAtinge: boolean;
}

/** Dias civis entre dois dias em formato `AAAA-MM-DD`. */
function diasEntreDias(de: string, ate: string): number {
  const emDias = (dia: string): number => Date.parse(`${dia}T00:00:00Z`) / 86_400_000;
  return Math.round(emDias(ate) - emDias(de));
}

export function urgenciaDoPrazo(diasRestantes: number): UrgenciaDoPrazo {
  if (diasRestantes < 0) return 'passou';
  if (diasRestantes <= DIAS_QUE_JA_SAO_AGORA) return 'agora';
  if (diasRestantes <= DIAS_DO_HORIZONTE) return 'este_mes';
  return 'tem_tempo';
}

export interface OpcoesDosPrazos {
  readonly agora?: Date;
  readonly fuso?: string;
  readonly regime?: RegimeFiscal;
  readonly prazos?: readonly PrazoFiscal[];
}

/**
 * Avalia os prazos contra hoje.
 *
 * Ordem: o que atinge o regime do vendedor primeiro, depois por data. Prazo de
 * outro regime não é escondido — fica no fim, marcado —, porque o regime muda: quem
 * é CPF hoje pode ser MEI em dezembro, e aí o prazo que era "de outro" passa a ser
 * o dele.
 */
export function avaliarPrazos(opcoes: OpcoesDosPrazos = {}): readonly PrazoAvaliado[] {
  const agora = opcoes.agora ?? new Date();
  const hoje = diaNoFuso(agora, opcoes.fuso ?? FUSO_PADRAO);
  const regime = opcoes.regime;

  return (opcoes.prazos ?? PRAZOS)
    .map((prazo): PrazoAvaliado => {
      const diasRestantes = diasEntreDias(hoje, prazo.dia);
      return {
        ...prazo,
        diasRestantes,
        urgencia: urgenciaDoPrazo(diasRestantes),
        meAtinge: regime === undefined || prazo.regimes.includes(regime),
      };
    })
    .sort((a, b) => Number(b.meAtinge) - Number(a.meAtinge) || a.dia.localeCompare(b.dia));
}

/**
 * O prazo que decide o que fazer nesta semana.
 *
 * O mais próximo que ainda não passou **e** que atinge o vendedor. `null` quando
 * não há nenhum — e aí a tela não mostra caixa vazia.
 */
export function prazoQueImporta(avaliados: readonly PrazoAvaliado[]): PrazoAvaliado | null {
  return avaliados.find((p) => p.meAtinge && p.urgencia !== 'passou') ?? null;
}
