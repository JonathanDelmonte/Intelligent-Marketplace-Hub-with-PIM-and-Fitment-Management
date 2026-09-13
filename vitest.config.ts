import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Carrega o `.env` antes de qualquer teste ser importado. O motivo de ser um
    // arquivo de preparação, e não uma chamada aqui, está escrito nele.
    setupFiles: ['./vitest.setup.ts'],
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
