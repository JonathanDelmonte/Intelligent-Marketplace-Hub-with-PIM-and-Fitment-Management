import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from './src/config/carregar-env';

/**
 * O `.env` entra antes de a suíte montar, e isto não é conveniência.
 *
 * O vitest não lê `.env` por conta própria, e a consequência era a pior possível:
 * com `DATABASE_URL` no `.env`, correto, os 202 testes de banco **pulavam em
 * silêncio**. O resumo dizia "202 skipped", que é exatamente o que ele diz para
 * quem não configurou banco — então o sinal de "não testei" era idêntico ao de
 * "não tenho banco", e ninguém suspeitaria de estar no primeiro caso.
 */
carregarEnv();

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],

    // Arquivos rodam em série, não em paralelo.
    //
    // Os testes de infraestrutura compartilham UM banco e limpam tabelas no
    // `beforeEach`; em paralelo, o `truncate` de um arquivo apaga as linhas que
    // outro acabou de inserir, e a falha aparece como erro de chave estrangeira
    // sem relação com o que o teste verifica. Isolar por schema por worker seria
    // a alternativa, e não se paga: a suíte inteira roda em poucos segundos.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/dominio/**',
        'src/lib/**',
        'src/plataformas/**',
        // Três arquivos de fora do domínio entram por arquivo, não por pasta: são
        // lógica pura e testável, e ficariam sem bar se ficassem de fora. O resto
        // de `src/infra` fica fora de propósito — migração e semeadura são script,
        // e cobri-los mediria execução de script, não regra.
        'src/infra/log.ts',
        'src/infra/fila/poller.ts',
        'src/app/jobs/apresentacao.ts',
      ],
      // O domínio é onde mora a regra de negócio numérica. Cobertura alta aqui
      // não é vaidade: a saída de `calcularMargem` decide dinheiro.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
