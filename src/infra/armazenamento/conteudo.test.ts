import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArmazenamentoDeConteudo,
  ConteudoInvalido,
  ConteudoNaoEncontrado,
  MAX_BYTES,
  calcularHash,
} from './conteudo';
import type { Deposito } from './deposito';

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
});
