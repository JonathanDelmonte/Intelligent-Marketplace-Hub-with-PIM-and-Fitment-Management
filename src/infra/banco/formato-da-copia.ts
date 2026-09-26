/**
 * O formato do arquivo da cópia dos dados (ADR 0016), lido dos dois lados.
 *
 * O servidor escreve a cópia e a restaura (`copia.ts`). O navegador a confere antes de
 * enviar (a tela da cópia, ADR 0017): de quando é, de que versão, quantas tabelas e
 * linhas, e se chegou inteira — tudo no computador de quem usa, sem mandar um byte. Por
 * isso este arquivo não importa nada de servidor: nem banco, nem `node:`.
 *
 * A leitura é uma só para os dois (`percorrerCopia`): cabeçalho, blocos `COPY` fechados
 * por `\.`, e a linha de fechamento com as contagens. O servidor pendura nela o que é do
 * banco — conferir tabelas e colunas, apagar e escrever —; o navegador só conta.
 */

/** Versão do formato. Muda se o arquivo mudar de um jeito que a leitura antiga não entenda. */
export const FORMATO_DA_COPIA = 1;

/** A linha que fecha um bloco de dados. */
export const FIM_DO_BLOCO = '\\.';

export class CopiaInvalida extends Error {
  override readonly name = 'CopiaInvalida';
}

export interface ResumoDaCopia {
  readonly geradaEm: string | null;
  readonly versao: string | null;
  readonly tabelas: number;
  readonly linhas: number;
}

export interface CabecalhoDaCopia {
  readonly geradaEm: string | null;
  readonly versao: string | null;
  /** O carimbo da última migração do banco de origem; `null` quando não se soube. */
  readonly migracao: number | null;
  /** As tabelas da cópia, na ordem em que voltam. */
  readonly tabelas: readonly string[];
}

export interface BlocoDaCopia {
  readonly tabela: string;
  readonly colunas: readonly string[];
}

const METADADO = /^-- ([a-z-]+): (.*)$/;
const COMANDO_DE_COPIA =
  /^COPY public\."([a-z_][a-z0-9_]*)" \(((?:"[a-z_][a-z0-9_]*", )*"[a-z_][a-z0-9_]*")\) FROM stdin;$/;
const FIM_DA_COPIA = /^-- fim-da-copia: tabelas=(\d+) linhas=(\d+)$/;

/** O que a cópia pode ter fora dos blocos de dados — e nada disto é executado. */
const LINHAS_CONHECIDAS = new Set([
  "SET client_encoding = 'UTF8';",
  'SET standard_conforming_strings = on;',
  'BEGIN;',
  'COMMIT;',
]);

/** Juntar linhas antes de entregar: uma escrita no banco por linha seria lenta à toa. */
const TAMANHO_DO_LOTE = 64 * 1024;

export const MOTIVO_DE_NAO_SER_COPIA =
  'este arquivo não é uma cópia dos dados que este sistema saiba ler';
export const MOTIVO_DE_COPIA_CORTADA =
  'a cópia termina no meio de uma tabela — o download deve ter sido interrompido. Nada foi mudado: baixe a cópia de novo.';
export const MOTIVO_DE_COPIA_INCOMPLETA =
  'a cópia está incompleta — o download deve ter sido interrompido. Nada foi mudado: baixe a cópia de novo.';

function numeroOuNulo(valor: string | undefined): number | null {
  if (valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Lê a cópia do começo ao fim e devolve o que ela tem.
 *
 * Recusa (`CopiaInvalida`) o arquivo que não é cópia, o bloco de uma tabela fora da lista
 * do cabeçalho, qualquer linha que não seja de cópia, o bloco que não fecha e a cópia
 * cujas contagens não batem com a linha de fechamento — o download interrompido.
 *
 * - `aoLerCabecalho` roda antes do primeiro bloco: é onde o servidor confere a cópia
 *   contra o banco e apaga o que ela vai trocar.
 * - `aoLerBloco` recebe as linhas de dados de cada bloco, em lotes, e tem de lê-las até o
 *   fim. Sem ele, os blocos são só contados.
 */
export async function percorrerCopia(
  linhas: AsyncIterable<string>,
  acoes: {
    readonly aoLerCabecalho?: (cabecalho: CabecalhoDaCopia) => Promise<void>;
    readonly aoLerBloco?: (bloco: BlocoDaCopia, lotes: AsyncIterable<string>) => Promise<void>;
  } = {},
): Promise<ResumoDaCopia> {
  const iterador = linhas[Symbol.asyncIterator]();
  const proxima = async (): Promise<string | null> => {
    const lida = await iterador.next();
    return lida.done === true ? null : lida.value;
  };

  // O cabeçalho: comentários `-- chave: valor` até a primeira linha em branco.
  const metadados = new Map<string, string>();
  let linha = await proxima();
  while (linha !== null && linha !== '') {
    const achado = METADADO.exec(linha);
    if (achado?.[1] !== undefined && achado[2] !== undefined) metadados.set(achado[1], achado[2]);
    else if (!linha.startsWith('--')) break;
    linha = await proxima();
  }
  if (metadados.get('copia-formato') !== String(FORMATO_DA_COPIA)) {
    throw new CopiaInvalida(MOTIVO_DE_NAO_SER_COPIA);
  }

  const cabecalho: CabecalhoDaCopia = {
    geradaEm: metadados.get('gerada-em') ?? null,
    versao: metadados.get('versao') ?? null,
    migracao: numeroOuNulo(metadados.get('migracao')),
    tabelas: (metadados.get('tabelas') ?? '').split(' ').filter((t) => t !== ''),
  };
  await acoes.aoLerCabecalho?.(cabecalho);

  let tabelasLidas = 0;
  let linhasLidas = 0;
  let fechamento: { readonly tabelas: number; readonly linhas: number } | null = null;

  let blocoTerminou = false;
  async function* lotesDoBloco(): AsyncGenerator<string, void, undefined> {
    let lote = '';
    for (linha = await proxima(); linha !== null; linha = await proxima()) {
      if (linha === FIM_DO_BLOCO) {
        blocoTerminou = true;
        if (lote !== '') yield lote;
        return;
      }
      linhasLidas += 1;
      lote += `${linha}\n`;
      if (lote.length >= TAMANHO_DO_LOTE) {
        yield lote;
        lote = '';
      }
    }
    throw new CopiaInvalida(MOTIVO_DE_COPIA_CORTADA);
  }

  for (; linha !== null; linha = await proxima()) {
    if (linha === '' || LINHAS_CONHECIDAS.has(linha) || linha.startsWith('TRUNCATE TABLE ')) {
      continue;
    }
    const fim = FIM_DA_COPIA.exec(linha);
    if (fim?.[1] !== undefined && fim[2] !== undefined) {
      fechamento = { tabelas: Number(fim[1]), linhas: Number(fim[2]) };
      continue;
    }
    if (linha.startsWith('--')) continue;

    const comando = COMANDO_DE_COPIA.exec(linha);
    const tabela = comando?.[1];
    const listaDeColunas = comando?.[2];
    if (tabela === undefined || listaDeColunas === undefined) {
      throw new CopiaInvalida(`linha que não é de uma cópia: ${linha.slice(0, 80)}`);
    }
    if (!cabecalho.tabelas.includes(tabela)) {
      throw new CopiaInvalida(`a tabela ${tabela} não está na lista da cópia`);
    }
    const bloco: BlocoDaCopia = {
      tabela,
      colunas: listaDeColunas.split(', ').map((c) => c.slice(1, -1)),
    };

    blocoTerminou = false;
    if (acoes.aoLerBloco === undefined) {
      for await (const lote of lotesDoBloco()) void lote;
    } else {
      await acoes.aoLerBloco(bloco, lotesDoBloco());
    }
    // Quem lê o bloco tem de ir até o `\.`: parar antes deixaria dado sendo lido como
    // se fosse comando.
    if (!blocoTerminou) throw new Error(`o bloco da tabela ${tabela} não foi lido até o fim`);
    tabelasLidas += 1;
  }

  if (
    fechamento === null ||
    fechamento.tabelas !== tabelasLidas ||
    fechamento.linhas !== linhasLidas
  ) {
    throw new CopiaInvalida(MOTIVO_DE_COPIA_INCOMPLETA);
  }
  return {
    geradaEm: cabecalho.geradaEm,
    versao: cabecalho.versao,
    tabelas: tabelasLidas,
    linhas: linhasLidas,
  };
}

/** Confere a cópia inteira, sem banco: o que o navegador faz antes de enviá-la. */
export function conferirCopia(linhas: AsyncIterable<string>): Promise<ResumoDaCopia> {
  return percorrerCopia(linhas);
}

/** Os dois primeiros bytes de todo arquivo gzip. */
const ASSINATURA_DO_GZIP = [0x1f, 0x8b] as const;

/**
 * O fluxo como veio, descomprimido se for gzip — a cópia como baixou (`.sql.gz`) e a
 * cópia já descomprimida servem as duas. Lê o começo para saber, e devolve um fluxo que
 * começa do começo.
 */
async function descomprimidoSeGzip(
  fluxo: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const leitor = fluxo.getReader();
  const inicio: Uint8Array<ArrayBuffer>[] = [];
  let lidos = 0;
  let acabou = false;
  while (lidos < ASSINATURA_DO_GZIP.length) {
    const lido = await leitor.read();
    if (lido.done) {
      acabou = true;
      break;
    }
    inicio.push(lido.value);
    lidos += lido.value.byteLength;
  }

  const recomposto = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controle) {
      for (const pedaco of inicio) controle.enqueue(pedaco);
      if (acabou) controle.close();
    },
    async pull(controle) {
      const lido = await leitor.read();
      if (lido.done) controle.close();
      else controle.enqueue(lido.value);
    },
    cancel(motivo) {
      return leitor.cancel(motivo);
    },
  });

  const primeiro = inicio[0];
  const segundo = primeiro !== undefined && primeiro.byteLength > 1 ? primeiro[1] : inicio[1]?.[0];
  const ehGzip = primeiro?.[0] === ASSINATURA_DO_GZIP[0] && segundo === ASSINATURA_DO_GZIP[1];
  if (!ehGzip) return recomposto;
  if (typeof DecompressionStream === 'undefined') {
    await recomposto.cancel();
    throw new CopiaInvalida(
      'este navegador não sabe abrir arquivo comprimido: use um navegador atualizado',
    );
  }
  return recomposto.pipeThrough(new DecompressionStream('gzip'));
}

/**
 * O arquivo da cópia, linha por linha: descomprime se for gzip, lê como UTF-8 e corta nas
 * quebras de linha, com ou sem `\r` (arquivo que passou por um editor do Windows). Serve
 * ao corpo do pedido, no servidor, e ao arquivo escolhido, no navegador.
 *
 * Erro de leitura — arquivo corrompido, download ou envio que parou no meio — vira
 * `CopiaInvalida`: para quem restaura, é a mesma coisa, e nada foi mudado.
 */
export async function* linhasDoArquivo(
  fluxo: ReadableStream<Uint8Array<ArrayBuffer>>,
): AsyncGenerator<string, void, undefined> {
  const leitor = (await descomprimidoSeGzip(fluxo)).getReader();
  const decodificador = new TextDecoder('utf-8');
  let resto = '';
  let terminou = false;
  try {
    for (;;) {
      let lido: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
      try {
        lido = await leitor.read();
      } catch {
        throw new CopiaInvalida(
          'o arquivo não pôde ser lido até o fim — está corrompido ou cortado. Nada foi mudado.',
        );
      }
      if (lido.done) break;
      resto += decodificador.decode(lido.value, { stream: true });
      const partes = resto.split('\n');
      resto = partes.pop() ?? '';
      for (const parte of partes) yield parte.endsWith('\r') ? parte.slice(0, -1) : parte;
    }
    resto += decodificador.decode();
    terminou = true;
    if (resto !== '') yield resto.endsWith('\r') ? resto.slice(0, -1) : resto;
  } finally {
    if (!terminou) await leitor.cancel().catch(() => undefined);
    leitor.releaseLock();
  }
}
