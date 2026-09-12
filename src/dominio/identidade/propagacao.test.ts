/**
 * Testes da propagação de SKU, contra Postgres de verdade.
 *
 * A propagação é a ponte entre o grafo compartilhado e a operação de um perfil, e é
 * o passo em que o M3 vira dinheiro: um SKU com N ocorrências de fornecedores e
 * plataformas diferentes responde na hora qual fornecedor é mais barato e a que preço
 * o mercado vende.
 *
 * Dois comportamentos que não podem regredir: SKU de outro perfil é recusado pelo
 * tipo e pela consulta, e ocorrência que já pertence a outro SKU **não** é religada —
 * vira conflito reportado.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, produtoExterno, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { ocorrenciasDoSku, propagarSku } from './propagacao';
import { ResolvedorDeIdentidade } from './resolucao';

const TABELAS = [
  'par_identidade',
  'exemplo_identidade',
  'llm_call',
  'embedding',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

const REFIL_ANUNCIO = { tipoProduto: 'refil de filtro', marca: 'Electrolux', modeloPeca: 'PA21G' };
const REFIL_DISTRIBUIDOR = {
  tipoProduto: 'elemento filtrante',
  marca: 'electrolux do brasil s/a',
  modeloPeca: 'pa 21 g',
};

describe.skipIf(!temBancoDeTeste())('propagação de SKU', () => {
  let conexao: ConexaoDeTeste;
  let perfil: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'propagacao', nome: 'Perfil', regime: 'mei' })
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  async function ocorrencia(
    hash: string,
    campos: {
      atributos?: Record<string, unknown> | null;
      preco?: number | null;
      vendedor?: string;
    } = {},
  ): Promise<string> {
    const criados = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: `ocorrência ${hash}`,
        hashConteudo: hash,
        fonte: 'm0_link',
        atributosExtraidos: campos.atributos ?? null,
        preco: campos.preco ?? null,
        vendedor: campos.vendedor ?? null,
      })
      .returning({ id: produtoExterno.id });
    const id = criados[0]?.id;
    if (id === undefined) throw new Error('não criou a ocorrência');
    return id;
  }

  it('liga ao SKU as ocorrências afirmadas equivalentes', async () => {
    const a = await ocorrencia('h1', {
      atributos: REFIL_ANUNCIO,
      preco: 4_990,
      vendedor: 'loja',
    });
    const b = await ocorrencia('h2', {
      atributos: REFIL_DISTRIBUIDOR,
      preco: 1_990,
      vendedor: 'distribuidor',
    });
    const resolvedor = new ResolvedorDeIdentidade(conexao.db);
    await resolvedor.prepararLote();
    await resolvedor.resolver(a);

    const criados = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Refil PA21G' })
      .returning({ id: sku.id });
    const skuId = criados[0]?.id ?? '';
    await conexao.db.update(produtoExterno).set({ skuId }).where(eq(produtoExterno.id, a));

    const r = await propagarSku(conexao.db, { perfil, skuId });
    expect(r.ligadas).toEqual([b]);
    expect(r.conflitos).toEqual([]);

    // E é aqui que o grafo vira dinheiro: as duas pontas do mesmo produto.
    const ocorrencias = await ocorrenciasDoSku(conexao.db, perfil, skuId);
    expect(ocorrencias.map((o) => o.preco)).toEqual([1_990, 4_990]);
  });

  it('não religa ocorrência que já pertence a outro SKU — reporta conflito', async () => {
    const a = await ocorrencia('h1', { atributos: REFIL_ANUNCIO });
    const b = await ocorrencia('h2', { atributos: REFIL_DISTRIBUIDOR });
    const resolvedor = new ResolvedorDeIdentidade(conexao.db);
    await resolvedor.prepararLote();
    await resolvedor.resolver(a);

    const criados = await conexao.db
      .insert(sku)
      .values([
        { perfilId: perfil, tituloInterno: 'SKU um' },
        { perfilId: perfil, tituloInterno: 'SKU dois' },
      ])
      .returning({ id: sku.id });
    const um = criados[0]?.id ?? '';
    const dois = criados[1]?.id ?? '';
    await conexao.db.update(produtoExterno).set({ skuId: um }).where(eq(produtoExterno.id, a));
    await conexao.db.update(produtoExterno).set({ skuId: dois }).where(eq(produtoExterno.id, b));

    const r = await propagarSku(conexao.db, { perfil, skuId: um });
    expect(r.ligadas).toEqual([]);
    expect(r.conflitos).toEqual([{ produtoId: b, skuId: dois }]);
  });

  it('recusa propagar para SKU de outro perfil', async () => {
    const outros = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'outro', nome: 'Outro', regime: 'cpf' })
      .returning({ id: perfilVendedor.id });
    const criados = await conexao.db
      .insert(sku)
      .values({ perfilId: outros[0]?.id ?? '', tituloInterno: 'de outro perfil' })
      .returning({ id: sku.id });

    await expect(propagarSku(conexao.db, { perfil, skuId: criados[0]?.id ?? '' })).rejects.toThrow(
      /não existe neste perfil/,
    );
  });
});
