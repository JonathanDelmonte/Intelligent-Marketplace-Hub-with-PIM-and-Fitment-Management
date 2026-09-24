import { describe, expect, it } from 'vitest';
import type { NumerosDaLoja } from '@/dominio/lojas/estado';
import type { FilaDoDia, ItemDaFila, Urgencia } from '@/dominio/pedidos/fila-do-dia';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { lerEstadoDaBarra, montarEstadoDaBarra } from './leitura';

const numeros = (plataforma: Plataforma, pedidos = 0): NumerosDaLoja => ({
  plataforma,
  pedidos,
  ultimoPedidoEm: pedidos > 0 ? new Date('2026-09-22T15:00:00Z') : null,
  conectada: false,
});

const item = (plataforma: Plataforma, urgencia: Urgencia): ItemDaFila => ({
  id: `${plataforma}-${urgencia}`,
  idExterno: '1',
  plataforma,
  qtd: 1,
  tituloDoProduto: null,
  prazoPostagemAte: null,
  postagemConfirmadaEm: null,
  rastreio: null,
  urgencia,
  horasRestantes: null,
});

const fila = (itens: readonly ItemDaFila[]): FilaDoDia => ({
  itens,
  porUrgencia: { sem_prazo: 0, atrasado: 0, hoje: 0, amanha: 0, depois: 0 },
  jaPostados: 0,
});

describe('montarEstadoDaBarra', () => {
  it('conta por loja só o que é para hoje: atrasado, hoje e sem prazo', () => {
    const estado = montarEstadoDaBarra(
      [numeros('ml', 10), numeros('shopee', 5), numeros('amazon')],
      fila([
        item('ml', 'atrasado'),
        item('ml', 'hoje'),
        item('ml', 'amanha'),
        item('shopee', 'sem_prazo'),
        item('shopee', 'depois'),
      ]),
    );
    expect(estado.postarHoje).toBe(3);
    expect(estado.lojas.map((l) => [l.plataforma, l.paraPostar, l.tipo])).toEqual([
      ['ml', 2, 'planilha'],
      ['shopee', 1, 'planilha'],
      ['amazon', 0, 'sem_dados'],
    ]);
  });
});

describe('lerEstadoDaBarra', () => {
  it('aceita o que a rota devolve, ida e volta pelo JSON', () => {
    const estado = montarEstadoDaBarra([numeros('ml', 3)], fila([item('ml', 'hoje')]));
    expect(lerEstadoDaBarra(JSON.parse(JSON.stringify(estado)))).toEqual(estado);
  });

  it('resposta torta vira barra sem números, e não barra quebrada', () => {
    expect(lerEstadoDaBarra(null)).toBeNull();
    expect(lerEstadoDaBarra({ erro: 'fora do ar' })).toBeNull();
    expect(lerEstadoDaBarra({ postarHoje: -1, lojas: [] })).toBeNull();
    expect(
      lerEstadoDaBarra({
        postarHoje: 1,
        lojas: [{ plataforma: 'orkut', tipo: 'planilha', legenda: 'x', paraPostar: 1 }],
      }),
    ).toBeNull();
  });
});
