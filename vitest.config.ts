import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
      include: ['src/dominio/**', 'src/lib/**', 'src/plataformas/**'],
      // O domínio é onde mora a regra de negócio numérica. Cobertura alta aqui
      // não é vaidade: a saída de `calcularMargem` decide dinheiro.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
