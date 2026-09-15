/**
 * Alerta de categoria regulada (M12 — 9.6).
 *
 * A especificação: "suplemento tem regra específica de ANVISA no ML, com exigência
 * de rótulo e documentação, e **anúncio irregular é cancelado**. O sistema marca o
 * SKU e mostra o aviso **antes de publicar**."
 *
 * ## O "antes de publicar" é a entrega
 *
 * Descobrir depois é o cancelamento do anúncio, com a venda perdida e uma marca na
 * conta — que é o ativo. Então isto não é um relatório: é um item do checklist de
 * atributos, no mesmo lugar onde o resto do que impede publicar aparece.
 *
 * ## Detecção por palavra, e a marcação no SKU vence
 *
 * `sku.categoria_regulada` é o campo em que a pessoa **decide**, e ele manda. A
 * detecção por palavra existe para o caso em que ninguém marcou nada — que é o caso
 * de todo catálogo importado —, e ela só **sugere**.
 *
 * A assimetria de custo decide o desenho: deixar passar um suplemento custa o
 * anúncio cancelado; sugerir regulação onde não há custa uma linha de aviso que a
 * pessoa dispensa. Então a palavra sugere com folga, e quem decide é quem lê.
 */

/**
 * Áreas com regra de órgão regulador que atinge o anúncio.
 *
 * Quatro, e cada uma está aqui porque o anúncio pode ser cancelado por ela — não por
 * ser "sensível" em abstrato.
 */
export const AREAS_REGULADAS = [
  'anvisa_suplemento',
  'anvisa_cosmetico',
  'anvisa_saude',
  'inmetro',
] as const;
export type AreaRegulada = (typeof AREAS_REGULADAS)[number];

export interface RegraDaArea {
  readonly area: AreaRegulada;
  readonly orgao: string;
  readonly rotulo: string;
  /** O que a plataforma exige. Acionável, não descritivo. */
  readonly exigencia: string;
  /** O que acontece se publicar sem cumprir. */
  readonly consequencia: string;
  /** Palavras que sugerem a área. Sugerem, não decidem. */
  readonly palavras: readonly string[];
}

export const REGRAS: readonly RegraDaArea[] = [
  {
    area: 'anvisa_suplemento',
    orgao: 'ANVISA',
    rotulo: 'suplemento alimentar',
    exigencia:
      'Registro ou notificação na ANVISA, rótulo conforme a RDC aplicável, e a documentação do fabricante à mão — o Mercado Livre pede na revisão.',
    consequencia: 'Anúncio irregular de suplemento é cancelado, e a conta fica marcada.',
    palavras: [
      'suplemento',
      'whey',
      'creatina',
      'colageno',
      'vitamina',
      'proteina',
      'aminoacido',
      'termogenico',
      'omega',
    ],
  },
  {
    area: 'anvisa_cosmetico',
    orgao: 'ANVISA',
    rotulo: 'cosmético',
    exigencia:
      'Notificação ou registro do produto e rótulo com o número. Cosmético importado precisa do importador identificado.',
    consequencia: 'Anúncio sem a regularização é removido, e a reincidência suspende a conta.',
    palavras: ['cosmetico', 'shampoo', 'creme facial', 'protetor solar', 'tintura', 'esmalte'],
  },
  {
    area: 'anvisa_saude',
    orgao: 'ANVISA',
    rotulo: 'produto para saúde',
    exigencia:
      'Registro do produto e do fabricante, com o número no anúncio. Vale para o que toca o corpo com finalidade de saúde.',
    consequencia: 'Categoria com fiscalização ativa: anúncio irregular cai rápido.',
    palavras: [
      'mascara cirurgica',
      'seringa',
      'termometro',
      'teste rapido',
      'luva de procedimento',
    ],
  },
  {
    area: 'inmetro',
    orgao: 'INMETRO',
    rotulo: 'produto com certificação compulsória',
    exigencia:
      'Selo de conformidade do INMETRO e o número de registro do modelo. Vale para brinquedo, produto elétrico de uso doméstico e material de segurança.',
    consequencia:
      'Sem o selo o anúncio pode ser removido, e o produto apreendido em fiscalização de estoque.',
    palavras: ['brinquedo', 'capacete', 'cadeirinha', 'bebe conforto', 'extintor', 'disjuntor'],
  },
];

export type Origem = 'marcado_no_sku' | 'sugerido_por_palavra' | 'nenhuma';

export interface AvaliacaoDeRegulacao {
  readonly area: AreaRegulada | null;
  readonly origem: Origem;
  readonly regra: RegraDaArea | null;
  /** `null` quando não há nada a dizer, para a tela não mostrar caixa vazia. */
  readonly mensagem: string | null;
}

const SEM_REGULACAO: AvaliacaoDeRegulacao = {
  area: null,
  origem: 'nenhuma',
  regra: null,
  mensagem: null,
};

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export interface ProdutoParaRegulacao {
  /** `sku.categoria_regulada`. Decisão da pessoa, e ela manda. */
  readonly categoriaRegulada: string | null;
  /** Título e tipo, onde a palavra é procurada quando ninguém marcou. */
  readonly tituloInterno: string;
  readonly tipoProduto?: string | null;
}

/**
 * Avalia se o produto cai em área regulada.
 *
 * A marcação no SKU vence a palavra, sempre: é onde a pessoa decidiu, e decisão
 * humana não é sobrescrita por heurística — a mesma regra da resolução de
 * compatibilidade.
 */
export function avaliarRegulacao(produto: ProdutoParaRegulacao): AvaliacaoDeRegulacao {
  const marcado = (produto.categoriaRegulada ?? '').trim();
  if (marcado !== '') {
    const porArea = REGRAS.find((r) => r.area === marcado);
    const porRotulo = REGRAS.find((r) => normalizar(r.rotulo) === normalizar(marcado));
    const regra = porArea ?? porRotulo ?? null;

    if (regra !== null) {
      return {
        area: regra.area,
        origem: 'marcado_no_sku',
        regra,
        mensagem: mensagemDe(regra, 'marcado_no_sku'),
      };
    }

    // Marcado com algo que este módulo não conhece. Não é caso de ignorar: a
    // pessoa marcou por um motivo, e o aviso genérico preserva o motivo.
    return {
      area: null,
      origem: 'marcado_no_sku',
      regra: null,
      mensagem: `Este produto está marcado como categoria regulada ("${marcado}"), e eu não conheço a regra dessa área. Confira a exigência da plataforma antes de publicar.`,
    };
  }

  const texto = normalizar(`${produto.tituloInterno} ${produto.tipoProduto ?? ''}`);
  const sugerida = REGRAS.find((r) => r.palavras.some((p) => texto.includes(normalizar(p))));

  if (sugerida === undefined) return SEM_REGULACAO;

  return {
    area: sugerida.area,
    origem: 'sugerido_por_palavra',
    regra: sugerida,
    mensagem: mensagemDe(sugerida, 'sugerido_por_palavra'),
  };
}

function mensagemDe(regra: RegraDaArea, origem: Origem): string {
  const abertura =
    origem === 'marcado_no_sku'
      ? `Este produto está marcado como ${regra.rotulo}.`
      : `O título sugere ${regra.rotulo} — pode ser engano meu, e quem decide é você.`;

  return `${abertura} ${regra.orgao}: ${regra.exigencia} ${regra.consequencia}`;
}
