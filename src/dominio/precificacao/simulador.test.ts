import { describe, expect, it } from 'vitest';
import { percentualParaPontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import type { Centavos } from '@/lib/dinheiro';
import { calcularMargem } from './margem';
import {
  FaixaDeSimulacaoInvalida,
  ZONA_MORTA_ML,
  degrausDe,
  precoParaMargem,
  simularFaixa,
} from './simulador';
import type { EntradaSemPreco } from './simulador';
import { LIMIAR_FAIXA_SHOPEE, LIMIAR_FRETE_GRATIS_ML } from './tabelas';

const r = reaisParaCentavos;

const base: EntradaSemPreco = {
  plataforma: 'ml',
  tipoAnuncioML: 'classico',
  pesoGramas: 250,
  custoProduto: r(15),
  embalagem: r('1.50'),
  modoFrete: 'comprador_paga',
  taxaDevolucaoEsperada: percentualParaPontosBase(3),
  vendedor: {
    regimeFiscal: 'mei',
    temCnpj: true,
    dasMensal: r('75.90'),
    unidadesPrevistasNoMes: 60,
  },
  em: new Date('2026-09-12T00:00:00Z'),
};

describe('degrausDe', () => {
  it('no ML inclui o limiar de frete grátis e as faixas de taxa fixa', () => {
    const precos = degrausDe('ml').map((d) => d.preco);
    expect(precos).toContain(r(29));
    expect(precos).toContain(r(50));
    expect(precos).toContain(LIMIAR_FRETE_GRATIS_ML);
  });

  it('vem ordenado por preço', () => {
    const precos = degrausDe('ml').map((d) => d.preco);
    expect([...precos].sort((a, b) => a - b)).toEqual(precos);
  });

  it('junta os rótulos quando o mesmo preço é degrau por dois motivos', () => {
    // Na Shopee o limiar muda a comissão e a taxa fixa de uma vez, e duas marcas
    // no mesmo ponto do gráfico ficariam sobrepostas.
    const noLimiar = degrausDe('shopee').filter((d) => d.preco === LIMIAR_FAIXA_SHOPEE);
    expect(noLimiar).toHaveLength(1);
    expect(noLimiar[0]?.rotulo).toContain(';');
  });

  it('na Amazon não há degrau de frete grátis', () => {
    const rotulos = degrausDe('amazon').map((d) => d.rotulo);
    expect(rotulos.some((x) => x.includes('frete grátis'))).toBe(false);
  });
});

describe('simularFaixa', () => {
  it('amostra os dois lados de cada degrau, para a curva mostrar a queda', () => {
    const sim = simularFaixa({ base, de: r(30), ate: r(300), amostras: 20 });
    const precos = new Set(sim.pontos.map((p) => p.preco));
    expect(precos.has(LIMIAR_FRETE_GRATIS_ML)).toBe(true);
    expect(precos.has((LIMIAR_FRETE_GRATIS_ML - 1) as Centavos)).toBe(true);
  });

  it('a curva realmente cai no degrau', () => {
    const sim = simularFaixa({ base, de: r(30), ate: r(300) });
    const antes = sim.pontos.find((p) => p.preco === LIMIAR_FRETE_GRATIS_ML - 1);
    const depois = sim.pontos.find((p) => p.preco === LIMIAR_FRETE_GRATIS_ML);
    expect(antes).toBeDefined();
    expect(depois).toBeDefined();
    expect(depois!.margemReais).toBeLessThan(antes!.margemReais);
  });

  it('marca os pontos que caem exatamente num degrau', () => {
    const sim = simularFaixa({ base, de: r(30), ate: r(300) });
    const noDegrau = sim.pontos.find((p) => p.preco === LIMIAR_FRETE_GRATIS_ML);
    expect(noDegrau?.logoAposDegrau).toBe(true);
    const fora = sim.pontos.find((p) => p.preco === LIMIAR_FRETE_GRATIS_ML - 1);
    expect(fora?.logoAposDegrau).toBe(false);
  });

  it('devolve os pontos em ordem crescente de preço, sem repetição', () => {
    const sim = simularFaixa({ base, de: r(30), ate: r(300) });
    const precos = sim.pontos.map((p) => p.preco);
    expect([...precos].sort((a, b) => a - b)).toEqual(precos);
    expect(new Set(precos).size).toBe(precos.length);
  });

  it('todo ponto fica dentro da faixa pedida', () => {
    const sim = simularFaixa({ base, de: r(50), ate: r(90) });
    for (const p of sim.pontos) {
      expect(p.preco).toBeGreaterThanOrEqual(r(50));
      expect(p.preco).toBeLessThanOrEqual(r(90));
    }
  });

  it('cada ponto concorda com calcularMargem no mesmo preço', () => {
    const sim = simularFaixa({ base, de: r(40), ate: r(200), amostras: 8 });
    for (const ponto of sim.pontos) {
      const direto = calcularMargem({ ...base, preco: ponto.preco });
      expect(ponto.margemReais).toBe(direto.margemReais);
      expect(ponto.repasseLiquido).toBe(direto.repasseLiquido);
    }
  });

  it('acha o ponto de equilíbrio', () => {
    const caro: EntradaSemPreco = { ...base, custoProduto: r(40) };
    const sim = simularFaixa({ base: caro, de: r(10), ate: r(300) });
    expect(sim.pontoDeEquilibrio).not.toBeNull();
    const noEquilibrio = calcularMargem({ ...caro, preco: sim.pontoDeEquilibrio! });
    expect(noEquilibrio.margemReais).toBeGreaterThanOrEqual(0);
  });

  it('devolve equilíbrio nulo quando nenhum preço da faixa dá lucro', () => {
    const impossivel: EntradaSemPreco = { ...base, custoProduto: r(500) };
    const sim = simularFaixa({ base: impossivel, de: r(10), ate: r(100) });
    expect(sim.pontoDeEquilibrio).toBeNull();
  });

  it('o melhor preço da faixa é o de maior margem absoluta', () => {
    const sim = simularFaixa({ base, de: r(30), ate: r(300) });
    const melhor = sim.pontos.find((p) => p.preco === sim.melhorPreco);
    for (const p of sim.pontos) {
      expect(p.margemReais).toBeLessThanOrEqual(melhor!.margemReais);
    }
  });

  it('só devolve degraus que caem dentro da faixa', () => {
    const sim = simularFaixa({ base, de: r(100), ate: r(300) });
    for (const d of sim.degraus) {
      expect(d.preco).toBeGreaterThanOrEqual(r(100));
      expect(d.preco).toBeLessThanOrEqual(r(300));
    }
    expect(sim.degraus.map((d) => d.preco)).not.toContain(r(29));
  });

  it('recomenda as duas faixas boas do ML e exclui a zona morta', () => {
    const sim = simularFaixa({ base, de: r(10), ate: r(400) });
    expect(sim.faixasRecomendadas).toHaveLength(2);

    const [baixa, alta] = sim.faixasRecomendadas;
    expect(baixa!.ate).toBeLessThan(ZONA_MORTA_ML.de);
    expect(alta!.de).toBeGreaterThanOrEqual(ZONA_MORTA_ML.ate);

    for (const faixa of sim.faixasRecomendadas) {
      expect(faixa.de).toBeLessThan(faixa.ate);
    }
  });

  it('recorta as faixas recomendadas pela faixa simulada', () => {
    const sim = simularFaixa({ base, de: r(60), ate: r(75) });
    for (const faixa of sim.faixasRecomendadas) {
      expect(faixa.de).toBeGreaterThanOrEqual(r(60));
      expect(faixa.ate).toBeLessThanOrEqual(r(75));
    }
  });

  it('recusa faixa inválida', () => {
    expect(() => simularFaixa({ base, de: 0 as Centavos, ate: r(100) })).toThrow(
      FaixaDeSimulacaoInvalida,
    );
    expect(() => simularFaixa({ base, de: r(100), ate: r(50) })).toThrow(FaixaDeSimulacaoInvalida);
    expect(() => simularFaixa({ base, de: r(10), ate: r(100), amostras: 1 })).toThrow(
      FaixaDeSimulacaoInvalida,
    );
  });

  it('aceita faixa de um único preço', () => {
    const sim = simularFaixa({ base, de: r(70), ate: r(70) });
    expect(sim.pontos).toHaveLength(1);
    expect(sim.pontos[0]?.preco).toBe(r(70));
  });
});

describe('precoParaMargem', () => {
  it('acha o menor preço que alcança a margem em reais', () => {
    const alvo = r(20);
    const preco = precoParaMargem({ base, margemAlvo: { tipo: 'reais', valor: alvo } });
    expect(preco).not.toBeNull();

    expect(calcularMargem({ ...base, preco: preco! }).margemReais).toBeGreaterThanOrEqual(alvo);
    // Um centavo abaixo não alcança — é o que faz dele o *menor*.
    expect(calcularMargem({ ...base, preco: (preco! - 1) as Centavos }).margemReais).toBeLessThan(
      alvo,
    );
  });

  it('acha o menor preço que alcança a margem percentual', () => {
    const alvo = percentualParaPontosBase(30);
    const preco = precoParaMargem({ base, margemAlvo: { tipo: 'pontos_base', valor: alvo } });
    expect(preco).not.toBeNull();
    expect(calcularMargem({ ...base, preco: preco! }).margemPontosBase).toBeGreaterThanOrEqual(
      alvo,
    );
  });

  it('atravessa o degrau: a resposta pode estar ANTES dele, não depois', () => {
    // É o teste que justifica não usar busca binária simples. Com um alvo
    // alcançável logo abaixo do limiar, a resposta correta é o preço menor —
    // uma busca binária ingênua sobre a faixa inteira poderia devolver um preço
    // depois do degrau.
    const alvo = r(30);
    const preco = precoParaMargem({
      base,
      margemAlvo: { tipo: 'reais', valor: alvo },
      de: r(10),
      ate: r(400),
    });
    expect(preco).not.toBeNull();
    expect(preco!).toBeLessThan(LIMIAR_FRETE_GRATIS_ML);
  });

  it('devolve null quando a margem alvo é inalcançável na faixa', () => {
    const preco = precoParaMargem({
      base,
      margemAlvo: { tipo: 'reais', valor: r(10_000) },
      de: r(10),
      ate: r(300),
    });
    expect(preco).toBeNull();
  });

  it('devolve o início da faixa quando ele já alcança o alvo', () => {
    const preco = precoParaMargem({
      base,
      margemAlvo: { tipo: 'reais', valor: r(1) },
      de: r(60),
      ate: r(300),
    });
    expect(preco).toBe(r(60));
  });

  it('é consistente com simularFaixa no mesmo alvo de equilíbrio', () => {
    const caro: EntradaSemPreco = { ...base, custoProduto: r(40) };
    const viaInverso = precoParaMargem({
      base: caro,
      margemAlvo: { tipo: 'reais', valor: 0 as Centavos },
      de: r(10),
      ate: r(300),
    });
    expect(viaInverso).not.toBeNull();
    expect(calcularMargem({ ...caro, preco: viaInverso! }).margemReais).toBeGreaterThanOrEqual(0);
    expect(
      calcularMargem({ ...caro, preco: (viaInverso! - 1) as Centavos }).margemReais,
    ).toBeLessThan(0);
  });

  it('funciona nas três plataformas', () => {
    // A chave `tipoAnuncioML` está ausente fora do ML, não com `undefined`:
    // `exactOptionalPropertyTypes` distingue as duas coisas de propósito.
    const { tipoAnuncioML: _ml, ...semTipo } = base;
    const bases: readonly EntradaSemPreco[] = [
      base,
      { ...semTipo, plataforma: 'shopee' },
      { ...semTipo, plataforma: 'amazon' },
    ];

    for (const b of bases) {
      const preco = precoParaMargem({
        base: b,
        margemAlvo: { tipo: 'reais', valor: r(15) },
        de: r(10),
        ate: r(500),
      });
      expect(preco, b.plataforma).not.toBeNull();
    }
  });

  it('recusa faixa inválida', () => {
    expect(() =>
      precoParaMargem({ base, margemAlvo: { tipo: 'reais', valor: r(1) }, de: 0 as Centavos }),
    ).toThrow(FaixaDeSimulacaoInvalida);
    expect(() =>
      precoParaMargem({
        base,
        margemAlvo: { tipo: 'reais', valor: r(1) },
        de: r(100),
        ate: r(50),
      }),
    ).toThrow(FaixaDeSimulacaoInvalida);
  });
});
