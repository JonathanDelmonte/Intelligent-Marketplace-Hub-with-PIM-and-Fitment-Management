import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infra/banco/schema/index.ts',
  out: './src/infra/banco/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/bancada',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
