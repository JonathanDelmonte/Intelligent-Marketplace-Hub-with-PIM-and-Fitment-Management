import type { NextConfig } from 'next';
import { MAX_UPLOAD_BYTES } from './src/config/limites';

const config: NextConfig = {
  reactStrictMode: true,
  // O domínio inteiro é TypeScript estrito e testado; um build que passa com
  // erro de tipo esconde exatamente a classe de bug que `strict` existe para
  // pegar. Ver CLAUDE.md, seção 4.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // O mesmo número que a ação valida em runtime. Ver src/config/limites.ts.
    serverActions: { bodySizeLimit: MAX_UPLOAD_BYTES },
  },
};

export default config;
