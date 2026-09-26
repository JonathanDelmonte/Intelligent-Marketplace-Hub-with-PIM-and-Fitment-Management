/**
 * A casca da Catálogo e preço: só carrega as fontes do desenho novo.
 *
 * IBM Plex Sans no texto e IBM Plex Mono nos números do cupom, com licença livre (OFL) e
 * servidas daqui mesmo, sem pedir nada a serviço de fora. Carregam só nesta tela enquanto
 * o desenho novo é piloto; aprovado, sobem para o layout do sistema. Só o subconjunto
 * latino, que tem todo acento do português: 22 KB por peso.
 */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import type { ReactNode } from 'react';

export default function LayoutDoCatalogo({ children }: { readonly children: ReactNode }) {
  return children;
}
