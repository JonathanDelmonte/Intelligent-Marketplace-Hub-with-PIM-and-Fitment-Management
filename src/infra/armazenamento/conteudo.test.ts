import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArmazenamentoDeConteudo,
  ConteudoInvalido,
  ConteudoNaoEncontrado,
  MAX_BYTES,
  calcularHash,
  motivoDoArquivoAusente,
  type ConteudoGuardado,
} from './conteudo';
import { DepositoEmDisco, type Deposito, type ObjetoGuardado } from './deposito';

/** Um depósito em memória que conta as gravações: é o que prova a idempotência. */
class DepositoEmMemoria implements Deposito {
  readonly descricao = 'memória';
  readonly objetos = new Map<string, Uint8Array>();
  gravacoes = 0;

  gravar(chave: string, bytes: Uint8Array): Promise<void> {
    this.gravacoes += 1;
    this.objetos.set(chave, bytes);
    return Promise.resolve();
  }

  ler(chave: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objetos.get(chave) ?? null);
  }

  tamanho(chave: string): Promise<number | null> {
    return Promise.resolve(this.objetos.get(chave)?.byteLength ?? null);
  }

  async *listar(): AsyncIterable<ObjetoGuardado> {
    await Promise.resolve();
    for (const [chave, bytes] of this.objetos) {
      yield { chave, bytes: bytes.byteLength, gravadoEm: new Date('2026-09-20T12:00:00Z') };
    }
  }

  apagar(chave: string): Promise<void> {
    this.objetos.delete(chave);
    return Promise.resolve();
  }
}

async function todos<T>(iteravel: AsyncIterable<T>): Promise<T[]> {
  const itens: T[] = [];
  for await (const item of iteravel) itens.push(item);
  return itens;
}

const texto = (s: string) => new TextEncoder().encode(s);

describe('ArmazenamentoDeConteudo sobre um depósito qualquer', () => {
  it('guarda pelo hash, fragmentado pelos dois primeiros caracteres', async () => {
    const deposito = new DepositoEmMemoria();
    const hash = await new ArmazenamentoDeConteudo(deposito).guardar(texto('sku;preco\n1;10'));

    expect(hash).toBe(calcularHash(texto('sku;preco\n1;10')));
    expect([...deposito.objetos.keys()]).toEqual([`${hash.slice(0, 2)}/${hash.slice(2)}`]);
  });

  it('o mesmo conteúdo duas vezes grava uma só', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);

    const primeiro = await armazenamento.guardar(texto('igual'));
    const segundo = await armazenamento.guardar(texto('igual'));

    expect(segundo).toBe(primeiro);
    expect(deposito.gravacoes).toBe(1);
  });

  it('lê de volta os mesmos bytes, e como texto', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(new DepositoEmMemoria());
    const hash = await armazenamento.guardar(texto('ação'));

    expect(await armazenamento.lerTexto(hash)).toBe('ação');
    expect(await armazenamento.tamanho(hash)).toBe(texto('ação').byteLength);
    expect(await armazenamento.existe(hash)).toBe(true);
  });

  it('conteúdo que não está no depósito é ConteudoNaoEncontrado, não null', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(new DepositoEmMemoria());
    const ausente = calcularHash(texto('nunca guardado'));

    await expect(armazenamento.ler(ausente)).rejects.toBeInstanceOf(ConteudoNaoEncontrado);
    await expect(armazenamento.tamanho(ausente)).rejects.toBeInstanceOf(ConteudoNaoEncontrado);
    expect(await armazenamento.existe(ausente)).toBe(false);
  });

  it('recusa hash que não é hash antes de chegar ao depósito', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);

    await expect(armazenamento.ler('../../etc/passwd')).rejects.toBeInstanceOf(ConteudoInvalido);
    await expect(armazenamento.existe('ABC')).rejects.toBeInstanceOf(ConteudoInvalido);
  });

  it('recusa vazio e acima do teto sem gravar nada', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);

    await expect(armazenamento.guardar(new Uint8Array())).rejects.toBeInstanceOf(ConteudoInvalido);
    await expect(armazenamento.guardar(new Uint8Array(MAX_BYTES + 1))).rejects.toBeInstanceOf(
      ConteudoInvalido,
    );
    expect(deposito.gravacoes).toBe(0);
  });
});

describe('ArmazenamentoDeConteudo: o que a limpeza da nuvem usa', () => {
  it('guardarDizendo diz se o conteúdo já estava guardado', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);

    const primeira = await armazenamento.guardarDizendo(texto('planilha'));
    const segunda = await armazenamento.guardarDizendo(texto('planilha'));

    expect(primeira).toEqual({ hash: calcularHash(texto('planilha')), jaEstava: false });
    expect(segunda).toEqual({ hash: primeira.hash, jaEstava: true });
    expect(deposito.gravacoes).toBe(1);
  });

  it('o que saiu e é guardado de novo é gravado de novo', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);
    const { hash } = await armazenamento.guardarDizendo(texto('planilha'));

    await armazenamento.apagar(hash);
    const devolta = await armazenamento.guardarDizendo(texto('planilha'));

    expect(devolta.jaEstava).toBe(false);
    expect(await armazenamento.lerTexto(hash)).toBe('planilha');
    expect(deposito.gravacoes).toBe(2);
  });

  it('lista pelo hash, e deixa de fora o que não foi este sistema que guardou', async () => {
    const deposito = new DepositoEmMemoria();
    const armazenamento = new ArmazenamentoDeConteudo(deposito);
    const hash = await armazenamento.guardar(texto('planilha'));
    deposito.objetos.set('leia-me.txt', texto('de outra pessoa'));
    deposito.objetos.set(`${hash.slice(0, 2)}/${hash.slice(2)}/sobra`, texto('x'));
    deposito.objetos.set(`${hash.slice(0, 3)}/${hash.slice(3)}`, texto('x'));

    const listados: ConteudoGuardado[] = await todos(armazenamento.listar());

    expect(listados).toEqual([{ hash, bytes: 8, gravadoEm: new Date('2026-09-20T12:00:00Z') }]);
  });

  it('o apagado não se lê mais, e o erro diz o prazo da nuvem', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(new DepositoEmMemoria(), {
      retencaoDias: 7,
    });
    const hash = await armazenamento.guardar(texto('planilha'));

    await armazenamento.apagar(hash);

    const erro = await armazenamento.ler(hash).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConteudoNaoEncontrado);
    expect(erro).toMatchObject({ hash, retencaoDias: 7 });
    expect(armazenamento.retencaoDias).toBe(7);
  });

  it('sem prazo, o armazenamento guarda para sempre', () => {
    expect(new ArmazenamentoDeConteudo(new DepositoEmMemoria()).retencaoDias).toBeNull();
  });

  it('apagar recusa o que não é hash, antes de chegar ao depósito', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(new DepositoEmMemoria());
    await expect(armazenamento.apagar('../../etc/passwd')).rejects.toBeInstanceOf(ConteudoInvalido);
  });
});

describe('motivoDoArquivoAusente', () => {
  const hash = calcularHash(texto('x'));

  it('na nuvem, diz que o arquivo saiu, depois de quanto tempo, e o que fazer', () => {
    const motivo = motivoDoArquivoAusente(new ConteudoNaoEncontrado(hash, 7));
    expect(motivo).toContain('já saiu da nuvem');
    expect(motivo).toContain('7 dias depois de processado');
    expect(motivo).toContain('Envie o mesmo arquivo de novo na tela Importar');
  });

  it('sem prazo, não fala de nuvem', () => {
    const motivo = motivoDoArquivoAusente(new ConteudoNaoEncontrado(hash));
    expect(motivo).not.toContain('nuvem');
    expect(motivo).toContain('Envie o mesmo arquivo de novo na tela Importar');
  });
});

describe('ArmazenamentoDeConteudo em disco', () => {
  let pasta: string;

  beforeEach(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'conteudo-'));
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  it('um diretório é o depósito em disco, no mesmo desenho de pastas de sempre', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(pasta);
    const hash = await armazenamento.guardar(texto('planilha'));

    // O caminho não mudou com o depósito: o conteúdo já guardado continua achável.
    const noDisco = await readFile(join(pasta, hash.slice(0, 2), hash.slice(2)), 'utf-8');
    expect(noDisco).toBe('planilha');
    expect(armazenamento.descricao).toBe(pasta);
  });

  it('o que não está no disco é ConteudoNaoEncontrado', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(pasta);
    await expect(armazenamento.ler(calcularHash(texto('x')))).rejects.toBeInstanceOf(
      ConteudoNaoEncontrado,
    );
  });

  it('lista o que está guardado, com o tamanho e a data da gravação', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(pasta);
    const hash = await armazenamento.guardar(texto('planilha'));
    const caminho = join(pasta, hash.slice(0, 2), hash.slice(2));
    const quando = new Date('2026-09-10T08:00:00Z');
    await utimes(caminho, quando, quando);

    expect(await todos(armazenamento.listar())).toEqual([{ hash, bytes: 8, gravadoEm: quando }]);
  });

  it('a listagem pula a gravação pela metade e o que não é pasta de hash', async () => {
    const deposito = new DepositoEmDisco(pasta);
    await mkdir(join(pasta, 'ab'), { recursive: true });
    await writeFile(join(pasta, 'ab', 'cdef.123.parcial'), 'metade');
    await writeFile(join(pasta, 'solto.txt'), 'x');

    expect(await todos(deposito.listar())).toEqual([]);
  });

  it('pasta que ainda não existe é depósito vazio, e não erro', async () => {
    const deposito = new DepositoEmDisco(join(pasta, 'nao-existe'));
    expect(await todos(deposito.listar())).toEqual([]);
  });

  it('apaga, e apagar de novo não é erro', async () => {
    const armazenamento = new ArmazenamentoDeConteudo(pasta);
    const hash = await armazenamento.guardar(texto('planilha'));

    await armazenamento.apagar(hash);
    await armazenamento.apagar(hash);

    expect(await armazenamento.existe(hash)).toBe(false);
    expect(await todos(armazenamento.listar())).toEqual([]);
  });
});
