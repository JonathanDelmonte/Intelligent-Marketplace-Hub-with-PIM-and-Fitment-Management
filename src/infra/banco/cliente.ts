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
import { urlParaODriver } from './url';

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

/**
 * Abre uma conexão com a configuração canônica.
 *
 * A URL passa por `urlParaODriver`, que tira o `channel_binding` da string do painel do
 * Neon: o driver o repassaria ao servidor, e a conexão cairia.
 */
export function criarBancoCom(
  url: string,
  opcoes: { readonly max?: number; readonly silenciarAvisos?: boolean } = {},
) {
  const conexao = postgres(urlParaODriver(url), {
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

/**
 * Instância única por processo, guardada em `globalThis`.
 *
 * Um `let` de módulo seria o natural, e vaza no servidor de desenvolvimento do
 * Next: cada recarga a quente reavalia o módulo, o `let` volta a `null` e abre
 * **outro** pool de dez conexões, sem fechar o anterior. Meia hora editando
 * componente esgota o `max_connections` do Postgres, e o sintoma aparece como
 * erro de conexão em uma tela que não foi tocada.
 *
 * `globalThis` sobrevive à reavaliação de módulo, então o pool é um só.
 */
const CHAVE_GLOBAL = Symbol.for('bancada.banco');

type Conexao = ReturnType<typeof criarBancoCom>;

interface GlobalComBanco {
  [CHAVE_GLOBAL]?: Conexao;
}

function conexao(): Conexao {
  const global = globalThis as GlobalComBanco;
  global[CHAVE_GLOBAL] ??= criarBancoCom(lerAmbiente().DATABASE_URL);
  return global[CHAVE_GLOBAL];
}

export function banco(): Banco {
  return conexao().db;
}

/**
 * Fecha o pool do processo, se houver.
 *
 * Existe para processo de linha de comando terminar em vez de ficar pendurado: o
 * driver mantém socket aberto, e socket aberto é `handle` ativo que impede o Node
 * de sair. A alternativa seria `process.exit`, que mata o que estivesse gravando.
 *
 * Não é para usar em requisição do Next — lá o pool é do processo e vive enquanto
 * o servidor viver.
 */
export async function encerrarBanco(): Promise<void> {
  const global = globalThis as GlobalComBanco;
  const atual = global[CHAVE_GLOBAL];
  if (atual === undefined) return;
  delete global[CHAVE_GLOBAL];
  await atual.encerrar();
}

export { schema };
