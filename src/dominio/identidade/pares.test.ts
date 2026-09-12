/**
 * Testes do par de identidade e da fila de revisão, contra Postgres de verdade.
 *
 * O que só o banco prova: que o par é **ordenado por constraint** e não por
 * convenção, e que o upsert com `setWhere` protege a decisão humana de ser
 * sobrescrita pela varredura seguinte.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parIdentidade, produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { ParInvalido, RepositorioDePares, ordenarPar } from './pares';

describe('ordenarPar', () => {
  it('ordena pelos ids, nos dois sentidos', () => {
    expect(ordenarPar('b', 'a')).toEqual(['a', 'b']);
    expect(ordenarPar('a', 'b')).toEqual(['a', 'b']);
  });

  it('recusa o par de um produto com ele mesmo', () => {
    expect(() => ordenarPar('a', 'a')).toThrow(ParInvalido);
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDePares', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDePares;
  let ids: string[];

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    repo = new RepositorioDePares(conexao.db);
    await limparTabelas(conexao.db, ['par_identidade', 'preco_historico', 'produto_externo']);

    const criados = await conexao.db
      .insert(produtoExterno)
      .values([
        { tituloBruto: 'Refil A', hashConteudo: 'p-a', fonte: 'm0_link', preco: 4_990 },
        { tituloBruto: 'Refil B', hashConteudo: 'p-b', fonte: 'm1_planilha', preco: 1_990 },
        { tituloBruto: 'Refil C', hashConteudo: 'p-c', fonte: 'm0_link' },
      ])
      .returning({ id: produtoExterno.id });
    ids = criados.map((c) => c.id).sort();
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const id = (i: number): string => {
    const valor = ids[i];
    if (valor === undefined) throw new Error('produto não criado');
    return valor;
  };

  /**
   * O nome da constraint violada.
   *
   * O Drizzle embrulha o erro do driver em "Failed query: …" e põe o original em
   * `cause`, então asserção na mensagem de fora não vê o nome da constraint — que é
   * justamente o que se quer provar.
   */
  async function constraintViolada(promessa: Promise<unknown>): Promise<string> {
    try {
      await promessa;
    } catch (erro) {
      const causa = erro instanceof Error ? erro.cause : undefined;
      const nome =
        causa !== null && typeof causa === 'object' && 'constraint_name' in causa
          ? causa.constraint_name
          : undefined;
      return typeof nome === 'string' ? nome : `sem constraint: ${String(erro)}`;
    }
    return 'não falhou';
  }

  it('grava o par na ordem canônica, independente da ordem do argumento', async () => {
    await repo.registrar({
      produtoA: id(1),
      produtoB: id(0),
      decisao: 'mesmo',
      origem: 'deterministico',
      nivel: 'gtin',
      confiancaBp: 10_000,
      status: 'automatico',
    });

    const [linha] = await conexao.db
      .select({ a: parIdentidade.produtoAId, b: parIdentidade.produtoBId })
      .from(parIdentidade);
    expect(linha?.a).toBe(id(0));
    expect(linha?.b).toBe(id(1));
  });

  it('o banco recusa par fora de ordem, então a invariante não depende do código', async () => {
    const violada = await constraintViolada(
      conexao.db.insert(parIdentidade).values({
        produtoAId: id(1),
        produtoBId: id(0),
        decisao: 'mesmo',
        origem: 'deterministico',
        nivel: 'gtin',
      }),
    );
    expect(violada).toBe('chk_par_identidade_ordenado');
  });

  it('o banco recusa o par de um produto com ele mesmo', async () => {
    const violada = await constraintViolada(
      conexao.db.insert(parIdentidade).values({
        produtoAId: id(0),
        produtoBId: id(0),
        decisao: 'mesmo',
        origem: 'deterministico',
        nivel: 'gtin',
      }),
    );
    expect(violada).toBe('chk_par_identidade_ordenado');
  });

  it('registrar duas vezes atualiza em vez de duplicar', async () => {
    const base = {
      produtoA: id(0),
      produtoB: id(1),
      origem: 'deterministico' as const,
      nivel: 'marca_modelo' as const,
      status: 'automatico' as const,
    };
    await repo.registrar({ ...base, decisao: 'mesmo', confiancaBp: 8_500 });
    await repo.registrar({ ...base, decisao: 'diferente', confiancaBp: 7_500 });

    const [{ n } = { n: -1 }] = await conexao.db
      .select({ n: sql<number>`count(*)::int` })
      .from(parIdentidade);
    expect(n).toBe(1);
    expect((await repo.buscar(id(0), id(1)))?.decisao).toBe('diferente');
  });

  it('não sobrescreve decisão humana, e diz que não gravou', async () => {
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'diferente',
      origem: 'humano',
      nivel: 'marca_modelo',
      confiancaBp: 10_000,
      status: 'resolvido',
    });

    const tentativa = await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'mesmo',
      origem: 'deterministico',
      nivel: 'marca_modelo',
      confiancaBp: 8_500,
      status: 'automatico',
    });

    expect(tentativa.gravado).toBe(false);
    const par = await repo.buscar(id(0), id(1));
    expect(par?.origem).toBe('humano');
    expect(par?.decisao).toBe('diferente');
  });

  it('uma pessoa pode revisar a própria decisão', async () => {
    const base = {
      produtoA: id(0),
      produtoB: id(1),
      origem: 'humano' as const,
      nivel: 'marca_modelo' as const,
    };
    await repo.registrar({
      ...base,
      decisao: 'diferente',
      confiancaBp: 10_000,
      status: 'resolvido',
    });
    const segunda = await repo.registrar({
      ...base,
      decisao: 'mesmo',
      confiancaBp: 10_000,
      status: 'resolvido',
    });
    expect(segunda.gravado).toBe(true);
    expect((await repo.buscar(id(0), id(1)))?.decisao).toBe('mesmo');
  });

  it('a fila traz só o pendente, mais confiante primeiro, com os dois lados', async () => {
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'indeciso',
      origem: 'llm',
      nivel: 'embedding',
      confiancaBp: 7_000,
      status: 'pendente',
      justificativa: 'parecem o mesmo refil',
    });
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(2),
      decisao: 'indeciso',
      origem: 'llm',
      nivel: 'embedding',
      confiancaBp: 5_800,
      status: 'pendente',
    });
    await repo.registrar({
      produtoA: id(1),
      produtoB: id(2),
      decisao: 'diferente',
      origem: 'deterministico',
      nivel: 'marca',
      confiancaBp: 7_000,
      status: 'automatico',
    });

    const fila = await repo.fila();
    expect(fila).toHaveLength(2);
    expect(fila[0]?.confiancaBp).toBe(7_000);
    expect(fila[1]?.confiancaBp).toBe(5_800);

    // Os dois lados vêm com o que a tela precisa para decidir em dois cliques.
    expect(fila[0]?.a.tituloBruto).toBeDefined();
    expect(fila[0]?.b.tituloBruto).toBeDefined();
    expect(fila[0]?.a.id).toBe(id(0));
    expect(fila[0]?.justificativa).toBe('parecem o mesmo refil');
  });

  it('conta por status', async () => {
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'mesmo',
      origem: 'deterministico',
      nivel: 'gtin',
      confiancaBp: 10_000,
      status: 'automatico',
    });
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(2),
      decisao: 'indeciso',
      origem: 'llm',
      nivel: 'embedding',
      confiancaBp: 7_000,
      status: 'pendente',
    });

    const contagem = await repo.contarPorStatus();
    expect(contagem).toEqual({ automatico: 1, pendente: 1, resolvido: 0, descartado: 0 });
  });

  it('jaAvaliados devolve o outro lado de cada par', async () => {
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'mesmo',
      origem: 'deterministico',
      nivel: 'gtin',
      confiancaBp: 10_000,
      status: 'automatico',
    });
    await repo.registrar({
      produtoA: id(2),
      produtoB: id(0),
      decisao: 'diferente',
      origem: 'deterministico',
      nivel: 'marca',
      confiancaBp: 7_000,
      status: 'automatico',
    });

    const avaliados = await repo.jaAvaliados(id(0));
    expect([...avaliados].sort()).toEqual([id(1), id(2)].sort());
    expect(await repo.jaAvaliados(id(1))).toEqual(new Set([id(0)]));
  });

  it('marcarStatus tira o par da fila', async () => {
    const { id: parId } = await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'indeciso',
      origem: 'llm',
      nivel: 'embedding',
      confiancaBp: 7_000,
      status: 'pendente',
    });

    expect(await repo.marcarStatus([parId], 'resolvido')).toBe(1);
    expect(await repo.fila()).toHaveLength(0);
    expect(await repo.porId(parId)).not.toBeNull();
  });

  it('apagar a ocorrência apaga o par, sem deixar linha órfã', async () => {
    await repo.registrar({
      produtoA: id(0),
      produtoB: id(1),
      decisao: 'mesmo',
      origem: 'deterministico',
      nivel: 'gtin',
      confiancaBp: 10_000,
      status: 'automatico',
    });
    await conexao.db.delete(produtoExterno).where(sql`id = ${id(0)}`);
    const linhas = await conexao.db.select().from(parIdentidade);
    expect(linhas).toHaveLength(0);
  });
});
