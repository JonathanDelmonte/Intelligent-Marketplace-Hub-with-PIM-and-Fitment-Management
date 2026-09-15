/**
 * Testes do repositório fiscal, contra Postgres de verdade.
 *
 * O que só o banco prova: que o estado fiscal é **recalculado na leitura**, que
 * gravar um campo não apaga os outros, que apagar é diferente de não enviar, e que a
 * receita do teto sai do **preço bruto** e não do repasse.
 */
import { eq } from 'drizzle-orm';
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
import { RepositorioFiscal } from './repositorio';

const TABELAS = ['acumulado_anual', 'pedido', 'produto_externo', 'sku', 'perfil_vendedor'] as const;
const SETEMBRO = new Date('2026-09-15T12:00:00-03:00');

describe.skipIf(!temBancoDeTeste())('RepositorioFiscal', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioFiscal;
  let perfil: PerfilId;
  let outroPerfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioFiscal(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'fiscal', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'fiscal-outro', nome: 'Outro', regime: 'simples' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outroPerfil = perfilId(perfis[1]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Refil para purificador PA 21' })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('SKU sem cadastro fiscal aparece como pendente, com o que falta', async () => {
    const r = await repo.resumo(perfil);
    expect(r.pendentes).toBe(1);
    expect(r.regime).toBe('mei');
    expect(r.skus[0]?.estado.prontoPara2027).toBe(false);
    expect(r.skus[0]?.estado.faltando).toEqual(['ncm', 'cst', 'cclasstrib']);
  });

  it('a contagem rápida de pendentes concorda com o resumo, que varre tudo', async () => {
    // Duas implementações da mesma pergunta — uma em SQL, uma em TypeScript — e é por
    // isso que este teste existe: divergirem é o risco de ter as duas.
    const so = await repo.contarPendentes(perfil);
    expect(so).toBe((await repo.resumo(perfil)).pendentes);

    await repo.gravarCodigos(perfil, skuId, {
      ncm: '84212100',
      cst: '000',
      cclasstrib: '000001',
    });

    expect(await repo.contarPendentes(perfil)).toBe(0);
    expect(await repo.contarPendentes(perfil)).toBe((await repo.resumo(perfil)).pendentes);
  });

  it('a contagem rápida não conta CEST, que não é obrigatório em 2027', async () => {
    await repo.gravarCodigos(perfil, skuId, { ncm: '84212100', cst: '000', cclasstrib: '000001' });
    expect(await repo.contarPendentes(perfil)).toBe(0);
  });

  it('a contagem rápida trata campo com espaço em branco como vazio', async () => {
    // Um `update` direto, porque `gravarCodigos` recusa espaço na validação — e é
    // exatamente por isso que o banco pode ter espaço gravado por outro caminho.
    await conexao.db
      .update(sku)
      .set({ ncm: '84212100', cst: '   ', cclasstrib: '000001' })
      .where(eq(sku.id, skuId));

    expect(await repo.contarPendentes(perfil)).toBe(1);
  });

  it('gravar um campo não apaga os outros', async () => {
    await repo.gravarCodigos(perfil, skuId, { ncm: '84212100' });
    await repo.gravarCodigos(perfil, skuId, { cst: '000' });
    await repo.gravarCodigos(perfil, skuId, { cclasstrib: '000001' });

    const r = await repo.resumo(perfil);
    expect(r.skus[0]?.ncm).toBe('84212100');
    expect(r.skus[0]?.cst).toBe('000');
    expect(r.skus[0]?.estado.prontoPara2027).toBe(true);
    expect(r.pendentes).toBe(0);
  });

  it('apagar é diferente de não enviar', async () => {
    // Confundir os dois perderia cadastro em silêncio numa direção, e impediria
    // corrigir um código errado na outra.
    await repo.gravarCodigos(perfil, skuId, { ncm: '84212100', cst: '000' });
    await repo.gravarCodigos(perfil, skuId, { ncm: null });

    const r = await repo.resumo(perfil);
    expect(r.skus[0]?.ncm).toBeNull();
    expect(r.skus[0]?.cst).toBe('000');
  });

  it('a marcação de categoria regulada grava, e é ela que manda', async () => {
    // Prova de passagem que o nome da propriedade está certo: com o nome da coluna
    // o Drizzle aceitaria em silêncio e a gravação sumiria.
    await repo.gravarCodigos(perfil, skuId, { categoriaRegulada: 'anvisa_suplemento' });

    const r = await repo.resumo(perfil);
    expect(r.skus[0]?.categoriaRegulada).toBe('anvisa_suplemento');
    expect(r.skus[0]?.regulacao.origem).toBe('marcado_no_sku');
    expect(r.regulados).toBe(1);
  });

  it('detecta regulação pelo título quando ninguém marcou nada', async () => {
    await conexao.db.insert(sku).values({ perfilId: perfil, tituloInterno: 'Whey Protein 900g' });

    const r = await repo.resumo(perfil);
    expect(r.regulados).toBe(1);
    expect(r.skus.find((s) => s.tituloInterno.includes('Whey'))?.regulacao.origem).toBe(
      'sugerido_por_palavra',
    );
  });

  it('pendente vem primeiro, porque quem abre a tela vem fazer o que falta', async () => {
    await repo.gravarCodigos(perfil, skuId, {
      ncm: '84212100',
      cst: '000',
      cclasstrib: '000001',
    });
    await conexao.db.insert(sku).values({ perfilId: perfil, tituloInterno: 'Aguardando cadastro' });

    const r = await repo.resumo(perfil);
    expect(r.skus[0]?.tituloInterno).toBe('Aguardando cadastro');
  });

  it('não grava nem lê SKU de outro perfil', async () => {
    expect(await repo.gravarCodigos(outroPerfil, skuId, { ncm: '84212100' })).toBe(false);
    expect((await repo.resumo(outroPerfil)).skus).toHaveLength(0);
    expect((await repo.resumo(perfil)).skus[0]?.ncm).toBeNull();
  });

  it('SKU inativo fica fora: não emite nota quem não vende', async () => {
    await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Desativado', ativo: false });
    expect((await repo.resumo(perfil)).skus).toHaveLength(1);
  });

  it('a receita do teto sai do preço bruto, não do repasse', async () => {
    // Usar o repasse líquido diria um número menor — folga que não existe, que é o
    // erro caro deste arquivo.
    await conexao.db.insert(pedido).values({
      perfilId: perfil,
      plataforma: 'ml' as const,
      idExterno: 'MLB-1',
      data: new Date('2026-03-10T12:00:00Z'),
      qtd: 2,
      precoBruto: reaisParaCentavos(100),
      repasseLiquido: reaisParaCentavos(62),
      fonte: 'm1_planilha' as const,
    });

    expect(await repo.atualizarReceitaDoAno(perfil, 2026)).toBe(reaisParaCentavos(200));
  });

  it('pedido de outro ano não entra na conta do ano', async () => {
    await conexao.db.insert(pedido).values([
      {
        perfilId: perfil,
        plataforma: 'ml' as const,
        idExterno: 'MLB-2026',
        data: new Date('2026-03-10T12:00:00Z'),
        qtd: 1,
        precoBruto: reaisParaCentavos(100),
        fonte: 'm1_planilha' as const,
      },
      {
        perfilId: perfil,
        plataforma: 'ml' as const,
        idExterno: 'MLB-2025',
        data: new Date('2025-03-10T12:00:00Z'),
        qtd: 1,
        precoBruto: reaisParaCentavos(500),
        fonte: 'm1_planilha' as const,
      },
    ]);

    expect(await repo.atualizarReceitaDoAno(perfil, 2026)).toBe(reaisParaCentavos(100));
  });

  it('a receita informada à mão soma com a das plataformas, e sobrevive ao recálculo', async () => {
    // O teto olha receita bruta do regime, que inclui venda fora das plataformas —
    // e recalcular a parte das plataformas não pode apagar a parte informada.
    await conexao.db.insert(pedido).values({
      perfilId: perfil,
      plataforma: 'ml' as const,
      idExterno: 'MLB-1',
      data: new Date('2026-03-10T12:00:00Z'),
      qtd: 1,
      precoBruto: reaisParaCentavos(20_000),
      fonte: 'm1_planilha' as const,
    });
    await repo.informarReceitaExterna(perfil, 2026, reaisParaCentavos(10_000));

    const teto = await repo.teto(perfil, 2026, SETEMBRO);
    expect(teto.acumulado).toBe(reaisParaCentavos(30_000));
    expect(teto.situacao).toBe('tranquilo');
  });

  it('o teto reflete a última importação, não a última visita à tela', async () => {
    const antes = await repo.teto(perfil, 2026, SETEMBRO);
    expect(antes.acumulado).toBe(0);

    await conexao.db.insert(pedido).values({
      perfilId: perfil,
      plataforma: 'ml' as const,
      idExterno: 'MLB-novo',
      data: new Date('2026-04-10T12:00:00Z'),
      qtd: 1,
      precoBruto: reaisParaCentavos(70_000),
      fonte: 'm1_planilha' as const,
    });

    const depois = await repo.teto(perfil, 2026, SETEMBRO);
    expect(depois.acumulado).toBe(reaisParaCentavos(70_000));
    expect(depois.situacao).toBe('perto');
  });

  it('teto zerado no perfil não vira teto zero por acidente', async () => {
    // `teto_anual` nulo significa "usa o padrão", não "o teto é zero".
    const teto = await repo.teto(perfil, 2026, SETEMBRO);
    expect(teto.teto).toBeGreaterThan(0);
  });
});
