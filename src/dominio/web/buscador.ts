/**
 * O buscador gratuito: a versão HTML do DuckDuckGo.
 *
 * Gratuito e sem chave (CLAUDE.md, 3.7): a versão HTML devolve os resultados em
 * marcação simples, sem JavaScript, e cada resultado traz o endereço real dentro do
 * parâmetro `uddg`. Buscador com API oficial pede chave e cobra; este não. Usam o
 * garimpo (M6) e a conferência de fornecedor (M5).
 *
 * Quando o buscador recusa — 202 por pedido demais, ou a página de confirmação de
 * robô —, `buscarNaWeb` lança `FalhaDeRede`: "não consegui procurar" não é "procurei e
 * não achei", e quem chama decide esperar.
 */
import { enderecoPermitido, FalhaDeRede, lerTexto, type OpcoesDaRede } from '@/infra/web/rede';
import { semMarcacao } from './pagina';

export const ENDERECO_DO_BUSCADOR = 'https://html.duckduckgo.com/html/';

/** Resultados considerados por busca. A primeira página do buscador. */
export const RESULTADOS_POR_BUSCA = 10;

export interface ResultadoDeBusca {
  readonly titulo: string;
  readonly url: string;
  readonly trecho: string;
}

/** O endereço real de um resultado: o `uddg` do redirecionamento, ou o próprio link. */
function enderecoDoResultado(href: string): string | null {
  const bruto = semMarcacao(href);
  const completo = bruto.startsWith('//') ? `https:${bruto}` : bruto;
  let url: URL;
  try {
    url = new URL(completo, 'https://duckduckgo.com');
  } catch {
    return null;
  }
  const destino = url.hostname.endsWith('duckduckgo.com') ? url.searchParams.get('uddg') : url.href;
  // Anúncio patrocinado passa por `duckduckgo.com/y.js` e não tem `uddg`: fica de fora.
  if (destino === null) return null;
  return enderecoPermitido(destino)?.href ?? null;
}

/**
 * Os resultados da página HTML do DuckDuckGo, na ordem em que aparecem.
 *
 * Por expressão regular, e não por um leitor de HTML inteiro: a página é simples e
 * estável, e o que se lê são duas classes — `result__a` no link, `result__snippet` no
 * trecho. O trecho é associado ao último link visto antes dele.
 */
export function lerResultadosDoDuckDuckGo(html: string): readonly ResultadoDeBusca[] {
  const resultados: { titulo: string; url: string; trecho: string }[] = [];
  const vistos = new Set<string>();
  const marcas = html.matchAll(
    /<(a|div|td)\b([^>]*class\s*=\s*["'][^"']*\bresult__(a|snippet)\b[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi,
  );

  for (const marca of marcas) {
    const atributos = marca[2] ?? '';
    const tipo = marca[3];
    const conteudo = semMarcacao(marca[4] ?? '');

    if (tipo === 'a') {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(atributos)?.[1];
      const url = href === undefined ? null : enderecoDoResultado(href);
      if (url === null || vistos.has(url) || conteudo === '') continue;
      vistos.add(url);
      resultados.push({ titulo: conteudo.slice(0, 200), url, trecho: '' });
    } else {
      const ultimo = resultados.at(-1);
      if (ultimo !== undefined && ultimo.trecho === '') ultimo.trecho = conteudo.slice(0, 400);
    }
  }
  return resultados;
}

export interface OpcoesDoBuscador extends OpcoesDaRede {
  readonly endereco?: string | undefined;
}

/** Busca, e devolve os resultados da primeira página. Lança `FalhaDeRede` quando recusa. */
export async function buscarNaWeb(
  consulta: string,
  opcoes: OpcoesDoBuscador = {},
): Promise<readonly ResultadoDeBusca[]> {
  const endereco = `${opcoes.endereco ?? ENDERECO_DO_BUSCADOR}?q=${encodeURIComponent(consulta)}&kl=br-pt`;
  const resposta = await lerTexto(endereco, opcoes);
  if (resposta.status === 202 || resposta.status === 429) {
    throw new FalhaDeRede(
      'o buscador pediu uma pausa (pedidos demais). Tente de novo mais tarde.',
      resposta.status,
    );
  }
  if (resposta.status >= 400) {
    throw new FalhaDeRede(`o buscador respondeu ${String(resposta.status)}.`, resposta.status);
  }
  const resultados = lerResultadosDoDuckDuckGo(resposta.texto).slice(0, RESULTADOS_POR_BUSCA);
  if (resultados.length === 0 && /anomaly|captcha|robot|robô/i.test(resposta.texto)) {
    throw new FalhaDeRede(
      'o buscador pediu confirmação de que não é robô. Tente de novo mais tarde.',
    );
  }
  return resultados;
}
