/**
 * Classificador de entrada (M1, etapa 3.1).
 *
 * A especificação pede "um único campo de entrada que aceita qualquer coisa e faz
 * a coisa certa". Este módulo é o "faz a coisa certa": decide o que a entrada é e
 * para qual extrator ela vai.
 *
 * **É função pura e determinística de propósito.** Classificar entrada não exige
 * julgamento sobre evidência incompleta — exige reconhecer formato, o que regra
 * resolve melhor, mais barato e de forma auditável que LLM (ADR 0005). O LLM entra
 * *depois*, dentro do extrator, onde o layout é imprevisível.
 */

/** O que a entrada é, e portanto qual extrator a recebe. */
export const TIPOS_DE_ENTRADA = [
  'anuncio_marketplace',
  'listagem_categoria',
  'catalogo_distribuidor',
  'tabela_precos_pdf',
  'imagem_tabela',
  'planilha_exportacao',
  'planilha_generica',
  'lista_de_links',
  'texto_colado',
  'desconhecido',
] as const;
export type TipoDeEntrada = (typeof TIPOS_DE_ENTRADA)[number];

/** Plataforma reconhecida na URL, quando houver. */
export const SITES_RECONHECIDOS = [
  'ml',
  'shopee',
  'amazon',
  'aliexpress',
  '1688',
  'alibaba',
] as const;
export type SiteReconhecido = (typeof SITES_RECONHECIDOS)[number];

export type Entrada =
  | { readonly tipo: 'url'; readonly valor: string }
  | { readonly tipo: 'texto'; readonly valor: string }
  | {
      readonly tipo: 'arquivo';
      readonly nome: string;
      readonly tipoMime?: string;
      readonly tamanhoBytes?: number;
    };

export interface Classificacao {
  readonly tipoDeEntrada: TipoDeEntrada;
  /** Site de origem, quando a entrada é URL de um site conhecido. */
  readonly site: SiteReconhecido | null;
  /**
   * Confiança da classificação, em pontos-base.
   *
   * Não é probabilidade de modelo: é o quanto a regra que casou é específica.
   * URL de item do ML com ID no caminho é 10 000; "parece uma planilha" é 5 000.
   * Abaixo de `LIMIAR_CLASSIFICACAO_CONFIAVEL` a entrada vai para revisão humana
   * antes de gastar token de extração.
   */
  readonly confiancaBp: number;
  /** Qual regra casou. Aparece na tela de jobs, para o erro ser diagnosticável. */
  readonly motivo: string;
  /** URLs encontradas, quando a entrada é uma lista. */
  readonly urls?: readonly string[];
}

/** Abaixo disso, revisar antes de extrair. */
export const LIMIAR_CLASSIFICACAO_CONFIAVEL = 6000;

// ─── Reconhecimento de site ──────────────────────────────────────────────────

const HOSTS: readonly { readonly site: SiteReconhecido; readonly padrao: RegExp }[] = [
  {
    site: 'ml',
    padrao: /(^|\.)mercadolivre\.com(\.br)?$|(^|\.)mercadolibre\.com(\.br)?$|(^|\.)mlstatic\.com$/,
  },
  { site: 'shopee', padrao: /(^|\.)shopee\.com(\.br)?$/ },
  { site: 'amazon', padrao: /(^|\.)amazon\.com(\.br)?$/ },
  { site: 'aliexpress', padrao: /(^|\.)aliexpress\.com$/ },
  { site: '1688', padrao: /(^|\.)1688\.com$/ },
  { site: 'alibaba', padrao: /(^|\.)alibaba\.com$/ },
];

export function siteDaUrl(url: string): SiteReconhecido | null {
  const analisada = analisarUrl(url);
  if (analisada === null) return null;
  return HOSTS.find((h) => h.padrao.test(analisada.hostname))?.site ?? null;
}

function analisarUrl(bruto: string): URL | null {
  const limpo = bruto.trim();

  // Espaço em branco no meio recusa antes de chegar ao `URL`, e não por
  // preciosismo: o analisador do padrão WHATWG **remove** tabulação e quebra de
  // linha em vez de recusar, então duas URLs coladas uma por linha viram uma URL
  // só, válida e sem sentido — `https://a.com` + `https://b.com` resulta em
  // `https://a.comhttps//b.com`. Numa caixa que aceita texto colado, isso é o
  // caso comum, não o exótico.
  if (/\s/u.test(limpo)) return null;

  try {
    const url = new URL(limpo);
    // Só http(s). `file:`, `javascript:` e `data:` não são entradas de ingestão,
    // e aceitá-las seria superfície de ataque numa caixa que recebe texto colado.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function ehUrlValida(valor: string): boolean {
  return analisarUrl(valor) !== null;
}

// ─── Padrões por plataforma ──────────────────────────────────────────────────

/**
 * URL de **item** por plataforma.
 *
 * Distinguir item de listagem é a decisão mais consequente do classificador: o
 * extrator de item devolve um `produto_externo`, o de listagem devolve N e precisa
 * paginar. Errar aqui gasta token e devolve lixo.
 */
const PADROES_DE_ITEM: Readonly<Record<SiteReconhecido, readonly RegExp[]>> = {
  // MLB-1234567890 ou /p/MLB12345678 (catálogo).
  ml: [/\/MLB-?\d{6,}/i, /\/p\/MLB\d{6,}/i],
  // .../produto-i.<shopid>.<itemid>
  shopee: [/-i\.\d+\.\d+/],
  // /dp/B0XXXXXXXX ou /gp/product/B0XXXXXXXX
  amazon: [/\/dp\/[A-Z0-9]{10}/i, /\/gp\/product\/[A-Z0-9]{10}/i],
  aliexpress: [/\/item\/\d+\.html/i],
  '1688': [/\/offer\/\d+\.html/i],
  alibaba: [/\/product-detail\//i],
};

/**
 * O endereço é de um anúncio de plataforma conhecida?
 *
 * É o filtro dos links de uma página de listagem: dos duzentos links de uma busca do
 * Mercado Livre, só os de item viram entrada — o resto é menu, filtro e rodapé.
 */
export function ehUrlDeAnuncio(bruto: string): boolean {
  const url = analisarUrl(bruto);
  const site = siteDaUrl(bruto);
  if (url === null || site === null) return false;
  const alvo = `${url.hostname}${url.pathname}${url.search}`;
  return PADROES_DE_ITEM[site].some((p) => p.test(alvo));
}

/**
 * URL de **listagem**: categoria, busca, loja, marca.
 *
 * Casado contra `hostname + pathname + search`, não só contra o caminho: no
 * Mercado Livre o sinal mais forte está no **subdomínio** (`lista.` é busca,
 * `produto.` é item), e olhar só o caminho classificaria
 * `lista.mercadolivre.com.br/refil` como anúncio.
 */
const PADROES_DE_LISTAGEM: Readonly<Record<SiteReconhecido, readonly RegExp[]>> = {
  ml: [/^lista\./i, /\/c\//i, /\/categoria/i, /listado/i],
  shopee: [/\/search/i, /\/cat\./i, /\/shop\/\d+/i],
  amazon: [/\/s\?/i, /\/s\//i, /\/b\//i, /\/stores\//i],
  aliexpress: [/\/wholesale/i, /\/category/i],
  '1688': [/\/page\/offerlist/i, /\/s\//i],
  alibaba: [/\/trade\/search/i, /\/showroom\//i],
};

// ─── Extensões e MIME ────────────────────────────────────────────────────────

const EXTENSOES_PLANILHA = ['.xlsx', '.xls', '.xlsm', '.csv', '.tsv'] as const;
const EXTENSOES_IMAGEM = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.gif', '.bmp'] as const;

const MIME_PLANILHA = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/tab-separated-values',
] as const;

function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto === -1 ? '' : nome.slice(ponto).toLowerCase();
}

/**
 * Nome de arquivo que denuncia exportação de plataforma.
 *
 * O ganho de reconhecer isso é grande: exportação tem **mapeamento fixo de
 * colunas**, então não gasta LLM nenhum. Planilha genérica cai no extrator com
 * LLM, que custa. A heurística é o nome, e quando ela falha a planilha é tratada
 * como genérica — degradação correta, nunca erro.
 */
const PISTAS_DE_EXPORTACAO: readonly { readonly padrao: RegExp; readonly site: SiteReconhecido }[] =
  [
    { padrao: /mercado[\s_-]?livre|\bmlb\b|meus[\s_-]?anuncios|minhas[\s_-]?vendas/i, site: 'ml' },
    { padrao: /shopee|mass[\s_-]?update|basic[\s_-]?info/i, site: 'shopee' },
    { padrao: /amazon|seller[\s_-]?central|\bsku\b.*report|flat[\s_-]?file/i, site: 'amazon' },
  ];

/**
 * Um nome de arquivo que casa com cada pista acima.
 *
 * Existe para a mensagem de revisão poder **ensinar a renomear** em vez de só dizer
 * que não reconheceu. Mora ao lado das pistas de propósito: mensagem que promete um
 * nome e padrão que aceita o nome têm de mudar juntos, e há teste conferindo que
 * cada exemplo daqui é de fato classificado como exportação.
 */
export const EXEMPLOS_DE_NOME_DE_EXPORTACAO: readonly string[] = [
  'mercado-livre.csv',
  'shopee.csv',
  'amazon.csv',
];

// ─── Classificação ───────────────────────────────────────────────────────────

/**
 * Classifica uma entrada.
 *
 * Nunca lança e nunca devolve `undefined`: entrada irreconhecível vira
 * `desconhecido` com confiança zero, que a fila trata como `pendente_revisao`.
 * Descartar entrada é o erro que a especificação proíbe explicitamente.
 */
export function classificar(entrada: Entrada): Classificacao {
  switch (entrada.tipo) {
    case 'url':
      return classificarUrl(entrada.valor);
    case 'arquivo':
      return classificarArquivo(entrada);
    case 'texto':
      return classificarTexto(entrada.valor);
  }
}

function classificarUrl(bruto: string): Classificacao {
  const url = analisarUrl(bruto);
  if (url === null) {
    return {
      tipoDeEntrada: 'desconhecido',
      site: null,
      confiancaBp: 0,
      motivo: 'não é uma URL http(s) válida',
    };
  }

  const site = siteDaUrl(bruto);
  // O alvo inclui o hostname porque algumas plataformas põem o sinal no
  // subdomínio. Ver o comentário de PADROES_DE_LISTAGEM.
  const alvo = `${url.hostname}${url.pathname}${url.search}`;

  if (site !== null) {
    if (PADROES_DE_ITEM[site].some((p) => p.test(alvo))) {
      return {
        tipoDeEntrada: 'anuncio_marketplace',
        site,
        confiancaBp: 10_000,
        motivo: `URL de item de ${site}, com identificador no caminho`,
      };
    }

    if (PADROES_DE_LISTAGEM[site].some((p) => p.test(alvo))) {
      return {
        tipoDeEntrada: 'listagem_categoria',
        site,
        confiancaBp: 8500,
        motivo: `URL de listagem de ${site}`,
      };
    }

    // Site conhecido, formato de caminho não reconhecido. É melhor tentar como
    // anúncio — o custo de errar é uma extração que devolve `pendente_revisao`,
    // e o caminho pode ser apenas um formato novo da plataforma.
    return {
      tipoDeEntrada: 'anuncio_marketplace',
      site,
      confiancaBp: 5000,
      motivo: `site ${site} reconhecido, mas o formato do caminho não — tratando como anúncio`,
    };
  }

  // Site desconhecido. PDF e imagem por URL vão para o extrator do formato.
  const extensao = extensaoDe(url.pathname);
  if (extensao === '.pdf') {
    return {
      tipoDeEntrada: 'tabela_precos_pdf',
      site: null,
      confiancaBp: 9000,
      motivo: 'URL aponta para PDF',
    };
  }
  if ((EXTENSOES_IMAGEM as readonly string[]).includes(extensao)) {
    return {
      tipoDeEntrada: 'imagem_tabela',
      site: null,
      confiancaBp: 7000,
      motivo: 'URL aponta para imagem',
    };
  }
  if ((EXTENSOES_PLANILHA as readonly string[]).includes(extensao)) {
    return {
      tipoDeEntrada: 'planilha_generica',
      site: null,
      confiancaBp: 8000,
      motivo: 'URL aponta para planilha',
    };
  }

  // Site qualquer: é candidato a catálogo de distribuidor, que é o caso de uso
  // mais valioso do M1 e o que exige LLM por estrutura imprevisível.
  return {
    tipoDeEntrada: 'catalogo_distribuidor',
    site: null,
    confiancaBp: 6000,
    motivo: 'site não reconhecido — tratando como catálogo de distribuidor',
  };
}

function classificarArquivo(entrada: Extract<Entrada, { tipo: 'arquivo' }>): Classificacao {
  const extensao = extensaoDe(entrada.nome);
  const mime = entrada.tipoMime?.toLowerCase() ?? '';

  const ehPlanilha =
    (EXTENSOES_PLANILHA as readonly string[]).includes(extensao) ||
    (MIME_PLANILHA as readonly string[]).some((m) => mime.startsWith(m));

  if (ehPlanilha) {
    const pista = PISTAS_DE_EXPORTACAO.find((p) => p.padrao.test(entrada.nome));
    if (pista !== undefined) {
      return {
        tipoDeEntrada: 'planilha_exportacao',
        site: pista.site,
        confiancaBp: 8500,
        motivo: `nome do arquivo indica exportação de ${pista.site} — mapeamento fixo, sem LLM`,
      };
    }
    return {
      tipoDeEntrada: 'planilha_generica',
      site: null,
      confiancaBp: 7000,
      motivo: 'planilha sem pista de plataforma — precisa de mapeamento de colunas',
    };
  }

  if (extensao === '.pdf' || mime === 'application/pdf') {
    return {
      tipoDeEntrada: 'tabela_precos_pdf',
      site: null,
      confiancaBp: 9000,
      motivo: 'PDF — extração de tabela',
    };
  }

  if ((EXTENSOES_IMAGEM as readonly string[]).includes(extensao) || mime.startsWith('image/')) {
    return {
      tipoDeEntrada: 'imagem_tabela',
      site: null,
      confiancaBp: 8000,
      // O caso comum de verdade: fornecedor manda foto da planilha no WhatsApp.
      motivo: 'imagem — extração por visão (foto de tabela de fornecedor)',
    };
  }

  if (extensao === '.txt' || mime.startsWith('text/plain')) {
    return {
      tipoDeEntrada: 'texto_colado',
      site: null,
      confiancaBp: 7000,
      motivo: 'texto simples',
    };
  }

  return {
    tipoDeEntrada: 'desconhecido',
    site: null,
    confiancaBp: 0,
    motivo: `formato não suportado: ${extensao === '' ? 'sem extensão' : extensao}`,
  };
}

function classificarTexto(bruto: string): Classificacao {
  const texto = bruto.trim();

  if (texto === '') {
    return { tipoDeEntrada: 'desconhecido', site: null, confiancaBp: 0, motivo: 'entrada vazia' };
  }

  // Uma URL sozinha é URL, não texto — o usuário colou um link.
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (linhas.length === 1 && ehUrlValida(linhas[0]!)) {
    return classificarUrl(linhas[0]!);
  }

  // Várias URLs: lista de links, que vira N jobs em vez de um.
  const urls = extrairUrls(texto);
  if (urls.length > 1 && urls.length >= linhas.length / 2) {
    return {
      tipoDeEntrada: 'lista_de_links',
      site: null,
      confiancaBp: 9000,
      motivo: `${String(urls.length)} links encontrados`,
      urls,
    };
  }

  // Texto com estrutura de tabela colada (WhatsApp, e-mail de fornecedor).
  if (pareceTabelaColada(linhas)) {
    return {
      tipoDeEntrada: 'planilha_generica',
      site: null,
      confiancaBp: 6500,
      motivo: 'texto com estrutura de tabela — tratando como planilha colada',
    };
  }

  return {
    tipoDeEntrada: 'texto_colado',
    site: null,
    confiancaBp: 7000,
    motivo: 'texto livre',
  };
}

/** Extrai URLs http(s) de um texto qualquer, sem duplicar. */
/**
 * Interpreta o que veio do campo único da tela: uma URL, ou texto.
 *
 * A especificação pede "um único campo de entrada que aceita qualquer coisa e faz
 * a coisa certa". Esta é a primeira bifurcação desse "faz a coisa certa", e mora
 * aqui — e não na tela — porque é decisão de classificação, não de apresentação.
 *
 * Lista de links cai em `texto` de propósito: `classificar` reconhece a lista e o
 * executor abre um job por link, o que faz o terceiro link falhar sem levar os
 * outros dois junto.
 */
export function entradaDeTextoLivre(valor: string): Entrada {
  const limpo = valor.trim();
  return ehUrlValida(limpo) ? { tipo: 'url', valor: limpo } : { tipo: 'texto', valor: limpo };
}

export function extrairUrls(texto: string): readonly string[] {
  const encontradas = texto.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const limpas = encontradas
    // Pontuação final costuma vir colada quando o link está no meio de uma frase.
    .map((u) => u.replace(/[.,;:!?]+$/, ''))
    .filter((u) => ehUrlValida(u));
  return [...new Set(limpas)];
}

/**
 * O texto parece uma tabela colada?
 *
 * Critério: pelo menos três linhas, e a maioria delas com o mesmo número de
 * separadores. É o que distingue tabela de parágrafo, e é deliberadamente
 * conservador — falso negativo cai em `texto_colado`, que ainda é processável;
 * falso positivo gastaria extração de tabela em prosa.
 */
function pareceTabelaColada(linhas: readonly string[]): boolean {
  if (linhas.length < 3) return false;

  for (const separador of ['\t', ';', '|', ',']) {
    const contagens = linhas.map((l) => l.split(separador).length - 1).filter((n) => n > 0);
    if (contagens.length < Math.ceil(linhas.length * 0.6)) continue;

    const maisComum = contagens.reduce<Map<number, number>>(
      (mapa, n) => mapa.set(n, (mapa.get(n) ?? 0) + 1),
      new Map(),
    );
    const [, ocorrencias] = [...maisComum.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));

    if (ocorrencias >= Math.ceil(linhas.length * 0.6)) return true;
  }

  return false;
}

/** A classificação é confiável o bastante para extrair sem revisão humana? */
export function ehConfiavel(classificacao: Classificacao): boolean {
  return classificacao.confiancaBp >= LIMIAR_CLASSIFICACAO_CONFIAVEL;
}

/**
 * O tipo de entrada exige LLM, e portanto gasta dinheiro? Ver ADR 0005.
 *
 * Tabela em vez de `switch`: o `Record` sobre o tipo dá exaustividade pelo
 * compilador — acrescentar um tipo de entrada sem classificá-lo aqui não compila.
 *
 * Os três que não exigem: exportação de plataforma tem mapeamento fixo de
 * colunas; lista de links só roteia para N jobs; desconhecido vai para revisão
 * antes de gastar qualquer token.
 */
const EXIGE_LLM: Readonly<Record<TipoDeEntrada, boolean>> = {
  planilha_exportacao: false,
  lista_de_links: false,
  desconhecido: false,

  anuncio_marketplace: true,
  listagem_categoria: true,
  catalogo_distribuidor: true,
  tabela_precos_pdf: true,
  imagem_tabela: true,
  planilha_generica: true,
  texto_colado: true,
};

export function exigeLlm(tipo: TipoDeEntrada): boolean {
  return EXIGE_LLM[tipo];
}
