/**
 * Aplica as migrations pendentes.
 *
 * Roda `CREATE EXTENSION` antes das migrations porque a primeira delas cria uma
 * coluna `vector`, e sem a extensão isso falha com um erro que não diz o que
 * fazer. `pgcrypto` é o que dá `gen_random_uuid()` em Postgres anterior ao 13.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { banco } from './cliente';

async function principal(): Promise<void> {
  const db = banco();

  console.log('Habilitando extensões…');
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  console.log('Aplicando migrations…');
  await migrate(db, { migrationsFolder: './src/infra/banco/migrations' });

  console.log('Banco atualizado.');
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    console.error('Falha ao migrar:', erro);
    process.exit(1);
  },
);
