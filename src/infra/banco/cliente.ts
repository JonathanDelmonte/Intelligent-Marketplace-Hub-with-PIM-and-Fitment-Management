/**
 * Conexão com o Postgres.
 *
 * Uma instância por processo, criada na primeira chamada. O `postgres` já faz
 * pool; criar um cliente por requisição esgotaria as conexões de um plano free —
 * que é onde este sistema roda.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { lerAmbiente } from '@/config/ambiente';
import * as schema from './schema';

export type Banco = ReturnType<typeof criarBanco>;

function criarBanco() {
  const ambiente = lerAmbiente();
  const conexao = postgres(ambiente.DATABASE_URL, {
    max: 10,
    // O domínio guarda dinheiro em bigint de centavos e espera `number`
    // (ADR 0004). Sem isto o driver devolveria string para `bigint`.
    types: {
      bigint: postgres.BigInt,
    },
  });
  return drizzle(conexao, { schema, casing: 'snake_case' });
}

let instancia: Banco | null = null;

export function banco(): Banco {
  instancia ??= criarBanco();
  return instancia;
}

export { schema };
