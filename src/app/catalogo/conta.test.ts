import { describe, expect, it } from 'vitest';
import { calcularMargem } from '@/dominio/precificacao/margem';
import type { ContextoDoVendedor, ResultadoDeMargem } from '@/dominio/precificacao/tipos';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  alcancaMeta,
  avisosDaConta,
  celulasDoProduto,
  contaDaVenda,
  curvaDeLucro,
  divisaoDoDinheiro,
  faixaDoGrafico,
  META_PADRAO,
  metaValida,
  montarConta,
  notaDoEstimado,
  numerosDoCatalogo,
  percentual,
  precoParaMeta,
  precoSemPrejuizo,
  reaisCurtos,
  situacaoDoProduto,
  textoDaMeta,
  type CelulaDaTabela,
  type CenarioDaConta,
  type FichaDaConta,
  type Meta,
  type VendaNaLoja,
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

const VINTE_POR_CENTO: Meta = { tipo: 'percentual', bp: 2_000 };
const DOZE_REAIS: Meta = { tipo: 'reais', centavos: 1_200 };

/** Uma venda de loja, com a margem dos pedidos todos conhecida. */
const venda = (unidades: number, faturamento: number, margem = 0): VendaNaLoja => ({
  unidades,
  faturamento,
  margem,
  faturamentoComMargem: margem === 0 ? 0 : faturamento,
  unidadesComMargem: margem === 0 ? 0 : unidades,
});

describe('o preço para a meta', () => {
  it('em percentual: o preço achado alcança a meta, e um centavo a menos não', () => {
    const preco = precoParaMeta(ficha, cenario, VINTE_POR_CENTO);
    expect(preco).not.toBeNull();
    if (preco === null) return;
    expect(contaDaVenda(ficha, cenario, preco)?.margemPontosBase).toBeGreaterThanOrEqual(2_000);
    const antes = contaDaVenda(ficha, cenario, centavos(preco - 1));
    expect(antes?.margemPontosBase ?? 0).toBeLessThan(2_000);
  });

  it('em reais: o preço achado deixa os reais pedidos em cada venda', () => {
    const preco = precoParaMeta(ficha, cenario, DOZE_REAIS);
    expect(preco).not.toBeNull();
    if (preco === null) return;
    expect(contaDaVenda(ficha, cenario, preco)?.margemReais).toBeGreaterThanOrEqual(1_200);
    const antes = contaDaVenda(ficha, cenario, centavos(preco - 1));
    expect(antes?.margemReais ?? 0).toBeLessThan(1_200);
  });

  it('meta maior pede preço maior, nas duas unidades', () => {
    const vinte = precoParaMeta(ficha, cenario, VINTE_POR_CENTO) ?? 0;
    const trinta = precoParaMeta(ficha, cenario, { tipo: 'percentual', bp: 3_000 }) ?? 0;
    expect(trinta).toBeGreaterThan(vinte);
    const doze = precoParaMeta(ficha, cenario, DOZE_REAIS) ?? 0;
    const quinze = precoParaMeta(ficha, cenario, { tipo: 'reais', centavos: 1_500 }) ?? 0;
    expect(quinze).toBeGreaterThan(doze);
  });

  it('aceita meta quebrada: 22,5% fica entre 20% e 25%', () => {
    const vinte = precoParaMeta(ficha, cenario, VINTE_POR_CENTO) ?? 0;
    const quebrada = precoParaMeta(ficha, cenario, { tipo: 'percentual', bp: 2_250 }) ?? 0;
    const vinteCinco = precoParaMeta(ficha, cenario, { tipo: 'percentual', bp: 2_500 }) ?? 0;
    expect(quebrada).toBeGreaterThan(vinte);
    expect(quebrada).toBeLessThan(vinteCinco);
  });

  it('sem custo não há preço: custo zero presumido daria um preço bonito e falso', () => {
    const semCusto = { ...ficha, custo: null };
    expect(precoParaMeta(semCusto, cenario, VINTE_POR_CENTO)).toBeNull();
    expect(precoSemPrejuizo(semCusto, cenario)).toBeNull();
  });

  it('o preço sem prejuízo fica abaixo do preço da meta', () => {
    const empate = precoSemPrejuizo(ficha, cenario) ?? 0;
    expect(empate).toBeGreaterThan(0);
    expect(empate).toBeLessThan(precoParaMeta(ficha, cenario, VINTE_POR_CENTO) ?? 0);
  });

  it('peça cara acha preço acima dos R$ 500 que a tela antiga varria', () => {
    const cara = { ...ficha, custo: r(420) };
    expect(precoParaMeta(cara, cenario, VINTE_POR_CENTO)).toBeGreaterThan(r(500));
  });

  it('preço zero não vira conta', () => {
    expect(contaDaVenda(ficha, cenario, centavos(0))).toBeNull();
  });
});

describe('a meta', () => {
  it('aceita qualquer número que faça sentido, com casa decimal', () => {
    expect(metaValida(META_PADRAO)).toBe(true);
    expect(metaValida({ tipo: 'percentual', bp: 2_250 })).toBe(true);
    expect(metaValida({ tipo: 'percentual', bp: 50 })).toBe(true);
    expect(metaValida({ tipo: 'reais', centavos: 1 })).toBe(true);
  });

  it('recusa o que não é meta: zero, cem por cento, fração de ponto-base, centavo quebrado', () => {
    expect(metaValida({ tipo: 'percentual', bp: 0 })).toBe(false);
    expect(metaValida({ tipo: 'percentual', bp: 10_000 })).toBe(false);
    expect(metaValida({ tipo: 'percentual', bp: 2_000.5 })).toBe(false);
    expect(metaValida({ tipo: 'reais', centavos: 0 })).toBe(false);
    expect(metaValida({ tipo: 'reais', centavos: 12.5 })).toBe(false);
  });

  it('é dita do jeito que foi pedida', () => {
    expect(textoDaMeta(VINTE_POR_CENTO)).toBe('20% do preço');
    expect(textoDaMeta({ tipo: 'percentual', bp: 2_250 })).toBe('22,5% do preço');
    expect(simples(textoDaMeta({ tipo: 'reais', centavos: 1_250 }))).toBe('R$ 12,50 por venda');
  });

  it('alcançar a meta é chegar nela, na unidade dela', () => {
    const conta = contaDaVenda(ficha, cenario, r(60));
    expect(conta).not.toBeNull();
    if (conta === null) return;
    expect(alcancaMeta(conta, { tipo: 'percentual', bp: conta.margemPontosBase })).toBe(true);
    expect(alcancaMeta(conta, { tipo: 'percentual', bp: conta.margemPontosBase + 1 })).toBe(false);
    expect(alcancaMeta(conta, { tipo: 'reais', centavos: conta.margemReais })).toBe(true);
    expect(alcancaMeta(conta, { tipo: 'reais', centavos: conta.margemReais + 1 })).toBe(false);
  });
});

describe('os textos curtos', () => {
  it('real redondo sai sem centavos, e quebrado sai com', () => {
    expect(simples(reaisCurtos(r(79)))).toBe('R$ 79');
    expect(simples(reaisCurtos(r('39.90')))).toBe('R$ 39,90');
  });

  it('percentual pequeno ganha uma casa, grande não', () => {
    expect(percentual(850)).toBe('8,5%');
    expect(percentual(2_340)).toBe('23%');
    expect(percentual(-730)).toBe('-7,3%');
  });
});

describe('a tabela de preços', () => {
  it('pede um preço por loja e compara com o que a pessoa cobra', () => {
    const celulas = celulasDoProduto({
      ficha,
      vendas: { ml: venda(4, r(160)) },
      meta: VINTE_POR_CENTO,
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
      em: EM,
    });
    expect(celulas.map((c) => c.plataforma)).toEqual(['ml', 'shopee', 'amazon']);
    const ml = celulas[0];
    expect(ml?.cobre.tipo).toBe('preco');
    expect(ml?.voceCobra).toBe(r(40));
    expect(ml?.unidades).toBe(4);
    // R$ 40 de média paga a conta, mas não chega aos 20% do preço.
    expect(ml?.situacao).toBe('abaixo');
    expect(ml?.margemHoje).toBeGreaterThan(0);
    expect(ml?.margemHojeBp).toBeLessThan(2_000);
    // Loja sem venda não tem situação: não há o que comparar.
    expect(celulas[1]?.voceCobra).toBeNull();
    expect(celulas[1]?.situacao).toBeNull();
  });

  it('cobrar abaixo do custo é prejuízo, e cobrar bem é meta alcançada', () => {
    const celulas = celulasDoProduto({
      ficha,
      vendas: { ml: venda(2, r(30)), shopee: venda(1, r(90)) },
      meta: VINTE_POR_CENTO,
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
      em: EM,
    });
    expect(celulas[0]?.situacao).toBe('prejuizo');
    expect(celulas[0]?.margemHoje).toBeLessThan(0);
    expect(celulas[1]?.situacao).toBe('na_meta');
  });

  it('com meta em reais, a situação compara os reais de cada venda', () => {
    const [ml] = celulasDoProduto({
      ficha,
      vendas: { ml: venda(1, r(60)) },
      meta: { tipo: 'reais', centavos: 50_000 },
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
      em: EM,
    });
    expect(ml?.situacao).toBe('abaixo');
  });

  it('sem custo, toda loja espera o custo, e a venda de verdade continua aparecendo', () => {
    const celulas = celulasDoProduto({
      ficha: { ...ficha, custo: null },
      vendas: { shopee: venda(2, r(90)) },
      meta: VINTE_POR_CENTO,
      vendedor,
      tipoAnuncioML: 'classico',
      modoFrete: 'comprador_paga',
    });
    expect(celulas.every((c) => c.cobre.tipo === 'sem_custo')).toBe(true);
    expect(celulas[1]?.voceCobra).toBe(r(45));
    expect(celulas[1]?.situacao).toBeNull();
  });
});

describe('a situação do produto', () => {
  const celula = (situacao: CelulaDaTabela['situacao']): CelulaDaTabela => ({
    plataforma: 'ml',
    cobre: { tipo: 'sem_custo' },
    voceCobra: null,
    unidades: 0,
    margemHojeBp: null,
    margemHoje: null,
    situacao,
  });

  it('é a da pior loja onde ele vende', () => {
    expect(situacaoDoProduto(100, [celula('na_meta'), celula('abaixo')])).toBe('abaixo');
    expect(situacaoDoProduto(100, [celula('abaixo'), celula('prejuizo')])).toBe('prejuizo');
    expect(situacaoDoProduto(100, [celula('na_meta'), celula(null)])).toBe('na_meta');
  });

  it('sem custo e sem venda são estados próprios, e não "na meta"', () => {
    expect(situacaoDoProduto(null, [celula('na_meta')])).toBe('sem_custo');
    expect(situacaoDoProduto(100, [celula(null), celula(null)])).toBe('sem_vendas');
  });
});

describe('os números do alto', () => {
  it('somam as lojas, e a margem real usa só os pedidos que têm margem', () => {
    const numeros = numerosDoCatalogo([
      {
        custo: 1_000,
        custoVelho: true,
        vendas: {
          ml: venda(3, r(90), r(18)),
          shopee: { ...venda(1, r(40)), margem: 0 },
        },
        situacao: 'abaixo',
      },
      { custo: null, custoVelho: false, vendas: {}, situacao: 'sem_custo' },
    ]);
    expect(numeros.produtos).toBe(2);
    expect(numeros.semCusto).toBe(1);
    expect(numeros.custoVelho).toBe(1);
    expect(numeros.abaixoDaMeta).toBe(1);
    expect(numeros.unidades).toBe(4);
    expect(numeros.unidadesPorLoja).toEqual({ ml: 3, shopee: 1, amazon: 0 });
    expect(numeros.faturamento).toBe(r(130));
    expect(numeros.lucro).toBe(r(18));
    // R$ 18 de R$ 90, e não de R$ 130: a venda da Shopee não tem margem conhecida.
    expect(numeros.margemRealBp).toBe(2_000);
    expect(numeros.lucroPorUnidade).toBe(r(6));
  });

  it('sem venda com margem, não há margem real para mostrar', () => {
    const numeros = numerosDoCatalogo([
      { custo: 1_000, custoVelho: false, vendas: { ml: venda(2, r(50)) }, situacao: 'na_meta' },
    ]);
    expect(numeros.margemRealBp).toBeNull();
    expect(numeros.lucroPorUnidade).toBeNull();
  });
});

describe('o gráfico', () => {
  it('vai de um pouco abaixo da menor referência até bem acima da maior', () => {
    expect(faixaDoGrafico([r(20), r(40)], 1_840)).toEqual({ de: r(12), ate: r(58) });
  });

  it('degrau na ponta estica o trecho, para a queda não ficar colada na borda', () => {
    // De R$ 12 a R$ 58, com a folga de 15% do trecho (R$ 6,90) depois do degrau.
    expect(faixaDoGrafico([r(20), r(40)], 1_840, [r(55)])).toEqual({ de: r(12), ate: r('61.90') });
    expect(faixaDoGrafico([r(20), r(40)], 1_840, [r(60)])).toEqual({ de: r(12), ate: r('66.90') });
    // Degrau no meio, ou longe da ponta, não mexe em nada.
    expect(faixaDoGrafico([r(20), r(40)], 1_840, [r(30), r(90)])).toEqual({
      de: r(12),
      ate: r(58),
    });
  });

  it('sem referência, sai do dobro do custo', () => {
    expect(faixaDoGrafico([null, null], r(10))).toEqual({ de: r(12), ate: r(29) });
  });

  it('a curva fica no trecho, perde embaixo do empate e ganha em cima', () => {
    const empate = precoSemPrejuizo(ficha, cenario);
    const meta = precoParaMeta(ficha, cenario, VINTE_POR_CENTO);
    const faixa = faixaDoGrafico([empate, meta], ficha.custo ?? 0);
    const pontos = curvaDeLucro({ ficha, cenario, faixa });
    expect(pontos.length).toBeGreaterThan(100);
    expect(pontos[0]?.preco).toBe(faixa.de);
    expect(pontos.at(-1)?.preco).toBe(faixa.ate);
    expect(pontos[0]?.margemReais).toBeLessThan(0);
    expect(pontos.at(-1)?.margemReais).toBeGreaterThan(0);
  });

  it('sem custo, não há curva', () => {
    const faixa = faixaDoGrafico([], 1_000);
    expect(curvaDeLucro({ ficha: { ...ficha, custo: null }, cenario, faixa })).toEqual([]);
  });
});

function contaA(preco: number, custo = ficha.custo): ResultadoDeMargem {
  const base = montarConta({ ...ficha, custo }, cenario).base;
  return calcularMargem({ ...base, preco: centavos(preco) });
}

describe('para onde vai o dinheiro', () => {
  it('começa pelo que fica com você, e as partes somam o preço', () => {
    const conta = contaA(r(60));
    const divisao = divisaoDoDinheiro(conta, 'ml', []);
    expect(divisao.partes[0]?.chave).toBe('fica');
    expect(divisao.partes.reduce((t, p) => t + p.valor, 0)).toBe(conta.preco);
    expect(divisao.partes.reduce((t, p) => t + p.fracao, 0)).toBeCloseTo(1, 5);
    expect(divisao.fimDoPreco).toBe(1);
    expect(divisao.perde).toBe(0);
  });

  it('diz a taxa com o nome da loja, marca o estimado e esconde o que é zero', () => {
    const divisao = divisaoDoDinheiro(contaA(r(60)), 'ml', ['embalagem']);
    expect(divisao.partes.find((p) => p.chave === 'loja')?.rotulo).toBe('Taxa do Mercado Livre');
    expect(divisao.partes.find((p) => p.chave === 'resto')?.presumido).toBe('embalagem');
    expect(divisao.partes.find((p) => p.chave === 'produto')?.valor).toBe(1_840);
    expect(divisao.partes.every((p) => p.valor > 0)).toBe(true);
  });

  it('com prejuízo, a barra são os custos, e o preço termina antes do fim', () => {
    const conta = contaA(r(20), r(30));
    const divisao = divisaoDoDinheiro(conta, 'ml', []);
    expect(divisao.partes.some((p) => p.chave === 'fica')).toBe(false);
    expect(divisao.partes.reduce((t, p) => t + p.fracao, 0)).toBeCloseTo(1, 5);
    expect(divisao.perde).toBe(0 - conta.margemReais);
    expect(divisao.fimDoPreco).toBeCloseTo(conta.preco / (conta.preco + divisao.perde), 5);
  });

  it('a nota diz o que foi estimado, com o número usado', () => {
    const conta = contaA(r(60));
    expect(simples(notaDoEstimado(conta, ['embalagem', 'devolucao']) ?? '')).toBe(
      'Estimado: embalagem de R$ 1,50 e devolução de 2 em cada 100 vendas.',
    );
    expect(notaDoEstimado(conta, [])).toBeNull();
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
