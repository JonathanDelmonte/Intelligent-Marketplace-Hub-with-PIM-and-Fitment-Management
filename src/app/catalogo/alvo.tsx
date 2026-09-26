'use client';

/**
 * "Quero ficar com R$ 20 de cada R$ 100 vendidos": o número que decide os preços.
 *
 * Um controle só para a tabela inteira (e para a conta do produto), porque a decisão é
 * uma só: quanto a pessoa quer que sobre. Menos opção na tela é decisão mais rápida (lei
 * de Hick), e mexer aqui refaz todos os preços na hora, que é o jeito de uma tela ensinar
 * sem texto: causa e efeito, lado a lado.
 *
 * Dito em reais de cada R$ 100, e não em percentual. É o mesmo número, e é o que quem
 * nunca calculou margem entende de primeira.
 */
import { useId, useState } from 'react';
import estilo from './catalogo.module.css';
import { ALVO_MAXIMO_BP, ALVO_MINIMO_BP, limitarAlvo } from './conta';
import { SinalMais, SinalMenos } from './sinais';

/** O texto digitado virando alvo, ou `null` enquanto não é um número inteiro da faixa. */
function lerDigitado(texto: string): number | null {
  if (!/^\d{1,2}$/.test(texto.trim())) return null;
  const bp = Number(texto.trim()) * 100;
  return bp < ALVO_MINIMO_BP || bp > ALVO_MAXIMO_BP ? null : bp;
}

export function SeletorDeAlvo({
  alvoBp,
  aoMudar,
}: {
  readonly alvoBp: number;
  readonly aoMudar: (alvoBp: number) => void;
}) {
  const id = useId();
  // O que a pessoa está digitando, enquanto digita. `null` mostra o alvo de verdade: sem
  // isso, apagar o número para escrever outro seria impossível, porque o campo vazio
  // voltaria na hora para o valor anterior.
  const [rascunho, setRascunho] = useState<string | null>(null);

  const passo = (reais: number) => {
    setRascunho(null);
    aoMudar(limitarAlvo(alvoBp + reais * 100));
  };

  return (
    <div className={estilo.alvo}>
      <label className={estilo.alvoTexto} htmlFor={id}>
        Quero ficar com
      </label>
      <span className={estilo.passo}>
        <button
          aria-label="Um real a menos"
          className={estilo.passoBotao}
          disabled={alvoBp <= ALVO_MINIMO_BP}
          onClick={() => passo(-1)}
          type="button"
        >
          <SinalMenos />
        </button>
        <span aria-hidden="true" className={estilo.passoMoeda}>
          R$
        </span>
        <input
          aria-describedby={`${id}-de-cada`}
          className={estilo.passoCampo}
          id={id}
          inputMode="numeric"
          maxLength={2}
          onBlur={() => setRascunho(null)}
          onChange={(evento) => {
            const texto = evento.target.value;
            setRascunho(texto);
            const lido = lerDigitado(texto);
            if (lido !== null) aoMudar(lido);
          }}
          value={rascunho ?? String(Math.round(alvoBp / 100))}
        />
        <button
          aria-label="Um real a mais"
          className={estilo.passoBotao}
          disabled={alvoBp >= ALVO_MAXIMO_BP}
          onClick={() => passo(1)}
          type="button"
        >
          <SinalMais />
        </button>
      </span>
      <span className={estilo.alvoTexto} id={`${id}-de-cada`}>
        de cada R$&nbsp;100 vendidos
      </span>
    </div>
  );
}
