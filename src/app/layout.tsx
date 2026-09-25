import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca, variaveisCssDaMarca } from '@/config/marca';
import { Lateral } from './lateral';
import { descreverVersao } from './versao';
import estilo from './casca.module.css';
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
  const ambiente = lerAmbiente();
  const marca = montarMarca(ambiente);
  const versao = descreverVersao(ambiente.VERSAO, ambiente.VERSAO_EM);

  return (
    <html lang="pt-BR" style={variaveisCssDaMarca(marca.visual)}>
      <body>
        {/*
          Grid de duas colunas: lateral e conteúdo. O rodapé mora **dentro** da coluna de
          conteúdo, e não embaixo das duas, porque crédito e copyright são sobre o que se
          está lendo — embaixo da lateral ele ficaria a quinze telas de distância do texto
          a que se refere.
        */}
        <div className={estilo.casca}>
          <Lateral nomeSistema={marca.nomeSistema} />
          <div className={estilo.conteudo}>
            {children}
            <footer className={estilo.rodape}>
              {marca.copyright}
              {marca.creditoRodape !== null ? ` · ${marca.creditoRodape}` : ''}
              {versao !== null ? ` · ${versao}` : ''}
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
