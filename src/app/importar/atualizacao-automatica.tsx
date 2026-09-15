'use client';

/**
 * Recarrega a tela sozinha, quando ligado.
 *
 * O único componente de cliente da tela, e existe por um motivo específico: a
 * pergunta que se faz olhando esta página é "está andando?", e responder isso
 * apertando F5 é pior que uma caixa de seleção.
 *
 * Começa **desligado** de propósito. Aba esquecida aberta com atualização
 * automática vira consulta ao banco a cada poucos segundos para sempre, e quem
 * paga isso não está olhando. Ligar é um clique; deixar ligado é escolha de quem
 * está de fato acompanhando.
 *
 * `router.refresh()` recarrega os Server Components sem perder o que foi digitado
 * no formulário, que é o que um `location.reload()` perderia.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import estilo from './importar.module.css';

export function AtualizacaoAutomatica({ intervaloMs = 5000 }: { readonly intervaloMs?: number }) {
  const router = useRouter();
  const [ligada, setLigada] = useState(false);

  useEffect(() => {
    if (!ligada) return undefined;
    const temporizador = setInterval(() => {
      router.refresh();
    }, intervaloMs);
    return () => {
      clearInterval(temporizador);
    };
  }, [ligada, intervaloMs, router]);

  return (
    <label className={estilo.alternarAuto}>
      <input
        type="checkbox"
        checked={ligada}
        onChange={(evento) => {
          setLigada(evento.target.checked);
        }}
      />
      atualizar a cada {String(Math.round(intervaloMs / 1000))} s
    </label>
  );
}
