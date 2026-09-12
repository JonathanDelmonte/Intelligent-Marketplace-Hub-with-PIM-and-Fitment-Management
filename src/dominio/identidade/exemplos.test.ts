/**
 * Testes do exemplo few-shot, contra Postgres de verdade.
 *
 * O que importa aqui não é gravar: é **o equilíbrio da amostra**. Um prompt com dez
 * exemplos de "sim" e nenhum de "não" ensina o modelo a dizer sim, e em resolução de
 * identidade o erro de dizer sim é o caro — funde dois produtos em um SKU, e a
 * margem passa a ser calculada sobre o custo do produto errado.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { exemploIdentidade } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { ExemploInvalido, RepositorioDeExemplos, ordenarCanonicos } from './exemplos';

describe('ordenarCanonicos', () => {
  it('ordena o par nos dois sentidos', () => {
    expect(ordenarCanonicos('b', 'a')).toEqual(['a', 'b']);
    expect(ordenarCanonicos('a', 'b')).toEqual(['a', 'b']);
  });

  it('recusa lado vazio e par de um texto com ele mesmo', () => {
    expect(() => ordenarCanonicos('', 'a')).toThrow(ExemploInvalido);
    expect(() => ordenarCanonicos('  ', 'a')).toThrow(ExemploInvalido);
    expect(() => ordenarCanonicos('a', 'a')).toThrow(ExemploInvalido);
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDeExemplos', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeExemplos;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDeExemplos(conexao.db);
    await limparTabelas(conexao.db, ['exemplo_identidade']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('o mesmo par nos dois sentidos é uma decisão só', async () => {
    await repo.registrar({ canonicoA: 'refil a', canonicoB: 'refil b', decisao: 'sim' });
    await repo.registrar({ canonicoA: 'refil b', canonicoB: 'refil a', decisao: 'nao' });

    const linhas = await conexao.db.select().from(exemploIdentidade);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.mesmoProduto).toBe('nao');
  });

  it('equilibra sim e não, e o total pode vir menor que o limite', async () => {
    for (let i = 0; i < 10; i += 1) {
      await repo.registrar({
        canonicoA: `positivo a ${String(i)}`,
        canonicoB: `positivo b ${String(i)}`,
        decisao: 'sim',
      });
    }
    await repo.registrar({ canonicoA: 'negativo a', canonicoB: 'negativo b', decisao: 'nao' });

    const exemplos = await repo.paraPrompt(8);
    const sim = exemplos.filter((e) => e.mesmoProduto === 'sim');
    const nao = exemplos.filter((e) => e.mesmoProduto === 'nao');

    expect(sim).toHaveLength(4);
    expect(nao).toHaveLength(1);
    // Total menor que o limite de propósito: encher com a classe abundante
    // desfaria o equilíbrio, que é a razão de o método existir.
    expect(exemplos).toHaveLength(5);
  });

  it('intercala, para a lista continuar equilibrada se for truncada', async () => {
    for (let i = 0; i < 3; i += 1) {
      await repo.registrar({
        canonicoA: `s a ${String(i)}`,
        canonicoB: `s b ${String(i)}`,
        decisao: 'sim',
      });
      await repo.registrar({
        canonicoA: `n a ${String(i)}`,
        canonicoB: `n b ${String(i)}`,
        decisao: 'nao',
      });
    }

    const exemplos = await repo.paraPrompt(6);
    expect(exemplos.map((e) => e.mesmoProduto)).toEqual(['sim', 'nao', 'sim', 'nao', 'sim', 'nao']);
  });

  it('"incerto" não entra em prompt, porque não ensina nada', async () => {
    await repo.registrar({ canonicoA: 'incerto a', canonicoB: 'incerto b', decisao: 'incerto' });
    expect(await repo.paraPrompt()).toEqual([]);
    expect(await repo.contar()).toEqual({ sim: 0, nao: 0, incerto: 1 });
  });

  it('leva a justificativa, que é o que ensina o critério e não só a resposta', async () => {
    await repo.registrar({
      canonicoA: 'refil electrolux pa21g',
      canonicoB: 'elemento filtrante electrolux pa21g',
      decisao: 'sim',
      justificativa: 'mesmo código de peça, nomes de catálogo diferentes',
    });
    const exemplos = await repo.paraPrompt();
    expect(exemplos[0]?.justificativa).toContain('código de peça');
  });

  it('sem exemplo nenhum, devolve lista vazia em vez de falhar', async () => {
    expect(await repo.paraPrompt()).toEqual([]);
  });
});
