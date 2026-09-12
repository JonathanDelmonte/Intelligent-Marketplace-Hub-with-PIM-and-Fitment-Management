/**
 * Testes da consulta de evidência por GTIN, contra Postgres de verdade.
 *
 * O que se verifica é o encaixe entre a chave canônica e o banco: o mesmo item
 * gravado como UPC-A e como EAN-13 tem que ser achado pela leitura de qualquer um
 * dos dois, e o catálogo de um perfil não pode aparecer na consulta de outro.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizarGtin } from '@/dominio/gtin';
import { RepositorioDeSku, perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { IngestorDeProdutoExterno } from '@/dominio/ingestao/produto-externo';
import { perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { ConsultaDeGtin } from './consulta';

const EAN13 = '7896541200121';
const UPC_A = '036000291452';
const UPC_COMO_EAN = '0036000291452';
const CAIXA = '17896541200128';

describe.skipIf(!temBancoDeTeste())('consulta de evidência por GTIN', () => {
  let conexao: ConexaoDeTeste;
  let consulta: ConsultaDeGtin;
  let ingestor: IngestorDeProdutoExterno;
  let repoSku: RepositorioDeSku;
  let perfilA: PerfilId;
  let perfilB: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    consulta = new ConsultaDeGtin(conexao.db);
    ingestor = new IngestorDeProdutoExterno(conexao.db);
    repoSku = new RepositorioDeSku(conexao.db);

    await limparTabelas(conexao.db, [
      'produto_externo',
      'preco_historico',
      'sku',
      'perfil_vendedor',
    ]);

    const criados = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'perfil-a', nome: 'Perfil A', regime: 'mei' },
        { slug: 'perfil-b', nome: 'Perfil B', regime: 'mei' },
      ])
      .returning({ id: perfilVendedor.id });

    perfilA = perfilId(criados[0]!.id);
    perfilB = perfilId(criados[1]!.id);
  });

  afterAll(async () => {
    await conexao.encerrar();
  });

  const gravar = async (params: {
    readonly ean: string;
    readonly titulo: string;
    readonly precoReais: number;
    readonly vendedor?: string;
    readonly fonte?: 'm1_planilha' | 'm0_link' | 'm3_api';
    readonly diasAtras?: number;
  }) =>
    ingestor.gravar({
      tituloBruto: params.titulo,
      ean: params.ean,
      precoReais: params.precoReais,
      vendedor: params.vendedor ?? null,
      fonte: params.fonte ?? 'm1_planilha',
      coletadoEm: new Date(Date.now() - (params.diasAtras ?? 1) * 86_400_000),
      // Sem o preço: o hash de conteúdo define a IDENTIDADE da captura, e preço
      // novo do mesmo anúncio é recaptura, não outro anúncio.
      conteudoBruto: `${params.titulo}|${params.ean}`,
    });

  it('acha as ocorrências pelo GTIN e monta a evidência', async () => {
    await gravar({
      ean: EAN13,
      titulo: 'Refil PA21G vendedor 1',
      precoReais: 69.9,
      vendedor: 'Loja 1',
    });
    await gravar({
      ean: EAN13,
      titulo: 'Refil PA21G vendedor 2',
      precoReais: 74.9,
      vendedor: 'Loja 2',
    });
    await gravar({ ean: EAN13, titulo: 'Outro produto', precoReais: 19.9, vendedor: 'Loja 3' });

    const r = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });

    expect(r.ocorrencias).toHaveLength(3);
    expect(r.evidencias).toHaveLength(3);
    expect(r.evidencias.map((e) => e.preco).sort((a, b) => a - b)).toEqual([1990, 6990, 7490]);
    expect(r.skuProprio).toBeNull();
  });

  it('UPC-A gravado é achado pela leitura de EAN-13 equivalente, e vice-versa', async () => {
    await gravar({ ean: UPC_A, titulo: 'Produto importado', precoReais: 49.9 });

    const porUpc = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(UPC_A)! });
    const porEan = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(UPC_COMO_EAN)! });

    expect(porUpc.ocorrencias).toHaveLength(1);
    expect(porEan.ocorrencias).toHaveLength(1);
    expect(porEan.ocorrencias[0]?.id).toBe(porUpc.ocorrencias[0]?.id);
  });

  it('o código da caixa não acha as ocorrências da unidade', async () => {
    await gravar({ ean: EAN13, titulo: 'Refil unidade', precoReais: 69.9 });

    const daCaixa = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(CAIXA)! });

    // A caixa é outro item comercial. Achar a unidade aqui faria o veredito
    // comparar custo de caixa com preço de peça.
    expect(daCaixa.ocorrencias).toHaveLength(0);
    expect(daCaixa.evidencias).toHaveLength(0);
  });

  it('GTIN sem nenhuma ocorrência devolve evidência vazia, não erro', async () => {
    const r = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });

    expect(r.ocorrencias).toEqual([]);
    expect(r.evidencias).toEqual([]);
    expect(r.skuProprio).toBeNull();
  });

  it('traz o SKU do próprio perfil, e não o do outro', async () => {
    await repoSku.criar({
      perfil: perfilA,
      dados: { tituloInterno: 'Refil Electrolux PA21G', ean: EAN13, custoAtual: 1200 },
    });
    await repoSku.criar({
      perfil: perfilB,
      dados: { tituloInterno: 'Refil do outro perfil', ean: EAN13 },
    });

    const paraA = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });
    const paraB = await consulta.buscar({ perfil: perfilB, gtin: normalizarGtin(EAN13)! });

    expect(paraA.skuProprio?.tituloInterno).toBe('Refil Electrolux PA21G');
    expect(paraA.skuProprio?.custoAtual).toBe(1200);
    expect(paraB.skuProprio?.tituloInterno).toBe('Refil do outro perfil');
  });

  it('não conta a mesma leitura duas vezes: histórico tem precedência sobre o preço corrente', async () => {
    // A primeira gravação cria a ocorrência e uma linha de histórico. A segunda,
    // com o mesmo conteúdo e preço diferente, acrescenta histórico.
    await gravar({ ean: EAN13, titulo: 'Refil recapturado', precoReais: 69.9 });
    await gravar({ ean: EAN13, titulo: 'Refil recapturado', precoReais: 71.9 });

    const r = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });

    expect(r.ocorrencias).toHaveLength(1);
    // Duas observações de histórico, e o preço corrente NÃO entra de novo.
    expect(r.evidencias).toHaveLength(2);
    expect(r.evidencias.map((e) => e.preco).sort((a, b) => a - b)).toEqual([6990, 7190]);
  });

  it('preserva a procedência de cada observação, que é o que o veredito usa', async () => {
    await gravar({ ean: EAN13, titulo: 'Por API', precoReais: 69.9, fonte: 'm3_api' });
    await gravar({ ean: EAN13, titulo: 'Por link', precoReais: 40, fonte: 'm0_link' });

    const r = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });
    const fontes = r.evidencias.map((e) => e.procedencia.fonte).sort();

    expect(fontes).toEqual(['m0_link', 'm3_api']);
  });

  it('conta os GTINs distintos que a base conhece', async () => {
    expect(await consulta.quantidadeDeGtinsConhecidos()).toBe(0);

    await gravar({ ean: EAN13, titulo: 'Um', precoReais: 10 });
    await gravar({ ean: EAN13, titulo: 'Dois', precoReais: 11 });
    await gravar({ ean: UPC_A, titulo: 'Tres', precoReais: 12 });

    expect(await consulta.quantidadeDeGtinsConhecidos()).toBe(2);
  });

  it('ocorrência sem preço não vira evidência, mas continua aparecendo na lista', async () => {
    await ingestor.gravar({
      tituloBruto: 'Anúncio sem preço',
      ean: EAN13,
      precoReais: null,
      fonte: 'm1_planilha',
      conteudoBruto: 'sem-preco',
    });

    const r = await consulta.buscar({ perfil: perfilA, gtin: normalizarGtin(EAN13)! });

    expect(r.ocorrencias).toHaveLength(1);
    expect(r.evidencias).toHaveLength(0);
  });
});
