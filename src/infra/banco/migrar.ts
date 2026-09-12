/**
 * Aplica as migrations pendentes.
 *
 * Roda `CREATE EXTENSION` antes das migrations porque a primeira delas cria uma
 * coluna `vector`, e sem a extensão isso falha com um erro que não diz o que
 * fazer. `pgcrypto` é o que dá `gen_random_uuid()` em Postgres anterior ao 13.
 *
 * Os avisos do driver ficam silenciados. Rodar de novo produz uma sequência de
 * `NOTICE: ... already exists, skipping`, que é exatamente o que `IF NOT EXISTS`
 * significa — e cada um sai como objeto de várias linhas, com `file`, `line` e
 * `routine`. Vinte linhas de despejo que parecem erro são como se perde o erro de
 * verdade no meio. Falha continua saindo, e sai ruidosa.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { criarBancoCom } from './cliente';
import { lerAmbiente } from '@/config/ambiente';

async function principal(): Promise<void> {
  const { db, encerrar } = criarBancoCom(lerAmbiente().DATABASE_URL, { silenciarAvisos: true });

  console.log('Habilitando extensões…');
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  console.log('Aplicando migrations…');
  await migrate(db, { migrationsFolder: './src/infra/banco/migrations' });

  console.log('Banco atualizado.');
  await encerrar();
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    console.error('Falha ao migrar:', erro);
    process.exit(1);
  },
);
