/**
 * Testes do repositório de fornecedor, contra Postgres de verdade.
 *
 * O que só o banco prova: que a triagem é **recalculada na leitura** e não gravada,
 * que responder um campo não apaga os outros, e que o histórico de preço registra
 * cada gravação — que é o que detecta aumento silencioso.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import { AUMENTO_QUE_AVISA_BP, FornecedorInvalido, RepositorioDeFornecedores } from './repositorio';
import { CRITERIO_PADRAO } from './triagem';

const TABELAS = [
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
