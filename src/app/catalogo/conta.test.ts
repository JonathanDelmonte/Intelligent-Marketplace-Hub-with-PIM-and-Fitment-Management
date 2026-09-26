import { describe, expect, it } from 'vitest';
import { calcularMargem } from '@/dominio/precificacao/margem';
import type { ContextoDoVendedor, ResultadoDeMargem } from '@/dominio/precificacao/tipos';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  avisosDaConta,
  celulasDoProduto,
  contaDaVenda,
  ficaDeCadaCem,
  fraseDoAlvo,
  limitarAlvo,
  linhasDoCupom,
  montarConta,
  notaDoEstimado,
  precoParaFicarCom,
  precoSemPrejuizo,
  reaisCurtos,
  reguaDaConta,
  type CenarioDaConta,
  type FichaDaConta,
} from './conta';

const r = reaisParaCentavos;

/** O formatador põe espaço que não quebra entre "R$" e o número; aqui, espaço comum. */
const simples = (texto: string): string => texto.replace(/\u00a0/g, ' ');

const vendedor: ContextoDoVendedor = {
  regimeFiscal: 'mei',
  temCnpj: true,
  dasMensal: r('75.90'),
  unidadesPrevistasNoMes: 60,
};

const ficha: FichaDaConta = { custo: 1_840, pesoG: 420, devolucaoBp: 200, categoriaMl: null };

const EM = new Date('2026-09-26T12:00:00Z');

const cenario: CenarioDaConta = {
  plataforma: 'ml',
  tipoAnuncioML: 'classico',
  modoFrete: 'comprador_paga',
  vendedor,
  em: EM,
};

describe('preço para ficar com o alvo', () => {
  it('o preço achado deixa o alvo, e um centavo a menos não deixa', () => {
    const preco = precoParaFicarCom(ficha, cenario, 2_000);
    expect(preco).not.toBeNull();
    if (preco === null) return;
    const conta = contaDaVenda(ficha, cenario, preco);
    expect(conta?.margemPontosBase).toBeGreaterThanOrEqual(2_000);
    const antes = contaDaVenda(ficha, cenario, centavos(preco - 1));
    expect(antes?.margemPontosBase ?? 0).toBeLessThan(2_000);
  });

  it('alvo maior pede preço maior', () => {
    const vinte = precoParaFicarCom(ficha, cenario, 2_000) ?? 0;
    const trinta = precoParaFicarCom(ficha, cenario, 3_000) ?? 0;
    expect(trinta).toBeGreaterThan(vinte);
  });

  it('sem custo não há preço: custo zero presumido daria um preço bonito e falso', () => {
    const semCusto = { ...ficha, custo: null };
    expect(precoParaFicarCom(semCusto, cenario, 2_000)).toBeNull();
    expect(precoSemPrejuizo(semCusto, cenario)).toBeNull();
  });

  it('o preço sem prejuízo fica abaixo do preço do alvo', () => {
    const empate = precoSemPrejuizo(ficha, cenario) ?? 0;
    expect(empate).toBeGreaterThan(0);
    expect(empate).toBeLessThan(precoParaFicarCom(ficha, cenario, 2_000) ?? 0);
  });

  it('peça cara acha preço acima dos R$ 500 que a tela antiga varria', () => {
    const cara = { ...ficha, custo: r(420) };
    expect(precoParaFicarCom(cara, cenario, 2_000)).toBeGreaterThan(r(500));
  });

  it('preço zero não vira conta', () => {
    expect(contaDaVenda(ficha, cenario, centavos(0))).toBeNull();
  });
});

describe('o alvo', () => {
  it('fica entre R$ 1 e R$ 90 de cada R$ 100, em reais inteiros', () => {
    expect(limitarAlvo(0)).toBe(100);
    expect(limitarAlvo(2_040)).toBe(2_000);
    expect(limitarAlvo(9_900)).toBe(9_000);
  });

  it('é dito em reais de cada R$ 100, que é como se entende', () => {
    expect(simples(fraseDoAlvo(2_000))).toBe('R$ 20 de cada R$ 100 vendidos');
    expect(simples(ficaDeCadaCem(2_480))).toBe('R$ 25 de cada R$ 100');
    expect(simples(ficaDeCadaCem(-730))).toBe('R$ 7 de cada R$ 100');
  });

  it('real redondo sai sem centavos, e quebrado sai com', () => {
    expect(simples(reaisCurtos(r(79)))).toBe('R$ 79');
    expect(simples(reaisCurtos(r('39.90')))).toBe('R$ 39,90');
  });
});

describe('a tabela de preços', () => {
  it('pede um preço por loja e compara com o que a pessoa cobra', () => {
    const celulas = celulasDoProduto({
      ficha,
      vendas: { ml: { unidades: 4, faturamento: r(120) } },
      alvoBp: 2_000,
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
      em: EM,
    });
    expect(celulas.map((c) => c.plataforma)).toEqual(['ml', 'shopee', 'amazon']);
    const ml = celulas[0];
    expect(ml?.cobre.tipo).toBe('preco');
    expect(ml?.voceCobra).toBe(r(30));
    expect(ml?.unidades).toBe(4);
    // R$ 30 de média está abaixo do preço que deixa R$ 20 de cada R$ 100.
    expect(ml?.abaixo).toBe(true);
    expect(celulas[1]?.voceCobra).toBeNull();
    expect(celulas[1]?.abaixo).toBe(false);
  });

  it('sem custo, toda loja espera o custo, e a venda de verdade continua aparecendo', () => {
    const celulas = celulasDoProduto({
      ficha: { ...ficha, custo: null },
      vendas: { shopee: { unidades: 2, faturamento: r(90) } },
      alvoBp: 2_000,
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
    });
    expect(celulas.every((c) => c.cobre.tipo === 'sem_custo')).toBe(true);
    expect(celulas[1]?.voceCobra).toBe(r(45));
    expect(celulas[1]?.abaixo).toBe(false);
  });
});

function contaA(preco: number, custo = ficha.custo): ResultadoDeMargem {
  const base = montarConta({ ...ficha, custo }, cenario).base;
  return calcularMargem({ ...base, preco: centavos(preco) });
}

describe('a régua do dinheiro', () => {
  it('começa pelo que fica com você, e as partes somam o preço', () => {
    const conta = contaA(r(60));
    const regua = reguaDaConta(conta);
    expect(regua.partes[0]?.chave).toBe('fica');
    expect(regua.partes.reduce((t, p) => t + p.valor, 0)).toBe(conta.preco);
    expect(regua.partes.reduce((t, p) => t + p.fracao, 0)).toBeCloseTo(1, 5);
    expect(regua.fimDoPreco).toBe(1);
    expect(regua.perde).toBe(0);
  });

  it('com prejuízo, a régua são os custos, e o preço termina antes do fim', () => {
    const conta = contaA(r(20), r(30));
    const regua = reguaDaConta(conta);
    expect(regua.partes.some((p) => p.chave === 'fica')).toBe(false);
    expect(regua.partes.reduce((t, p) => t + p.fracao, 0)).toBeCloseTo(1, 5);
    expect(regua.perde).toBe(0 - conta.margemReais);
    expect(regua.fimDoPreco).toBeCloseTo(conta.preco / (conta.preco + regua.perde), 5);
  });
});

describe('o cupom', () => {
  it('diz a taxa com o nome da loja, marca o estimado e esconde o que é zero', () => {
    const conta = contaA(r(60));
    const linhas = linhasDoCupom(conta, 'ml', ['embalagem']);
    expect(linhas[0]?.rotulo).toBe('Taxa do Mercado Livre');
    expect(linhas.find((l) => l.rotulo === 'Embalagem')?.presumido).toBe('embalagem');
    expect(linhas.find((l) => l.rotulo === 'O produto')?.presumido).toBeNull();
    expect(linhas.find((l) => l.rotulo === 'O produto')?.valor).toBe(1_840);
    expect(linhas.every((l) => l.valor > 0)).toBe(true);
  });

  it('o rodapé diz o que foi estimado, com o número usado', () => {
    const conta = contaA(r(60));
    expect(
      simples(notaDoEstimado(linhasDoCupom(conta, 'ml', ['embalagem', 'devolucao'])) ?? ''),
    ).toBe('Estimado: embalagem de R$ 1,50 e devolução de 2 em cada 100 vendas.');
    expect(notaDoEstimado(linhasDoCupom(conta, 'ml', []))).toBeNull();
  });

  it('as linhas mais o que fica fecham o preço', () => {
    const conta = contaA(r(60));
    const saidas = linhasDoCupom(conta, 'ml', []).reduce((t, l) => t + l.valor, 0);
    expect(saidas + conta.margemReais).toBe(conta.preco);
  });
});

describe('os avisos', () => {
  it('falam português de balcão, sem travessão, e deixam de fora o que a tela já diz', () => {
    const conta = contaA(r(20), r(30));
    const avisos = avisosDaConta(conta);
    expect(avisos.some((a) => a.codigo === 'margem_negativa')).toBe(false);
    expect(avisos.some((a) => a.codigo === 'tabela_presumida')).toBe(false);
    for (const aviso of avisos) {
      expect(aviso.texto).not.toMatch(/[—–]/);
      expect(aviso.texto).not.toMatch(/markup|ticket/i);
    }
  });

  it('o mais grave vem primeiro', () => {
    const conta = contaA(r(90));
    const tons = avisosDaConta(conta).map((a) => a.tom);
    const peso = { erro: 0, atencao: 1, nota: 2 } as const;
    expect([...tons].sort((a, b) => peso[a] - peso[b])).toEqual(tons);
  });
});
