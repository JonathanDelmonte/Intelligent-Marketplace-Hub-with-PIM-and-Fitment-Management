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
 */
import { createHash } from 'node:crypto';
import { type Deposito, DepositoEmDisco } from './deposito';

export class ConteudoNaoEncontrado extends Error {
  override readonly name = 'ConteudoNaoEncontrado';
  constructor(readonly hash: string) {
    super(`conteúdo ${hash} não está no armazenamento`);
  }
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

export class ArmazenamentoDeConteudo {
  private readonly deposito: Deposito;

  /** Um diretório é o depósito em disco; o resto vem pronto (ver `deposito.ts`). */
  constructor(destino: string | Deposito) {
    this.deposito = typeof destino === 'string' ? new DepositoEmDisco(destino) : destino;
  }

  /** Onde o conteúdo mora, para o log — sem segredo. */
  get descricao(): string {
    return this.deposito.descricao;
  }

  /** Guarda o conteúdo e devolve o hash. */
  async guardar(bytes: Uint8Array): Promise<string> {
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
    if (await this.existe(hash)) return hash;

    await this.deposito.gravar(chaveDe(hash), bytes);
    return hash;
  }

  async ler(hash: string): Promise<Uint8Array> {
    const bytes = await this.deposito.ler(chaveDe(hash));
    if (bytes === null) throw new ConteudoNaoEncontrado(hash);
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
    if (tamanho === null) throw new ConteudoNaoEncontrado(hash);
    return tamanho;
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

function validarHash(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ConteudoInvalido(`hash inválido: ${JSON.stringify(hash)}`);
  }
}
