/**
 * O selo da loja: a sigla sobre as cores da plataforma.
 *
 * Decorativo de propósito (`aria-hidden`): o nome da loja vem sempre escrito ao lado, e
 * o selo é o atalho para quem bate o olho.
 */
import type { IdentidadeDaLoja } from './identidade';

export function Selo({
  identidade,
  tamanho,
  className,
}: {
  readonly identidade: IdentidadeDaLoja;
  /** Lado do quadrado, em pixels. */
  readonly tamanho: number;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        alignItems: 'center',
        background: identidade.fundo,
        borderRadius: Math.round(tamanho * 0.27),
        color: identidade.texto,
        display: 'inline-flex',
        flex: 'none',
        fontSize: Math.max(9, Math.round(tamanho * 0.38)),
        fontWeight: 700,
        height: tamanho,
        justifyContent: 'center',
        letterSpacing: '-0.02em',
        lineHeight: 1,
        width: tamanho,
      }}
    >
      {identidade.sigla}
    </span>
  );
}
