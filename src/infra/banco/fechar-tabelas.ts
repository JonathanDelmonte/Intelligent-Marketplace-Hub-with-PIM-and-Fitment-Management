/**
 * Fecha as tabelas do schema `public` para quem não é o dono delas.
 *
 * O Supabase (ADR 0013) publica o schema `public` pela API REST dele, a "Data API",
 * para quem tiver a chave pública do projeto, e dá a ela acesso a toda tabela nova. O
 * sistema não usa essa API: entra direto no Postgres, como o dono das tabelas. Com o
 * RLS ligado e nenhuma política, a API não lê nem grava linha nenhuma — nem de conta,
 * nem de sessão, nem de credencial —, e o sistema fica como estava, porque o dono não
 * passa pelo RLS.
 *
 * Roda depois de toda migração (`migrar.ts`), então a tabela que uma migração nova
 * criar já sai fechada. Num Postgres sem essa API — o do computador, o do CI, o do
 * servidor próprio — não muda nada para o sistema.
 *
 * Só toca tabela de quem migra: tabela de outro dono (de uma extensão, por exemplo)
 * não é deste sistema, e mexer nela daria erro de permissão.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from './cliente';

const linhas = z.array(z.object({ tabela: z.string() }));

/** Devolve quantas tabelas estavam abertas e foram fechadas agora. */
export async function fecharTabelasParaQuemNaoEDono(db: Banco): Promise<number> {
  const abertas = linhas.parse([
    ...(await db.execute(sql`
      select tablename as tabela
      from pg_tables
      where schemaname = 'public' and tableowner = current_user and not rowsecurity
      order by tablename
    `)),
  ]);
  for (const { tabela } of abertas) {
    await db.execute(
      sql`alter table ${sql.identifier('public')}.${sql.identifier(tabela)} enable row level security`,
    );
  }
  return abertas.length;
}
