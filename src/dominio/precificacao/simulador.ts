/**
 * Simulador de faixa e resolução inversa de preço.
 *
 * A especificação pede: "dado o custo, mostrar a curva de margem por preço e
 * marcar os degraus das três plataformas. Você vê visualmente onde colocar o
 * preço."
 *
 * Marcar os degraus é o ponto. A curva de margem **não é contínua**: no limiar
 * de frete grátis do ML ela cai de degrau, e é exatamente ali que a intuição
 * erra. Um gráfico que interpola por cima do degrau esconde o que o usuário
 * precisa ver.
 */
import { centavos } from '@/lib/dinheiro';
import type { Centavos, PontosBase } from '@/lib/dinheiro';
import { calcularMargem } from './margem';
import {
  FIM_ZONA_MORTA_ML,
  LIMIAR_FAIXA_SHOPEE,
  LIMIAR_FRETE_GRATIS_ML,
  RETOMADA_SAUDAVEL_ML,
  tabelaVigente,
} from './tabelas';
import type { EntradaDeMargem, Plataforma, ResultadoDeMargem } from './tipos';

/** Entrada sem o preço: é o preço que a simulação varre. */
export type EntradaSemPreco = Omit<EntradaDeMargem, 'preco'>;

export interface PontoDaCurva {
  readonly preco: Centavos;
  readonly margemReais: Centavos;
  readonly margemPontosBase: PontosBase;
  readonly repasseLiquido: Centavos;
  /** `true` quando este ponto é a primeira amostra depois de um degrau. */
  readonly logoAposDegrau: boolean;
}

export interface Degrau {
  readonly preco: Centavos;
  readonly rotulo: string;
  readonly plataforma: Plataforma;
}

export interface FaixaRecomendada {
  readonly de: Centavos;
  readonly ate: Centavos;
  readonly motivo: string;
}

export interface SimulacaoDeFaixa {
  readonly pontos: readonly PontoDaCurva[];
  readonly degraus: readonly Degrau[];
  /** Menor preço com margem não negativa. `null` se nenhum na faixa serve. */
  readonly pontoDeEquilibrio: Centavos | null;
  /** Preço de maior margem absoluta na faixa varrida. */
  readonly melhorPreco: Centavos | null;
  readonly faixasRecomendadas: readonly FaixaRecomendada[];
}

export class FaixaDeSimulacaoInvalida extends Error {
  override readonly name = 'FaixaDeSimulacaoInvalida';
}

/**
 * Varre uma faixa de preço e devolve a curva de margem, com os degraus marcados.
 *
 * A amostragem é uniforme, mas **todo degrau é amostrado de propósito** nos dois
 * lados (um centavo antes e no valor exato), para a curva mostrar a queda em vez
 * de passar reto por cima dela.
 */
export function simularFaixa(params: {
  readonly base: EntradaSemPreco;
  readonly de: Centavos;
  readonly ate: Centavos;
  /** Quantidade de amostras uniformes. Os degraus entram além dessas. */
  readonly amostras?: number;
}): SimulacaoDeFaixa {
  const { base, de, ate } = params;
  const amostras = params.amostras ?? 60;

  if (de <= 0) throw new FaixaDeSimulacaoInvalida('o início da faixa precisa ser positivo');
  if (ate < de)
    throw new FaixaDeSimulacaoInvalida('o fim da faixa não pode ser menor que o início');
  if (!Number.isInteger(amostras) || amostras < 2) {
    throw new FaixaDeSimulacaoInvalida('a simulação precisa de pelo menos duas amostras');
  }

  const degraus = degrausDe(base.plataforma, base.em);
  const precos = precosAAmostrar({ de, ate, amostras, degraus });
  const precosDeDegrau = new Set(degraus.map((d) => d.preco));

  const pontos: PontoDaCurva[] = precos.map((preco) => {
    const r = calcularMargem({ ...base, preco });
    return {
      preco,
      margemReais: r.margemReais,
      margemPontosBase: r.margemPontosBase,
      repasseLiquido: r.repasseLiquido,
      logoAposDegrau: precosDeDegrau.has(preco),
    };
  });

  return {
    pontos,
    degraus: degraus.filter((d) => d.preco >= de && d.preco <= ate),
    pontoDeEquilibrio: pontos.find((p) => p.margemReais >= 0)?.preco ?? null,
    melhorPreco: melhorPrecoDe(pontos),
    faixasRecomendadas: faixasRecomendadasDe(base.plataforma, de, ate),
  };
}

/**
 * Menor preço que alcança a margem alvo, ou `null` se nenhum na faixa alcança.
 *
 * Busca binária ingênua não serve: a margem **cai** no degrau de frete grátis, o
 * que quebra a monotonicidade que a busca binária exige. A solução é partir a
 * faixa nos degraus e buscar dentro de cada segmento, onde a margem é monótona,
 * e depois pegar o menor preço entre os segmentos.
 */
export function precoParaMargem(params: {
  readonly base: EntradaSemPreco;
  readonly margemAlvo:
    | { readonly tipo: 'reais'; readonly valor: Centavos }
    | {
        readonly tipo: 'pontos_base';
        readonly valor: PontosBase;
      };
  readonly de?: Centavos;
  readonly ate?: Centavos;
}): Centavos | null {
  const de = params.de ?? centavos(100);
  const ate = params.ate ?? centavos(100_000);

  if (de <= 0) throw new FaixaDeSimulacaoInvalida('o início da faixa precisa ser positivo');
  if (ate < de)
    throw new FaixaDeSimulacaoInvalida('o fim da faixa não pode ser menor que o início');

  const alcanca = (r: ResultadoDeMargem): boolean =>
    params.margemAlvo.tipo === 'reais'
      ? r.margemReais >= params.margemAlvo.valor
      : r.margemPontosBase >= params.margemAlvo.valor;

  const cortes = degrausDe(params.base.plataforma, params.base.em)
    .map((d) => d.preco)
    .filter((p) => p > de && p <= ate)
    .sort((a, b) => a - b);

  // Segmentos monótonos: [de, primeiro degrau − 1], [degrau, próximo − 1], …
  const segmentos: Array<readonly [Centavos, Centavos]> = [];
  let inicio = de;
  for (const corte of cortes) {
    segmentos.push([inicio, centavos(corte - 1)]);
    inicio = corte;
  }
  segmentos.push([inicio, ate]);

  let melhor: Centavos | null = null;

  for (const [segDe, segAte] of segmentos) {
    if (segAte < segDe) continue;
    const achado = menorPrecoNoSegmento({ base: params.base, de: segDe, ate: segAte, alcanca });
    if (achado !== null && (melhor === null || achado < melhor)) melhor = achado;
  }

  return melhor;
}

/** Busca binária dentro de um segmento onde a margem é monótona no preço. */
function menorPrecoNoSegmento(params: {
  readonly base: EntradaSemPreco;
  readonly de: Centavos;
  readonly ate: Centavos;
  readonly alcanca: (r: ResultadoDeMargem) => boolean;
}): Centavos | null {
  const { base, alcanca } = params;

  if (!alcanca(calcularMargem({ ...base, preco: params.ate }))) return null;
  if (alcanca(calcularMargem({ ...base, preco: params.de }))) return params.de;

  let baixo = params.de;
  let alto = params.ate;

  // Invariante: `baixo` não alcança e `alto` alcança. Converge em ~log2(faixa)
  // passos sobre centavos inteiros.
  while (alto - baixo > 1) {
    const meio = centavos(baixo + Math.floor((alto - baixo) / 2));
    if (alcanca(calcularMargem({ ...base, preco: meio }))) {
      alto = meio;
    } else {
      baixo = meio;
    }
  }

  return alto;
}

// ─── Degraus e faixas ────────────────────────────────────────────────────────

/**
 * Preços em que a estrutura de custo da plataforma muda.
 *
 * Vem da tabela vigente, não de constante duplicada, para um ajuste de tabela
 * mover o degrau sem tocar no simulador.
 */
export function degrausDe(plataforma: Plataforma, em?: Date): readonly Degrau[] {
  const tabela = tabelaVigente(plataforma, em);
  const degraus: Degrau[] = [];

  for (const faixa of tabela.custoFixoPorUnidade) {
    if (faixa.ateExclusivo !== null) {
      degraus.push({
        preco: faixa.ateExclusivo,
        rotulo: `muda a taxa fixa por unidade`,
        plataforma,
      });
    }
  }

  if (tabela.limiarFreteGratisObrigatorio !== null) {
    degraus.push({
      preco: tabela.limiarFreteGratisObrigatorio,
      rotulo: 'frete grátis passa a ser bancado pelo vendedor',
      plataforma,
    });
  }

  if (tabela.comissao.tipo === 'por_faixa_de_preco') {
    for (const faixa of tabela.comissao.faixas) {
      if (faixa.ateExclusivo !== null) {
        degraus.push({ preco: faixa.ateExclusivo, rotulo: 'muda a comissão', plataforma });
      }
    }
  }

  // Um mesmo preço pode ser degrau por dois motivos (na Shopee o limiar muda
  // comissão e taxa fixa de uma vez). Juntar os rótulos evita duas marcas
  // sobrepostas no gráfico.
  const porPreco = new Map<number, Degrau>();
  for (const d of degraus) {
    const existente = porPreco.get(d.preco);
    porPreco.set(
      d.preco,
      existente === undefined ? d : { ...existente, rotulo: `${existente.rotulo}; ${d.rotulo}` },
    );
  }

  return [...porPreco.values()].sort((a, b) => a.preco - b.preco);
}

function precosAAmostrar(params: {
  readonly de: Centavos;
  readonly ate: Centavos;
  readonly amostras: number;
  readonly degraus: readonly Degrau[];
}): readonly Centavos[] {
  const { de, ate, amostras, degraus } = params;
  const passo = (ate - de) / (amostras - 1);

  const conjunto = new Set<number>();
  for (let i = 0; i < amostras; i += 1) {
    conjunto.add(Math.round(de + passo * i));
  }

  // O degrau e o centavo anterior a ele. Sem esses dois pontos a curva
  // atravessa a descontinuidade em linha reta e esconde a queda.
  for (const degrau of degraus) {
    if (degrau.preco > de && degrau.preco <= ate) {
      conjunto.add(degrau.preco);
      conjunto.add(degrau.preco - 1);
    }
  }

  return [...conjunto]
    .filter((p) => p >= de && p <= ate && p > 0)
    .sort((a, b) => a - b)
    .map((p) => centavos(p));
}

function melhorPrecoDe(pontos: readonly PontoDaCurva[]): Centavos | null {
  return (
    pontos.reduce<PontoDaCurva | null>(
      (melhor, atual) =>
        melhor === null || atual.margemReais > melhor.margemReais ? atual : melhor,
      null,
    )?.preco ?? null
  );
}

/**
 * Faixas onde vale colocar o preço, por estrutura de custo da plataforma.
 *
 * No ML são duas, e a razão é o degrau: logo abaixo do limiar você paga taxa fixa
 * pequena e o comprador paga o frete; bem acima dele, o frete grátis se dilui no
 * preço. Entre as duas fica a zona morta.
 */
function faixasRecomendadasDe(
  plataforma: Plataforma,
  de: Centavos,
  ate: Centavos,
): readonly FaixaRecomendada[] {
  const candidatas: readonly FaixaRecomendada[] =
    plataforma === 'ml'
      ? [
          {
            de: centavos(5500),
            ate: centavos(LIMIAR_FRETE_GRATIS_ML - 100),
            motivo: 'taxa fixa pequena e frete pago pelo comprador',
          },
          {
            de: RETOMADA_SAUDAVEL_ML,
            ate,
            motivo: 'preço alto o bastante para o frete grátis se diluir',
          },
        ]
      : plataforma === 'shopee'
        ? [
            {
              de: centavos(4000),
              ate: centavos(LIMIAR_FAIXA_SHOPEE - 100),
              motivo: 'comissão maior mas taxa por item pequena e sem programa de frete',
            },
            {
              de: centavos(LIMIAR_FAIXA_SHOPEE + 6000),
              ate,
              motivo: 'comissão cai para 14% e a taxa do programa de frete se dilui',
            },
          ]
        : [{ de, ate, motivo: 'estrutura de custo sem degrau relevante' }];

  return candidatas
    .map((f) => ({ ...f, de: centavos(Math.max(f.de, de)), ate: centavos(Math.min(f.ate, ate)) }))
    .filter((f) => f.ate > f.de);
}

/** Limites da zona morta do ML, para a UI poder sombrear a região no gráfico. */
export const ZONA_MORTA_ML = {
  de: LIMIAR_FRETE_GRATIS_ML,
  ate: FIM_ZONA_MORTA_ML,
} as const;
