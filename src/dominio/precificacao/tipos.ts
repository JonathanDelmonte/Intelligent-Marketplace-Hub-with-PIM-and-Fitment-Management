/**
 * Tipos da precificação (M8).
 *
 * A especificação põe este módulo em primeiro lugar na ordem de construção, e a
 * razão é que ele é a única função do sistema que muda uma decisão de dinheiro
 * no mesmo dia em que existe: nunca mais publicar anúncio com margem negativa.
 *
 * Todo valor é `Centavos` e todo percentual é `PontosBase` (ADR 0004).
 */
import type { Centavos, PontosBase } from '@/lib/dinheiro';
import type { Fonte } from '@/dominio/procedencia';

export const PLATAFORMAS = ['ml', 'shopee', 'amazon'] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

/**
 * Tipo de anúncio do Mercado Livre. Muda a comissão, e é a escolha de
 * precificação mais consequente da plataforma.
 *
 * - `classico`: comissão menor, sem parcelamento sem juros bancado.
 * - `premium`: comissão maior, com parcelamento sem juros.
 * - `catalogo`: concorre pela posição destacada da ficha de catálogo. Conta sem
 *   reputação verde não ganha o destaque e fica em "outras opções de compra" —
 *   ver o aviso `catalogo_sem_reputacao`.
 */
export const TIPOS_ANUNCIO_ML = ['classico', 'premium', 'catalogo'] as const;
export type TipoAnuncioML = (typeof TIPOS_ANUNCIO_ML)[number];

export const REGIMES_FISCAIS = ['cpf', 'mei', 'simples'] as const;
export type RegimeFiscal = (typeof REGIMES_FISCAIS)[number];

/** Quem paga o frete. Decide se o valor entra como custo do vendedor. */
export const MODOS_FRETE = ['comprador_paga', 'vendedor_paga', 'retirada'] as const;
export type ModoFrete = (typeof MODOS_FRETE)[number];

// ─── Tabelas de taxa ─────────────────────────────────────────────────────────

/**
 * Faixa de valor fixo por preço.
 *
 * `ateExclusivo` `null` significa "daqui para cima". As faixas são avaliadas em
 * ordem, e a primeira cujo limite superior é maior que o preço vence.
 */
export interface FaixaDeValorFixo {
  readonly ateExclusivo: Centavos | null;
  readonly valor: Centavos;
}

/**
 * Tabela de taxas de uma plataforma, com vigência.
 *
 * A vigência existe porque a especificação avisa que taxa de marketplace muda, e
 * uma margem realizada de três meses atrás precisa ser recalculável com a tabela
 * que valia naquele dia — senão a conferência de repasse (M10) acusa diferença
 * que não existe.
 */
export interface TabelaDeTaxas {
  readonly plataforma: Plataforma;
  readonly vigenteDe: Date;
  /** `null` = ainda vigente. */
  readonly vigenteAte: Date | null;
  /** De onde a tabela veio. `m3_api` quando lida de `listing_prices`. */
  readonly fonte: Fonte;
  /** Identificador humano, para aparecer na decomposição e no aviso. */
  readonly rotulo: string;

  /** Comissão base, por tipo de anúncio quando a plataforma tem tipos. */
  readonly comissao: ComissaoConfigurada;

  /**
   * Custo fixo por unidade, por faixa de preço. No ML é o que desaparece a
   * partir de R$ 79; na Shopee é a taxa por item; na Amazon é a do plano
   * individual.
   */
  readonly custoFixoPorUnidade: readonly FaixaDeValorFixo[];

  /**
   * Preço a partir do qual a plataforma obriga frete grátis bancado pelo
   * vendedor. `null` quando a plataforma não tem essa regra.
   */
  readonly limiarFreteGratisObrigatorio: Centavos | null;

  /** Acréscimos condicionais (CPF sem CNPJ, campanha, programa de frete). */
  readonly acrescimos: readonly AcrescimoConfigurado[];
}

/**
 * Comissão configurada. Duas formas, porque as plataformas são diferentes:
 * o ML cobra por tipo de anúncio, Shopee e Amazon por faixa de preço.
 */
export type ComissaoConfigurada =
  | {
      readonly tipo: 'por_tipo_anuncio';
      readonly porTipo: Readonly<Record<TipoAnuncioML, PontosBase>>;
      /** Sobrescrita por categoria, quando a categoria tem comissão própria. */
      readonly porCategoria?: Readonly<Record<string, Readonly<Record<TipoAnuncioML, PontosBase>>>>;
    }
  | {
      readonly tipo: 'por_faixa_de_preco';
      readonly faixas: readonly {
        readonly ateExclusivo: Centavos | null;
        readonly pontosBase: PontosBase;
      }[];
      readonly porCategoria?: Readonly<Record<string, PontosBase>>;
    };

/** Acréscimo que só incide quando a condição é verdadeira. */
export interface AcrescimoConfigurado {
  readonly codigo: string;
  readonly rotulo: string;
  readonly quando: CondicaoDeAcrescimo;
  readonly cobranca:
    | { readonly tipo: 'fixo_por_item'; readonly valor: Centavos }
    | { readonly tipo: 'percentual_do_preco'; readonly pontosBase: PontosBase };
}

export type CondicaoDeAcrescimo =
  'sempre' | 'vendedor_sem_cnpj' | 'em_campanha' | 'acima_do_limiar_de_frete';

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** Contexto do vendedor. Vem de `perfil_vendedor`, nunca de constante. */
export interface ContextoDoVendedor {
  readonly regimeFiscal: RegimeFiscal;
  readonly temCnpj: boolean;
  /**
   * Valor mensal do DAS do MEI, em centavos. Só usado no regime `mei`.
   * É rateado pelas unidades previstas no mês — ver `ratear` em `dinheiro.ts`.
   */
  readonly dasMensal?: Centavos;
  /** Unidades previstas de venda no mês, para ratear o DAS. */
  readonly unidadesPrevistasNoMes?: number;
  /** Alíquota efetiva do Simples, quando o regime é `simples`. */
  readonly aliquotaSimples?: PontosBase;
}

/** Entrada de `calcularMargem`. */
export interface EntradaDeMargem {
  readonly preco: Centavos;
  readonly plataforma: Plataforma;
  /** Tipo de anúncio. Obrigatório no ML; ignorado nas outras. */
  readonly tipoAnuncioML?: TipoAnuncioML;
  /** Identificador de categoria da plataforma, para comissão específica. */
  readonly categoria?: string;
  /** Peso em gramas. Usado para estimar o frete quando o vendedor paga. */
  readonly pesoGramas: number;
  readonly custoProduto: Centavos;
  readonly embalagem: Centavos;
  readonly modoFrete: ModoFrete;
  /**
   * Frete conhecido, quando já se sabe o valor. Quando ausente e o vendedor
   * paga, é estimado por peso pela tabela da plataforma.
   */
  readonly freteConhecido?: Centavos;
  /** Taxa de devolução esperada da categoria. Entra como custo, não surpresa. */
  readonly taxaDevolucaoEsperada: PontosBase;
  readonly vendedor: ContextoDoVendedor;
  /** Anúncio participando de campanha da plataforma. */
  readonly emCampanha?: boolean;
  /** Data de referência, para escolher a tabela vigente. Padrão: agora. */
  readonly em?: Date;
}

// ─── Saída ───────────────────────────────────────────────────────────────────

/** Cada linha do cálculo, para a tela poder mostrar onde o dinheiro foi. */
export interface DecomposicaoDeMargem {
  readonly preco: Centavos;
  readonly comissao: Centavos;
  readonly custoFixoPlataforma: Centavos;
  readonly acrescimos: readonly { readonly rotulo: string; readonly valor: Centavos }[];
  readonly frete: Centavos;
  readonly custoProduto: Centavos;
  readonly embalagem: Centavos;
  readonly tributo: Centavos;
  readonly provisaoDevolucao: Centavos;
}

export const SEVERIDADES = ['vermelho', 'amarelo', 'informativo'] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export const CODIGOS_AVISO = [
  'margem_negativa',
  'margem_apertada',
  'zona_morta_ml',
  'markup_abaixo_do_corte',
  'taxa_fixa_domina',
  'ticket_abaixo_do_corte',
  'custo_nao_informado',
  'regime_cpf_sem_tributo',
  'das_sem_unidades_previstas',
  'tabela_presumida',
  'catalogo_sem_reputacao',
] as const;
export type CodigoAviso = (typeof CODIGOS_AVISO)[number];

export interface Aviso {
  readonly codigo: CodigoAviso;
  readonly severidade: Severidade;
  readonly mensagem: string;
}

export interface ResultadoDeMargem {
  readonly preco: Centavos;
  /** Preço menos tudo que a plataforma retém. É o que cai na conta. */
  readonly repasseLiquido: Centavos;
  /** Repasse menos custo, embalagem, tributo e provisão de devolução. */
  readonly margemReais: Centavos;
  /** Margem sobre o preço. Negativa quando dá prejuízo. */
  readonly margemPontosBase: PontosBase;
  /** Markup sobre o custo: quantas vezes o preço cobre o custo do produto. */
  readonly markupSobreCusto: number | null;
  readonly decomposicao: DecomposicaoDeMargem;
  readonly avisos: readonly Aviso[];
  /** Rótulo da tabela usada, para auditoria. */
  readonly tabelaUsada: string;
}
