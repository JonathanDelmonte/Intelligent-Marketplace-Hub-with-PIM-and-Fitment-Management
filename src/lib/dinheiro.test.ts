import { describe, expect, it } from 'vitest';
import {
  ZERO,
  _interno,
  absoluto,
  aplicarPontosBase,
  centavos,
  centavosParaReais,
  formatarBRL,
  formatarPontosBase,
  maior,
  menor,
  multiplicarPorFator,
  multiplicarPorQuantidade,
  negar,
  percentualParaPontosBase,
  pontosBase,
  proporcaoEmPontosBase,
  ratear,
  ratearPorPesos,
  reaisParaCentavos,
  somar,
  subtrair,
  ValorMonetarioInvalido,
} from './dinheiro';

describe('centavos', () => {
  it('aceita inteiro, positivo, negativo e zero', () => {
    expect(centavos(7890)).toBe(7890);
    expect(centavos(-500)).toBe(-500);
    expect(centavos(0)).toBe(0);
  });

  it('recusa fração, porque centavo fracionário é sempre bug de conversão', () => {
    expect(() => centavos(78.9)).toThrow(ValorMonetarioInvalido);
    expect(() => centavos(0.5)).toThrow(/precisa de inteiro/);
  });

  it('recusa NaN e infinito', () => {
    expect(() => centavos(Number.NaN)).toThrow(ValorMonetarioInvalido);
    expect(() => centavos(Number.POSITIVE_INFINITY)).toThrow(ValorMonetarioInvalido);
  });

  it('recusa valor fora do inteiro seguro', () => {
    expect(() => centavos(Number.MAX_SAFE_INTEGER + 2)).toThrow(ValorMonetarioInvalido);
  });
});

describe('reaisParaCentavos', () => {
  it('converte sem erro de ponto flutuante — 19.99 é a prova', () => {
    // 19.99 * 100 é 1998.9999999999998 em IEEE-754.
    expect(reaisParaCentavos(19.99)).toBe(1999);
    expect(reaisParaCentavos(0.07)).toBe(7);
    expect(reaisParaCentavos(1.1)).toBe(110);
    expect(reaisParaCentavos(78.9)).toBe(7890);
  });

  it('converte inteiro e zero', () => {
    expect(reaisParaCentavos(79)).toBe(7900);
    expect(reaisParaCentavos(0)).toBe(0);
  });

  it('converte negativo', () => {
    expect(reaisParaCentavos(-12.34)).toBe(-1234);
  });

  it('aceita string com ponto e com vírgula', () => {
    expect(reaisParaCentavos('19.99')).toBe(1999);
    expect(reaisParaCentavos('19,99')).toBe(1999);
    expect(reaisParaCentavos('-0,05')).toBe(-5);
    expect(reaisParaCentavos(' 140 ')).toBe(14_000);
  });

  it('completa uma casa decimal para duas', () => {
    expect(reaisParaCentavos('19.9')).toBe(1990);
    expect(reaisParaCentavos(19.9)).toBe(1990);
  });

  it('recusa três casas decimais em vez de arredondar em silêncio', () => {
    expect(() => reaisParaCentavos(19.999)).toThrow(ValorMonetarioInvalido);
    expect(() => reaisParaCentavos('19.999')).toThrow(/duas casas decimais/);
  });

  it('recusa texto que não é número', () => {
    expect(() => reaisParaCentavos('R$ 19,99')).toThrow(ValorMonetarioInvalido);
    expect(() => reaisParaCentavos('abc')).toThrow(ValorMonetarioInvalido);
    expect(() => reaisParaCentavos('')).toThrow(ValorMonetarioInvalido);
  });

  it('recusa NaN e infinito', () => {
    expect(() => reaisParaCentavos(Number.NaN)).toThrow(ValorMonetarioInvalido);
    expect(() => reaisParaCentavos(Number.POSITIVE_INFINITY)).toThrow(ValorMonetarioInvalido);
  });

  it('faz ida e volta em todos os centavos de um real', () => {
    for (let c = 0; c <= 100; c += 1) {
      const reais = c / 100;
      expect(reaisParaCentavos(reais)).toBe(c);
    }
  });
});

describe('pontosBase', () => {
  it('converte percentual comercial', () => {
    expect(percentualParaPontosBase(14.5)).toBe(1450);
    expect(percentualParaPontosBase(20)).toBe(2000);
    expect(percentualParaPontosBase(100)).toBe(10_000);
    expect(percentualParaPontosBase(0)).toBe(0);
    expect(percentualParaPontosBase(2.5)).toBe(250);
  });

  it('recusa precisão além de ponto-base', () => {
    expect(() => percentualParaPontosBase(14.567)).toThrow(ValorMonetarioInvalido);
  });

  it('recusa infinito', () => {
    expect(() => percentualParaPontosBase(Number.POSITIVE_INFINITY)).toThrow(
      ValorMonetarioInvalido,
    );
  });

  it('recusa construção fracionária direta', () => {
    expect(() => pontosBase(14.5)).toThrow(ValorMonetarioInvalido);
  });
});

describe('aplicarPontosBase', () => {
  it('aplica comissão percentual de forma exata', () => {
    // 14,50% de R$ 100,00
    expect(aplicarPontosBase(centavos(10_000), pontosBase(1450))).toBe(1450);
    // 20% de R$ 79,99 = R$ 15,998 → R$ 16,00
    expect(aplicarPontosBase(centavos(7999), pontosBase(2000))).toBe(1600);
    // 10% de R$ 78,90 = R$ 7,89 exato
    expect(aplicarPontosBase(centavos(7890), pontosBase(1000))).toBe(789);
  });

  it('respeita o modo de arredondamento', () => {
    // 12,5% de R$ 1,00 = 12,5 centavos
    const valor = centavos(100);
    const bp = pontosBase(1250);
    expect(aplicarPontosBase(valor, bp, 'meio-para-cima')).toBe(13);
    expect(aplicarPontosBase(valor, bp, 'baixo')).toBe(12);
    expect(aplicarPontosBase(valor, bp, 'cima')).toBe(13);
    expect(aplicarPontosBase(valor, bp, 'meio-par')).toBe(12);
  });

  it('é simétrico para valor negativo', () => {
    const a = aplicarPontosBase(centavos(-100), pontosBase(1250), 'meio-para-cima');
    const b = aplicarPontosBase(centavos(100), pontosBase(1250), 'meio-para-cima');
    expect(a).toBe(0 - b);
  });

  it('devolve zero para zero por cento', () => {
    expect(aplicarPontosBase(centavos(12_345), pontosBase(0))).toBe(0);
  });
});

describe('operações', () => {
  it('soma, subtrai, nega e toma módulo', () => {
    expect(somar(centavos(100), centavos(250), centavos(-50))).toBe(300);
    expect(somar()).toBe(0);
    expect(subtrair(centavos(100), centavos(250))).toBe(-150);
    expect(negar(centavos(100))).toBe(-100);
    expect(absoluto(centavos(-100))).toBe(100);
  });

  it('compara', () => {
    expect(maior(centavos(100), centavos(250))).toBe(250);
    expect(menor(centavos(100), centavos(250))).toBe(100);
    expect(maior(centavos(100), centavos(100))).toBe(100);
  });

  it('multiplica por quantidade inteira', () => {
    expect(multiplicarPorQuantidade(centavos(7890), 3)).toBe(23_670);
    expect(multiplicarPorQuantidade(centavos(7890), 0)).toBe(0);
  });

  it('recusa quantidade fracionária ou negativa', () => {
    expect(() => multiplicarPorQuantidade(centavos(100), 1.5)).toThrow(ValorMonetarioInvalido);
    expect(() => multiplicarPorQuantidade(centavos(100), -1)).toThrow(ValorMonetarioInvalido);
  });

  it('multiplica por fator com modo declarado', () => {
    expect(multiplicarPorFator(centavos(101), 1.5, 'meio-para-cima')).toBe(152);
    expect(multiplicarPorFator(centavos(101), 1.5, 'baixo')).toBe(151);
    expect(multiplicarPorFator(centavos(101), 1.5, 'meio-par')).toBe(152);
    expect(() => multiplicarPorFator(centavos(100), Number.NaN, 'baixo')).toThrow(
      ValorMonetarioInvalido,
    );
  });

  it('multiplicarPorFator herda o erro do ponto flutuante — use aplicarPontosBase para percentual', () => {
    // `100 * 1.005` é 100.49999999999999 em IEEE-754, então meio-para-cima
    // devolve 100 e não 101. Não é bug desta função: é a razão de percentual
    // nunca passar por aqui. `aplicarPontosBase` multiplica em inteiro antes de
    // dividir e acerta os mesmos 0,5%.
    expect(multiplicarPorFator(centavos(100), 1.005, 'meio-para-cima')).toBe(100);
    expect(somar(centavos(100), aplicarPontosBase(centavos(100), pontosBase(50)))).toBe(101);
  });
});

describe('proporcaoEmPontosBase', () => {
  it('calcula margem percentual', () => {
    // R$ 20,00 sobre R$ 100,00 = 20%
    expect(proporcaoEmPontosBase(centavos(2000), centavos(10_000))).toBe(2000);
    // R$ 1,00 sobre R$ 3,00 = 33,33%
    expect(proporcaoEmPontosBase(centavos(100), centavos(300))).toBe(3333);
  });

  it('devolve zero bp quando o todo é zero, em vez de lançar', () => {
    expect(proporcaoEmPontosBase(centavos(100), ZERO)).toBe(0);
  });

  it('aceita parte negativa (margem negativa)', () => {
    expect(proporcaoEmPontosBase(centavos(-500), centavos(10_000))).toBe(-500);
  });
});

describe('ratear', () => {
  it('a soma das partes é sempre exatamente o total', () => {
    for (const total of [100, 101, 7890, 6666, 1, 0, 99_999]) {
      for (const partes of [1, 2, 3, 7, 13, 30]) {
        const fatias = ratear(centavos(total), partes);
        expect(fatias).toHaveLength(partes);
        expect(fatias.reduce<number>((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('distribui o resto nas primeiras posições, de forma determinística', () => {
    expect(ratear(centavos(100), 3)).toEqual([34, 33, 33]);
    expect(ratear(centavos(10), 4)).toEqual([3, 3, 2, 2]);
  });

  it('rateia o DAS do MEI por unidade prevista', () => {
    // DAS de R$ 75,90 rateado em 37 unidades previstas no mês.
    const fatias = ratear(centavos(7590), 37);
    expect(fatias.reduce<number>((a, b) => a + b, 0)).toBe(7590);
    expect(new Set(fatias).size).toBeLessThanOrEqual(2);
  });

  it('preserva o sinal de um total negativo', () => {
    const fatias = ratear(centavos(-100), 3);
    expect(fatias).toEqual([-34, -33, -33]);
    expect(fatias.reduce<number>((a, b) => a + b, 0)).toBe(-100);
  });

  it('recusa partes inválidas', () => {
    expect(() => ratear(centavos(100), 0)).toThrow(ValorMonetarioInvalido);
    expect(() => ratear(centavos(100), -1)).toThrow(ValorMonetarioInvalido);
    expect(() => ratear(centavos(100), 2.5)).toThrow(ValorMonetarioInvalido);
  });
});

describe('ratearPorPesos', () => {
  it('a soma das partes é sempre exatamente o total', () => {
    const casos: Array<[number, number[]]> = [
      [10_000, [1, 1, 1]],
      [9999, [3, 5, 7, 11]],
      [7890, [0.5, 0.25, 0.25]],
      [1, [1, 1, 1, 1]],
      [0, [2, 3]],
    ];
    for (const [total, pesos] of casos) {
      const fatias = ratearPorPesos(centavos(total), pesos);
      expect(fatias).toHaveLength(pesos.length);
      expect(fatias.reduce<number>((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('respeita a proporção', () => {
    expect(ratearPorPesos(centavos(10_000), [3, 1])).toEqual([7500, 2500]);
    expect(ratearPorPesos(centavos(100), [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('cai em rateio igual quando todos os pesos são zero', () => {
    expect(ratearPorPesos(centavos(100), [0, 0, 0])).toEqual([34, 33, 33]);
  });

  it('preserva o sinal de um total negativo', () => {
    const fatias = ratearPorPesos(centavos(-10_000), [3, 1]);
    expect(fatias).toEqual([-7500, -2500]);
  });

  it('recusa lista vazia e peso inválido', () => {
    expect(() => ratearPorPesos(centavos(100), [])).toThrow(ValorMonetarioInvalido);
    expect(() => ratearPorPesos(centavos(100), [1, -1])).toThrow(ValorMonetarioInvalido);
    expect(() => ratearPorPesos(centavos(100), [1, Number.NaN])).toThrow(ValorMonetarioInvalido);
  });
});

describe('apresentação', () => {
  it('formata em real brasileiro', () => {
    // O separador de milhar do ICU em pt-BR é U+00A0 em alguns builds; comparar
    // por conteúdo em vez de por string literal.
    const texto = formatarBRL(centavos(198_790));
    expect(texto).toContain('R$');
    expect(texto).toContain('1');
    expect(texto).toContain('987,90');
    expect(formatarBRL(ZERO)).toContain('0,00');
    expect(formatarBRL(centavos(-1234))).toContain('12,34');
  });

  it('formata pontos-base como percentual', () => {
    expect(formatarPontosBase(pontosBase(1450))).toContain('14,50');
    expect(formatarPontosBase(pontosBase(2000), 0)).toContain('20');
  });

  it('converte para reais', () => {
    expect(centavosParaReais(centavos(7890))).toBe(78.9);
    expect(centavosParaReais(ZERO)).toBe(0);
  });
});

describe('arredondamento interno', () => {
  const { arredondar } = _interno;

  it('meio-para-cima é simétrico, diferente do Math.round do JS', () => {
    expect(arredondar(0.5, 'meio-para-cima')).toBe(1);
    expect(arredondar(-0.5, 'meio-para-cima')).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0); // o comportamento que o sistema evita
    expect(arredondar(1.5, 'meio-para-cima')).toBe(2);
    expect(arredondar(-1.5, 'meio-para-cima')).toBe(-2);
  });

  it('meio-par remove o viés de alta', () => {
    expect(arredondar(0.5, 'meio-par')).toBe(0);
    expect(arredondar(1.5, 'meio-par')).toBe(2);
    expect(arredondar(2.5, 'meio-par')).toBe(2);
    expect(arredondar(3.5, 'meio-par')).toBe(4);
    expect(arredondar(2.4, 'meio-par')).toBe(2);
    expect(arredondar(2.6, 'meio-par')).toBe(3);
    expect(arredondar(-1.5, 'meio-par')).toBe(-2);
    expect(arredondar(-2.5, 'meio-par')).toBe(-2);
  });

  it('baixo, cima e para-zero truncam na direção declarada', () => {
    expect(arredondar(1.9, 'baixo')).toBe(1);
    expect(arredondar(-1.1, 'baixo')).toBe(-2);
    expect(arredondar(1.1, 'cima')).toBe(2);
    expect(arredondar(-1.9, 'cima')).toBe(-1);
    expect(arredondar(1.9, 'para-zero')).toBe(1);
    expect(arredondar(-1.9, 'para-zero')).toBe(-1);
  });
});
