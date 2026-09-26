/**
 * Leituras por loja, contra Postgres de verdade: o agrupamento por plataforma, a loja
 * sem pedido que continua na lista, a credencial que conta como conexão e a que não
 * conta, e o perfil que não vê o do outro.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { credencial, pedido, perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { janelaAte } from './painel';
import { RepositorioDeLojas } from './repositorio';

describe.skipIf(!temBancoDeTeste())('RepositorioDeLojas.numeros', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeLojas;
  let perfil: PerfilId;
  let outro: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['pedido', 'credencial', 'sku', 'perfil_vendedor']);
    repo = new RepositorioDeLojas(conexao.db);
    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'lojas', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'lojas-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outro = perfilId(perfis[1]?.id ?? '');
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const vender = (dono: PerfilId, plataforma: 'ml' | 'shopee', idExterno: string, data: string) =>
    conexao.db.insert(pedido).values({
      perfilId: dono,
      plataforma,
      idExterno,
      data: new Date(data),
      precoBruto: 5_000,
      fonte: 'm1_planilha' as const,
    });

  it('agrupa por loja, com o pedido mais recente, e mantém a loja sem pedido', async () => {
    await vender(perfil, 'ml', 'a', '2026-09-20T12:00:00Z');
    await vender(perfil, 'ml', 'b', '2026-09-22T12:00:00Z');
    await vender(perfil, 'shopee', 'c', '2026-09-21T12:00:00Z');
    await vender(outro, 'shopee', 'd', '2026-09-23T12:00:00Z');

    const lojas = await repo.numeros(perfil);
    expect(
      lojas.map((l) => [l.plataforma, l.pedidos, l.ultimoPedidoEm?.toISOString() ?? null]),
    ).toEqual([
      ['ml', 2, '2026-09-22T12:00:00.000Z'],
      ['shopee', 1, '2026-09-21T12:00:00.000Z'],
      ['amazon', 0, null],
    ]);
  });

  it('só credencial OAuth ativa conta como conectada', async () => {
    await conexao.db.insert(credencial).values([
      { perfilId: perfil, plataforma: 'ml' as const, tipo: 'oauth' as const },
      { perfilId: perfil, plataforma: 'shopee' as const, tipo: 'oauth' as const, ativo: false },
      { perfilId: perfil, plataforma: 'amazon' as const, tipo: 'planilha' as const },
      { perfilId: outro, plataforma: 'amazon' as const, tipo: 'oauth' as const },
    ]);
    const lojas = await repo.numeros(perfil);
    expect(lojas.map((l) => [l.plataforma, l.conectada])).toEqual([
      ['ml', true],
      ['shopee', false],
      ['amazon', false],
    ]);
  });

  describe('números da janela', () => {
    // 30 dias até 24/09 no fuso de São Paulo: de 26/08 03h UTC a 25/09 03h UTC.
    const janela = janelaAte('2026-09-24');

    const pedidoDe = (
      dono: PerfilId,
      plataforma: 'ml' | 'shopee',
      idExterno: string,
      data: string,
      extra: { precoBruto?: number; margem?: number | null; repasse?: number; skuId?: string } = {},
    ) =>
      conexao.db.insert(pedido).values({
        perfilId: dono,
        plataforma,
        idExterno,
        data: new Date(data),
        precoBruto: extra.precoBruto ?? 10_000,
        margemRealizada: extra.margem ?? null,
        repasseLiquido: extra.repasse ?? null,
        skuId: extra.skuId ?? null,
        fonte: 'm1_planilha' as const,
      });

    it('soma por loja só o que está dentro da janela, e a margem só onde há margem', async () => {
      await pedidoDe(perfil, 'ml', 'a', '2026-09-24T20:00:00Z', { margem: 2_500, repasse: 8_000 });
      await pedidoDe(perfil, 'ml', 'b', '2026-09-10T12:00:00Z');
      // 25/09 02h UTC ainda é 24/09 em São Paulo: entra.
      await pedidoDe(perfil, 'shopee', 'c', '2026-09-25T02:00:00Z', { precoBruto: 3_290 });
      // 25/09 04h UTC já é 25/09: fica fora. E 26/08 02h UTC ainda é 25/08: fora também.
      await pedidoDe(perfil, 'shopee', 'd', '2026-09-25T04:00:00Z');
      await pedidoDe(perfil, 'shopee', 'e', '2026-08-26T02:00:00Z');
      await pedidoDe(outro, 'ml', 'f', '2026-09-20T12:00:00Z');

      const somas = await repo.somas(perfil, janela);
      expect(somas.map((x) => [x.plataforma, x.pedidos, x.faturamento])).toEqual([
        ['ml', 2, 20_000],
        ['shopee', 1, 3_290],
        ['amazon', 0, 0],
      ]);
      const ml = somas[0];
      expect(ml?.faturamentoComMargem).toBe(10_000);
      expect(ml?.margem).toBe(2_500);
      expect(ml?.pedidosSemMargem).toBe(1);
      expect(ml?.repasse).toBe(8_000);
    });

    it('série por dia no fuso do vendedor, filtrada pela loja', async () => {
      await pedidoDe(perfil, 'ml', 'a', '2026-09-24T20:00:00Z');
      await pedidoDe(perfil, 'ml', 'b', '2026-09-25T02:00:00Z', { precoBruto: 500 });
      await pedidoDe(perfil, 'ml', 'c', '2026-09-23T12:00:00Z', { precoBruto: 700 });
      await pedidoDe(perfil, 'shopee', 'd', '2026-09-23T12:00:00Z');

      const serie = await repo.serieDiaria(perfil, janela, 'ml');
      const ordenada = [...serie].sort((x, y) => x.dia.localeCompare(y.dia));
      expect(ordenada.map((p) => [p.dia, p.faturamento, p.pedidos])).toEqual([
        ['2026-09-23', 700, 1],
        ['2026-09-24', 10_500, 2],
      ]);
    });

    it('mais vendidos por faturamento, com a margem de cada um e os sem produto juntos', async () => {
      const skus = await conexao.db
        .insert(sku)
        .values([
          { perfilId: perfil, tituloInterno: 'Refil PA21G' },
          { perfilId: perfil, tituloInterno: 'Filtro CPC30' },
        ])
        .returning({ id: sku.id });
      const refil = skus[0]?.id ?? '';
      const filtro = skus[1]?.id ?? '';

      await pedidoDe(perfil, 'ml', 'a', '2026-09-20T12:00:00Z', { skuId: refil, margem: 2_000 });
      await pedidoDe(perfil, 'ml', 'b', '2026-09-21T12:00:00Z', { skuId: refil });
      await pedidoDe(perfil, 'ml', 'c', '2026-09-21T12:00:00Z', {
        skuId: filtro,
        precoBruto: 30_000,
      });
      await pedidoDe(perfil, 'ml', 'd', '2026-09-22T12:00:00Z', { precoBruto: 1_000 });

      const top = await repo.maisVendidos(perfil, janela, 'ml');
      expect(top.map((t) => [t.titulo, t.pedidos, t.faturamento, t.margemBp])).toEqual([
        ['Filtro CPC30', 1, 30_000, null],
        ['Refil PA21G', 2, 20_000, 2000],
        [null, 1, 1_000, null],
      ]);
    });

    it('vendas de cada produto por loja contam unidades, e deixam de fora o pedido sem produto', async () => {
      const skus = await conexao.db
        .insert(sku)
        .values([{ perfilId: perfil, tituloInterno: 'Refil PA21G' }])
        .returning({ id: sku.id });
      const refil = skus[0]?.id ?? '';

      await pedidoDe(perfil, 'ml', 'a', '2026-09-20T12:00:00Z', { skuId: refil });
      await conexao.db.insert(pedido).values({
        perfilId: perfil,
        plataforma: 'ml',
        idExterno: 'b',
        data: new Date('2026-09-21T12:00:00Z'),
        qtd: 2,
        precoBruto: 18_000,
        skuId: refil,
        fonte: 'm1_planilha' as const,
      });
      await pedidoDe(perfil, 'shopee', 'c', '2026-09-22T12:00:00Z', {
        skuId: refil,
        precoBruto: 4_500,
      });
      // Sem produto, fora da janela, e de outro perfil: nenhum entra.
      await pedidoDe(perfil, 'ml', 'd', '2026-09-22T12:00:00Z');
      await pedidoDe(perfil, 'ml', 'e', '2026-08-01T12:00:00Z', { skuId: refil });
      await pedidoDe(outro, 'ml', 'f', '2026-09-22T12:00:00Z', { skuId: refil });

      const vendas = await repo.vendasPorProduto(perfil, janela);
      const ordenadas = [...vendas].sort((x, y) => x.plataforma.localeCompare(y.plataforma));
      expect(ordenadas.map((v) => [v.skuId, v.plataforma, v.unidades, v.faturamento])).toEqual([
        [refil, 'ml', 3, 28_000],
        [refil, 'shopee', 1, 4_500],
      ]);
    });
  });
});
