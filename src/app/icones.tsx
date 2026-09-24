/**
 * Os ícones da barra, desenhados em traço de 24 por 24.
 *
 * Em SVG no próprio código, e não em biblioteca: são dezesseis desenhos simples, e uma
 * dependência de ícones traria centenas para usar dezesseis. O traço herda a cor do
 * texto (`currentColor`), então a mesma peça serve na barra escura e numa tela clara.
 *
 * Todo ícone é decorativo (`aria-hidden`): o rótulo ao lado é que diz o que é. Ícone
 * sem texto seria adivinhação para quem usa leitor de tela.
 */
import type { ReactNode } from 'react';
import type { Icone } from './navegacao';

const DESENHO: Readonly<Record<Icone, ReactNode>> = {
  importar: (
    <>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  visao: (
    <>
      <rect height="9" rx="1.5" width="7" x="3" y="3" />
      <rect height="5" rx="1.5" width="7" x="14" y="3" />
      <rect height="9" rx="1.5" width="7" x="14" y="12" />
      <rect height="5" rx="1.5" width="7" x="3" y="16" />
    </>
  ),
  assistente: (
    <>
      <path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  postar: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  adicionar: <path d="M12 5v14M5 12h14" />,
  catalogo: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  ondeserve: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  publicar: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </>
  ),
  garimpo: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  monitor: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  bipar: (
    <>
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 8v8M10.5 8v8M13 8v8M16 8v8" />
    </>
  ),
  afiliados: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  fornecedores: (
    <>
      <path d="M3 6h11v10H3z" />
      <path d="M14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  consignacao: (
    <>
      <path d="M4 10v10h16V10" />
      <path d="M3 10l2-6h14l2 6" />
      <path d="M9 20v-5h6v5" />
    </>
  ),
  fiscal: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h7M9 17h5" />
    </>
  ),
  negocio: (
    <>
      <rect height="13" rx="2" width="18" x="3" y="7" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M3 13h18" />
    </>
  ),
};

export function IconeDaPorta({
  nome,
  className,
  tamanho = 18,
}: {
  readonly nome: Icone;
  readonly className?: string;
  readonly tamanho?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={tamanho}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={tamanho}
    >
      {DESENHO[nome]}
    </svg>
  );
}
