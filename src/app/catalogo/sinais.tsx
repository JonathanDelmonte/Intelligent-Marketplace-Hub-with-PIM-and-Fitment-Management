/**
 * Os poucos sinais desenhados da Catálogo e preço: menos, mais, voltar, certo e alerta.
 *
 * Traço fino e da cor do texto em volta (`currentColor`), no tamanho da letra. Decorativos
 * (`aria-hidden`): o texto ao lado ou o `aria-label` do botão é que dizem o que fazem.
 */
import type { ReactNode } from 'react';

function Sinal({
  children,
  tamanho = 16,
}: {
  readonly children: ReactNode;
  readonly tamanho?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={tamanho}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 16 16"
      width={tamanho}
    >
      {children}
    </svg>
  );
}

export function SinalMenos() {
  return (
    <Sinal>
      <path d="M3.5 8h9" />
    </Sinal>
  );
}

export function SinalMais() {
  return (
    <Sinal>
      <path d="M3.5 8h9M8 3.5v9" />
    </Sinal>
  );
}

export function SinalVoltar() {
  return (
    <Sinal tamanho={14}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Sinal>
  );
}

export function SinalCerto() {
  return (
    <Sinal>
      <path d="m3.5 8.5 3 3 6-7" />
    </Sinal>
  );
}

export function SinalAlerta() {
  return (
    <Sinal>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.75v3.75M8 11.1v.15" />
    </Sinal>
  );
}
