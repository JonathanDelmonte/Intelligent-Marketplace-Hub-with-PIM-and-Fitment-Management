/**
 * Famílias de hipótese do prospector (M6 — 10.3).
 *
 * A especificação separa o que é viável do que não é, e a distinção manda no desenho
 * inteiro deste módulo: "varrer a internet inteira é caro e inútil… crawler largo não
 * é mais inteligente que busca dirigida — é **menos**, porque não tem objetivo".
 *
 * O que substitui o crawler é **fronteira dirigida por hipótese**: o agente não
 * varre, investiga — com alvo, orçamento e critério de parada. E investigar exige
 * saber o que se está tentando descobrir, que é o que este arquivo declara.
 *
 * ## Por que as famílias são dados e não código
 *
 * Cada família tem pergunta própria, ferramenta própria e valor próprio. Como tabela,
 * acrescentar uma família é uma linha; como `switch`, é mexer no laço do agente — e o
 * laço é a parte que não se quer tocar depois de estar certa.
 *
 * ## O valor é declarado, e é palpite honesto
 *
 * `valorBase` ordena a fronteira, e os números **não** foram medidos: não há execução
 * real para medir. O critério que usei é o da especificação — o que muda a decisão de
 * comprar e vender. "Onde isso é mais barato" vale mais que "quem já vende isso",
 * porque a primeira resposta muda o preço de compra e a segunda só informa. Ficam
 * nomeados aqui para serem ajustados com dossiê de verdade na mão.
 */

export const FAMILIAS_DE_HIPOTESE = [
  'quem_fabrica',
  'quem_distribui',
  'onde_e_mais_barato',
  'em_que_mais_serve',
  'que_outras_pecas',
  'quem_ja_vende',
  'demanda_publica',
] as const;
export type FamiliaDeHipotese = (typeof FAMILIAS_DE_HIPOTESE)[number];

/**
 * Ferramenta que uma investigação usa.
 *
 * Declarada porque é o que diz se a hipótese **pode** ser investigada hoje: sem rede,
 * `busca_web` e `pncp` não rodam, e o agente precisa saber disso antes de gastar um
 * passo na fronteira em vez de descobrir no meio.
 */
export const FERRAMENTAS = [
  'busca_web',
  'ler_pagina',
  'visao',
  'cnpj',
  'pncp',
  'base_local',
] as const;
export type Ferramenta = (typeof FERRAMENTAS)[number];

export interface DefinicaoDeFamilia {
  readonly familia: FamiliaDeHipotese;
  /** A pergunta, do jeito que a especificação a escreve. */
  readonly pergunta: string;
  /** O que fazer com a resposta. É o que justifica gastar o passo. */
  readonly porQueImporta: string;
  readonly ferramentas: readonly Ferramenta[];
  /**
   * Valor esperado, em pontos de 0 a 100.
   *
   * Palpite declarado, ordenado pelo que muda decisão de compra e de venda.
   */
  readonly valorBase: number;
}

export const DEFINICOES: readonly DefinicaoDeFamilia[] = [
  {
    familia: 'onde_e_mais_barato',
    pergunta: 'Onde isso é mais barato?',
    porQueImporta:
      'Muda o preço de compra, que é o único número que melhora a margem sem mexer no preço de venda. Com custo desembarcado, não preço de etiqueta.',
    ferramentas: ['busca_web', 'ler_pagina'],
    valorBase: 100,
  },
  {
    familia: 'quem_distribui',
    pergunta: 'Quem distribui isso no Brasil?',
    porQueImporta:
      'Distribuidor nacional é fornecedor com prazo curto e sem importação. É o caminho mais rápido de comprar mais barato do que hoje.',
    ferramentas: ['busca_web', 'ler_pagina', 'cnpj'],
    valorBase: 90,
  },
  {
    familia: 'quem_fabrica',
    pergunta: 'Quem fabrica isso?',
    porQueImporta:
      'Achar o fabricante é o que permite achar o distribuidor dele — e às vezes comprar direto. Também resolve a marca quando o anúncio não diz.',
    ferramentas: ['busca_web', 'visao', 'ler_pagina'],
    valorBase: 80,
  },
  {
    familia: 'que_outras_pecas',
    pergunta: 'Que outras peças o mesmo aparelho consome?',
    porQueImporta:
      'Expande o catálogo de forma coerente, com custo de aquisição de cliente zero: quem compra refil hoje compra vedação em seis meses.',
    ferramentas: ['busca_web', 'base_local'],
    valorBase: 70,
  },
  {
    familia: 'em_que_mais_serve',
    pergunta: 'Em que mais isso serve?',
    porQueImporta:
      'Cada modelo compatível a mais é uma busca em que o anúncio aparece. Alimenta a ficha de M4, que é o que responde "serve no meu?".',
    ferramentas: ['busca_web', 'ler_pagina', 'base_local'],
    valorBase: 65,
  },
  {
    familia: 'demanda_publica',
    pergunta: 'Existe demanda pública?',
    porQueImporta:
      'Órgão público compra refil e peça em volume, os preços são dados abertos, e quase nenhum vendedor de marketplace olha para lá. Serve de sensor de demanda e de preço de referência.',
    ferramentas: ['pncp'],
    valorBase: 60,
  },
  {
    familia: 'quem_ja_vende',
    pergunta: 'Quem já vende isso, e quão forte é?',
    porQueImporta:
      'Mede concorrência sem depender da API de busca bloqueada. Informa a decisão, mas não muda preço de compra — por isso vale menos que as de custo.',
    ferramentas: ['busca_web', 'ler_pagina'],
    valorBase: 50,
  },
];

const POR_FAMILIA = new Map(DEFINICOES.map((d) => [d.familia, d]));

export function definicaoDaFamilia(familia: FamiliaDeHipotese): DefinicaoDeFamilia {
  const definicao = POR_FAMILIA.get(familia);
  // Não pode acontecer: `DEFINICOES` cobre a união, e há teste disso. O lançamento
  // existe para o dia em que alguém acrescentar à união e esquecer a definição —
  // falhar alto é melhor que investigar com valor zero em silêncio.
  if (definicao === undefined) {
    throw new Error(`família de hipótese sem definição: ${familia}`);
  }
  return definicao;
}

/** As famílias que dão para investigar com as ferramentas disponíveis. */
export function familiasPossiveis(
  disponiveis: readonly Ferramenta[],
): readonly FamiliaDeHipotese[] {
  const tem = new Set(disponiveis);
  return DEFINICOES.filter((d) => d.ferramentas.some((f) => tem.has(f))).map((d) => d.familia);
}
