/**
 * Testes do repositório de pedido, contra Postgres de verdade.
 *
 * O que só o banco prova: que reimportar a mesma planilha não duplica pedido, que
 * o custo é **congelado** na venda em vez de recalculado com o custo de hoje, e que
 * pedido sem SKU é gravado e contado em vez de recusado.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { RepositorioDePedidos, type PedidoCapturado } from './repositorio';

const TABELAS = [
  'pedido',
  'anuncio',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

const AGORA = new Date('2026-09-14T13:00:00.000Z');
const EAN = '7896541200909';

describe.skipIf(!temBancoDeTeste())('RepositorioDePedidos', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDePedidos;
  let perfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDePedidos(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'pedidos', nome: 'Perfil', regime: 'mei' })
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({
        perfilId: perfil,
        tituloInterno: 'Refil PA21G',
        ean: EAN,
        custoAtual: reaisParaCentavos(30),
      })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const capturado = (campos: Partial<PedidoCapturado> = {}): PedidoCapturado => ({
    plataforma: 'ml',
    idExterno: 'MLB-1',
    data: AGORA,
    qtd: 1,
    precoBruto: reaisParaCentavos(100),
    taxaComissao: reaisParaCentavos(12),
    taxaFixa: reaisParaCentavos(6),
    fretePago: reaisParaCentavos(20),
    repasseLiquido: reaisParaCentavos(62),
    ean: EAN,
    fonte: 'm1_planilha',
    ...campos,
  });

  it('casa com o SKU pelo EAN e usa o custo do catálogo', async () => {
    const r = await repo.registrar(perfil, capturado());
    expect(r.casouComSku).toBe(true);
    expect(r.pedido.skuId).toBe(skuId);
    expect(r.pedido.custoNaVenda).toBe(reaisParaCentavos(30));
    expect(r.pedido.margemRealizada).toBe(reaisParaCentavos(32));
  });

  it('o custo fica congelado na venda: mudar o catálogo não reescreve o passado', async () => {
    await repo.registrar(perfil, capturado());
    await conexao.db
      .update(sku)
      .set({ custoAtual: reaisParaCentavos(50) })
      .where(eq(sku.id, skuId));

    const resumo = await repo.resumo(perfil);
    expect(resumo.margemTotal).toBe(reaisParaCentavos(32));
  });

  it('custo da planilha vence o do catálogo', async () => {
    const r = await repo.registrar(perfil, capturado({ custoNaVenda: reaisParaCentavos(40) }));
    expect(r.pedido.custoNaVenda).toBe(reaisParaCentavos(40));
    expect(r.pedido.margemRealizada).toBe(reaisParaCentavos(22));
  });

  it('pedido sem SKU é gravado e contado, não recusado', async () => {
    // Pedido sem SKU é venda sem margem, e esconder isso esconderia o número que
    // importa.
    const r = await repo.registrar(perfil, capturado({ ean: '0000000000000' }));
    expect(r.casouComSku).toBe(false);
    expect(r.pedido.skuId).toBeNull();
    expect(r.pedido.margemRealizada).toBeNull();
    expect((await repo.resumo(perfil)).semSku).toBe(1);
  });

  it('reimportar a mesma planilha não duplica', async () => {
    const primeiro = await repo.registrar(perfil, capturado());
    const segundo = await repo.registrar(perfil, capturado());
    expect(segundo.pedido.id).toBe(primeiro.pedido.id);
    expect(primeiro.novo).toBe(true);
    expect((await repo.resumo(perfil)).pedidos).toBe(1);
  });

  it('reimportar com taxa corrigida atualiza a margem', async () => {
    await repo.registrar(perfil, capturado());
    const r = await repo.registrar(perfil, capturado({ repasseLiquido: reaisParaCentavos(58) }));
    expect(r.pedido.margemRealizada).toBe(reaisParaCentavos(28));
  });

  it('conta pedido sem custo, que é o que falta preencher', async () => {
    await repo.registrar(perfil, capturado({ ean: null, custoNaVenda: null }));
    expect((await repo.resumo(perfil)).semCusto).toBe(1);
  });

  describe('fila do dia', () => {
    it('traz o título do produto quando o pedido casou com SKU', async () => {
      await repo.registrar(
        perfil,
        capturado({ prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') }),
      );
      const fila = await repo.filaDoDia(perfil, AGORA);
      expect(fila.itens[0]?.tituloDoProduto).toBe('Refil PA21G');
      expect(fila.itens[0]?.urgencia).toBe('hoje');
    });

    it('confirmar postagem tira da fila', async () => {
      const r = await repo.registrar(
        perfil,
        capturado({ prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') }),
      );
      expect(await repo.confirmarPostagem(perfil, r.pedido.id, AGORA, 'BR123')).toBe(true);

      const fila = await repo.filaDoDia(perfil, AGORA);
      expect(fila.itens).toHaveLength(0);
      expect(fila.jaPostados).toBe(1);
    });

    it('não confirma pedido de outro perfil', async () => {
      const r = await repo.registrar(perfil, capturado());
      const outros = await conexao.db
        .insert(perfilVendedor)
        .values({ slug: 'outro-pedidos', nome: 'Outro', regime: 'cpf' })
        .returning({ id: perfilVendedor.id });
      const outro = perfilId(outros[0]?.id ?? '');
      expect(await repo.confirmarPostagem(outro, r.pedido.id, AGORA)).toBe(false);
    });
  });

  describe('divergência de repasse', () => {
    it('acha o pedido em que a plataforma repassa menos do que as taxas explicam', async () => {
      await repo.registrar(perfil, capturado({ repasseLiquido: reaisParaCentavos(58) }));
      const achados = await repo.divergenciasDeRepasse(perfil);
      expect(achados).toHaveLength(1);
      expect(achados[0]?.divergencia).toBe(reaisParaCentavos(-4));
    });

    it('ignora quem fecha na conta', async () => {
      await repo.registrar(perfil, capturado());
      expect(await repo.divergenciasDeRepasse(perfil)).toHaveLength(0);
    });

    it('ignora pedido sem repasse informado, porque não há o que conferir', async () => {
      await repo.registrar(perfil, capturado({ repasseLiquido: null }));
      expect(await repo.divergenciasDeRepasse(perfil)).toHaveLength(0);
    });
  });
});
