import { describe, expect, it } from 'vitest';
import { classificarPlanilha, interpretarData, TIPOS_DE_PLANILHA } from './planilha';

describe('classificarPlanilha', () => {
  it('data mais uma coluna de venda já decide', () => {
    const r = classificarPlanilha(['titulo', 'preco', 'data', 'repasse_liquido']);
    expect(r.tipo).toBe('pedidos');
    expect(r.motivo).toContain('repasse_liquido');
  });

  it('duas colunas de venda decidem mesmo sem data', () => {
    expect(classificarPlanilha(['comissao', 'comprador']).tipo).toBe('pedidos');
  });

  it('estoque e status é planilha de anúncio', () => {
    const r = classificarPlanilha(['titulo', 'preco', 'quantidade', 'status']);
    expect(r.tipo).toBe('anuncios');
    expect(r.motivo).toContain('quantidade');
  });

  it('data sozinha não decide: anúncio também tem data de criação', () => {
    expect(classificarPlanilha(['titulo', 'preco', 'data']).tipo).toBe('indefinido');
  });

  it('sem sinal de nenhum dos dois lados fica indefinido, e explica o que falta', () => {
    const r = classificarPlanilha(['titulo', 'preco']);
    expect(r.tipo).toBe('indefinido');
    expect(r.motivo).toContain('Planilha de venda tem data');
  });

  it('venda vence anúncio quando há sinal dos dois', () => {
    // Exportação de venda do ML traz status do pedido junto. O sinal de dinheiro
    // depois da venda é mais específico que o de estoque.
    expect(classificarPlanilha(['data', 'repasse_liquido', 'status']).tipo).toBe('pedidos');
  });

  it('lista vazia é indefinido, não anúncio por omissão', () => {
    expect(classificarPlanilha([]).tipo).toBe('indefinido');
  });

  it('todo tipo declarado é alcançável', () => {
    const alcancados = new Set([
      classificarPlanilha(['data', 'comissao']).tipo,
      classificarPlanilha(['quantidade']).tipo,
      classificarPlanilha([]).tipo,
    ]);
    expect([...alcancados].sort()).toEqual([...TIPOS_DE_PLANILHA].sort());
  });
});

describe('interpretarData', () => {
  it('data brasileira sem hora é o começo do dia no fuso do vendedor', () => {
    // Meia-noite de 14/09 em São Paulo é 03:00 UTC do mesmo dia. Interpretar como
    // meia-noite UTC jogaria a venda para o dia anterior às 21h de Brasília.
    const d = interpretarData('14/09/2026');
    expect(d?.toISOString()).toBe('2026-09-14T03:00:00.000Z');
  });

  it('aceita data brasileira com hora', () => {
    expect(interpretarData('14/09/2026 10:30')?.toISOString()).toBe('2026-09-14T13:30:00.000Z');
  });

  it('aceita ISO com e sem hora', () => {
    expect(interpretarData('2026-09-14')?.toISOString()).toBe('2026-09-14T03:00:00.000Z');
    expect(interpretarData('2026-09-14T10:30:00')?.toISOString()).toBe('2026-09-14T13:30:00.000Z');
  });

  it('aceita segundos', () => {
    expect(interpretarData('14/09/2026 10:30:45')?.toISOString()).toBe('2026-09-14T13:30:45.000Z');
  });

  it('respeita o fuso informado', () => {
    expect(interpretarData('14/09/2026', 'UTC')?.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('usa o deslocamento daquela data, porque horário de verão existiu', () => {
    // O Brasil tinha horário de verão em janeiro de 2017: UTC-02:00, não -03:00.
    expect(interpretarData('15/01/2017')?.toISOString()).toBe('2017-01-15T02:00:00.000Z');
    expect(interpretarData('15/07/2017')?.toISOString()).toBe('2017-07-15T03:00:00.000Z');
  });

  it('devolve nulo para o que não entende, em vez de Invalid Date', () => {
    for (const ruim of ['ontem', '', '  ', '32/13/2026', 'abc', '14-09-2026']) {
      expect(interpretarData(ruim), ruim).toBeNull();
    }
  });

  it('devolve nulo para célula ausente', () => {
    expect(interpretarData(undefined)).toBeNull();
  });
});
