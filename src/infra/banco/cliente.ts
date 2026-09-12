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

/**
 * Configuração de tipos do driver, em ponto único.
 *
 * Não é preferência: o domínio guarda dinheiro em `bigint` de centavos e espera
 * `number` (ADR 0004). Sem isto o driver devolve `string` para `bigint`, e a
 * comparação `preco === 6990` falha silenciosamente contra `'6990'`.
 *
 * Existe aqui, exportado, para que o cliente de teste use exatamente o mesmo —
 * duas definições poderiam divergir, e o teste passaria com um comportamento que
 * produção não tem.
 */
export const TIPOS_DO_DRIVER = { bigint: postgres.BigInt } as const;

/** Abre uma conexão com a configuração canônica. */
export function criarBancoCom(
  url: string,
  opcoes: { readonly max?: number; readonly silenciarAvisos?: boolean } = {},
) {
  const conexao = postgres(url, {
    max: opcoes.max ?? 10,
    types: TIPOS_DO_DRIVER,
    ...(opcoes.silenciarAvisos === true ? { onnotice: () => undefined } : {}),
  });
  return {
    db: drizzle(conexao, { schema, casing: 'snake_case' }),
    encerrar: async () => {
      await conexao.end({ timeout: 5 });
    },
  };
}

export type Banco = ReturnType<typeof criarBancoCom>['db'];

let instancia: Banco | null = null;

export function banco(): Banco {
  instancia ??= criarBancoCom(lerAmbiente().DATABASE_URL).db;
  return instancia;
}

export { schema };
