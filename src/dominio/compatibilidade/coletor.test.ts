/**
 * Testes da coleta de evidência: a parte pura sozinha, e o laço todo contra
 * Postgres de verdade.
 *
 * O que só o banco prova: que reexecutar o coletor não infla a confiança, que a
 * inferência de família chega à linha do irmão, e que a restrição escreve o
 * conflito em vez de escolher um lado.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, produtoExterno, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  ColetorDeCompatibilidade,
  casarAnuncio,
  indexarPorCodigo,
  tipoDaEvidenciaDaFonte,
} from './coletor';
import { RepositorioDeCompatibilidade } from './repositorio';
import { LIMIAR_PUBLICACAO_BP } from './resolucao';

const TABELAS = [
  'compatibilidade',
  'aparelho',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

describe('indexarPorCodigo', () => {
  it('indexa pelo código normalizado', () => {
    const indice = indexarPorCodigo([{ id: 'a1', marca: 'Acme', modelo: 'xp-21-a' }]);
    expect(indice.get('XP21A')?.[0]?.id).toBe('a1');
  });

  it('deixa fora aparelho cujo modelo não é código', () => {
    const indice = indexarPorCodigo([{ id: 'a1', marca: 'Acme', modelo: 'Purificador Master' }]);
    expect(indice.size).toBe(0);
  });

  it('normaliza a marca, para razão social casar com marca de anúncio', () => {
    const indice = indexarPorCodigo([{ id: 'a1', marca: 'Acme Comercio Ltda', modelo: 'XP21A' }]);
    expect(indice.get('XP21A')?.[0]?.marca).toBe('acme');
  });
});

describe('casarAnuncio', () => {
  const indice = indexarPorCodigo([
    { id: 'a1', marca: 'Acme', modelo: 'XP21A' },
    { id: 'a2', marca: 'Acme', modelo: 'XP26A' },
  ]);

  it('casa o código citado no título', () => {
    const r = casarAnuncio({ titulo: 'Refil Purificador Acme XP21A Original', indice });
    expect(r.achados.map((a) => a.aparelhoId)).toEqual(['a1']);
  });

  it('casa vários códigos de um título só, que é como anúncio de reposição é escrito', () => {
    const r = casarAnuncio({ titulo: 'Refil Acme XP21A XP26A compatível', indice });
    expect(r.achados.map((a) => a.aparelhoId).sort()).toEqual(['a1', 'a2']);
  });

  it('ignora o que não está cadastrado', () => {
    const r = casarAnuncio({ titulo: 'Refil Acme XP99Z', indice });
    expect(r.achados).toHaveLength(0);
    expect(r.codigos).toContain('XP99Z');
  });

  it('usa também os modelos que a extração trouxe', () => {
    const r = casarAnuncio({
      titulo: 'Refil de purificador original',
      modelosCompativeis: ['XP26A'],
      indice,
    });
    expect(r.achados[0]?.aparelhoId).toBe('a2');
    expect(r.achados[0]?.doRegistro).toBe(true);
  });

  it('não casa preço nem medida como modelo', () => {
    const comMedida = indexarPorCodigo([{ id: 'm', marca: 'Acme', modelo: '500ML' }]);
    const r = casarAnuncio({ titulo: 'Refil Acme 500ml R$ 89,90', indice: comMedida });
    expect(r.achados).toHaveLength(0);
  });

  describe('código repetido entre marcas', () => {
    const ambos = indexarPorCodigo([
      { id: 'a1', marca: 'Acme', modelo: 'XP21A' },
      { id: 'b1', marca: 'Beta', modelo: 'XP21A' },
    ]);

    it('desambigua pela marca citada no título', () => {
      const r = casarAnuncio({ titulo: 'Refil Beta XP21A', indice: ambos });
      expect(r.achados.map((a) => a.aparelhoId)).toEqual(['b1']);
    });

    it('sem a marca no título, registra ambiguidade e não escolhe', () => {
      const r = casarAnuncio({ titulo: 'Refil compatível XP21A', indice: ambos });
      expect(r.achados).toHaveLength(0);
      expect(r.ambiguos).toEqual(['XP21A']);
    });
  });
});

describe('tipoDaEvidenciaDaFonte', () => {
  it('planilha própria é anúncio seu, que não confirma nada sozinho', () => {
    expect(tipoDaEvidenciaDaFonte('m1_planilha')).toBe('anuncio_proprio');
  });

  it('as outras portas são anúncio de terceiro', () => {
    expect(tipoDaEvidenciaDaFonte('m0_link')).toBe('concorrente');
    expect(tipoDaEvidenciaDaFonte('m2_publico')).toBe('concorrente');
    expect(tipoDaEvidenciaDaFonte('m3_api')).toBe('concorrente');
  });
});

describe.skipIf(!temBancoDeTeste())('ColetorDeCompatibilidade', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeCompatibilidade;
  let coletor: ColetorDeCompatibilidade;
  let perfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeCompatibilidade(conexao.db);
    coletor = new ColetorDeCompatibilidade(conexao.db, repo);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'compat', nome: 'Perfil', regime: 'mei' })
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

  const anuncio = async (dados: {
    readonly titulo: string;
    readonly hash: string;
    readonly fonte: 'm0_link' | 'm1_planilha';
    readonly url?: string;
  }) => {
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: dados.titulo,
      hashConteudo: dados.hash,
      fonte: dados.fonte,
      skuId,
      url: dados.url ?? `https://exemplo.invalid/${dados.hash}`,
    });
  };

  const cadastrarAparelho = (modelo: string, marca = 'Electrolux') =>
    repo.garantirAparelho({ tipo: 'purificador de agua', marca, modelo, fonte: 'manual' });

  describe('fonte de fora (6.10, 6.11)', () => {
    const AGORA = new Date('2026-09-24T12:00:00Z');
    const REFIL = 'Refil Electrolux EF-ELX-21';

    it('manual que cita o produto publica sozinho, e propaga para o irmão', async () => {
      const pa21g = await cadastrarAparelho('PA21G');
      const pa21b = await cadastrarAparelho('PA21B');
      const r = await coletor.coletarDaFonte({
        skuId,
        tituloDoProduto: REFIL,
        tipo: 'manual_fabricante',
        texto: 'Manual do purificador Electrolux PA21G\nUse somente o refil EF-ELX-21.',
        url: null,
        origem: 'manual-pa21g.pdf',
        agora: AGORA,
      });

      expect(r).toMatchObject({ comForca: 1, paraConferir: 0, produtoTemCodigo: true });
      const linhas = await repo.doSku(skuId);
      const doManual = linhas.find((l) => l.aparelhoId === pa21g.id);
      expect(doManual?.confiancaBp).toBeGreaterThanOrEqual(LIMIAR_PUBLICACAO_BP);
      expect(doManual?.evidencias[0]?.trecho).toBe(
        'manual-pa21g.pdf: Manual do purificador Electrolux PA21G',
      );
      // O irmão de família ganha inferência, que propõe e não publica.
      const irmao = linhas.find((l) => l.aparelhoId === pa21b.id);
      expect(irmao?.evidencias[0]?.tipo).toBe('inferencia_familia');
      expect(irmao?.confiancaBp ?? 0).toBeLessThan(LIMIAR_PUBLICACAO_BP);
    });

    it('página que não cita o produto fica abaixo do corte, para conferir', async () => {
      const pa21g = await cadastrarAparelho('PA21G');
      const r = await coletor.coletarDaFonte({
        skuId,
        tituloDoProduto: REFIL,
        tipo: 'pagina_oficial',
        texto: 'Purificador Electrolux PA21G — conheça',
        url: 'https://fabricante.invalid/pa21g',
        origem: null,
        agora: AGORA,
      });

      expect(r).toMatchObject({ comForca: 0, paraConferir: 1 });
      const linha = (await repo.doSku(skuId)).find((l) => l.aparelhoId === pa21g.id);
      expect(linha?.confiancaBp ?? 0).toBeLessThan(LIMIAR_PUBLICACAO_BP);
      expect(linha?.evidencias[0]?.url).toBe('https://fabricante.invalid/pa21g');
    });
  });

  it('grava aparelho com família derivada da gramática', async () => {
    const a = await cadastrarAparelho('PA21G');
    expect(a.familia).toBe('electrolux:pa21');
    expect(a.linhagem).toBe('electrolux:pa');
  });

  it('garantirAparelho é idempotente', async () => {
    const primeiro = await cadastrarAparelho('PA21G');
    const segundo = await cadastrarAparelho('PA21G');
    expect(segundo.id).toBe(primeiro.id);
    expect(await repo.aparelhos()).toHaveLength(1);
  });

  it('transforma anúncio de terceiro em evidência de compatibilidade', async () => {
    const aparelho = await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Purificador Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });

    const r = await coletor.coletarDoSku(skuId);
    expect(r.evidenciasNovas).toBe(1);

    const linhas = await repo.doSku(skuId);
    const linha = linhas.find((l) => l.aparelhoId === aparelho.id);
    expect(linha?.decisao).toBe('serve');
    expect(linha?.evidencias[0]?.tipo).toBe('concorrente');
    expect(linha?.evidencias[0]?.trecho).toContain('PA21G');
  });

  it('reexecutar não infla a confiança', async () => {
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });

    await coletor.coletarDoSku(skuId);
    const depoisDeUma = (await repo.doSku(skuId))[0]?.confiancaBp;
    await coletor.coletarDoSku(skuId);
    const depoisDeDuas = await repo.doSku(skuId);

    expect(depoisDeDuas[0]?.confiancaBp).toBe(depoisDeUma);
    expect(depoisDeDuas[0]?.evidencias).toHaveLength(1);
  });

  it('três concorrentes distintos publicam; um não', async () => {
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });
    await coletor.coletarDoSku(skuId);
    expect((await repo.doSku(skuId))[0]?.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);

    await anuncio({ titulo: 'Refil Electrolux PA21G compatível', hash: 'h2', fonte: 'm0_link' });
    await anuncio({ titulo: 'Refil original Electrolux PA21G', hash: 'h3', fonte: 'm0_link' });
    await coletor.coletarDoSku(skuId);
    expect((await repo.doSku(skuId))[0]?.confiancaBp).toBeGreaterThanOrEqual(LIMIAR_PUBLICACAO_BP);
  });

  it('anúncio seu entra registrado e não decide nada', async () => {
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'meu', fonte: 'm1_planilha' });

    await coletor.coletarDoSku(skuId);
    const linha = (await repo.doSku(skuId))[0];
    expect(linha?.evidencias[0]?.tipo).toBe('anuncio_proprio');
    expect(linha?.decisao).toBe('indefinido');
    expect(linha?.confiancaBp).toBe(0);
  });

  it('anúncio seu não serve de semente para inferir a família inteira', async () => {
    await cadastrarAparelho('PA21G');
    await cadastrarAparelho('PA21X');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'meu', fonte: 'm1_planilha' });

    const r = await coletor.coletarDoSku(skuId);
    expect(r.inferencias).toBe(0);
  });

  it('propaga para o modelo irmão, abaixo do corte de publicação', async () => {
    const irmao = await cadastrarAparelho('PA21X');
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });
    await anuncio({ titulo: 'Refil Electrolux PA21G original', hash: 'h2', fonte: 'm0_link' });
    await anuncio({ titulo: 'Refil PA21G Electrolux compatível', hash: 'h3', fonte: 'm0_link' });

    const r = await coletor.coletarDoSku(skuId);
    expect(r.inferencias).toBeGreaterThanOrEqual(1);

    const linhas = await repo.doSku(skuId);
    const inferida = linhas.find((l) => l.aparelhoId === irmao.id);
    expect(inferida?.decisao).toBe('serve');
    expect(inferida?.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);
    expect(inferida?.evidencias[0]?.tipo).toBe('inferencia_familia');
  });

  it('a linha inferida cai na fila de revisão', async () => {
    await cadastrarAparelho('PA21X');
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });
    await coletor.coletarDoSku(skuId);

    const fila = await repo.fila(perfil);
    expect(fila.length).toBeGreaterThan(0);
    expect(fila[0]?.skuTitulo).toBe('Refil de purificador');
  });

  it('serve num irmão e não serve no outro é conflito gravado, não escolha', async () => {
    const g = await cadastrarAparelho('PA21G');
    const x = await cadastrarAparelho('PA21X');
    await repo.registrarEvidencia({
      skuId,
      aparelhoId: g.id,
      evidencia: {
        tipo: 'manual_fabricante',
        url: 'https://exemplo.invalid/manual',
        trecho: null,
        em: '2026-09-01T00:00:00.000Z',
        negativa: false,
        forcaBp: null,
      },
    });
    await repo.registrarEvidencia({
      skuId,
      aparelhoId: x.id,
      evidencia: {
        tipo: 'manual_fabricante',
        url: 'https://exemplo.invalid/manual-2',
        trecho: null,
        em: '2026-09-01T00:00:00.000Z',
        negativa: true,
        forcaBp: null,
      },
    });

    const r = await coletor.propagarPorFamilia(skuId);
    expect(r.inconsistencias).toBe(1);
    expect(r.inferencias).toBe(0);

    const linhas = await repo.doSku(skuId);
    for (const l of linhas) {
      expect(l.conflito).toContain('mesmo aparelho');
    }
  });

  it('conta o estado da base para a tela', async () => {
    await cadastrarAparelho('PA21G');
    await anuncio({ titulo: 'Refil Electrolux PA21G', hash: 'h1', fonte: 'm0_link' });
    await anuncio({ titulo: 'Refil Electrolux PA21G x', hash: 'h2', fonte: 'm0_link' });
    await anuncio({ titulo: 'Refil Electrolux PA21G y', hash: 'h3', fonte: 'm0_link' });
    await coletor.coletarDoSku(skuId);

    const estado = await repo.estado(perfil);
    expect(estado.publicaveis).toBe(1);
    expect(estado.aparelhos).toBe(1);
  });

  it('sem anúncio ligado ao SKU não faz nada e não falha', async () => {
    await cadastrarAparelho('PA21G');
    expect(await coletor.coletarDoSku(skuId)).toMatchObject({ anuncios: 0, evidenciasNovas: 0 });
  });
});
