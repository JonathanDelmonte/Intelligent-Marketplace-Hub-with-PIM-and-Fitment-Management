/**
 * Testes do repositório de fornecedor, contra Postgres de verdade.
 *
 * O que só o banco prova: que a triagem é **recalculada na leitura** e não gravada,
 * que responder um campo não apaga os outros, e que o histórico de preço registra
 * cada gravação — que é o que detecta aumento silencioso.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { fornecedorSku, pedido, perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import type { Conferencia } from './conferencia';
import { AUMENTO_QUE_AVISA_BP, FornecedorInvalido, RepositorioDeFornecedores } from './repositorio';
import { CRITERIO_PADRAO } from './triagem';

/** Uma conferência pronta, com ou sem a loja própria achada. */
function conferencia(params: { readonly em: Date; readonly loja: boolean }): Conferencia {
  return {
    em: params.em.toISOString(),
    cadastro: { tipo: 'sem_documento' },
    vitrine: {
      buscadoComo: 'Acme Distribuidora',
      conferidas: params.loja ? ['ml'] : ['ml', 'shopee', 'amazon'],
      lojas: params.loja
        ? [
            {
              plataforma: 'ml',
              titulo: 'Acme Distribuidora | Mercado Livre',
              url: 'https://www.mercadolivre.com.br/loja/acme-distribuidora',
            },
          ]
        : [],
      indicios: [],
      falha: null,
    },
  };
}

const TABELAS = [
  'pedido',
  'fornecedor_preco_historico',
  'fornecedor_sku',
  'fornecedor',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

describe.skipIf(!temBancoDeTeste())('RepositorioDeFornecedores', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeFornecedores;
  let perfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeFornecedores(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'fornecedores', nome: 'Perfil', regime: 'mei' })
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Refil de purificador' })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const criar = (nome = 'Acme Distribuidora') => repo.criar({ nome, fonte: 'manual' });

  it('nasce com as cinco perguntas em branco, então o veredito é "perguntar"', async () => {
    const f = await criar();
    expect(f.triagem.veredito).toBe('perguntar');
    expect(f.triagem.pendentes).toHaveLength(5);
  });

  it('recusa fornecedor sem nome', async () => {
    await expect(repo.criar({ nome: '   ', fonte: 'manual' })).rejects.toThrow(FornecedorInvalido);
  });

  it('responder uma pergunta não apaga as outras', async () => {
    const f = await criar();
    await repo.responder(f.id, { emiteNf: true });
    const depois = await repo.responder(f.id, { postaComEtiqueta: true });
    expect(depois?.emiteNf).toBe(true);
    expect(depois?.postaComEtiqueta).toBe(true);
  });

  it('responder "vende direto" descarta na leitura seguinte', async () => {
    const f = await criar();
    await repo.responder(f.id, { vendeDiretoMarketplace: true });
    const lido = await repo.porId(f.id);
    expect(lido?.triagem.veredito).toBe('descartar');
    expect(lido?.triagem.descarteAutomatico).toBe(true);
  });

  it('a triagem é recalculada na leitura, então mudar o critério muda o veredito', async () => {
    // Se o veredito fosse coluna, subir o limite de prazo deixaria a base com dois
    // vereditos conforme a data do cadastro.
    const f = await criar();
    await repo.responder(f.id, {
      postaComEtiqueta: true,
      emiteNf: true,
      prazoPostagemDias: 10,
      pedidoMinimoUn: 0,
      vendeDiretoMarketplace: false,
    });
    expect((await repo.porId(f.id))?.triagem.veredito).toBe('ressalva');

    const tolerante = new RepositorioDeFornecedores(conexao.db, {
      ...CRITERIO_PADRAO,
      prazoMaximoDias: 15,
    });
    expect((await tolerante.porId(f.id))?.triagem.veredito).toBe('aprovado');
  });

  it('lista em ordem alfabética e conta por veredito', async () => {
    const zeta = await repo.criar({ nome: 'Zeta', fonte: 'manual' });
    await repo.criar({ nome: 'Alfa', fonte: 'manual' });
    await repo.responder(zeta.id, { vendeDiretoMarketplace: true });

    expect((await repo.listar()).map((f) => f.nome)).toEqual(['Alfa', 'Zeta']);
    const contagem = await repo.contarPorVeredito();
    expect(contagem.descartar).toBe(1);
    expect(contagem.perguntar).toBe(1);
  });

  it('porId devolve nulo para quem não existe', async () => {
    expect(await repo.porId('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  describe('conferência de CNPJ e vitrine (7.3)', () => {
    const AGORA = new Date('2026-09-24T12:00:00Z');

    it('loja própria achada responde "vende direto" que estava em branco, e descarta', async () => {
      const f = await criar();
      const r = await repo.registrarConferencia(f.id, conferencia({ em: AGORA, loja: true }));

      expect(r?.respondeu).toBe(true);
      expect(r?.fornecedor).toMatchObject({
        vendeDiretoMarketplace: true,
        vendeDiretoFonte: 'm0_link',
        vendeDiretoVerificadoEm: AGORA,
      });
      expect(r?.fornecedor.triagem.veredito).toBe('descartar');
      expect(r?.fornecedor.conferencia?.vitrine.lojas).toHaveLength(1);
    });

    it('resposta dada à mão não é trocada; a conferência fica gravada ao lado', async () => {
      const f = await criar();
      await repo.responder(f.id, { vendeDiretoMarketplace: false });
      const r = await repo.registrarConferencia(f.id, conferencia({ em: AGORA, loja: true }));

      expect(r?.respondeu).toBe(false);
      expect(r?.fornecedor).toMatchObject({
        vendeDiretoMarketplace: false,
        vendeDiretoFonte: 'manual',
      });
      expect(r?.fornecedor.conferencia?.vitrine.lojas).toHaveLength(1);
    });

    it('não achar loja não responde "não": a pergunta continua em aberto', async () => {
      const f = await criar();
      const r = await repo.registrarConferencia(f.id, conferencia({ em: AGORA, loja: false }));
      expect(r?.respondeu).toBe(false);
      expect(r?.fornecedor.vendeDiretoMarketplace).toBeNull();
      expect(r?.fornecedor.conferencia?.em).toBe(AGORA.toISOString());
    });

    it('para conferir: o nunca conferido primeiro, e nem quem já foi descartado à mão', async () => {
      const conferido = await repo.criar({ nome: 'Conferido', fonte: 'manual' });
      const vencido = await repo.criar({ nome: 'Vencido', fonte: 'manual' });
      const descartado = await repo.criar({ nome: 'Descartado', fonte: 'manual' });
      const novo = await repo.criar({ nome: 'Novo', fonte: 'manual' });

      await repo.registrarConferencia(conferido.id, conferencia({ em: AGORA, loja: false }));
      await repo.registrarConferencia(
        vencido.id,
        conferencia({ em: new Date('2026-05-01T12:00:00Z'), loja: false }),
      );
      await repo.responder(descartado.id, { vendeDiretoMarketplace: true });

      const fila = await repo.paraConferir(AGORA, 10);
      expect(fila.map((f) => f.nome)).toEqual(['Novo', 'Vencido']);
      expect((await repo.paraConferir(AGORA))[0]?.id).toBe(novo.id);
    });

    it('apagar a resposta à mão apaga também de quem ela era', async () => {
      const f = await criar();
      await repo.responder(f.id, { vendeDiretoMarketplace: true });
      const apagado = await repo.responder(f.id, { vendeDiretoMarketplace: null });
      expect(apagado).toMatchObject({
        vendeDiretoMarketplace: null,
        vendeDiretoFonte: null,
        vendeDiretoVerificadoEm: null,
      });
    });
  });

  describe('confiabilidade pelo atraso real (7.5)', () => {
    // 2026-09-25 é sexta-feira; o fornecedor promete postar em 1 dia útil.
    const AGORA = new Date('2026-10-15T12:00:00-03:00');
    const SEXTA = new Date('2026-09-25T14:00:00-03:00');
    const SEGUNDA = new Date('2026-09-28T18:00:00-03:00');
    const TERCA = new Date('2026-09-29T18:00:00-03:00');

    let pedidos = 0;
    const venda = async (params: {
      readonly skuId: string;
      readonly postadoEm: Date | null;
      readonly perfil?: PerfilId;
      readonly data?: Date;
    }) => {
      pedidos += 1;
      await conexao.db.insert(pedido).values({
        perfilId: params.perfil ?? perfil,
        skuId: params.skuId,
        plataforma: 'ml',
        idExterno: `P-${String(pedidos)}`,
        data: params.data ?? SEXTA,
        precoBruto: centavos(5_000),
        postagemConfirmadaEm: params.postadoEm,
        fonte: 'm1_planilha',
      });
    };

    it('mede a fração postada no prazo prometido, com cinco pedidos ou mais', async () => {
      const f = await criar();
      await repo.responder(f.id, { prazoPostagemDias: 1 });
      await conexao.db.insert(fornecedorSku).values({ fornecedorId: f.id, skuId, fonte: 'manual' });

      for (let i = 0; i < 4; i += 1) await venda({ skuId, postadoEm: SEGUNDA });
      await venda({ skuId, postadoEm: TERCA });
      // Não confirmado não mede; e o de fora da janela de 180 dias também não.
      await venda({ skuId, postadoEm: null });
      await venda({ skuId, postadoEm: SEGUNDA, data: new Date('2026-01-10T12:00:00-03:00') });

      const medidas = await repo.confiabilidades(perfil, AGORA);
      expect(medidas.get(f.id)).toEqual({ tipo: 'medida', nota: 3, medidos: 5, noPrazo: 4 });
    });

    it('pedido de produto com dois fornecedores não conta para nenhum', async () => {
      const a = await repo.criar({ nome: 'A', fonte: 'manual' });
      const b = await repo.criar({ nome: 'B', fonte: 'manual' });
      await repo.responder(a.id, { prazoPostagemDias: 1 });
      await conexao.db.insert(fornecedorSku).values([
        { fornecedorId: a.id, skuId, fonte: 'manual' },
        { fornecedorId: b.id, skuId, fonte: 'manual' },
      ]);
      await venda({ skuId, postadoEm: TERCA });

      expect((await repo.confiabilidades(perfil, AGORA)).size).toBe(0);
    });

    it('pedido de outro perfil não entra na medida deste', async () => {
      const outros = await conexao.db
        .insert(perfilVendedor)
        .values({ slug: 'outro-perfil', nome: 'Outro', regime: 'cpf' })
        .returning({ id: perfilVendedor.id });
      const outroPerfil = perfilId(outros[0]?.id ?? '');
      const f = await criar();
      await repo.responder(f.id, { prazoPostagemDias: 1 });
      await conexao.db.insert(fornecedorSku).values({ fornecedorId: f.id, skuId, fonte: 'manual' });
      await venda({ skuId, postadoEm: SEGUNDA, perfil: outroPerfil });

      expect((await repo.confiabilidades(perfil, AGORA)).get(f.id)).toBeUndefined();
      expect((await repo.confiabilidades(outroPerfil, AGORA)).get(f.id)).toEqual({
        tipo: 'poucos',
        medidos: 1,
      });
    });
  });

  describe('preço', () => {
    it('a primeira gravação não tem anterior e não avisa de aumento', async () => {
      const f = await criar();
      const r = await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(30),
        fonte: 'manual',
      });
      expect(r.precoAnterior).toBeNull();
      expect(r.variacaoBp).toBeNull();
      expect(r.aumentoRelevante).toBe(false);
    });

    it('detecta o aumento em pontos-base, com o preço anterior', async () => {
      const f = await criar();
      await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(30),
        fonte: 'manual',
      });
      const r = await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(33),
        fonte: 'manual',
      });
      expect(r.precoAnterior).toBe(reaisParaCentavos(30));
      expect(r.variacaoBp).toBe(1_000);
      expect(r.aumentoRelevante).toBe(true);
    });

    it('aumento pequeno não vira aviso', async () => {
      const f = await criar();
      await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(100),
        fonte: 'manual',
      });
      const r = await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(101),
        fonte: 'manual',
      });
      expect(r.variacaoBp).toBeLessThan(AUMENTO_QUE_AVISA_BP);
      expect(r.aumentoRelevante).toBe(false);
    });

    it('queda de preço vem com variação negativa e sem aviso', async () => {
      const f = await criar();
      await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(30),
        fonte: 'manual',
      });
      const r = await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: reaisParaCentavos(27),
        fonte: 'manual',
      });
      expect(r.variacaoBp).toBeLessThan(0);
      expect(r.aumentoRelevante).toBe(false);
    });

    it('o histórico ganha linha em toda gravação, mesmo com preço igual', async () => {
      // Saber que o preço foi conferido ontem vale tanto quanto saber qual é.
      const f = await criar();
      for (let i = 0; i < 3; i += 1) {
        await repo.registrarPreco({
          fornecedorId: f.id,
          skuId,
          preco: reaisParaCentavos(30),
          fonte: 'manual',
        });
      }
      expect(await repo.historicoDePreco(f.id, skuId)).toHaveLength(3);
    });

    it('precosDoSku ordena do mais barato, com a triagem de cada um', async () => {
      const caro = await repo.criar({ nome: 'Caro', fonte: 'manual' });
      const barato = await repo.criar({ nome: 'Barato', fonte: 'manual' });
      await repo.responder(barato.id, { vendeDiretoMarketplace: true });
      await repo.registrarPreco({
        fornecedorId: caro.id,
        skuId,
        preco: reaisParaCentavos(40),
        fonte: 'manual',
      });
      await repo.registrarPreco({
        fornecedorId: barato.id,
        skuId,
        preco: reaisParaCentavos(20),
        fonte: 'manual',
      });

      const precos = await repo.precosDoSku(perfil, skuId);
      expect(precos.map((p) => p.fornecedorNome)).toEqual(['Barato', 'Caro']);
      // O mais barato é justamente quem vende na mesma vitrine: a tela precisa
      // desse veredito para não recomendar o descartado só por ser barato.
      expect(precos[0]?.triagem.veredito).toBe('descartar');
    });

    it('não devolve preço de SKU de outro perfil', async () => {
      const outros = await conexao.db
        .insert(perfilVendedor)
        .values({ slug: 'outro-perfil', nome: 'Outro', regime: 'cpf' })
        .returning({ id: perfilVendedor.id });
      const outroPerfil = perfilId(outros[0]?.id ?? '');

      const f = await criar();
      await repo.registrarPreco({
        fornecedorId: f.id,
        skuId,
        preco: centavos(3_000),
        fonte: 'manual',
      });

      expect(await repo.precosDoSku(outroPerfil, skuId)).toHaveLength(0);
    });
  });
});
