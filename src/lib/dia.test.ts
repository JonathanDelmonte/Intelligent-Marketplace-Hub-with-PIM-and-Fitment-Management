import { describe, expect, it } from 'vitest';
import { diaDoCampo, lerDia } from './dia';

describe('lerDia', () => {
  it('lê o dia do campo de data, ao meio-dia UTC', () => {
    expect(lerDia('2026-09-24')?.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('recusa o dia que não existe, em vez de rolar para o mês seguinte', () => {
    expect(lerDia('2026-02-31')).toBeNull();
    expect(lerDia('2026-13-01')).toBeNull();
  });

  it('recusa o que não é o formato do campo', () => {
    expect(lerDia('24/09/2026')).toBeNull();
    expect(lerDia('')).toBeNull();
  });
});

describe('diaDoCampo', () => {
  it('volta para o campo como foi', () => {
    expect(diaDoCampo(lerDia('2027-01-04'))).toBe('2027-01-04');
  });

  it('a meia-noite UTC que o banco devolve continua no mesmo dia', () => {
    expect(diaDoCampo(new Date('2027-06-30T00:00:00Z'))).toBe('2027-06-30');
  });

  it('sem data é campo vazio', () => {
    expect(diaDoCampo(null)).toBe('');
  });
});
