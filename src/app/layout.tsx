import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca, variaveisCssDaMarca } from '@/config/marca';
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
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const marca = montarMarca(lerAmbiente());

  return (
    <html lang="pt-BR" style={variaveisCssDaMarca(marca.visual)}>
      <body>
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
