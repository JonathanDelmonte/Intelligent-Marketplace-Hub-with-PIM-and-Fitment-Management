import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // O domínio inteiro é TypeScript estrito e testado; um build que passa com
  // erro de tipo esconde exatamente a classe de bug que `strict` existe para
  // pegar. Ver CLAUDE.md, seção 4.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default config;
