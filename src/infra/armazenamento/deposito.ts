/**
 * Onde os bytes do armazenamento de conteúdo moram.
 *
 * `ArmazenamentoDeConteudo` cuida do que é regra — hash, limite de tamanho,
 * idempotência, validação do endereço —, e entrega os bytes a um depósito. Dois
 * depósitos existem, e a escolha é de configuração (`montagem.ts`):
 *
 * - **Em disco**, no computador de quem desenvolve e num servidor com disco próprio.
 * - **S3**, onde o disco some a cada publicação — o Render gratuito (ADR 0013), que
 *   guarda os arquivos no Supabase Storage.
 *
 * A chave é o hash, fragmentado pelos dois primeiros caracteres (`ab/cdef…`): um
 * diretório com cem mil arquivos é lento de listar, e o mesmo desenho serve às duas.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface Deposito {
  /** Para o log: onde fica, sem segredo nenhum. */
  readonly descricao: string;
  /** Grava por inteiro ou não grava: leitura nunca vê arquivo pela metade. */
  gravar(chave: string, bytes: Uint8Array): Promise<void>;
  /** `null` quando a chave não existe. */
  ler(chave: string): Promise<Uint8Array | null>;
  /** `null` quando a chave não existe. */
  tamanho(chave: string): Promise<number | null>;
}

export class DepositoEmDisco implements Deposito {
  private readonly raiz: string;
  readonly descricao: string;

  constructor(diretorio: string) {
    this.raiz = resolve(diretorio);
    this.descricao = this.raiz;
  }

  /**
   * Escrita atômica: grava num arquivo temporário e renomeia. Sem isso, um processo
   * morto no meio da escrita deixaria um arquivo truncado **com o hash de um conteúdo
   * completo** — e toda leitura seguinte confiaria nele.
   */
  async gravar(chave: string, bytes: Uint8Array): Promise<void> {
    const destino = join(this.raiz, chave);
    await mkdir(dirname(destino), { recursive: true });
    const temporario = `${destino}.${String(process.pid)}.parcial`;
    await writeFile(temporario, bytes);
    await rename(temporario, destino);
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.raiz, chave)));
    } catch {
      return null;
    }
  }

  async tamanho(chave: string): Promise<number | null> {
    try {
      const info = await stat(join(this.raiz, chave));
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }
}
