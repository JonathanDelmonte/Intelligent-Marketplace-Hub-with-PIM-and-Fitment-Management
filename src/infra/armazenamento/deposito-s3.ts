/**
 * Depósito S3: o armazenamento de conteúdo fora do disco (ADR 0013).
 *
 * No Render gratuito o disco some a cada publicação, e com ele sumiriam as planilhas
 * que a fila ainda vai ler. O Supabase Storage fala o protocolo S3, e é para ele que
 * os bytes vão — mas nada aqui é do Supabase: R2, B2 ou MinIO servem igual.
 *
 * Duas escolhas que não são óbvias:
 *
 * - **`forcePathStyle`**: o endereço do Supabase é `…/storage/v1/s3/<balde>/<chave>`,
 *   e não `<balde>.<host>`. Sem isto, o cliente tenta um nome de host que não existe.
 * - **Checksum só quando obrigatório**: o SDK passou a mandar CRC32 em todo envio, e
 *   serviços compatíveis com S3 recusam o que não conhecem. `WHEN_REQUIRED` volta ao
 *   comportamento que todos aceitam.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Deposito, ObjetoGuardado } from './deposito';

export interface ConfiguracaoS3 {
  readonly endpoint: string;
  readonly regiao: string;
  readonly chave: string;
  readonly segredo: string;
  readonly balde: string;
}

/** O erro do SDK traz o nome do código S3 e o status HTTP; nada mais importa aqui. */
function codigoDoErro(erro: unknown): { nome: string; status: number | undefined } {
  if (typeof erro !== 'object' || erro === null) return { nome: '', status: undefined };
  const nome = 'name' in erro && typeof erro.name === 'string' ? erro.name : '';
  const metadados = '$metadata' in erro ? erro.$metadata : undefined;
  const status =
    typeof metadados === 'object' &&
    metadados !== null &&
    'httpStatusCode' in metadados &&
    typeof metadados.httpStatusCode === 'number'
      ? metadados.httpStatusCode
      : undefined;
  return { nome, status };
}

function naoExiste(erro: unknown): boolean {
  const { nome, status } = codigoDoErro(erro);
  return nome === 'NoSuchKey' || nome === 'NotFound' || status === 404;
}

export class DepositoS3 implements Deposito {
  private readonly cliente: S3Client;
  private readonly balde: string;
  readonly descricao: string;

  constructor(configuracao: ConfiguracaoS3) {
    this.balde = configuracao.balde;
    this.descricao = `s3, balde ${configuracao.balde}`;
    this.cliente = new S3Client({
      endpoint: configuracao.endpoint,
      region: configuracao.regiao,
      forcePathStyle: true,
      credentials: {
        accessKeyId: configuracao.chave,
        secretAccessKey: configuracao.segredo,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000 },
    });
  }

  /**
   * Um PUT do S3 já é tudo ou nada: o objeto só aparece inteiro. Se o balde não
   * existe — o primeiro envio de uma conta nova —, ele é criado e o envio, refeito.
   */
  async gravar(chave: string, bytes: Uint8Array): Promise<void> {
    const enviar = () =>
      this.cliente.send(
        new PutObjectCommand({
          Bucket: this.balde,
          Key: chave,
          Body: bytes,
          ContentType: 'application/octet-stream',
        }),
      );
    try {
      await enviar();
    } catch (erro) {
      if (codigoDoErro(erro).nome !== 'NoSuchBucket') throw erro;
      await this.cliente.send(new CreateBucketCommand({ Bucket: this.balde }));
      await enviar();
    }
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    try {
      const resposta = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.balde, Key: chave }),
      );
      return resposta.Body ? await resposta.Body.transformToByteArray() : null;
    } catch (erro) {
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  async tamanho(chave: string): Promise<number | null> {
    try {
      const resposta = await this.cliente.send(
        new HeadObjectCommand({ Bucket: this.balde, Key: chave }),
      );
      return resposta.ContentLength ?? null;
    } catch (erro) {
      if (naoExiste(erro)) return null;
      throw erro;
    }
  }

  /** Página por página, até mil por pedido. Balde que ainda não existe é depósito vazio. */
  async *listar(): AsyncIterable<ObjetoGuardado> {
    let continuacao: string | undefined;
    do {
      let pagina;
      try {
        pagina = await this.cliente.send(
          new ListObjectsV2Command({
            Bucket: this.balde,
            ...(continuacao === undefined ? {} : { ContinuationToken: continuacao }),
          }),
        );
      } catch (erro) {
        if (codigoDoErro(erro).nome === 'NoSuchBucket') return;
        throw erro;
      }
      for (const objeto of pagina.Contents ?? []) {
        if (objeto.Key === undefined || objeto.LastModified === undefined) continue;
        yield { chave: objeto.Key, bytes: objeto.Size ?? 0, gravadoEm: objeto.LastModified };
      }
      continuacao = pagina.IsTruncated === true ? pagina.NextContinuationToken : undefined;
    } while (continuacao !== undefined);
  }

  async apagar(chave: string): Promise<void> {
    try {
      await this.cliente.send(new DeleteObjectCommand({ Bucket: this.balde, Key: chave }));
    } catch (erro) {
      if (naoExiste(erro)) return;
      throw erro;
    }
  }
}
