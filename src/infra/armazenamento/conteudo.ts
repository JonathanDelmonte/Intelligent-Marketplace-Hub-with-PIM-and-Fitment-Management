/**
 * Armazenamento de conteúdo endereçado por hash.
 *
 * O payload de um job não carrega o arquivo: carrega o **hash** dele. Três
 * consequências que valem o módulo:
 *
 * 1. **Idempotência por construção.** O mesmo conteúdo produz o mesmo hash, então
 *    subir a mesma planilha duas vezes colapsa num job só sem nenhuma
 *    comparação de conteúdo.
 * 2. **A tabela `job` fica pequena.** Um XLSX de 4 MB em `jsonb` transformaria a
 *    fila num depósito de arquivo, e a tela dos últimos 100 jobs ficaria
 *    impossível de carregar.
 * 3. **É o cache de extração que a especificação pede** — "cache agressivo de
 *    HTML por URL e hash" (seção 7). O mesmo mecanismo serve para HTML baixado,
 *    PDF e imagem de fornecedor.
 *
 * O caminho é fragmentado pelos dois primeiros caracteres do hash: um diretório
 * com cem mil arquivos é lento de listar em qualquer sistema de arquivos.
 *
 * **Na nuvem, o conteúdo é temporário** (ADR 0016): com `retencaoDias`, a limpeza
 * (`limpeza.ts`) apaga o que ficou esse tempo sem uso. Em disco, no computador de quem
 * usa, nada sai.
 */
import { createHash } from 'node:crypto';
import { type Deposito, DepositoEmDisco } from './deposito';

export class ConteudoNaoEncontrado extends Error {
  override readonly name = 'ConteudoNaoEncontrado';
  constructor(
    readonly hash: string,
    /** Os dias que o conteúdo fica guardado, quando é temporário: diz por que sumiu. */
    readonly retencaoDias: number | null = null,
  ) {
    super(`conteúdo ${hash} não está no armazenamento`);
  }
}

/**
 * O motivo de revisão de um job cujo arquivo não está guardado: o que a pessoa lê na
 * tela, e o que ela faz. Enviar o mesmo arquivo de novo basta — o orquestrador devolve à
 * fila o job que esperava por ele (ADR 0016).
 */
export function motivoDoArquivoAusente(erro: ConteudoNaoEncontrado): string {
  const porque =
    erro.retencaoDias === null
      ? 'O arquivo enviado não está guardado'
      : `O arquivo enviado já saiu da nuvem, onde fica ${String(erro.retencaoDias)} dias depois de processado — o original está com quem enviou`;
  return `${porque}. Envie o mesmo arquivo de novo na tela Importar, e isto volta para a fila sozinho.`;
}

export class ConteudoInvalido extends Error {
  override readonly name = 'ConteudoInvalido';
}

/**
 * Teto de tamanho por arquivo.
 *
 * Não é limitação técnica: é limite de bom senso para ingestão manual. Uma
 * exportação de painel de 32 MB é sinal de que a pessoa está subindo a coisa
 * errada, e recusar com mensagem clara é melhor que engasgar depois.
 */
export const MAX_BYTES = 32 * 1024 * 1024;

export function calcularHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Conteúdo guardado, como a listagem o vê. */
export interface ConteudoGuardado {
  readonly hash: string;
  readonly bytes: number;
  readonly gravadoEm: Date;
}

export class ArmazenamentoDeConteudo {
  private readonly deposito: Deposito;
  /** Dias que o conteúdo fica guardado sem uso; `null` é para sempre. */
  readonly retencaoDias: number | null;

  /** Um diretório é o depósito em disco; o resto vem pronto (ver `deposito.ts`). */
  constructor(destino: string | Deposito, opcoes: { readonly retencaoDias?: number } = {}) {
    this.deposito = typeof destino === 'string' ? new DepositoEmDisco(destino) : destino;
    this.retencaoDias = opcoes.retencaoDias ?? null;
  }

  /** Onde o conteúdo mora, para o log — sem segredo. */
  get descricao(): string {
    return this.deposito.descricao;
  }

  /** Guarda o conteúdo e devolve o hash. */
  async guardar(bytes: Uint8Array): Promise<string> {
    return (await this.guardarDizendo(bytes)).hash;
  }

  /**
   * Guarda, e diz se o conteúdo já estava guardado.
   *
   * `jaEstava` falso para um hash que a fila já conhece é o arquivo voltando depois de
   * sair da nuvem — e o orquestrador devolve à fila o que esperava por ele.
   */
  async guardarDizendo(
    bytes: Uint8Array,
  ): Promise<{ readonly hash: string; readonly jaEstava: boolean }> {
    if (bytes.byteLength === 0) {
      throw new ConteudoInvalido('não há conteúdo vazio a guardar');
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw new ConteudoInvalido(
        `conteúdo de ${String(bytes.byteLength)} bytes passa do limite de ${String(MAX_BYTES)}`,
      );
    }

    const hash = calcularHash(bytes);

    // Já existe: o conteúdo é idêntico por definição, então não reescreve.
    if (await this.existe(hash)) return { hash, jaEstava: true };

    await this.deposito.gravar(chaveDe(hash), bytes);
    return { hash, jaEstava: false };
  }

  async ler(hash: string): Promise<Uint8Array> {
    const bytes = await this.deposito.ler(chaveDe(hash));
    if (bytes === null) throw new ConteudoNaoEncontrado(hash, this.retencaoDias);
    return bytes;
  }

  /** Lê como texto UTF-8, para conteúdo que é CSV, HTML ou texto colado. */
  async lerTexto(hash: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.ler(hash));
  }

  async existe(hash: string): Promise<boolean> {
    return (await this.deposito.tamanho(chaveDe(hash))) !== null;
  }

  async tamanho(hash: string): Promise<number> {
    const tamanho = await this.deposito.tamanho(chaveDe(hash));
    if (tamanho === null) throw new ConteudoNaoEncontrado(hash, this.retencaoDias);
    return tamanho;
  }

  /**
   * Todo conteúdo guardado. Objeto cuja chave não é a de um hash fica de fora: não foi
   * este sistema que guardou, e não é ele que vai apagar.
   */
  async *listar(): AsyncIterable<ConteudoGuardado> {
    for await (const objeto of this.deposito.listar()) {
      const hash = hashDaChave(objeto.chave);
      if (hash !== null) yield { hash, bytes: objeto.bytes, gravadoEm: objeto.gravadoEm };
    }
  }

  async apagar(hash: string): Promise<void> {
    await this.deposito.apagar(chaveDe(hash));
  }
}

/**
 * A chave do conteúdo no depósito: o hash, fragmentado pelos dois primeiros
 * caracteres.
 *
 * `validarHash` antes de montar a chave não é zelo excessivo: o hash chega do
 * payload de um job, e um valor como `../../etc/passwd` viraria leitura de
 * caminho arbitrário.
 */
function chaveDe(hash: string): string {
  validarHash(hash);
  return `${hash.slice(0, 2)}/${hash.slice(2)}`;
}

const FORMA_DO_HASH = /^[0-9a-f]{64}$/;

function validarHash(hash: string): void {
  if (!FORMA_DO_HASH.test(hash)) {
    throw new ConteudoInvalido(`hash inválido: ${JSON.stringify(hash)}`);
  }
}

/** O caminho inverso de `chaveDe`; `null` para o que não tem a forma dela. */
function hashDaChave(chave: string): string | null {
  const [prefixo, resto, ...sobra] = chave.split('/');
  if (prefixo === undefined || resto === undefined || sobra.length > 0) return null;
  const hash = `${prefixo}${resto}`;
  return prefixo.length === 2 && FORMA_DO_HASH.test(hash) ? hash : null;
}
