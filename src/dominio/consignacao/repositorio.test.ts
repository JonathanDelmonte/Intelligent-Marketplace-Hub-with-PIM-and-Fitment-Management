/**
 * Testes do repositório de consignação, contra Postgres de verdade.
 *
 * O que só o banco prova: que o estado da conferência é **calculado na leitura** e
 * portanto envelhece sozinho, que conferir grava a contagem junto com a data, que o
 * mesmo SKU em duas lojas é duas linhas, e que nenhuma query atravessa perfil.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { pedido, perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { INTERVALO_DE_CONFERENCIA_DIAS } from './conferencia';
import { RepositorioDeConsignacao } from './repositorio';

const TABELAS = ['consignacao', 'pedido', 'produto_externo', 'sku', 'perfil_vendedor'] as const;

const AGORA = new Date('2026-09-14T15:00:00Z');
const diasAtras = (dias: number): Date => new Date(AGORA.getTime() - dias * 86_400_000);

describe.skipIf(!temBancoDeTeste())('RepositorioDeConsignacao', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeConsignacao;
  let perfil: PerfilId;
  let outroPerfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeConsignacao(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'consignacao', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'consignacao-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outroPerfil = perfilId(perfis[1]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Refil PA21G', custoAtual: reaisParaCentavos(30) })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('linha nova entra como nunca conferida, e é o topo do quadro', async () => {
    await repo.registrar(perfil, { parceiroNome: 'Loja do Centro', skuId, qtdDisponivel: 5 });

    const quadro = await repo.quadroDeConferencia(perfil, { agora: AGORA });
    expect(quadro.itens).toHaveLength(1);
    expect(quadro.itens[0]?.estado).toBe('nunca');
    expect(quadro.itens[0]?.tituloDoProduto).toBe('Refil PA21G');
    expect(quadro.unidadesEmRisco).toBe(5);
  });

  it('registrar duas vezes atualiza a mesma linha, não cria a segunda', async () => {
    await repo.registrar(perfil, { parceiroNome: 'Loja do Centro', skuId, qtdDisponivel: 5 });
    await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 9,
      precoAcordadoRepasse: reaisParaCentavos(40),
    });

    const quadro = await repo.quadroDeConferencia(perfil, { agora: AGORA });
    expect(quadro.itens).toHaveLength(1);
    expect(quadro.itens[0]?.qtdDisponivel).toBe(9);
  });

  it('o mesmo SKU em duas lojas são duas linhas, que é o ponto de comparar', async () => {
    await repo.registrar(perfil, { parceiroNome: 'Loja A', skuId, qtdDisponivel: 3 });
    await repo.registrar(perfil, { parceiroNome: 'Loja B', skuId, qtdDisponivel: 7 });

    const quadro = await repo.quadroDeConferencia(perfil, { agora: AGORA });
    expect(quadro.itens).toHaveLength(2);
    expect(quadro.parceirosEmRisco).toEqual(['Loja A', 'Loja B']);
  });

  it('conferir grava a contagem do parceiro junto com a data', async () => {
    // Marcar a data sem a contagem apagaria o alerta e deixaria o número errado —
    // que é exatamente o risco que o módulo cobre.
    const linha = await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 5,
    });

    expect(await repo.registrarConferencia(perfil, linha.id, 2, AGORA)).toBe(true);

    const quadro = await repo.quadroDeConferencia(perfil, { agora: AGORA });
    expect(quadro.itens[0]?.qtdDisponivel).toBe(2);
    expect(quadro.itens[0]?.estado).toBe('em_dia');
    expect(quadro.unidadesEmRisco).toBe(0);
  });

  it('o estado envelhece sozinho: nada é gravado e nenhum job precisa passar', async () => {
    const linha = await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 4,
    });
    await repo.registrarConferencia(
      perfil,
      linha.id,
      4,
      diasAtras(INTERVALO_DE_CONFERENCIA_DIAS + 3),
    );

    const quadro = await repo.quadroDeConferencia(perfil, { agora: AGORA });
    expect(quadro.itens[0]?.estado).toBe('vencida');
    expect(quadro.itens[0]?.emRisco).toBe(true);
  });

  it('conferência de outro perfil é recusada, não aplicada em silêncio', async () => {
    const linha = await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 5,
    });

    expect(await repo.registrarConferencia(outroPerfil, linha.id, 0, AGORA)).toBe(false);
    // E a linha original ficou intacta.
    expect((await repo.porId(perfil, linha.id))?.qtdDisponivel).toBe(5);
  });

  it('o quadro não atravessa perfil', async () => {
    await repo.registrar(perfil, { parceiroNome: 'Loja do Centro', skuId, qtdDisponivel: 5 });
    expect((await repo.quadroDeConferencia(outroPerfil, { agora: AGORA })).itens).toHaveLength(0);
  });

  it('fechamento soma a venda do SKU consignado no período', async () => {
    await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 5,
      precoAcordadoRepasse: reaisParaCentavos(40),
    });

    await conexao.db.insert(pedido).values([
      {
        perfilId: perfil,
        plataforma: 'ml' as const,
        idExterno: 'MLB-1',
        data: new Date('2026-09-10T12:00:00Z'),
        qtd: 2,
        precoBruto: reaisParaCentavos(100),
        skuId,
        fonte: 'm1_planilha' as const,
      },
      // Fora do período: não entra.
      {
        perfilId: perfil,
        plataforma: 'ml' as const,
        idExterno: 'MLB-2',
        data: new Date('2026-08-10T12:00:00Z'),
        qtd: 1,
        precoBruto: reaisParaCentavos(100),
        skuId,
        fonte: 'm1_planilha' as const,
      },
    ]);

    const f = await repo.fechamento(perfil, '2026-09-01', '2026-09-30');
    expect(f.unidades).toBe(2);
    expect(f.totalARepassar).toBe(reaisParaCentavos(80));
    expect(f.completo).toBe(true);
  });

  it('venda de SKU sem acordo de repasse fica pendente, não soma zero', async () => {
    await repo.registrar(perfil, { parceiroNome: 'Loja do Centro', skuId, qtdDisponivel: 5 });
    await conexao.db.insert(pedido).values({
      perfilId: perfil,
      plataforma: 'ml' as const,
      idExterno: 'MLB-3',
      data: new Date('2026-09-10T12:00:00Z'),
      qtd: 1,
      precoBruto: reaisParaCentavos(100),
      skuId,
      fonte: 'm1_planilha' as const,
    });

    const f = await repo.fechamento(perfil, '2026-09-01', '2026-09-30');
    expect(f.totalARepassar).toBe(0);
    expect(f.unidades).toBe(1);
    expect(f.completo).toBe(false);
  });

  it('venda de SKU não consignado não entra no fechamento', async () => {
    const outros = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Item próprio' })
      .returning({ id: sku.id });

    await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 5,
      precoAcordadoRepasse: reaisParaCentavos(40),
    });
    await conexao.db.insert(pedido).values({
      perfilId: perfil,
      plataforma: 'ml' as const,
      idExterno: 'MLB-4',
      data: new Date('2026-09-10T12:00:00Z'),
      qtd: 3,
      precoBruto: reaisParaCentavos(100),
      skuId: outros[0]?.id ?? '',
      fonte: 'm1_planilha' as const,
    });

    const f = await repo.fechamento(perfil, '2026-09-01', '2026-09-30');
    expect(f.unidades).toBe(0);
  });

  it('sem consignação nenhuma o fechamento é vazio, e não varre pedido', async () => {
    const f = await repo.fechamento(perfil, '2026-09-01', '2026-09-30');
    expect(f.porParceiro).toEqual([]);
    expect(f.completo).toBe(true);
  });

  it('porId não devolve linha de outro perfil', async () => {
    const linha = await repo.registrar(perfil, {
      parceiroNome: 'Loja do Centro',
      skuId,
      qtdDisponivel: 5,
    });
    expect(await repo.porId(outroPerfil, linha.id)).toBeNull();
  });
});
