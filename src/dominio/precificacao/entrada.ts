/**
 * Como montar a entrada do M8 a partir do que se sabe do produto.
 *
 * O motor de margem é a fase 1 e é a peça mais antiga do sistema. Ele recebe peso,
 * custo, embalagem e taxa de devolução — e a ficha do produto tem esses campos
 * **opcionais**, porque ninguém preenche tudo no dia em que cadastra. Este arquivo é a
 * ponte, e ela existia solta em cada chamador: o leitor de código de barras montava a
 * dele, com três constantes próprias, e a tela de catálogo ia montar a segunda.
 *
 * ## A presunção é declarada, não escondida
 *
 * Campo ausente entra presumido, e a função **devolve a lista do que presumiu**. É o que
 * permite a tela dizer "esta margem usou peso de 300 g porque o seu não está
 * cadastrado" em vez de mostrar um número com cara de medido. Presunção que não aparece
 * na tela é a forma mais barata de perder dinheiro com confiança.
 *
 * Custo ausente é caso separado: em vez de presumir, entra **zero**, e o M8 avisa que a
 * margem mostrada é o teto e não a real. Presumir custo erraria para o lado otimista,
 * que é o pior lado — e a razão é a mesma da proposta de SKU não presumir custo a partir
 * de preço de anúncio: preço de anúncio é o que outro cobra.
 */
import { centavos, pontosBase, ZERO, type Centavos, type PontosBase } from '@/lib/dinheiro';
import type { EntradaSemPreco } from './simulador';
import type { ContextoDoVendedor, ModoFrete, Plataforma, TipoAnuncioML } from './tipos';

/**
 * Peso presumido, em gramas.
 *
 * 300 g. No balcão ninguém sabe o peso, e peso errado muda a faixa de frete e portanto
 * a margem. Número escolhido, não medido — sai quando o SKU tiver peso cadastrado, e a
 * tela de catálogo existe justamente para isso.
 */
export const PESO_PRESUMIDO_GRAMAS = 300;

/** Embalagem presumida: R$ 1,50. Caixa, plástico e etiqueta de um item pequeno. */
export const EMBALAGEM_PRESUMIDA_CENTAVOS = 150;

/**
 * Devolução presumida: 2%.
 *
 * Entra como custo e não como surpresa. Sai quando houver histórico de pedido para
 * medir devolução real (M10).
 */
export const DEVOLUCAO_PRESUMIDA_BP = 200;

export const CAMPOS_PRESUMIVEIS = ['peso', 'embalagem', 'devolucao'] as const;
export type CampoPresumido = (typeof CAMPOS_PRESUMIVEIS)[number];

/** O que cada presunção custa quando está errada. É o texto que a tela mostra. */
export const O_QUE_O_PRESUMIDO_CUSTA: Readonly<Record<CampoPresumido, string>> = {
  peso: `Peso presumido em ${String(PESO_PRESUMIDO_GRAMAS)} g. Peso errado muda a faixa de frete, e frete é o custo que come margem sem aparecer.`,
  embalagem: 'Embalagem presumida em R$ 1,50 — caixa, plástico e etiqueta de item pequeno.',
  devolucao: `Devolução presumida em ${String(DEVOLUCAO_PRESUMIDA_BP / 100)}%. A real só aparece com histórico de pedido.`,
};

/** O que a margem precisa saber do produto. Campo nulo é "não sei", não zero. */
export interface FichaParaMargem {
  readonly custoAtual: Centavos | null;
  readonly pesoG: number | null;
  readonly taxaDevolucaoEsperadaBp: PontosBase | null;
  /** Custo de embalagem deste produto, quando ele é diferente do presumido. */
  readonly embalagem?: Centavos | null;
}

export interface EntradaMontada {
  readonly base: EntradaSemPreco;
  /** O que entrou presumido, na ordem de `CAMPOS_PRESUMIVEIS`. */
  readonly presumidos: readonly CampoPresumido[];
  /** Custo ausente. A margem sai, e é o teto — não a real. */
  readonly semCusto: boolean;
}

/**
 * Monta a entrada do M8, dizendo o que presumiu.
 *
 * Devolve a entrada **sem preço**: é o preço que a simulação varre, e é ele que a tela
 * deixa a pessoa mexer. `calcularMargem` recebe `{ ...base, preco }`.
 */
export function entradaParaMargem(params: {
  readonly ficha: FichaParaMargem;
  readonly plataforma: Plataforma;
  readonly vendedor: ContextoDoVendedor;
  readonly modoFrete: ModoFrete;
  readonly tipoAnuncioML?: TipoAnuncioML;
  readonly categoria?: string;
  readonly freteConhecido?: Centavos;
  readonly emCampanha?: boolean;
  readonly em?: Date;
}): EntradaMontada {
  const { ficha } = params;
  const presumidos: CampoPresumido[] = [];

  const pesoGramas = ficha.pesoG ?? PESO_PRESUMIDO_GRAMAS;
  if (ficha.pesoG === null) presumidos.push('peso');

  const embalagem = ficha.embalagem ?? centavos(EMBALAGEM_PRESUMIDA_CENTAVOS);
  if (ficha.embalagem === undefined || ficha.embalagem === null) presumidos.push('embalagem');

  const devolucao = ficha.taxaDevolucaoEsperadaBp ?? pontosBase(DEVOLUCAO_PRESUMIDA_BP);
  if (ficha.taxaDevolucaoEsperadaBp === null) presumidos.push('devolucao');

  const base: EntradaSemPreco = {
    plataforma: params.plataforma,
    pesoGramas,
    custoProduto: ficha.custoAtual ?? ZERO,
    embalagem,
    modoFrete: params.modoFrete,
    taxaDevolucaoEsperada: devolucao,
    vendedor: params.vendedor,
    ...(params.tipoAnuncioML === undefined ? {} : { tipoAnuncioML: params.tipoAnuncioML }),
    ...(params.categoria === undefined ? {} : { categoria: params.categoria }),
    ...(params.freteConhecido === undefined ? {} : { freteConhecido: params.freteConhecido }),
    ...(params.emCampanha === undefined ? {} : { emCampanha: params.emCampanha }),
    ...(params.em === undefined ? {} : { em: params.em }),
  };

  // A ordem é a de `CAMPOS_PRESUMIVEIS` porque a tela lista nessa ordem, e lista
  // ordenada por declaração não muda de lugar quando um campo é preenchido.
  return {
    base,
    presumidos: CAMPOS_PRESUMIVEIS.filter((c) => presumidos.includes(c)),
    semCusto: ficha.custoAtual === null,
  };
}
