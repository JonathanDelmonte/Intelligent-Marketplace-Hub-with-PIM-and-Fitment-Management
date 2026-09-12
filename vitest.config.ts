import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
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
