import { describe, expect, it } from 'vitest';
import type { NumerosDaLoja } from '@/dominio/lojas/estado';
import type { Janela, SomaDaLoja } from '@/dominio/lojas/painel';
import type { MaisVendido } from '@/dominio/lojas/repositorio';
import { montarFilaDoDia, type FilaDoDia } from '@/dominio/pedidos/fila-do-dia';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { centavos } from '@/lib/dinheiro';
import type { Consulta } from './consulta';
import {
  levantar,
  MAIS_VENDIDOS_DE_CADA,
  MAIS_VENDIDOS_DE_UMA,
  type FontesDoAssistente,
} from './levantar';

const AGORA = new Date('2026-09-24T15:00:00.000Z');

const consulta = (campos: Partial<Consulta> = {}): Consulta => ({
  metrica: 'faturamento',
  lojas: [],
  periodo: 'ultimos_30',
  porLoja: false,
  ...campos,
});

const soma = (plataforma: Plataforma, faturamento: number, pedidos: number): SomaDaLoja => ({
  plataforma,
  pedidos,
  faturamento: centavos(faturamento),
  faturamentoComMargem: centavos(faturamento),
  margem: centavos(Math.trunc(faturamento / 5)),
  pedidosSemMargem: 0,
  repasse: centavos(0),
});

/** Fontes fixas, que anotam o que foi pedido a elas. */
function fontes(): FontesDoAssistente & { pedidos: string[] } {
  const pedidos: string[] = [];
  const vendido = (titulo: string): MaisVendido => ({
    skuId: titulo,
    titulo,
    pedidos: 1,
    faturamento: centavos(1_000),
    margemBp: null,
  });
  return {
    pedidos,
    numeros: () =>
      Promise.resolve(
        PLATAFORMAS.map((plataforma): NumerosDaLoja => ({
          plataforma,
          pedidos: plataforma === 'amazon' ? 0 : 10,
          ultimoPedidoEm: plataforma === 'amazon' ? null : new Date('2026-09-22T15:00:00.000Z'),
          conectada: false,
        })),
      ),
    // A janela atual vende o dobro da anterior, para a comparação ter o que comparar.
    somas: (janela: Janela) => {
      const fator = janela.dias.at(-1) === '2026-09-24' ? 2 : 1;
      return Promise.resolve([
        soma('ml', 10_000 * fator, 4 * fator),
        soma('shopee', 30_000 * fator, 6 * fator),
        soma('amazon', 0, 0),
      ]);
    },
    maisVendidos: (_janela, plataforma, limite) => {
      pedidos.push(`mais_vendidos:${plataforma ?? 'todas'}:${String(limite)}`);
      return Promise.resolve([vendido(`campeão ${plataforma ?? 'geral'}`)]);
    },
    filaDoDia: (plataforma): Promise<FilaDoDia> => {
      pedidos.push(`fila:${plataforma}`);
      return Promise.resolve(montarFilaDoDia([], AGORA));
    },
    repassesDivergentes: (plataforma) => {
      pedidos.push(`repasse:${plataforma}`);
      return Promise.resolve(
        plataforma === 'shopee' ? [{ idExterno: 'S1', divergencia: centavos(-350) }] : [],
      );
    },
  };
}

describe('levantar', () => {
  it('soma só as lojas da pergunta, na janela e na anterior', async () => {
    const r = await levantar(consulta({ lojas: ['shopee'] }), fontes(), AGORA);
    if (r.tipo !== 'painel') throw new Error(`esperava painel, veio ${r.tipo}`);

    expect(r.lojas).toEqual(['shopee']);
    expect(r.total.faturamento).toBe(60_000);
    expect(r.totalAnterior.faturamento).toBe(30_000);
    expect(r.porLoja.map((l) => l.plataforma)).toEqual(['shopee']);
  });

  it('sem loja, soma todas, e cada uma vem ao lado', async () => {
    const r = await levantar(consulta({ porLoja: true }), fontes(), AGORA);
    if (r.tipo !== 'painel') throw new Error(`esperava painel, veio ${r.tipo}`);

    expect(r.total.faturamento).toBe(80_000);
    expect(r.porLoja.map((l) => [l.plataforma, l.atual.pedidos])).toEqual([
      ['ml', 8],
      ['shopee', 12],
      ['amazon', 0],
    ]);
  });

  it('diz em que pé cada loja está, para a resposta dizer até quando os números vão', async () => {
    const r = await levantar(consulta(), fontes(), AGORA);
    expect(r.frescor.map((f) => [f.plataforma, f.estado.tipo])).toEqual([
      ['ml', 'planilha'],
      ['shopee', 'planilha'],
      ['amazon', 'sem_dados'],
    ]);
  });

  it('mais vendidos: uma lista do negócio, ou uma por loja quando compara', async () => {
    const f = fontes();
    await levantar(consulta({ metrica: 'mais_vendidos' }), f, AGORA);
    await levantar(consulta({ metrica: 'mais_vendidos', lojas: ['ml'] }), f, AGORA);
    const porLoja = await levantar(consulta({ metrica: 'mais_vendidos', porLoja: true }), f, AGORA);

    expect(f.pedidos).toEqual([
      `mais_vendidos:todas:${String(MAIS_VENDIDOS_DE_UMA)}`,
      `mais_vendidos:ml:${String(MAIS_VENDIDOS_DE_UMA)}`,
      `mais_vendidos:ml:${String(MAIS_VENDIDOS_DE_CADA)}`,
      `mais_vendidos:shopee:${String(MAIS_VENDIDOS_DE_CADA)}`,
      `mais_vendidos:amazon:${String(MAIS_VENDIDOS_DE_CADA)}`,
    ]);
    if (porLoja.tipo !== 'mais_vendidos') throw new Error('esperava mais vendidos');
    expect(porLoja.grupos.map((g) => g.plataforma)).toEqual(['ml', 'shopee', 'amazon']);
  });

  it('fila e repasse leem loja por loja, sem janela', async () => {
    const f = fontes();
    const fila = await levantar(consulta({ metrica: 'postar_hoje', lojas: ['shopee'] }), f, AGORA);
    const repasse = await levantar(consulta({ metrica: 'repasse_divergente' }), f, AGORA);

    expect(fila.tipo).toBe('fila');
    expect(f.pedidos).toEqual(['fila:shopee', 'repasse:ml', 'repasse:shopee', 'repasse:amazon']);
    if (repasse.tipo !== 'repasse') throw new Error('esperava repasse');
    expect(repasse.porLoja.map((l) => l.divergentes.length)).toEqual([0, 1, 0]);
  });
});
