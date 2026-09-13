import { defineConfig } from 'drizzle-kit';
import { carregarEnv } from './src/config/carregar-env';

// O `drizzle-kit` é binário próprio e não lê `.env`. Sem isto, `db:generate` e
// `db:studio` rodavam com `DATABASE_URL` ausente.
carregarEnv();

/**
 * Sem `DATABASE_URL`, o alvo é um host que não existe — de propósito.
 *
 * O padrão anterior era `postgres://localhost:5432/bancada`, e isso é pior que
 * falhar: `db:studio` sem variável configurada abriria um editor apontado para
 * **qualquer** Postgres que estivesse na 5432 da máquina, que pode ser o banco de
 * outro projeto. Um host irresolvível falha ruidosamente e não acerta ninguém.
 *
 * `db:generate` não conecta — lê o schema e escreve SQL —, então continua
 * funcionando sem banco nenhum.
 */
const SEM_URL = 'postgres://database-url-nao-configurado.invalid:5432/bancada';

export default defineConfig({
  schema: './src/infra/banco/schema/index.ts',
  out: './src/infra/banco/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? SEM_URL,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
