/**
 * Manifesto do aplicativo web.
 *
 * É o que permite instalar o leitor na tela inicial do celular e abrir sem barra
 * de navegador — o que importa de verdade para quem vai usar de pé numa loja, com
 * uma mão só.
 *
 * Nome e cor vêm de configuração, nunca de literal (ADR 0003). Um segundo perfil
 * com outra marca não deve exigir tocar neste arquivo.
 */
import type { MetadataRoute } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';

/** Montado a cada pedido, pelo mesmo motivo do layout: a marca é do servidor, não do build. */
export const dynamic = 'force-dynamic';

export default function manifest(): MetadataRoute.Manifest {
  const marca = montarMarca(lerAmbiente());

  return {
    name: marca.nomeSistema,
    short_name: marca.nomeSistema,
    description: 'Hub de operação e inteligência para venda em marketplaces.',
    // `/leitor` e não `/`: quem instala na tela inicial instala para escanear na
    // loja, e mais um toque com o produto na outra mão é um toque de mais.
    start_url: '/leitor',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fafaf9',
    theme_color: marca.visual?.corPrimaria ?? '#1d4ed8',
    icons: [
      {
        // SVG em vez de PNG em vários tamanhos: escala em qualquer densidade e
        // não pede pipeline de imagem. O dia de ter logo de verdade troca aqui.
        src: '/icone.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
