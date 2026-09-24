/**
 * Leituras por loja, contra Postgres de verdade: o agrupamento por plataforma, a loja
 * sem pedido que continua na lista, a credencial que conta como conexão e a que não
 * conta, e o perfil que não vê o do outro.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { credencial, pedido, perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { RepositorioDeLojas } from './repositorio';

describe.skipIf(!temBancoDeTeste())('RepositorioDeLojas.numeros', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeLojas;
  let perfil: PerfilId;
  let outro: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['pedido', 'credencial', 'perfil_vendedor']);
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
});
