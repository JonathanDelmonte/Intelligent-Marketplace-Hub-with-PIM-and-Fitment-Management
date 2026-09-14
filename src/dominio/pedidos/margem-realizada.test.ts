import { describe, expect, it } from 'vitest';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  calcularMargemRealizada,
  DIVERGENCIA_QUE_IMPORTA,
  divergenciaRelevante,
  type TaxasRealizadas,
} from './margem-realizada';

/** Um pedido de R$ 100 com todas as taxas informadas e custo conhecido. */
const COMPLETO: TaxasRealizadas = {
  precoBruto: reaisParaCentavos(100),
  taxaComissao: reaisParaCentavos(12),
  taxaFixa: reaisParaCentavos(6),
  fretePago: reaisParaCentavos(20),
  repasseLiquido: reaisParaCentavos(62),
  custoNaVenda: reaisParaCentavos(30),
  qtd: 1,
};

const calcular = (campos: Partial<TaxasRealizadas> = {}) =>
  calcularMargemRealizada({ ...COMPLETO, ...campos });

describe('repasse', () => {
  it('calcula bruto menos as taxas', () => {
    expect(calcular().repasseCalculado).toBe(reaisParaCentavos(62));
  });

  it('sem divergência não reclama', () => {
    const r = calcular();
    expect(r.divergenciaDeRepasse).toBe(0);
    expect(r.avisos).toEqual([]);
  });

  it('repasse menor que o explicado é taxa não prevista, e avisa', () => {
    const r = calcular({ repasseLiquido: reaisParaCentavos(58) });
    expect(r.divergenciaDeRepasse).toBe(reaisParaCentavos(-4));
    expect(r.avisos.join(' ')).toContain('taxa que não estava na conta');
  });

  it('repasse maior que o explicado é taxa faltando na planilha, não bônus', () => {
    const r = calcular({ repasseLiquido: reaisParaCentavos(70) });
    expect(r.avisos.join(' ')).toContain('não é bônus');
  });

  it('diferença de centavo é arredondamento, não notícia', () => {
    const r = calcular({ repasseLiquido: centavos(reaisParaCentavos(62) - 1) });
    expect(r.avisos).toEqual([]);
    expect(divergenciaRelevante(r.divergenciaDeRepasse)).toBe(false);
  });

  it('sem repasse informado não há o que conferir', () => {
    const r = calcular({ repasseLiquido: null });
    expect(r.divergenciaDeRepasse).toBeNull();
    expect(divergenciaRelevante(r.divergenciaDeRepasse)).toBe(false);
  });

  it('o corte de divergência é o que decide o relatório', () => {
    expect(divergenciaRelevante(centavos(DIVERGENCIA_QUE_IMPORTA))).toBe(false);
    expect(divergenciaRelevante(centavos(DIVERGENCIA_QUE_IMPORTA + 1))).toBe(true);
    expect(divergenciaRelevante(centavos(0 - DIVERGENCIA_QUE_IMPORTA - 1))).toBe(true);
  });
});

describe('margem', () => {
  it('usa o repasse informado, que é o que a plataforma vai pagar de fato', () => {
    // R$ 58 de repasse informado menos R$ 30 de custo = R$ 28, e não R$ 32 que a
    // reconstrução de taxas sugeriria.
    const r = calcular({ repasseLiquido: reaisParaCentavos(58) });
    expect(r.margem).toBe(reaisParaCentavos(28));
  });

  it('cai para o calculado quando a plataforma não informou repasse', () => {
    const r = calcular({ repasseLiquido: null });
    expect(r.margem).toBe(reaisParaCentavos(32));
  });

  it('margem em pontos-base sobre o bruto', () => {
    expect(calcular().margemBp).toBe(3_200);
  });

  it('custo desconhecido devolve margem nula, nunca zero', () => {
    // Chutar custo zero produziria a margem mais bonita possível exatamente
    // quando se sabe menos.
    const r = calcular({ custoNaVenda: null });
    expect(r.margem).toBeNull();
    expect(r.margemBp).toBeNull();
    expect(r.avisos.join(' ')).toContain('presumir custo');
  });

  it('multiplica o custo pela quantidade', () => {
    const r = calcular({ qtd: 2, repasseLiquido: reaisParaCentavos(62) });
    expect(r.margem).toBe(reaisParaCentavos(2));
  });

  it('quantidade zero conta como uma, em vez de zerar o custo', () => {
    expect(calcular({ qtd: 0 }).margem).toBe(calcular({ qtd: 1 }).margem);
  });

  it('prejuízo é dito com essa palavra', () => {
    const r = calcular({ custoNaVenda: reaisParaCentavos(80) });
    expect(r.margem).toBeLessThan(0);
    expect(r.avisos.join(' ')).toContain('Prejuízo');
  });

  it('bruto zero não divide por zero', () => {
    const r = calcular({ precoBruto: centavos(0), repasseLiquido: centavos(0) });
    expect(r.margemBp).toBeNull();
  });
});

describe('taxa que falta', () => {
  it('avisa por taxa faltando, uma a uma', () => {
    expect(calcular({ taxaComissao: null }).avisos.join(' ')).toContain('Comissão não informada');
    expect(calcular({ taxaFixa: null }).avisos.join(' ')).toContain('Taxa fixa não informada');
    expect(calcular({ fretePago: null }).avisos.join(' ')).toContain('Frete não informado');
  });

  it('só é completo com as três taxas e o custo', () => {
    expect(calcular().completo).toBe(true);
    expect(calcular({ fretePago: null }).completo).toBe(false);
    expect(calcular({ custoNaVenda: null }).completo).toBe(false);
  });

  it('frete zero é resposta, e diferente de desconhecido', () => {
    const zero = calcular({ fretePago: centavos(0), repasseLiquido: null });
    const nulo = calcular({ fretePago: null, repasseLiquido: null });
    expect(zero.repasseCalculado).toBe(nulo.repasseCalculado);
    expect(zero.completo).toBe(true);
    expect(nulo.completo).toBe(false);
  });
});
