import { describe, expect, it } from 'vitest';
import { centavos } from '@/lib/dinheiro';
import {
  completarSerie,
  janelaAte,
  janelasDoPainel,
  somarDias,
  somarPainel,
  variacaoBp,
  type SomaDaLoja,
} from './painel';

const soma = (parciais: Partial<SomaDaLoja>): SomaDaLoja => ({
  plataforma: 'ml',
  pedidos: 0,
  faturamento: centavos(0),
  faturamentoComMargem: centavos(0),
  margem: centavos(0),
  pedidosSemMargem: 0,
  repasse: centavos(0),
  ...parciais,
});

describe('somarDias', () => {
  it('atravessa fim de mês e de ano sem fuso no meio', () => {
    expect(somarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(somarDias('2026-09-24', -29)).toBe('2026-08-26');
  });
});

describe('janelas', () => {
  it('trinta dias inteiros até hoje, começando à meia-noite do vendedor', () => {
    const janela = janelaAte('2026-09-24');
    expect(janela.dias).toHaveLength(30);
    expect(janela.dias[0]).toBe('2026-08-26');
    expect(janela.dias.at(-1)).toBe('2026-09-24');
    // Meia-noite em São Paulo é 03h em UTC.
    expect(janela.desde.toISOString()).toBe('2026-08-26T03:00:00.000Z');
    expect(janela.ate.toISOString()).toBe('2026-09-25T03:00:00.000Z');
  });

  it('o hoje é o do vendedor: 01h de 25/09 em UTC ainda é 24/09 em São Paulo', () => {
    const { atual, anterior } = janelasDoPainel(new Date('2026-09-25T01:00:00Z'));
    expect(atual.dias.at(-1)).toBe('2026-09-24');
    // A anterior termina exatamente onde a atual começa: nada contado duas vezes.
    expect(anterior.ate.getTime()).toBe(atual.desde.getTime());
    expect(anterior.dias.at(-1)).toBe('2026-08-25');
  });
});

describe('somarPainel', () => {
  it('soma as lojas e tira o ticket', () => {
    const painel = somarPainel([
      soma({ pedidos: 3, faturamento: centavos(30_000) }),
      soma({ plataforma: 'shopee', pedidos: 1, faturamento: centavos(10_000) }),
    ]);
    expect(painel.pedidos).toBe(4);
    expect(painel.faturamento).toBe(40_000);
    expect(painel.ticketMedio).toBe(10_000);
  });

  it('a margem é só sobre os pedidos que têm margem, e diz quantos ficaram de fora', () => {
    // R$ 100 com margem de R$ 25, e R$ 300 sem custo: a margem é 25%, e não 6,25%.
    const painel = somarPainel([
      soma({
        pedidos: 4,
        faturamento: centavos(40_000),
        faturamentoComMargem: centavos(10_000),
        margem: centavos(2_500),
        pedidosSemMargem: 3,
      }),
    ]);
    expect(painel.margemBp).toBe(2500);
    expect(painel.pedidosSemMargem).toBe(3);
  });

  it('sem pedido não há ticket, e sem custo não há margem — nunca zero', () => {
    expect(somarPainel([]).ticketMedio).toBeNull();
    const semCusto = somarPainel([soma({ pedidos: 2, faturamento: centavos(5_000) })]);
    expect(semCusto.margemBp).toBeNull();
  });

  it('margem negativa aparece negativa', () => {
    const painel = somarPainel([
      soma({
        pedidos: 1,
        faturamento: centavos(3_290),
        faturamentoComMargem: centavos(3_290),
        margem: centavos(-100),
      }),
    ]);
    expect(painel.margemBp).toBe(-303);
  });
});

describe('variacaoBp', () => {
  it('diz quanto mudou sobre a janela anterior', () => {
    expect(variacaoBp(11_100, 10_000)).toBe(1100);
    expect(variacaoBp(9_000, 10_000)).toBe(-1000);
  });

  it('sem base não há variação', () => {
    expect(variacaoBp(5_000, 0)).toBeNull();
    expect(variacaoBp(0, 0)).toBeNull();
  });
});

describe('completarSerie', () => {
  it('põe zero nos dias sem venda, na ordem dos dias', () => {
    const serie = completarSerie(
      [{ dia: '2026-09-23', faturamento: centavos(500), pedidos: 1 }],
      ['2026-09-22', '2026-09-23', '2026-09-24'],
    );
    expect(serie.map((p) => [p.dia, p.faturamento, p.pedidos])).toEqual([
      ['2026-09-22', 0, 0],
      ['2026-09-23', 500, 1],
      ['2026-09-24', 0, 0],
    ]);
  });
});
