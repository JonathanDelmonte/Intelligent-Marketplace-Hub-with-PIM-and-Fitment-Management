/**
 * Mapeamento de colunas de exportação para campos do domínio.
 *
 * ## O problema honesto deste arquivo
 *
 * Não há exportação real de nenhuma das três plataformas disponível para
 * conferir: não há conta conectada, e a documentação delas bloqueia acesso
 * automatizado. Os nomes de coluna abaixo são **o melhor palpite informado**, não
 * fato verificado. Ver o diário de bordo.
 *
 * ## O que o desenho faz a respeito
 *
 * Três coisas, e juntas elas transformam "palpite errado" em "aviso na tela" em
 * vez de "dado faltando que ninguém percebe":
 *
 * 1. **Casamento por sinônimo normalizado**, não por nome exato. "Preço",
 *    "PREÇO", "preco", "Preço unitário" e "price" chegam todos no mesmo campo.
 * 2. **Toda coluna não reconhecida é relatada** no resultado da importação. O
 *    palpite errado aparece como "coluna não reconhecida: X" e se conserta
 *    acrescentando um sinônimo.
 * 3. **Campos obrigatórios são poucos.** Só título é indispensável. Exigir preço
 *    faria uma exportação de rascunho ser rejeitada inteira.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';

/** Campos que uma linha de exportação pode alimentar. */
export const CAMPOS = [
  'id_externo',
  'titulo',
  'preco',
  'quantidade',
  'ean',
  'sku_vendedor',
  'categoria',
  'url',
  'status',
  'tipo_anuncio',
  'peso',
  'descricao',
  'data',
  'comissao',
  'taxa_fixa',
  'frete',
  'repasse_liquido',
  'comprador',
  'rastreio',
] as const;
export type Campo = (typeof CAMPOS)[number];

/**
 * Normaliza nome de coluna para comparação.
 *
 * Remove acento, caixa, pontuação e espaço. É o que faz `"Preço Unitário (R$)"` e
 * `"preco_unitario_rs"` casarem — e é exatamente o tipo de variação que aparece
 * entre uma exportação e a seguinte da mesma plataforma.
 */
export function normalizarNomeDeColuna(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Sinônimos por campo, por plataforma.
 *
 * A lista comum vale para todas; a específica de plataforma tem precedência
 * quando há conflito real (na Amazon `price` é `standard_price`).
 *
 * **Manutenção esperada:** ao ver "coluna não reconhecida" num relatório de
 * importação, o conserto é acrescentar o nome aqui — não mexer no leitor.
 */
const SINONIMOS_COMUNS: Readonly<Partial<Record<Campo, readonly string[]>>> = {
  id_externo: ['id', 'id_do_anuncio', 'codigo', 'item_id', 'listing_id', 'id_do_produto'],
  titulo: ['titulo', 'nome', 'nome_do_produto', 'nome_do_anuncio', 'produto', 'descricao_curta'],
  preco: ['preco', 'valor', 'preco_unitario', 'preco_de_venda', 'price', 'preco_r'],
  quantidade: ['quantidade', 'estoque', 'qtd', 'quantity', 'estoque_disponivel'],
  ean: ['ean', 'gtin', 'codigo_de_barras', 'ean_gtin', 'barcode'],
  sku_vendedor: ['sku', 'sku_do_vendedor', 'codigo_interno', 'seller_sku', 'referencia'],
  categoria: ['categoria', 'category', 'categoria_do_produto', 'id_da_categoria'],
  url: ['url', 'link', 'link_do_anuncio', 'permalink'],
  status: ['status', 'situacao', 'estado', 'status_do_anuncio'],
  peso: ['peso', 'peso_g', 'peso_gramas', 'peso_kg', 'weight'],
  descricao: ['descricao', 'descricao_completa', 'description', 'detalhes'],
  data: ['data', 'data_da_venda', 'data_do_pedido', 'date', 'criado_em'],
  comissao: ['comissao', 'tarifa_de_venda', 'taxa_de_venda', 'commission'],
  taxa_fixa: ['taxa_fixa', 'custo_fixo', 'tarifa_fixa'],
  frete: ['frete', 'custo_de_envio', 'valor_do_frete', 'shipping'],
  repasse_liquido: ['valor_liquido', 'repasse', 'total_recebido', 'net'],
  comprador: ['comprador', 'cliente', 'buyer'],
  rastreio: ['rastreio', 'codigo_de_rastreio', 'tracking', 'numero_de_rastreamento'],
  tipo_anuncio: ['tipo_de_anuncio', 'tipo', 'listing_type', 'exposicao'],
};

const SINONIMOS_POR_PLATAFORMA: Readonly<
  Record<Plataforma, Readonly<Partial<Record<Campo, readonly string[]>>>>
> = {
  ml: {
    id_externo: ['mlb', 'codigo_mlb', 'id_mlb', 'n_do_anuncio'],
    tipo_anuncio: ['tipo_de_publicacao', 'classico_premium'],
    preco: ['preco_de_venda_r'],
    comissao: ['tarifa_de_venda_r'],
    repasse_liquido: ['total_r', 'valor_a_receber'],
  },
  shopee: {
    id_externo: ['item_id', 'codigo_do_produto', 'no_do_pedido'],
    sku_vendedor: ['sku_principal', 'sku_do_produto', 'parent_sku'],
    preco: ['preco_original', 'preco_promocional'],
    quantidade: ['estoque_do_armazem', 'estoque_total'],
    status: ['status_do_pedido'],
  },
  amazon: {
    id_externo: ['asin', 'amazon_order_id', 'order_id'],
    sku_vendedor: ['seller_sku', 'sku'],
    titulo: ['item_name', 'product_name'],
    preco: ['standard_price', 'item_price', 'price'],
    quantidade: ['quantity', 'afn_fulfillable_quantity'],
    ean: ['external_product_id', 'product_id'],
    categoria: ['recommended_browse_nodes', 'product_type'],
    descricao: ['product_description'],
    peso: ['item_weight'],
  },
};

export interface ColunaMapeada {
  readonly indice: number;
  readonly nomeOriginal: string;
  readonly campo: Campo;
}

export interface ResultadoDoMapeamento {
  readonly mapeadas: readonly ColunaMapeada[];
  /**
   * Colunas que não casaram com nenhum sinônimo.
   *
   * **Relatar em vez de descartar é a decisão central deste módulo.** Uma coluna
   * ignorada em silêncio é dado que ninguém sabe que está faltando.
   */
  readonly naoReconhecidas: readonly { readonly indice: number; readonly nome: string }[];
  /** Campos que apareceram em mais de uma coluna. A primeira vence. */
  readonly duplicados: readonly Campo[];
}

/** Mapeia uma linha de cabeçalho. */
export function mapearCabecalho(
  cabecalho: readonly string[],
  plataforma: Plataforma,
): ResultadoDoMapeamento {
  const tabela = construirTabela(plataforma);

  const mapeadas: ColunaMapeada[] = [];
  const naoReconhecidas: { indice: number; nome: string }[] = [];
  const vistos = new Set<Campo>();
  const duplicados = new Set<Campo>();

  for (const [indice, nomeOriginal] of cabecalho.entries()) {
    const bruto = nomeOriginal.trim();
    if (bruto === '') continue;

    const campo = tabela.get(normalizarNomeDeColuna(bruto));

    if (campo === undefined) {
      naoReconhecidas.push({ indice, nome: bruto });
      continue;
    }

    if (vistos.has(campo)) {
      // Exportação do ML traz "Preço" e "Preço de venda" na mesma planilha. A
      // primeira vence, e a segunda é relatada — escolher em silêncio esconderia
      // qual das duas alimentou a margem.
      duplicados.add(campo);
      naoReconhecidas.push({ indice, nome: bruto });
      continue;
    }

    vistos.add(campo);
    mapeadas.push({ indice, nomeOriginal: bruto, campo });
  }

  return { mapeadas, naoReconhecidas, duplicados: [...duplicados] };
}

/**
 * Tabela de sinônimo para campo.
 *
 * Os específicos da plataforma entram **depois** dos comuns, para sobrescrever:
 * na Amazon `price` precisa cair em `preco` mesmo que a lista comum já tenha
 * mapeado outro nome para lá.
 */
function construirTabela(plataforma: Plataforma): ReadonlyMap<string, Campo> {
  const tabela = new Map<string, Campo>();

  const registrar = (dicionario: Readonly<Partial<Record<Campo, readonly string[]>>>) => {
    for (const campo of CAMPOS) {
      for (const sinonimo of dicionario[campo] ?? []) {
        tabela.set(normalizarNomeDeColuna(sinonimo), campo);
      }
    }
  };

  registrar(SINONIMOS_COMUNS);
  registrar(SINONIMOS_POR_PLATAFORMA[plataforma]);

  // O próprio nome do campo sempre casa, para quem gerar planilha a partir do
  // arquivo de importação que este sistema produz.
  for (const campo of CAMPOS) tabela.set(campo, campo);

  return tabela;
}

/** Quantas colunas deste cabeçalho o mapeador reconhece. */
export function quantidadeReconhecida(
  cabecalho: readonly string[],
  plataforma: Plataforma,
): number {
  return mapearCabecalho(cabecalho, plataforma).mapeadas.length;
}

/**
 * Campo indispensável.
 *
 * Só o título. Uma linha sem preço ainda é um anúncio que existe, e exportação de
 * rascunho não tem preço — rejeitar a planilha inteira por isso seria pior que
 * importar com preço nulo e marcar.
 */
export const CAMPOS_OBRIGATORIOS: readonly Campo[] = ['titulo'];

export function camposObrigatoriosAusentes(resultado: ResultadoDoMapeamento): readonly Campo[] {
  const presentes = new Set(resultado.mapeadas.map((m) => m.campo));
  return CAMPOS_OBRIGATORIOS.filter((c) => !presentes.has(c));
}
