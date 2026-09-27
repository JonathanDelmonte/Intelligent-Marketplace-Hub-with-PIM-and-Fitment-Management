'use client';

/**
 * A meta de lucro: quanto a pessoa quer ganhar, do jeito que ela quiser.
 *
 * Três jeitos de mexer no mesmo número: digitar (qualquer valor, com vírgula), arrastar a
 * régua, ou trocar a unidade entre percentual do preço e reais por venda. A versão
 * anterior prendia a meta em reais inteiros de cada R$ 100, com dois botões de mais e
 * menos, e o campo nem parecia editável: o dono perguntou por que não podia pôr o número
 * que quisesse, e a resposta honesta era que não havia motivo.
 */
import { useId, useState } from 'react';
import { centavos, centavosParaDigitar, lerReaisDigitados } from '@/lib/dinheiro';
import estilo from './catalogo.module.css';
import { metaValida, type Meta } from './conta';

/** Até onde a régua vai. Digitando, a meta pode passar disso. */
const REGUA = {
  percentual: { de: 1, ate: 60, passo: 0.5 },
  reais: { de: 1, ate: 100, passo: 0.5 },
} as const;

/** A meta como aparece no campo: "20", "22,5", "12,00". */
function textoDoCampo(meta: Meta): string {
  return meta.tipo === 'percentual'
    ? (meta.bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
    : centavosParaDigitar(centavos(meta.centavos));
}

/** O texto digitado virando meta, ou `null` enquanto não é uma meta que faz sentido. */
function lerDigitado(texto: string, tipo: Meta['tipo']): Meta | null {
  if (tipo === 'reais') {
    const valor = lerReaisDigitados(texto);
    const meta: Meta | null = valor === null ? null : { tipo: 'reais', centavos: valor };
    return meta !== null && metaValida(meta) ? meta : null;
  }
  const numero = Number.parseFloat(texto.trim().replace(',', '.'));
  if (!Number.isFinite(numero)) return null;
  const meta: Meta = { tipo: 'percentual', bp: Math.round(numero * 100) };
  return metaValida(meta) ? meta : null;
}

/** O valor da meta na régua, na unidade que a régua mostra: percentual, ou reais. */
function valorNaRegua(meta: Meta): number {
  return meta.tipo === 'percentual' ? meta.bp / 100 : meta.centavos / 100;
}

export function ControleDaMeta({
  meta,
  aoMudar,
}: {
  readonly meta: Meta;
  readonly aoMudar: (meta: Meta) => void;
}) {
  const id = useId();
  // O que está sendo digitado, enquanto é digitado: apagar o número para escrever outro
  // não pode fazer o campo voltar na hora para o valor anterior.
  const [rascunho, setRascunho] = useState<string | null>(null);
  const regua = REGUA[meta.tipo];
  const naRegua = Math.min(regua.ate, Math.max(regua.de, valorNaRegua(meta)));
  const progresso = ((naRegua - regua.de) / (regua.ate - regua.de)) * 100;
  const invalido = rascunho !== null && lerDigitado(rascunho, meta.tipo) === null;

  const trocarUnidade = (tipo: Meta['tipo']) => {
    if (tipo === meta.tipo) return;
    setRascunho(null);
    aoMudar(tipo === 'percentual' ? { tipo, bp: 2_000 } : { tipo, centavos: 1_000 });
  };

  return (
    <div className={estilo.meta}>
      <div className={estilo.metaTopo}>
        <label className={estilo.metaRotulo} htmlFor={id}>
          Quero ganhar
        </label>
        <div aria-label="Como medir a meta" className={estilo.alternador} role="radiogroup">
          <button
            aria-checked={meta.tipo === 'percentual'}
            className={meta.tipo === 'percentual' ? estilo.alternadorAtual : estilo.alternadorOpcao}
            onClick={() => trocarUnidade('percentual')}
            role="radio"
            type="button"
          >
            % do preço
          </button>
          <button
            aria-checked={meta.tipo === 'reais'}
            className={meta.tipo === 'reais' ? estilo.alternadorAtual : estilo.alternadorOpcao}
            onClick={() => trocarUnidade('reais')}
            role="radio"
            type="button"
          >
            R$ por venda
          </button>
        </div>
      </div>
      <div className={estilo.metaLinha}>
        <span className={invalido ? estilo.metaCampoInvalido : estilo.metaCampo}>
          {meta.tipo === 'reais' ? (
            <span aria-hidden="true" className={estilo.metaUnidade}>
              R$
            </span>
          ) : null}
          <input
            aria-invalid={invalido}
            className={estilo.metaEntrada}
            id={id}
            inputMode="decimal"
            onBlur={() => setRascunho(null)}
            onChange={(evento) => {
              const texto = evento.target.value;
              setRascunho(texto);
              const lida = lerDigitado(texto, meta.tipo);
              if (lida !== null) aoMudar(lida);
            }}
            value={rascunho ?? textoDoCampo(meta)}
          />
          {meta.tipo === 'percentual' ? (
            <span aria-hidden="true" className={estilo.metaUnidade}>
              %
            </span>
          ) : null}
        </span>
        <input
          aria-label="Arrastar a meta"
          className={estilo.metaRegua}
          max={regua.ate}
          min={regua.de}
          onChange={(evento) => {
            setRascunho(null);
            const valor = Number(evento.target.value);
            aoMudar(
              meta.tipo === 'percentual'
                ? { tipo: 'percentual', bp: Math.round(valor * 100) }
                : { tipo: 'reais', centavos: Math.round(valor * 100) },
            );
          }}
          step={regua.passo}
          style={{ ['--progresso' as string]: `${String(progresso)}%` }}
          type="range"
          value={naRegua}
        />
      </div>
    </div>
  );
}
