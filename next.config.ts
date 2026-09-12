import type { NextConfig } from 'next';
import { MAX_UPLOAD_BYTES } from './src/config/limites';

const config: NextConfig = {
  reactStrictMode: true,
  // O domínio inteiro é TypeScript estrito e testado; um build que passa com
  // erro de tipo esconde exatamente a classe de bug que `strict` existe para
  // pegar. Ver CLAUDE.md, seção 4.
  typescript: { ignoreBuildErrors: false },
  /**
   * O Next não escreve no `CLAUDE.md` deste repositório.
   *
   * `next dev` e `next build` anexam um bloco de instruções para agentes ao
   * `CLAUDE.md` do projeto. Aqui esse arquivo é a **fonte da verdade das
   * convenções** — inclusive da regra de autoria de commit da seção 1 —, e ferramenta
   * que edita sozinha o documento que define as regras é o começo de um problema que
   * ninguém percebe: o bloco reaparece a cada build, entra num commit distraído, e
   * dali em diante a diferença entre o que o dono escreveu e o que a ferramenta
   * escreveu deixa de ser visível.
   *
   * A orientação útil que o bloco trazia está registrada no diário, e não se perde:
   * esta versão do Next tem mudanças que quebram compatibilidade, e a referência é
   * `node_modules/next/dist/docs/`.
   */
  agentRules: false,
  experimental: {
    // O mesmo número que a ação valida em runtime. Ver src/config/limites.ts.
    serverActions: { bodySizeLimit: MAX_UPLOAD_BYTES },
  },
};

export default config;
