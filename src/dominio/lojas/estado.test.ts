import { describe, expect, it } from 'vitest';
import { diaEMes, estadoDaLoja, type NumerosDaLoja } from './estado';

const base: NumerosDaLoja = {
  plataforma: 'shopee',
  pedidos: 0,
  ultimoPedidoEm: null,
  conectada: false,
};

describe('estadoDaLoja', () => {
  it('sem pedido e sem conexão, a loja está sem dados — e isso não é erro', () => {
    expect(estadoDaLoja(base)).toMatchObject({ tipo: 'sem_dados', legenda: 'Sem dados' });
  });

  it('por planilha, a legenda diz até que dia vão os números', () => {
    const estado = estadoDaLoja({
      ...base,
      pedidos: 65,
      ultimoPedidoEm: new Date('2026-09-22T15:00:00Z'),
    });
    expect(estado.tipo).toBe('planilha');
    expect(estado.legenda).toBe('Por planilha · até 22/09');
    expect(estado.frase).toContain('22/09');
  });

  it('conectada vence planilha: os pedidos chegam sozinhos', () => {
    const estado = estadoDaLoja({
      ...base,
      pedidos: 10,
      ultimoPedidoEm: new Date('2026-09-22T15:00:00Z'),
      conectada: true,
    });
    expect(estado).toMatchObject({ tipo: 'conectada', legenda: 'Conectada' });
  });
});

describe('diaEMes', () => {
  it('usa o dia do vendedor, e não o do servidor', () => {
    // 02h de 23/09 em UTC ainda é 22/09 à noite em São Paulo.
    expect(diaEMes(new Date('2026-09-23T02:00:00Z'))).toBe('22/09');
    expect(diaEMes(new Date('2026-09-23T02:00:00Z'), 'UTC')).toBe('23/09');
  });
});
