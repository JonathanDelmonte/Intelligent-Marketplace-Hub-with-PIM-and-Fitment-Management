import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepositoS3 } from './deposito-s3';

/**
 * Um S3 de mentira, com o prefixo de caminho do Supabase (`/storage/v1/s3`).
 *
 * Não confere assinatura — isso é do serviço de verdade. Confere o que é nosso: o
 * endereço no estilo de caminho, o balde criado quando falta, o 404 virando `null`, e
 * nenhum cabeçalho de checksum que um serviço compatível pudesse recusar. A listagem
 * devolve duas chaves por página, para a continuação ser exercida com três objetos.
 */
const PREFIXO = '/storage/v1/s3';

interface Pedido {
  readonly metodo: string;
  readonly caminho: string;
  readonly cabecalhos: IncomingHttpHeaders;
}

function erroXml(codigo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${codigo}</Code><Message>${codigo}</Message></Error>`;
}

const POR_PAGINA = 2;

function listagemXml(balde: string, chaves: readonly [string, Buffer, Date][], depois: number) {
  const pagina = chaves.slice(depois, depois + POR_PAGINA);
  const truncada = depois + POR_PAGINA < chaves.length;
  const conteudos = pagina
    .map(
      ([chave, bytes, quando]) =>
        `<Contents><Key>${chave}</Key><LastModified>${quando.toISOString()}</LastModified>` +
        `<ETag>"x"</ETag><Size>${String(bytes.byteLength)}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>${balde}</Name><Prefix></Prefix><KeyCount>${String(pagina.length)}</KeyCount><MaxKeys>1000</MaxKeys>` +
    `<IsTruncated>${String(truncada)}</IsTruncated>` +
    (truncada
      ? `<NextContinuationToken>${String(depois + POR_PAGINA)}</NextContinuationToken>`
      : '') +
    `${conteudos}</ListBucketResult>`
  );
}

function subirS3DeMentira(baldesIniciais: string[]) {
  const baldes = new Set(baldesIniciais);
  const objetos = new Map<string, Buffer>();
  const gravadoEm = new Map<string, Date>();
  const pedidos: Pedido[] = [];

  const servidor: Server = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      const [bruto = '', consulta = ''] = (req.url ?? '').split('?');
      const caminho = decodeURIComponent(bruto);
      const parametros = new URLSearchParams(consulta);
      pedidos.push({ metodo: req.method ?? '', caminho, cabecalhos: req.headers });
      if (!caminho.startsWith(`${PREFIXO}/`)) {
        res.writeHead(400).end(erroXml('InvalidURI'));
        return;
      }
      const [balde = '', ...resto] = caminho.slice(PREFIXO.length + 1).split('/');
      const chave = resto.join('/');

      if (req.method === 'PUT' && chave === '') {
        baldes.add(balde);
        res.writeHead(200).end();
        return;
      }
      if (!baldes.has(balde)) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(req.method === 'HEAD' ? undefined : erroXml('NoSuchBucket'));
        return;
      }
      if (req.method === 'GET' && chave === '' && parametros.get('list-type') === '2') {
        const doBalde = [...objetos]
          .filter(([id]) => id.startsWith(`${balde}/`))
          .map(([id, bytes]): [string, Buffer, Date] => [
            id.slice(balde.length + 1),
            bytes,
            gravadoEm.get(id) ?? new Date(),
          ]);
        const depois = Number(parametros.get('continuation-token') ?? '0');
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(listagemXml(balde, doBalde, depois));
        return;
      }
      const id = `${balde}/${chave}`;
      if (req.method === 'PUT') {
        objetos.set(id, Buffer.concat(partes));
        gravadoEm.set(id, new Date());
        res.writeHead(200, { etag: '"x"' }).end();
        return;
      }
      if (req.method === 'DELETE') {
        // Como o S3: apagar o que não existe também responde 204.
        objetos.delete(id);
        gravadoEm.delete(id);
        res.writeHead(204).end();
        return;
      }
      const objeto = objetos.get(id);
      if (objeto === undefined) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(req.method === 'HEAD' ? undefined : erroXml('NoSuchKey'));
        return;
      }
      res.writeHead(200, {
        'content-length': String(objeto.byteLength),
        'content-type': 'application/octet-stream',
      });
      res.end(req.method === 'HEAD' ? undefined : objeto);
    });
  });

  return { servidor, baldes, objetos, gravadoEm, pedidos };
}

async function todos<T>(iteravel: AsyncIterable<T>): Promise<T[]> {
  const itens: T[] = [];
  for await (const item of iteravel) itens.push(item);
  return itens;
}

describe('DepositoS3', () => {
  let s3: ReturnType<typeof subirS3DeMentira>;
  let endpoint: string;

  const deposito = () =>
    new DepositoS3({
      endpoint,
      regiao: 'us-east-1',
      chave: 'chave-de-teste',
      segredo: 'segredo-de-teste',
      balde: 'conteudo',
    });

  beforeEach(async () => {
    s3 = subirS3DeMentira(['conteudo']);
    await new Promise<void>((pronto) => s3.servidor.listen(0, '127.0.0.1', pronto));
    const { port } = s3.servidor.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${String(port)}${PREFIXO}`;
  });

  afterEach(async () => {
    await new Promise((pronto) => s3.servidor.close(pronto));
  });

  it('grava e lê de volta os mesmos bytes, no estilo de caminho do Supabase', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    await deposito().gravar('ab/cdef', bytes);

    expect(await deposito().ler('ab/cdef')).toEqual(bytes);
    expect(await deposito().tamanho('ab/cdef')).toBe(6);
    expect(s3.pedidos.map((p) => `${p.metodo} ${p.caminho}`)).toContain(
      `PUT ${PREFIXO}/conteudo/ab/cdef`,
    );
  });

  it('o que não existe é null, na leitura e no tamanho', async () => {
    expect(await deposito().ler('00/nada')).toBeNull();
    expect(await deposito().tamanho('00/nada')).toBeNull();
  });

  it('assina os pedidos e não manda checksum que um serviço compatível recusaria', async () => {
    await deposito().gravar('ab/cdef', new Uint8Array([1]));

    const envio = s3.pedidos.find((p) => p.metodo === 'PUT');
    expect(envio?.cabecalhos.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    const nomes = Object.keys(envio?.cabecalhos ?? {});
    expect(nomes.filter((nome) => nome.startsWith('x-amz-checksum-'))).toEqual([]);
    expect(nomes).not.toContain('x-amz-sdk-checksum-algorithm');
  });

  it('cria o balde que falta e refaz o envio', async () => {
    s3.baldes.clear();

    await deposito().gravar('ab/cdef', new Uint8Array([7]));

    expect(s3.baldes.has('conteudo')).toBe(true);
    expect(await deposito().ler('ab/cdef')).toEqual(new Uint8Array([7]));
  });

  it('lista tudo, página por página, com tamanho e data da gravação', async () => {
    const quando = new Date('2026-09-18T10:00:00.000Z');
    for (const chave of ['aa/1', 'bb/22', 'cc/333']) {
      await deposito().gravar(chave, new Uint8Array(chave.length));
      s3.gravadoEm.set(`conteudo/${chave}`, quando);
    }

    const listados = await todos(deposito().listar());

    expect(listados).toEqual([
      { chave: 'aa/1', bytes: 4, gravadoEm: quando },
      { chave: 'bb/22', bytes: 5, gravadoEm: quando },
      { chave: 'cc/333', bytes: 6, gravadoEm: quando },
    ]);
    // Três objetos, duas por página: a segunda página veio pela continuação.
    const listagens = s3.pedidos.filter(
      (p) => p.metodo === 'GET' && p.caminho.replace(/\/$/, '') === `${PREFIXO}/conteudo`,
    );
    expect(listagens).toHaveLength(2);
  });

  it('balde que ainda não existe é depósito vazio', async () => {
    s3.baldes.clear();
    expect(await todos(deposito().listar())).toEqual([]);
  });

  it('apaga, e apagar o que não existe não é erro', async () => {
    await deposito().gravar('ab/cdef', new Uint8Array([1]));

    await deposito().apagar('ab/cdef');
    await deposito().apagar('ab/cdef');

    expect(await deposito().ler('ab/cdef')).toBeNull();
    expect(s3.pedidos.filter((p) => p.metodo === 'DELETE').map((p) => p.caminho)).toEqual([
      `${PREFIXO}/conteudo/ab/cdef`,
      `${PREFIXO}/conteudo/ab/cdef`,
    ]);
  });

  it('erro que não é "não existe" sobe, e não vira null', async () => {
    await new Promise((pronto) => s3.servidor.close(pronto));
    s3 = subirS3DeMentira(['conteudo']);
    s3.servidor.removeAllListeners('request');
    s3.servidor.on('request', (_req, res) => {
      res.writeHead(403, { 'content-type': 'application/xml' }).end(erroXml('AccessDenied'));
    });
    await new Promise<void>((pronto) => s3.servidor.listen(0, '127.0.0.1', pronto));
    const { port } = s3.servidor.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${String(port)}${PREFIXO}`;

    await expect(deposito().ler('ab/cdef')).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
