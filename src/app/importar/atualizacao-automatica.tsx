'use client';

/**
 * Atualiza a tela sozinha enquanto há entrada andando.
 *
 * A pergunta que se faz olhando esta tela é "já foi?", e responder isso apertando F5 é
 * trabalho que o sistema pode fazer. Quem decide se há o que acompanhar é a página, no
 * servidor (`ativa`, de `haEntradaAndando`): com entrada pronta ou rodando, a tela
 * recarrega a cada poucos segundos; quando tudo termina, a recarga seguinte já chega com
 * `ativa` falso, e o relógio para. Aba esquecida com a fila parada não consulta o banco.
 *
 * Com a aba escondida, também não: o relógio segue, mas não recarrega nada, e quando a
 * aba volta a tela recarrega na hora.
 *
 * Antes era uma caixa de seleção, desligada de propósito para a aba esquecida não
 * consultar o banco para sempre. Parar sozinha resolve isso melhor, e ninguém mais
 * precisa lembrar de ligar (diário, 26/09).
 *
 * `router.refresh()` recarrega os Server Components sem perder o que foi digitado no
 * formulário, que é o que um `location.reload()` perderia.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import estilo from './importar.module.css';

export function AtualizacaoAutomatica({
  ativa,
  intervaloMs = 3000,
}: {
  readonly ativa: boolean;
  readonly intervaloMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!ativa) return undefined;
    const recarregar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const temporizador = setInterval(recarregar, intervaloMs);
    document.addEventListener('visibilitychange', recarregar);
    return () => {
      clearInterval(temporizador);
      document.removeEventListener('visibilitychange', recarregar);
    };
  }, [ativa, intervaloMs, router]);

  if (!ativa) return null;
  return (
    <span className={estilo.alternarAuto} role="status">
      atualizando sozinha enquanto há entrada andando
    </span>
  );
}
