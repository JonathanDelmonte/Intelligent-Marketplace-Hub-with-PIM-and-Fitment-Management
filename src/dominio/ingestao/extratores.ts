/**
 * Os extratores da ingestão (M1, etapas 3.2 a 3.4): de página e de texto colado para
 * `produto_externo`.
 *
 * Funções puras sobre o que já foi lido — quem busca a página é o executor. E sem IA:
 * o que se tira aqui tem forma (dado estruturado da loja, preço em reais, uma linha por
 * produto), e forma se lê com código (CLAUDE.md, 3.5). O que não tem forma — separar
 * marca, peça e aparelho num título — é da extração por IA em lote (5.1), que roda
 * depois, sobre o `produto_externo` que sai daqui.
 *
 * ## A regra de sempre
 *
 * Tudo que entra vira `produto_externo`, nunca `sku` direto; e o que não dá para ler
 * vira revisão com o motivo, nunca descarte. Preço que não se sabe é `null` — o título
 * sozinho ainda alimenta o grafo de identidade.
 */
import { normalizarGtin } from '@/dominio/gtin';
import { normalizarCodigoDeModelo } from '@/dominio/identidade/canonico';
import {
  ofertasDaPagina,
  precosNoTexto,
  tituloDaPagina,
  type OfertaDaPagina,
} from '@/dominio/web/pagina';
import type { Fonte } from '@/dominio/procedencia';
import { centavosParaReais, type Centavos } from '@/lib/dinheiro';
import type { ProdutoExternoCapturado } from './produto-externo';

/** Endereço sem parâmetro de rastreio e sem âncora: é ele que identifica a página. */
export function enderecoCanonico(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return url;
  }
}

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * O título da página sem o nome do site: "Refil PA21G | Mercado Livre" → "Refil PA21G".
 *
 * Corta só o último trecho depois de `|`, ` - ` ou ` – `, e só quando sobra título de
 * verdade antes: "PA21G - Refil" não perde o "Refil".
 */
export function tituloSemSite(titulo: string): string {
  const partes = titulo.split(/\s[|–—-]\s|\s\|\s?|\|/);
  if (partes.length < 2) return titulo.trim();
  const semUltimo = partes.slice(0, -1).join(' - ').trim();
  return semUltimo.length >= 8 ? semUltimo : titulo.trim();
}

/** A página pediu login ou confirmação de robô, em vez de mostrar o produto? */
export function paginaBloqueada(titulo: string | null, html: string): boolean {
  const texto = `${titulo ?? ''} ${html.slice(0, 20_000)}`;
  return /captcha|are you a robot|você é um robô|verifique que você é humano|acesso negado|access denied|faça login para continuar|robot check/i.test(
    texto,
  );
}

function capturaDaOferta(params: {
  readonly oferta: OfertaDaPagina;
  readonly titulo: string;
  readonly url: string;
  readonly site: string;
  readonly conteudoBruto: string;
  readonly coletadoEm: Date;
}): ProdutoExternoCapturado {
  const { oferta } = params;
  // GTIN que não confere não vai para a coluna — a captura inteira seria recusada —, e
  // também não some: fica no atributo, como a planilha faz.
  const gtin = oferta.gtin === null ? null : normalizarGtin(oferta.gtin);
  const preco = oferta.moeda === null || oferta.moeda === 'BRL' ? oferta.preco : null;

  return {
    tituloBruto: params.titulo,
    url: params.url,
    plataformaOuSite: params.site,
    precoReais: preco === null ? null : centavosParaReais(preco),
    vendedor: oferta.vendedor,
    fonte: 'm0_link',
    coletadoEm: params.coletadoEm,
    ...(gtin === null ? {} : { ean: gtin.digitos }),
    atributos: {
      // A marca que a loja declarou é origem forte: a leitura do título pela IA não a
      // sobrescreve depois (`mesclarRegistro`).
      ...(oferta.marca === null ? {} : { marca: oferta.marca }),
      ...(oferta.disponibilidade === null ? {} : { disponibilidade: oferta.disponibilidade }),
      ...(oferta.gtin !== null && gtin === null ? { eanInvalido: oferta.gtin } : {}),
    },
    conteudoBruto: params.conteudoBruto,
  };
}

export type ExtracaoDaPagina =
  | { readonly tipo: 'capturas'; readonly capturas: readonly ProdutoExternoCapturado[] }
  | { readonly tipo: 'revisao'; readonly motivo: string };

/**
 * As capturas de uma página de produto ou de catálogo.
 *
 * Com dado estruturado: uma captura por produto declarado, com preço, GTIN, marca e
 * vendedor. Sem ele, na página de anúncio: uma captura só com o título, e sem preço —
 * preço lido do texto seria palpite (a parcela de "12x de R$ 8,33" aparece antes do
 * preço à vista), e preço inventado é pior que preço ausente.
 */
export function extrairDaPagina(params: {
  readonly html: string;
  readonly url: string;
  /** A plataforma reconhecida, quando é marketplace. */
  readonly site: string | null;
  readonly coletadoEm: Date;
  /** Anúncio aceita cair no título; catálogo sem produto declarado vai para revisão. */
  readonly anuncio: boolean;
}): ExtracaoDaPagina {
  const titulo = tituloDaPagina(params.html);
  if (paginaBloqueada(titulo, params.html)) {
    return {
      tipo: 'revisao',
      motivo:
        'a página pediu login ou confirmação de que não é robô, e não mostrou o produto. Link de marketplace às vezes só abre no navegador: cole o título e o preço como texto.',
    };
  }

  const url = enderecoCanonico(params.url);
  const site = params.site ?? dominio(url);
  const ofertas = ofertasDaPagina(params.html).filter((o) => (o.nome ?? titulo) !== null);

  if (ofertas.length > 0) {
    const varias = ofertas.length > 1;
    return {
      tipo: 'capturas',
      capturas: ofertas.map((oferta) => {
        const nome = oferta.nome ?? tituloSemSite(titulo ?? '');
        return capturaDaOferta({
          oferta,
          titulo: nome,
          url,
          site,
          // Página de um produto é identificada pelo endereço: recapturar o mesmo link
          // atualiza o preço em vez de criar outra ocorrência. Catálogo com vários, pelo
          // endereço e pelo nome de cada um.
          conteudoBruto: varias ? `m0:${url}#${nome}` : `m0:${url}`,
          coletadoEm: params.coletadoEm,
        });
      }),
    };
  }

  if (params.anuncio && titulo !== null && tituloSemSite(titulo).length >= 3) {
    return {
      tipo: 'capturas',
      capturas: [
        {
          tituloBruto: tituloSemSite(titulo),
          url,
          plataformaOuSite: site,
          precoReais: null,
          fonte: 'm0_link',
          coletadoEm: params.coletadoEm,
          atributos: { precoNaoLido: 'a página não declara o preço em dado estruturado' },
          conteudoBruto: `m0:${url}`,
        },
      ],
    };
  }

  return {
    tipo: 'revisao',
    motivo:
      'a página não declara produto em dado estruturado. Se é uma lista de produtos, cole os links deles; se é uma tabela de preços, cole o texto da tabela.',
  };
}

// ─── Texto colado ───────────────────────────────────────────────────────────

export interface LinhaDeCatalogo {
  readonly titulo: string;
  readonly preco: Centavos | null;
}

/** Alguma palavra da linha é, sozinha, um código de peça? */
function temCodigoProprio(linha: string): boolean {
  return linha
    .split(/[\s,;|()]+/)
    .some((palavra) => normalizarCodigoDeModelo(palavra.replace(/^[^\w]+|[^\w]+$/g, '')) !== null);
}

/** Preço no fim da linha sem `R$`: `PA21G - 38,00`, `Refil ...... 38,00`. */
const PRECO_NO_FIM = /(?:^|\s|[-:|;=])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\s*$/;

/**
 * As linhas de uma tabela de fornecedor colada como texto — do WhatsApp, de um PDF, de
 * um e-mail.
 *
 * Uma linha é produto quando tem preço — com `R$` em qualquer lugar, ou `38,00` no fim —,
 * ou quando cita um código de peça. O resto é cabeçalho, saudação e condição de
 * pagamento, e fica de fora. O preço sai da linha; o título é o que sobra, sem os
 * separadores que a tabela usava.
 */
export function linhasDeCatalogo(texto: string): readonly LinhaDeCatalogo[] {
  const linhas: LinhaDeCatalogo[] = [];
  const vistos = new Set<string>();

  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/\s+/g, ' ').trim();
    if (linha.length < 4 || !/[a-zà-ú]/i.test(linha)) continue;

    let preco: Centavos | null = precosNoTexto(linha)[0] ?? null;
    let semPreco = linha.replace(/R\$\s?[\d.]+,\d{2}/g, ' ');
    if (preco === null) {
      const noFim = PRECO_NO_FIM.exec(linha);
      if (noFim !== null) {
        preco = precosNoTexto(`R$ ${noFim[1] ?? ''},${noFim[2] ?? ''}`)[0] ?? null;
        semPreco = linha.slice(0, noFim.index);
      }
    }
    // Sem preço, só fica a linha que tem um código de peça **seu**, numa palavra só: a
    // junção de palavras vizinhas que o reconhecedor faz para `PA 21 G` também juntaria
    // "ou 30" de "à vista ou 30 dias", e condição de pagamento viraria produto.
    if (preco === null && !temCodigoProprio(linha)) continue;

    const titulo = semPreco
      .replace(/\s*[\t;|]\s*/g, ' - ')
      .replace(/[\s.·…_=|:;–—-]+$/g, '')
      .replace(/^[\s•*·\-–]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (titulo.length < 3) continue;

    const chave = `${titulo.toLowerCase()}|${String(preco)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    linhas.push({ titulo, preco });
  }
  return linhas;
}

/** As capturas de um texto colado: uma por linha de produto. */
export function capturasDoTexto(params: {
  readonly texto: string;
  readonly coletadoEm: Date;
  readonly fonte: Fonte;
  /** De onde veio, para a coluna de origem: "texto colado", o nome do PDF. */
  readonly origem: string;
}): readonly ProdutoExternoCapturado[] {
  return linhasDeCatalogo(params.texto).map((linha) => ({
    tituloBruto: linha.titulo,
    plataformaOuSite: params.origem,
    precoReais: linha.preco === null ? null : centavosParaReais(linha.preco),
    fonte: params.fonte,
    coletadoEm: params.coletadoEm,
    // A mesma linha colada de novo é a mesma ocorrência — com o preço atualizado.
    conteudoBruto: `texto:${params.origem}:${linha.titulo.toLowerCase()}`,
  }));
}
