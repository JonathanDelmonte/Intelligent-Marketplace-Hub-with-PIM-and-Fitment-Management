import { describe, expect, it } from 'vitest';
import { DIAS_DE_CUSTO_FRESCO, custoDefasado, idadeDoCustoEmDias } from './custo';

const AGORA = new Date('2026-09-16T12:00:00Z');
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000);

describe('custoDefasado', () => {
  it('custo de ontem vale', () => {
    expect(custoDefasado(diasAtras(1), AGORA)).toBe(false);
  });

  it('custo do limite ainda vale; um dia depois, não', () => {
    expect(custoDefasado(diasAtras(DIAS_DE_CUSTO_FRESCO), AGORA)).toBe(false);
    expect(custoDefasado(diasAtras(DIAS_DE_CUSTO_FRESCO + 1), AGORA)).toBe(true);
  });

  it('custo nunca informado não é defasado, é ausente', () => {
    // São dois estados com ações diferentes: um pede cadastro, o outro pede
    // conferência com o fornecedor.
    expect(custoDefasado(null, AGORA)).toBe(false);
  });

  it('o prazo é parâmetro, para o teste não depender do número escolhido', () => {
    expect(custoDefasado(diasAtras(10), AGORA, 7)).toBe(true);
    expect(custoDefasado(diasAtras(10), AGORA, 60)).toBe(false);
  });
});

describe('idadeDoCustoEmDias', () => {
  it('conta os dias cheios', () => {
    expect(idadeDoCustoEmDias(diasAtras(45), AGORA)).toBe(45);
  });

  it('data no futuro não vira idade negativa', () => {
    // Relógio de máquina errado é mais comum que se admite, e idade negativa na tela é
    // pior que idade zero.
    expect(idadeDoCustoEmDias(new Date(AGORA.getTime() + 86_400_000), AGORA)).toBe(0);
  });

  it('sem custo informado não há idade', () => {
    expect(idadeDoCustoEmDias(null, AGORA)).toBeNull();
  });
});
