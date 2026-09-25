/**
 * O RLS contra Postgres de verdade: quem liga é o banco, e é o banco que diz se ligou.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fecharTabelasParaQuemNaoEDono } from './fechar-tabelas';
import { abrirBancoDeTeste, temBancoDeTeste, type ConexaoDeTeste } from './teste';

/** Uma tabela só deste arquivo: os testes de banco rodam em paralelo. */
const TABELA = 'teste_fechar_tabelas';

const abertasDoDono = async (conexao: ConexaoDeTeste) =>
  z
    .array(z.object({ tabela: z.string() }))
    .parse([
      ...(await conexao.db.execute(sql`
        select tablename as tabela from pg_tables
        where schemaname = 'public' and tableowner = current_user and not rowsecurity
      `)),
    ])
    .map((l) => l.tabela);

describe.skipIf(!temBancoDeTeste())('fecharTabelasParaQuemNaoEDono', () => {
  let conexao: ConexaoDeTeste;

  beforeAll(async () => {
    conexao = abrirBancoDeTeste();
    await conexao.db.execute(sql.raw(`drop table if exists public.${TABELA}`));
  });

  afterAll(async () => {
    await conexao.db.execute(sql.raw(`drop table if exists public.${TABELA}`));
    await conexao.encerrar();
  });

  it('fecha toda tabela do sistema, e a que uma migração nova criar', async () => {
    await conexao.db.execute(sql.raw(`create table public.${TABELA} (id int primary key)`));
    expect(await abertasDoDono(conexao)).toContain(TABELA);

    expect(await fecharTabelasParaQuemNaoEDono(conexao.db)).toBeGreaterThanOrEqual(1);

    expect(await abertasDoDono(conexao)).toEqual([]);
  });

  it('rodar de novo não tem o que fechar', async () => {
    await fecharTabelasParaQuemNaoEDono(conexao.db);
    expect(await fecharTabelasParaQuemNaoEDono(conexao.db)).toBe(0);
  });

  it('o dono continua lendo e gravando como antes', async () => {
    await conexao.db.execute(sql.raw(`insert into public.${TABELA} (id) values (7)`));
    const linhas = [...(await conexao.db.execute(sql.raw(`select id from public.${TABELA}`)))];
    expect(linhas).toEqual([{ id: 7 }]);
  });
});
