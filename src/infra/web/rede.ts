/**
 * A saída para a rede de quem lê a internet: as ferramentas do garimpo (M6) e a
 * ingestão por link colado (M1).
 *
 * Um lugar para o que toda leitura de fora precisa, e que cada cópia faria de um
 * jeito: tempo limite, teto de tamanho, só `http` e `https`, e nada de endereço da
 * rede local.
 *
 * ## Por que recusar endereço local
 *
 * O leitor de página abre o endereço que um resultado de busca apontou — escrito por
 * quem publicou a página, e não por quem usa o sistema. Uma página que aponte para
 * `http://localhost:5433` ou para o roteador de casa faria o sistema bater em serviço
 * que não é da internet. O garimpo investiga a internet; o resto fica de fora.
 *
 * ## Por que o teto de tamanho
 *
 * Página de loja passa de um megabyte fácil, e o que interessa — título, preço, dado
 * estruturado — está no começo. Ler até dois megabytes e parar é o que impede uma página
 * de vídeo de ocupar a memória do poller.
 */

/** Tempo máximo de uma leitura. Página que não abre em vinte segundos não vai abrir. */
export const TEMPO_LIMITE_DA_REDE_MS = 20_000;

/** Quanto de uma resposta é lido, no máximo. */
export const TAMANHO_MAXIMO_DA_RESPOSTA = 2_000_000;

/**
 * Como o garimpo se apresenta.
 *
 * Navegador comum, porque parte das lojas devolve página vazia a identificação
 * desconhecida — e o garimpo lê o que uma pessoa leria, uma página por vez, sem
 * disputar banda com ninguém.
 */
const CABECALHOS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
};

export class FalhaDeRede extends Error {
  override readonly name = 'FalhaDeRede';
  constructor(
    mensagem: string,
    /** Status HTTP, quando houve resposta. */
    readonly status: number | null = null,
  ) {
    super(mensagem);
  }
}

export interface RespostaDeTexto {
  readonly status: number;
  /** O endereço final, depois de redirecionamento. É ele que o dossiê cita. */
  readonly url: string;
  readonly tipo: string | null;
  readonly texto: string;
}

export interface OpcoesDaRede {
  /** Para teste: o `fetch` a usar no lugar do global. */
  readonly buscar?: typeof fetch | undefined;
  readonly tempoLimiteMs?: number | undefined;
}

/** O host é da rede local — loopback, rede privada, link-local? */
export function ehEnderecoLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h.includes(':')) {
    // IPv4 escrito dentro de IPv6 (`::ffff:127.0.0.1`) vale o IPv4 que carrega.
    if (h.startsWith('::ffff:')) return ehEnderecoLocal(h.slice('::ffff:'.length));
    // Loopback, não especificado, link-local e única-local.
    return h === '::1' || h === '::' || h.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(h);
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4 === null) return false;
  const [a = 0, b = 0] = ipv4.slice(1, 3).map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Confere o endereço antes de sair: só `http`/`https`, e nunca rede local. */
export function enderecoPermitido(bruto: string): URL | null {
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (ehEnderecoLocal(url.hostname)) return null;
  return url;
}

async function lerCorpo(resposta: Response): Promise<string> {
  const leitor = resposta.body?.getReader();
  if (leitor === undefined) return '';
  const decodificador = new TextDecoder('utf-8');
  let texto = '';
  let lidos = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    lidos += value.byteLength;
    texto += decodificador.decode(value, { stream: true });
    if (lidos >= TAMANHO_MAXIMO_DA_RESPOSTA) {
      await leitor.cancel();
      break;
    }
  }
  return texto + decodificador.decode();
}

/**
 * Lê um endereço como texto. Lança `FalhaDeRede` com o motivo — endereço recusado,
 * rede fora, tempo esgotado — e devolve a resposta **com qualquer status**: quem chama
 * decide o que 404 ou 429 querem dizer para ele.
 */
export async function lerTexto(
  endereco: string,
  opcoes: OpcoesDaRede & { readonly aceitar?: string | undefined } = {},
): Promise<RespostaDeTexto> {
  const url = enderecoPermitido(endereco);
  if (url === null) throw new FalhaDeRede(`endereço recusado: ${endereco.slice(0, 200)}`);

  const buscar = opcoes.buscar ?? fetch;
  const tempo = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_DA_REDE_MS;
  let resposta: Response;
  try {
    resposta = await buscar(url.href, {
      headers: {
        ...CABECALHOS,
        accept: opcoes.aceitar ?? 'text/html,application/json;q=0.9,*/*;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(tempo),
    });
  } catch (erro) {
    if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
      throw new FalhaDeRede(
        `${url.hostname} não respondeu em ${String(Math.round(tempo / 1000))} segundos.`,
      );
    }
    const causa = erro instanceof Error && erro.cause instanceof Error ? erro.cause.message : null;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    throw new FalhaDeRede(`não consegui abrir ${url.hostname}: ${causa ?? mensagem}.`);
  }

  // Redirecionamento para a rede local também é recusado: o destino final é o que conta.
  const final = resposta.url === '' ? url.href : resposta.url;
  if (enderecoPermitido(final) === null) {
    throw new FalhaDeRede(`o endereço redirecionou para fora da internet: ${final.slice(0, 200)}`);
  }

  return {
    status: resposta.status,
    url: final,
    tipo: resposta.headers.get('content-type'),
    texto: await lerCorpo(resposta),
  };
}
