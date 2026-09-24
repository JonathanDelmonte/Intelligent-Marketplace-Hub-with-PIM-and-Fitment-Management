/**
 * O que se tira de uma página HTML, sem IA — para o leitor de página do garimpo (M6) e
 * para a ingestão por link colado (M1).
 *
 * Funções puras sobre o texto da página. A ordem de confiança é a das fontes:
 *
 * 1. **Dado estruturado** (`application/ld+json`, schema.org `Product` e `Offer`) — a
 *    loja declarou preço, moeda, marca e GTIN para o buscador ler. É o mais confiável
 *    que uma página tem, e a maioria das lojas publica.
 * 2. **Texto** — preço com `R$`, CNPJ com dígito verificador, códigos de modelo. Serve
 *    quando não há dado estruturado, e é marcado como vindo do texto.
 *
 * Por que sem IA: é gramática (CLAUDE.md, 3.5). Preço em reais, CNPJ e código de peça
 * têm forma, e forma se lê com código — de graça e igual toda vez.
 */
import { cnpjValido } from '@/dominio/documento';
import { reaisParaCentavos, type Centavos } from '@/lib/dinheiro';

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodifica as entidades de HTML que aparecem em título e preço. */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, nome: string) => {
    if (nome.startsWith('#x') || nome.startsWith('#X')) {
      const codigo = Number.parseInt(nome.slice(2), 16);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    if (nome.startsWith('#')) {
      const codigo = Number.parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

/** Texto sem marcação, sem espaço repetido. */
export function semMarcacao(html: string): string {
  return decodificarEntidades(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function tituloDaPagina(html: string): string | null {
  const achado = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titulo = achado?.[1] === undefined ? '' : semMarcacao(achado[1]);
  return titulo === '' ? null : titulo.slice(0, 300);
}

/** O texto visível: sem script, sem estilo, sem marcação. Cortado, porque é para casar. */
export function textoVisivel(html: string, limite = 200_000): string {
  return semMarcacao(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' '),
  ).slice(0, limite);
}

// ─── Dado estruturado ───────────────────────────────────────────────────────

export interface OfertaDaPagina {
  readonly nome: string | null;
  readonly marca: string | null;
  readonly gtin: string | null;
  /** Centavos. O menor preço da oferta quando ela é uma faixa. */
  readonly preco: Centavos | null;
  readonly moeda: string | null;
  /** `em estoque`, `esgotado`… — como a página declarou, em português. */
  readonly disponibilidade: string | null;
  readonly vendedor: string | null;
}

function comoTexto(valor: unknown): string | null {
  if (typeof valor === 'string') {
    const limpo = decodificarEntidades(valor).trim();
    return limpo === '' ? null : limpo;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function campo(objeto: unknown, nome: string): unknown {
  return typeof objeto === 'object' && objeto !== null && !Array.isArray(objeto)
    ? Object.getOwnPropertyDescriptor(objeto, nome)?.value
    : undefined;
}

/** `"Electrolux"` ou `{ "@type": "Brand", "name": "Electrolux" }`. */
function nomeDe(valor: unknown): string | null {
  return comoTexto(valor) ?? comoTexto(campo(valor, 'name'));
}

function tipos(objeto: unknown): readonly string[] {
  const tipo = campo(objeto, '@type');
  if (typeof tipo === 'string') return [tipo];
  return Array.isArray(tipo) ? tipo.filter((t): t is string => typeof t === 'string') : [];
}

/**
 * Preço de schema.org para centavos: `"69.90"`, `69.9`, `"69,90"`.
 *
 * Ponto e vírgula decimais são aceitos; separador de milhar não — preço estruturado
 * não tem, e aceitar faria `1.299` virar mil e duzentos ou um real, conforme o palpite.
 */
export function precoEstruturado(valor: unknown): Centavos | null {
  const texto = comoTexto(valor);
  if (texto === null || !/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return null;
  try {
    return reaisParaCentavos(texto.replace(',', '.'));
  } catch {
    return null;
  }
}

const DISPONIBILIDADE: Readonly<Record<string, string>> = {
  instock: 'em estoque',
  outofstock: 'esgotado',
  preorder: 'pré-venda',
  backorder: 'sob encomenda',
  discontinued: 'fora de linha',
  limitedavailability: 'estoque limitado',
  soldout: 'esgotado',
};

function disponibilidadeDe(valor: unknown): string | null {
  const texto = comoTexto(valor);
  if (texto === null) return null;
  const chave = texto.split('/').pop()?.toLowerCase() ?? '';
  return DISPONIBILIDADE[chave] ?? null;
}

function ofertaDe(produto: unknown): OfertaDaPagina {
  const bruto = campo(produto, 'offers');
  const ofertas = Array.isArray(bruto) ? bruto : bruto === undefined ? [] : [bruto];
  let preco: Centavos | null = null;
  let moeda: string | null = null;
  let disponibilidade: string | null = null;
  let vendedor: string | null = null;

  for (const oferta of ofertas) {
    const candidato =
      precoEstruturado(campo(oferta, 'price')) ?? precoEstruturado(campo(oferta, 'lowPrice'));
    if (candidato !== null && (preco === null || candidato < preco)) {
      preco = candidato;
      moeda = comoTexto(campo(oferta, 'priceCurrency'));
      disponibilidade = disponibilidadeDe(campo(oferta, 'availability'));
      vendedor = nomeDe(campo(oferta, 'seller'));
    }
  }

  const gtin =
    comoTexto(campo(produto, 'gtin13')) ??
    comoTexto(campo(produto, 'gtin')) ??
    comoTexto(campo(produto, 'gtin12')) ??
    comoTexto(campo(produto, 'gtin14')) ??
    comoTexto(campo(produto, 'gtin8'));

  return {
    nome: comoTexto(campo(produto, 'name')),
    marca: nomeDe(campo(produto, 'brand')),
    gtin,
    preco,
    moeda,
    disponibilidade,
    vendedor,
  };
}

/** Todo objeto de um JSON-LD, descendo em lista e em `@graph`. */
function objetosDoJsonLd(raiz: unknown): unknown[] {
  if (Array.isArray(raiz)) return raiz.flatMap(objetosDoJsonLd);
  if (typeof raiz !== 'object' || raiz === null) return [];
  const grafo = campo(raiz, '@graph');
  return [raiz, ...(grafo === undefined ? [] : objetosDoJsonLd(grafo))];
}

/**
 * As ofertas de produto que a página declara em `application/ld+json`.
 *
 * Bloco que não é JSON válido é pulado, e não derruba a leitura: página de loja tem
 * JSON-LD quebrado com frequência, e o bloco seguinte costuma estar certo.
 */
export function ofertasDaPagina(html: string): readonly OfertaDaPagina[] {
  const ofertas: OfertaDaPagina[] = [];
  const blocos = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const bloco of blocos) {
    let json: unknown;
    try {
      json = JSON.parse(bloco[1] ?? '');
    } catch {
      continue;
    }
    for (const objeto of objetosDoJsonLd(json)) {
      if (tipos(objeto).some((t) => t === 'Product' || t === 'ProductGroup')) {
        ofertas.push(ofertaDe(objeto));
      }
    }
  }
  return ofertas;
}

// ─── Texto ──────────────────────────────────────────────────────────────────

/**
 * Preços em reais escritos no texto: `R$ 69,90`, `R$1.299,00`.
 *
 * Aqui o separador de milhar é aceito, porque texto de loja escreve assim — e só com
 * vírgula decimal e duas casas, que é a forma brasileira sem ambiguidade.
 */
export function precosNoTexto(texto: string): readonly Centavos[] {
  const precos: Centavos[] = [];
  for (const achado of texto.matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g)) {
    const inteiro = (achado[1] ?? '').replace(/\./g, '');
    try {
      precos.push(reaisParaCentavos(`${inteiro}.${achado[2] ?? '00'}`));
    } catch {
      // Número fora do inteiro seguro não é preço de peça.
    }
  }
  return precos;
}

/**
 * CNPJs escritos no texto, **com dígito verificador conferido**.
 *
 * Só a forma pontuada (`12.345.678/0001-95`, e a com letras): catorze dígitos soltos
 * casariam com código de barras e telefone. Número que não confere não entra — é
 * número com cara de CNPJ, e consultar a Receita por ele gastaria um passo à toa.
 */
export function cnpjsNoTexto(texto: string): readonly string[] {
  const vistos = new Set<string>();
  for (const achado of texto.matchAll(
    /\b([0-9A-Z]{2})\.([0-9A-Z]{3})\.([0-9A-Z]{3})\/([0-9A-Z]{4})-(\d{2})\b/g,
  )) {
    const valor = achado.slice(1, 6).join('');
    if (cnpjValido(valor)) vistos.add(valor);
  }
  return [...vistos];
}

/**
 * Os endereços para onde a página aponta, absolutos e sem repetição, na ordem em que
 * aparecem. Âncora (`#`), `javascript:` e `mailto:` ficam de fora.
 */
export function linksDaPagina(html: string, base: string): readonly string[] {
  const vistos = new Set<string>();
  for (const achado of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const bruto = decodificarEntidades(achado[1] ?? '').trim();
    if (bruto === '' || bruto.startsWith('#') || /^(javascript|mailto|tel):/i.test(bruto)) {
      continue;
    }
    try {
      const url = new URL(bruto, base);
      url.hash = '';
      if (url.protocol === 'http:' || url.protocol === 'https:') vistos.add(url.href);
    } catch {
      // Endereço quebrado na página não é endereço.
    }
  }
  return [...vistos];
}
