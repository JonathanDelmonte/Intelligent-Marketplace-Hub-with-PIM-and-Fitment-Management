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
 *
 * Listar e apagar existem para a nuvem guardar só o que ainda serve (ADR 0016): o
 * original de quem enviou está no computador dele, e a cópia na nuvem sai depois de
 * uns dias (`limpeza.ts`).
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Um objeto guardado, como a listagem o vê. */
export interface ObjetoGuardado {
  readonly chave: string;
  readonly bytes: number;
  /** A última gravação. Guardar de novo o mesmo conteúdo que tinha saído renova. */
  readonly gravadoEm: Date;
}

export interface Deposito {
  /** Para o log: onde fica, sem segredo nenhum. */
  readonly descricao: string;
  /** Grava por inteiro ou não grava: leitura nunca vê arquivo pela metade. */
  gravar(chave: string, bytes: Uint8Array): Promise<void>;
  /** `null` quando a chave não existe. */
  ler(chave: string): Promise<Uint8Array | null>;
  /** `null` quando a chave não existe. */
  tamanho(chave: string): Promise<number | null>;
  /** Tudo o que está guardado. Arquivo pela metade de uma gravação em curso fica de fora. */
  listar(): AsyncIterable<ObjetoGuardado>;
  /** Apagar o que não existe não é erro: duas limpezas seguidas dão no mesmo. */
  apagar(chave: string): Promise<void>;
}

/** O sufixo do arquivo temporário da escrita atômica. */
const SUFIXO_PARCIAL = '.parcial';

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
    const temporario = `${destino}.${String(process.pid)}${SUFIXO_PARCIAL}`;
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

  /** Pasta por pasta, no desenho `ab/cdef…`. Pasta que ainda não existe é depósito vazio. */
  async *listar(): AsyncIterable<ObjetoGuardado> {
    for (const pasta of await entradas(this.raiz)) {
      if (!pasta.isDirectory()) continue;
      for (const arquivo of await entradas(join(this.raiz, pasta.name))) {
        if (!arquivo.isFile() || arquivo.name.endsWith(SUFIXO_PARCIAL)) continue;
        const chave = `${pasta.name}/${arquivo.name}`;
        try {
          const info = await stat(join(this.raiz, chave));
          yield { chave, bytes: info.size, gravadoEm: info.mtime };
        } catch {
          // Apagado entre a listagem da pasta e o `stat`: já não está guardado.
        }
      }
    }
  }

  async apagar(chave: string): Promise<void> {
    await rm(join(this.raiz, chave), { force: true });
  }
}

async function entradas(pasta: string) {
  try {
    return await readdir(pasta, { withFileTypes: true });
  } catch {
    return [];
  }
}
