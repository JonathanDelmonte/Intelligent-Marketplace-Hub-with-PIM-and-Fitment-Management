/**
 * Os sinais desenhados da Catálogo e preço, num traço só.
 *
 * Linha de 1,6 px, cantos redondos e a cor do texto em volta (`currentColor`), no mesmo
 * espírito dos ícones da lateral. Decorativos (`aria-hidden`): o texto ao lado ou o
 * `aria-label` do botão é que dizem o que fazem.
 */
import type { ReactNode } from 'react';

function Sinal({
  children,
  tamanho = 16,
}: {
  readonly children: ReactNode;
  readonly tamanho?: number | undefined;
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
      strokeWidth={1.6}
      viewBox="0 0 16 16"
      width={tamanho}
    >
      {children}
    </svg>
  );
}

export function SinalMais({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
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

export function SinalAvancar({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Sinal>
  );
}

export function SinalCerto({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Sinal>
  );
}

export function SinalFechar({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </Sinal>
  );
}

export function SinalAlerta({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.75v3.75M8 11.1v.15" />
    </Sinal>
  );
}

export function SinalLapis() {
  return (
    <Sinal tamanho={14}>
      <path d="m10.5 2.75 2.75 2.75L6 12.75l-3.25.5.5-3.25z" />
    </Sinal>
  );
}

export function SinalBusca() {
  return (
    <Sinal>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3 3" />
    </Sinal>
  );
}

/** A caixa: o lugar da foto do produto, enquanto o sistema não guarda foto. */
export function SinalCaixa({ tamanho }: { readonly tamanho?: number }) {
  return (
    <Sinal tamanho={tamanho}>
      <path d="M2.75 5.25 8 2.5l5.25 2.75v5.5L8 13.5l-5.25-2.75z" />
      <path d="M2.75 5.25 8 8l5.25-2.75M8 8v5.5" />
    </Sinal>
  );
}

export function SinalEtiqueta() {
  return (
    <Sinal>
      <path d="M2.75 3.5v3.75l6 6 4.5-4.5-6-6H3.5a.75.75 0 0 0-.75.75" />
      <circle cx="5.75" cy="5.75" r=".75" />
    </Sinal>
  );
}

export function SinalSacola() {
  return (
    <Sinal>
      <path d="M3.5 5.5h9l-.75 8h-7.5z" />
      <path d="M5.75 5.5V4.25a2.25 2.25 0 0 1 4.5 0V5.5" />
    </Sinal>
  );
}

export function SinalMoedas() {
  return (
    <Sinal>
      <ellipse cx="6.5" cy="5" rx="3.75" ry="1.75" />
      <path d="M2.75 5v3c0 1 1.7 1.75 3.75 1.75S10.25 9 10.25 8V5" />
      <path d="M6.25 11.5c.4 1.1 2 1.75 3.75 1.75 2.1 0 3.75-.8 3.75-1.75v-3c0-.8-1.1-1.45-2.6-1.7" />
    </Sinal>
  );
}

export function SinalSino() {
  return (
    <Sinal>
      <path d="M4 11V7.25a4 4 0 0 1 8 0V11l1 1.25H3z" />
      <path d="M6.75 13.75a1.4 1.4 0 0 0 2.5 0" />
    </Sinal>
  );
}
