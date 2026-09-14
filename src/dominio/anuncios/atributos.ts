/**
 * Conferência de atributos do anúncio (M9, 8.3).
 *
 * A especificação pede "checklist de atributos obrigatórios **por categoria**
 * (anúncio incompleto ranqueia pior)". Este módulo é esse checklist, e duas
 * decisões o afastam da leitura literal.
 *
 * ## Por que não é por categoria da plataforma
 *
 * A tabela de atributo obrigatório por categoria é da plataforma, e daqui não há
 * como obtê-la: nenhuma conta conectada, e a documentação bloqueia acesso
 * automatizado — o mesmo limite honesto de `ingestao/planilha/mapeamento.ts`.
 * Copiar à mão a árvore de categorias do Mercado Livre produziria uma tabela
 * grande, sem fonte e desatualizada na semana seguinte.
 *
 * E não é o que o vendedor pergunta. Ele não pergunta "o que a categoria 1234
 * exige"; ele pergunta "o que falta neste anúncio, e o que cada falta custa". A
 * conferência então parte de **traços do produto** — detectados do que o sistema
 * já sabe — e acumula a exigência de cada traço sobre uma base comum. Traço novo é
 * um item na tabela, não um `if`.
 *
 * ## A exigência é nomeada pela consequência, não pela força
 *
 * `obrigatorio` / `opcional` não diz nada acionável. Aqui cada nível diz **o que
 * acontece se faltar**, que é a única informação que muda a decisão de preencher
 * agora ou depois:
 *
 * - `bloqueia` — a linha do arquivo de importação não existe sem isso.
 * - `devolucao` — o anúncio publica, vende, e volta. É o caro.
 * - `ranqueia` — publica e aparece menos, que é a frase da especificação.
 * - `ajuda` — reduz pergunta de comprador.
 *
 * `bloqueia` e `devolucao` pesam **igual** no preenchimento, e o empate é
 * deliberado: um é anúncio que não existe, o outro é anúncio que existe e perde
 * dinheiro com a reputação junto. Não há forma honesta de ordenar os dois num
 * número só, então o número não finge ordená-los — a tela lista os dois grupos
 * separados.
 */
import { pontosBase, type PontosBase } from '@/lib/dinheiro';
import type { Ficha } from '@/dominio/compatibilidade/ficha';

/** O que um anúncio pode declarar, e que este módulo sabe conferir. */
export const ATRIBUTOS = [
  'categoria',
  'ean',
  'marca',
  'peso',
  'dimensoes',
  'descricao',
  'compatibilidade',
  'modelo_peca',
  'voltagem',
  'medida',
  'quantidade_embalagem',
] as const;
export type Atributo = (typeof ATRIBUTOS)[number];

/** O que acontece se o atributo faltar. Ver o cabeçalho. */
export const EXIGENCIAS = ['bloqueia', 'devolucao', 'ranqueia', 'ajuda'] as const;
export type Exigencia = (typeof EXIGENCIAS)[number];

/**
 * Peso de cada nível no preenchimento.
 *
 * Inteiros pequenos de propósito: o número que sai daqui é para a pessoa comparar
 * dois anúncios, não para alimentar cálculo de dinheiro.
 */
export const PESO_DA_EXIGENCIA: Readonly<Record<Exigencia, number>> = {
  bloqueia: 4,
  devolucao: 4,
  ranqueia: 2,
  ajuda: 1,
};

/**
 * Traço do produto que muda o que é exigido dele.
 *
 * Quatro, e cada um existe porque a falta de um atributo dele tem consequência
 * própria. Traço não é categoria: um refil de purificador é `reposicao` **e**
 * `consumivel`, e acumula a exigência dos dois.
 */
export const TRACOS = ['reposicao', 'eletrico', 'medida_critica', 'consumivel'] as const;
export type Traco = (typeof TRACOS)[number];

/**
 * Palavra no tipo do produto que denuncia o traço.
 *
 * É heurística, como a de `PISTAS_DE_EXPORTACAO`, e falha do mesmo jeito correto:
 * traço não detectado significa exigência não cobrada, nunca exigência errada. O
 * conserto é acrescentar a palavra aqui.
 *
 * `reposicao` **não** está nesta tabela de propósito: ele é detectado da ficha de
 * compatibilidade, que é estrutura e não palpite. Ver `tracosDoProduto`.
 */
const PALAVRAS_DO_TRACO: Readonly<Record<Exclude<Traco, 'reposicao'>, readonly string[]>> = {
  eletrico: [
    'purificador',
    'bebedouro',
    'liquidificador',
    'ventilador',
    'aspirador',
    'secadora',
    'lavadora',
    'motor',
    'bomba',
    'resistencia',
    'compressor',
  ],
  medida_critica: [
    'correia',
    'mangueira',
    'vedacao',
    'anel',
    'retentor',
    'rolamento',
    'parafuso',
    'rolo',
    'escova',
    'lampada',
  ],
  consumivel: [
    'refil',
    'filtro',
    'elemento filtrante',
    'cartucho',
    'vela',
    'saco',
    'bolsa',
    'pastilha',
  ],
};

/** Exigência que vale para todo anúncio, qualquer que seja o produto. */
const BASE: Readonly<Partial<Record<Atributo, Exigencia>>> = {
  categoria: 'bloqueia',
  ean: 'bloqueia',
  marca: 'ranqueia',
  peso: 'ranqueia',
  dimensoes: 'ranqueia',
  descricao: 'ranqueia',
};

/** O que cada traço acrescenta. Nível mais grave vence quando dois traços pedem o mesmo. */
const POR_TRACO: Readonly<Record<Traco, Readonly<Partial<Record<Atributo, Exigencia>>>>> = {
  reposicao: { compatibilidade: 'devolucao', modelo_peca: 'ajuda' },
  eletrico: { voltagem: 'devolucao' },
  medida_critica: { medida: 'devolucao' },
  consumivel: { quantidade_embalagem: 'devolucao' },
};

/**
 * Por que cada atributo é cobrado.
 *
 * Texto de tela, e é a metade do valor do checklist: "falta peso" não muda
 * comportamento, "sem peso o frete sai errado e frete errado come a margem
 * inteira" muda.
 */
const PORQUE: Readonly<Record<Atributo, string>> = {
  categoria:
    'A linha do arquivo de importação não existe sem categoria: a plataforma não tem onde pôr o anúncio.',
  // Os dois nomes de propósito: a plataforma escreve GTIN, e o vendedor chama de
  // código de barras — é o que ele lê com o leitor do M14.
  ean: 'Sem código de barras: boa parte das categorias exige GTIN, e a importação recusa a linha inteira quando exige e não vem.',
  marca:
    'Busca por marca é como o comprador de peça chega. Sem marca o anúncio só aparece em busca por texto solto.',
  peso: 'Sem peso o frete sai errado — e frete errado come a margem inteira sem aparecer em lugar nenhum.',
  dimensoes:
    'Sem dimensão a plataforma estima a embalagem, e estimativa alta é frete alto no seu bolso.',
  descricao:
    'Anúncio sem descrição ranqueia pior e gera pergunta que a descrição responderia sozinha.',
  compatibilidade:
    'Peça sem lista de onde serve é peça que ninguém acha e que volta quando alguém arrisca.',
  modelo_peca:
    'O código da peça é como outro vendedor e o fornecedor se referem a ela. Ajuda a achar e a conferir.',
  voltagem:
    'Produto elétrico sem voltagem é devolução esperando acontecer: 110 e 220 no mesmo anúncio sempre chega no errado.',
  medida:
    'Nesta peça a medida é o que decide se serve. Anunciar sem ela é vender para quem vai devolver.',
  quantidade_embalagem:
    'Quantas peças vêm é a primeira pergunta em consumível — e a primeira devolução quando o comprador esperava duas.',
};

/** O que a conferência lê do produto. Tudo que pode faltar é nulo, nunca ausente. */
export interface ProdutoParaConferir {
  readonly tipoProduto: string;
  readonly marca: string | null;
  readonly modeloPeca: string | null;
  readonly ean: string | null;
  readonly categoria: string | null;
  readonly pesoGramas: number | null;
  readonly dimensoesMm: {
    readonly comprimento: number;
    readonly largura: number;
    readonly altura: number;
  } | null;
  readonly descricao: string | null;
  readonly voltagem: string | null;
  readonly medida: string | null;
  readonly quantidadeEmbalagem: number | null;
  readonly ficha: Ficha;
}

export interface ItemDaConferencia {
  readonly atributo: Atributo;
  readonly exigencia: Exigencia;
  readonly preenchido: boolean;
  readonly porque: string;
}

export interface Conferencia {
  /** Todos os itens cobrados deste produto, na ordem de gravidade. */
  readonly itens: readonly ItemDaConferencia[];
  readonly faltando: readonly ItemDaConferencia[];
  /** O que impede a exportação. Vazio significa que o arquivo sai. */
  readonly bloqueiam: readonly ItemDaConferencia[];
  /** O que publica e volta. Separado de `bloqueiam` porque a ação é outra. */
  readonly devolvem: readonly ItemDaConferencia[];
  readonly tracos: readonly Traco[];
  /**
   * Fração preenchida do que foi cobrado, ponderada pelo peso da exigência.
   *
   * Chama-se preenchimento e não completude porque é isso que mede: quanto do
   * checklist está cheio. **Não é nota de "pronto para publicar"** — um anúncio com
   * 90% preenchido e um `bloqueia` aberto não publica de jeito nenhum, e é
   * `podeExportar` que responde essa pergunta.
   */
  readonly preenchimentoBp: PontosBase;
  readonly podeExportar: boolean;
}

/** Qual nível é mais grave. Menor índice em `EXIGENCIAS` é mais grave. */
function maisGrave(a: Exigencia, b: Exigencia): Exigencia {
  return EXIGENCIAS.indexOf(a) <= EXIGENCIAS.indexOf(b) ? a : b;
}

/**
 * Traços deste produto.
 *
 * `reposicao` vem da **ficha**, não de palavra: se há qualquer linha de
 * compatibilidade — publicável ou retida —, o produto serve em outro produto, e
 * isso é o que peça de reposição quer dizer. Estrutura em vez de palpite onde a
 * estrutura existe.
 */
export function tracosDoProduto(produto: ProdutoParaConferir): readonly Traco[] {
  const achados = new Set<Traco>();

  if (produto.ficha.publicaveis.length > 0 || produto.ficha.retidas.length > 0) {
    achados.add('reposicao');
  }

  const texto = produto.tipoProduto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  for (const traco of TRACOS) {
    if (traco === 'reposicao') continue;
    if (PALAVRAS_DO_TRACO[traco].some((palavra) => texto.includes(palavra))) achados.add(traco);
  }

  // Ordem estável: a de `TRACOS`, não a de descoberta.
  return TRACOS.filter((t) => achados.has(t));
}

/** O atributo está preenchido? Uma pergunta por atributo, num lugar. */
function estaPreenchido(atributo: Atributo, produto: ProdutoParaConferir): boolean {
  switch (atributo) {
    case 'categoria':
      return naoVazio(produto.categoria);
    case 'ean':
      return naoVazio(produto.ean);
    case 'marca':
      return naoVazio(produto.marca);
    case 'peso':
      return produto.pesoGramas !== null && produto.pesoGramas > 0;
    case 'dimensoes':
      return (
        produto.dimensoesMm !== null &&
        produto.dimensoesMm.comprimento > 0 &&
        produto.dimensoesMm.largura > 0 &&
        produto.dimensoesMm.altura > 0
      );
    case 'descricao':
      return naoVazio(produto.descricao);
    case 'compatibilidade':
      // Publicável, não qualquer linha: compatibilidade retida não vai para a
      // vitrine, então para o comprador ela não existe.
      return produto.ficha.publicaveis.length > 0;
    case 'modelo_peca':
      return naoVazio(produto.modeloPeca);
    case 'voltagem':
      return naoVazio(produto.voltagem);
    case 'medida':
      return naoVazio(produto.medida);
    case 'quantidade_embalagem':
      return produto.quantidadeEmbalagem !== null && produto.quantidadeEmbalagem > 0;
  }
}

function naoVazio(valor: string | null): boolean {
  return valor !== null && valor.trim() !== '';
}

/**
 * Confere um produto contra o checklist dos seus traços.
 *
 * Função pura, sem banco e sem plataforma: o que é exigido não depende de para
 * onde vai, depende do que o produto é. O que depende de plataforma é o limite de
 * título, e isso é de `titulo.ts`.
 */
export function conferirAtributos(produto: ProdutoParaConferir): Conferencia {
  const tracos = tracosDoProduto(produto);

  const exigido = new Map<Atributo, Exigencia>();
  for (const [atributo, exigencia] of Object.entries(BASE)) {
    exigido.set(atributo as Atributo, exigencia);
  }
  for (const traco of tracos) {
    for (const [atributo, exigencia] of Object.entries(POR_TRACO[traco])) {
      const chave = atributo as Atributo;
      const atual = exigido.get(chave);
      exigido.set(chave, atual === undefined ? exigencia : maisGrave(atual, exigencia));
    }
  }

  const itens: ItemDaConferencia[] = ATRIBUTOS.flatMap((atributo) => {
    const exigencia = exigido.get(atributo);
    if (exigencia === undefined) return [];
    return [
      {
        atributo,
        exigencia,
        preenchido: estaPreenchido(atributo, produto),
        porque: PORQUE[atributo],
      },
    ];
  }).sort((a, b) => EXIGENCIAS.indexOf(a.exigencia) - EXIGENCIAS.indexOf(b.exigencia));

  const faltando = itens.filter((i) => !i.preenchido);
  const bloqueiam = faltando.filter((i) => i.exigencia === 'bloqueia');
  const devolvem = faltando.filter((i) => i.exigencia === 'devolucao');

  const total = itens.reduce((soma, i) => soma + PESO_DA_EXIGENCIA[i.exigencia], 0);
  const cheio = itens
    .filter((i) => i.preenchido)
    .reduce((soma, i) => soma + PESO_DA_EXIGENCIA[i.exigencia], 0);

  return {
    itens,
    faltando,
    bloqueiam,
    devolvem,
    tracos,
    // Trunca: 99% não pode virar 100% num checklist que tem item aberto.
    preenchimentoBp: pontosBase(total === 0 ? 10_000 : Math.trunc((cheio * 10_000) / total)),
    podeExportar: bloqueiam.length === 0,
  };
}

/**
 * A conferência em linhas de aviso, para quem já mostra aviso em texto.
 *
 * Só o que falta, e na ordem de gravidade — a lista inteira, com o que está certo,
 * é a tela de checklist, não um aviso.
 */
export function avisosDaConferencia(conferencia: Conferencia): readonly string[] {
  return conferencia.faltando.map((i) => i.porque);
}
