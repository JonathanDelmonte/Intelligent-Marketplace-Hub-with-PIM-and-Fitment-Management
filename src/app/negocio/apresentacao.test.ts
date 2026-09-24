import { describe, expect, it } from 'vitest';
import { TETO_MEI_ANUAL } from '@/dominio/fiscal/teto';
import { lerDia } from '@/lib/dia';
import {
  centavosNoCampo,
  descreverAviso,
  percentualNoCampo,
  resumoDasVendas,
  valoresGravados,
} from './apresentacao';

describe('valores nos campos', () => {
  it('centavos viram reais com vírgula, do jeito que o campo aceita de volta', () => {
    expect(centavosNoCampo(8105)).toBe('81,05');
    expect(centavosNoCampo(TETO_MEI_ANUAL)).toBe('81000,00');
    expect(centavosNoCampo(7)).toBe('0,07');
    expect(centavosNoCampo(null)).toBe('');
  });

  it('pontos-base viram percentual sem zero à direita', () => {
    expect(percentualNoCampo(600)).toBe('6');
    expect(percentualNoCampo(650)).toBe('6,5');
    expect(percentualNoCampo(605)).toBe('6,05');
    expect(percentualNoCampo(1553)).toBe('15,53');
    expect(percentualNoCampo(null)).toBe('');
  });

  it('o que está gravado volta formatado, e ausente volta vazio', () => {
    const valores = valoresGravados({
      nome: 'Loja',
      regime: 'mei',
      documento: { tipo: 'cnpj', valor: '12ABC34501DE35' },
      inscricaoEstadual: null,
      uf: 'SP',
      abertoEm: lerDia('2026-07-20'),
      certificadoValidoAte: null,
      dasMensal: 8105,
      aliquotaSimplesBp: null,
      tetoAnual: TETO_MEI_ANUAL,
    });
    expect(valores).toEqual({
      nome: 'Loja',
      regime: 'mei',
      documento: '12.ABC.345/01DE-35',
      inscricaoEstadual: '',
      uf: 'SP',
      abertoEm: '2026-07-20',
      certificadoValidoAte: '',
      dasMensal: '81,05',
      aliquotaSimples: '',
      tetoAnual: '81000,00',
    });
  });
});

describe('resumoDasVendas', () => {
  it('zero diz de onde o número viria, em vez de parecer que o sistema não conta', () => {
    expect(resumoDasVendas({ ml: 0, shopee: 0, amazon: 0 })).toContain('planilha de pedidos');
  });

  it('concorda no singular', () => {
    expect(resumoDasVendas({ ml: 1, shopee: 0, amazon: 0 })).toMatch(/^1 venda nos/);
    expect(resumoDasVendas({ ml: 3, shopee: 2, amazon: 0 })).toMatch(/^5 vendas nos/);
  });
});

describe('descreverAviso', () => {
  it('só conhece o gravado; o resto é nulo', () => {
    expect(descreverAviso('gravado')?.tom).toBe('ok');
    expect(descreverAviso('qualquer')).toBeNull();
    expect(descreverAviso(undefined)).toBeNull();
  });
});
