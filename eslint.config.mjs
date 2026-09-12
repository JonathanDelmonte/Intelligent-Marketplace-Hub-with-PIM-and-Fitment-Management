import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'src/infra/banco/migrations/**',
      // Service worker: JavaScript de navegador, com globais que não existem no
      // programa do tsconfig (`self`, `caches`, `clients`). Verificá-lo com as
      // regras do projeto exigiria um segundo tsconfig só para ele.
      'public/sw.js',
      'next-env.d.ts',
    ],
  },

  js.configs.recommended,

  // O preset do Next define o parser dele no nível global. Ele vem antes do
  // bloco de TypeScript de propósito: o bloco abaixo reafirma o parser do
  // typescript-eslint, que é o único que alimenta as regras com tipo.
  ...next,

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Dinheiro é centavo inteiro e percentual é ponto-base (ADR 0004). Um
      // `number` cru onde se espera `Centavos` é bug silencioso, então a marca
      // de tipo não pode ser apagada com `as` nem com `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Configuração e script em JavaScript puro não estão no programa do tsconfig,
  // então regra que exige tipo não tem como rodar neles.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },

  // Scripts de linha de comando e migração escrevem em stdout por contrato.
  {
    files: ['scripts/**/*.ts', 'src/infra/banco/migrar.ts', 'src/infra/banco/semear.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
