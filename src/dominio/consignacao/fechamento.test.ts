import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { fecharPeriodo, mesDe, type VendaConsignada } from './fechamento';

const venda = (campos: Partial<VendaConsignada> = {}): VendaConsignada => ({
  pedidoId: 'p1',
  skuId: 's1',
  parceiroNome: 'Loja do Centro',
  tituloDoProduto: 'Refil PA21G',
  data: new Date('2026-09-10T12:00:00Z'),
  qtd: 1,
  repassePorUnidade: reaisParaCentavos(40),
  ...campos,
});

describe('fecharPeriodo', () => {
  it('soma unidade × repasse combinado, por parceiro', () => {
    const f = fecharPeriodo(
      [venda({ qtd: 2 }), venda({ pedidoId: 'p2', qtd: 3 })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.unidades).toBe(5);
    expect(f.totalARepassar).toBe(reaisParaCentavos(200));
    expect(f.completo).toBe(true);
  });

  it('separa por parceiro, em ordem alfabética de português', () => {
    const f = fecharPeriodo(
      [
        venda({ parceiroNome: 'Ótica Central' }),
        venda({ pedidoId: 'p2', parceiroNome: 'Auto Center' }),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.porParceiro.map((p) => p.parceiroNome)).toEqual(['Auto Center', 'Ótica Central']);
  });

  it('venda sem repasse combinado não vira zero: fica pendente e nomeada', () => {
    // Somar zero daria um fechamento bonito e falso — você deveria dinheiro que o
    // relatório diz que não deve.
    const f = fecharPeriodo(
      [venda({ qtd: 2 }), venda({ pedidoId: 'p2', qtd: 5, repassePorUnidade: null })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.totalARepassar).toBe(reaisParaCentavos(80));
    // A unidade conta: o parceiro entregou a peça, o que falta é o valor.
    expect(f.unidades).toBe(7);
    expect(f.completo).toBe(false);
    const [parceiro] = f.porParceiro;
    expect(parceiro?.pendencias).toHaveLength(1);
    expect(parceiro?.pendencias[0]?.pedidoId).toBe('p2');
    expect(parceiro?.pendencias[0]?.motivo).toContain('Combine o valor');
  });

  it('um parceiro pendente não contamina o fechamento do outro', () => {
    const f = fecharPeriodo(
      [
        venda({ parceiroNome: 'Loja A' }),
        venda({ pedidoId: 'p2', parceiroNome: 'Loja B', repassePorUnidade: null }),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.porParceiro.find((p) => p.parceiroNome === 'Loja A')?.completo).toBe(true);
    expect(f.porParceiro.find((p) => p.parceiroNome === 'Loja B')?.completo).toBe(false);
    // O fechamento geral só está completo quando todos estão.
    expect(f.completo).toBe(false);
  });

  it('venda fora do período fica fora', () => {
    const f = fecharPeriodo(
      [venda({ data: new Date('2026-08-31T12:00:00Z') }), venda({ pedidoId: 'p2' })],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.unidades).toBe(1);
  });

  it('o período é fechado nas duas pontas', () => {
    const f = fecharPeriodo(
      [
        venda({ data: new Date('2026-09-01T12:00:00Z') }),
        venda({ pedidoId: 'p2', data: new Date('2026-09-30T12:00:00Z') }),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    expect(f.unidades).toBe(2);
  });

  it('o dia da venda é o do fuso do vendedor, não o de UTC', () => {
    // 22h do dia 30 de setembro em São Paulo é 01h do dia 1 de outubro em UTC. Em
    // UTC essa venda cairia em outubro, e setembro mais outubro não daria o ano.
    const virada = venda({ data: new Date('2026-10-01T01:00:00Z') });
    expect(fecharPeriodo([virada], '2026-09-01', '2026-09-30').unidades).toBe(1);
    expect(fecharPeriodo([virada], '2026-09-01', '2026-09-30', { fuso: 'UTC' }).unidades).toBe(0);
  });

  it('período sem venda devolve zero, e zero completo', () => {
    const f = fecharPeriodo([], '2026-09-01', '2026-09-30');
    expect(f.porParceiro).toEqual([]);
    expect(f.totalARepassar).toBe(0);
    // Nada a repassar é um fechamento válido, não um fechamento pendente.
    expect(f.completo).toBe(true);
  });

  it('guarda o período no resultado, para o relatório não depender de quem chamou', () => {
    const f = fecharPeriodo([], '2026-09-01', '2026-09-30');
    expect(f.de).toBe('2026-09-01');
    expect(f.ate).toBe('2026-09-30');
  });
});

describe('mesDe', () => {
  it('devolve o primeiro e o último dia do mês', () => {
    expect(mesDe(new Date('2026-09-14T12:00:00Z'))).toEqual({
      de: '2026-09-01',
      ate: '2026-09-30',
    });
  });

  it('acerta fevereiro, inclusive em ano bissexto', () => {
    expect(mesDe(new Date('2026-02-10T12:00:00Z')).ate).toBe('2026-02-28');
    expect(mesDe(new Date('2028-02-10T12:00:00Z')).ate).toBe('2028-02-29');
  });

  it('acerta dezembro sem passar para o ano seguinte', () => {
    expect(mesDe(new Date('2026-12-05T12:00:00Z'))).toEqual({
      de: '2026-12-01',
      ate: '2026-12-31',
    });
  });

  it('usa o fuso do vendedor para decidir de que mês é a data', () => {
    // 21h do dia 30/09 em São Paulo é 00h de 01/10 em UTC.
    const virada = new Date('2026-10-01T00:00:00Z');
    expect(mesDe(virada, 'America/Sao_Paulo').de).toBe('2026-09-01');
    expect(mesDe(virada, 'UTC').de).toBe('2026-10-01');
  });
});
