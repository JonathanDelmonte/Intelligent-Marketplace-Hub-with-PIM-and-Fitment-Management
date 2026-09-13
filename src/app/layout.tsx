import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca, variaveisCssDaMarca } from '@/config/marca';
import { PORTAS } from './navegacao';
import './globals.css';

/**
 * O título e o autor vêm de configuração, nunca de literal — é a regra da seção
 * 1.2 da especificação aplicada até no `<head>`.
 */
export function generateMetadata(): Metadata {
  const marca = montarMarca(lerAmbiente());
  return {
    title: { default: marca.nomeSistema, template: `%s · ${marca.nomeSistema}` },
    description: 'Hub de operação e inteligência para venda em marketplaces.',
    authors: [{ name: marca.metaAutor }],
    applicationName: marca.nomeSistema,
    /**
     * Ícone declarado, senão o navegador pede `/favicon.ico` — que não existe, e o
     * 404 aparecia no console de **toda** página do sistema. O SVG é o mesmo que o
     * manifesto da PWA usa, então não há segundo arquivo para manter em sincronia.
     */
    icons: { icon: '/icone.svg' },
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const marca = montarMarca(lerAmbiente());

  return (
    <html lang="pt-BR" style={variaveisCssDaMarca(marca.visual)}>
      <body>
        <header
          style={{
            alignItems: 'center',
            borderBottom: '1px solid var(--cor-borda)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            padding: '0.875rem 1.5rem',
          }}
        >
          <strong>{marca.nomeSistema}</strong>
          {/*
           * `flexWrap` não é enfeite: a barra é uma linha de `flex` e, com cinco
           * portas, ela passava de 390px e a página inteira ganhava rolagem
           * horizontal — em todas as telas, não só na nova. Medido no navegador ao
           * acrescentar a quinta porta. Uma linha de `flex` que não quebra é uma
           * largura mínima escondida.
           */}
          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.875rem' }}>
            {PORTAS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.rotulo}
              </Link>
            ))}
          </nav>
        </header>
        {children}
        <footer
          style={{
            borderTop: '1px solid var(--cor-borda)',
            color: 'var(--cor-texto-fraco)',
            fontSize: '0.8125rem',
            marginTop: '3rem',
            padding: '1.25rem 1.5rem',
          }}
        >
          {marca.copyright}
          {marca.creditoRodape !== null ? ` · ${marca.creditoRodape}` : ''}
        </footer>
      </body>
    </html>
  );
}
