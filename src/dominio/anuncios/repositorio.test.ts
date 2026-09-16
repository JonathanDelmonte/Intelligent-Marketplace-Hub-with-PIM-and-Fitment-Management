/**
 * Testes do repositório de anúncio, contra Postgres de verdade.
 *
 * O que só o banco prova: que o tipo do produto é recuperado do **registro extraído
 * das ocorrências** — porque `sku` não tem coluna para ele —, que entre duas
 * ocorrências vence a mais completa e não a mais recente, e que nenhuma leitura
 * atravessa perfil.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP } from '@/dominio/compatibilidade/resolucao';
import {
  aparelho,
  compatibilidade,
  perfilVendedor,
  produtoExterno,
  sku,
} from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { RepositorioDeAnuncios } from './repositorio';

const TABELAS = [
  'compatibilidade',
  'aparelho',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

const EAN = '7896541200909';

describe.skipIf(!temBancoDeTeste())('RepositorioDeAnuncios', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeAnuncios;
  let perfil: PerfilId;
  let outroPerfil: PerfilId;
  let skuId: string;

  /** Uma ocorrência do SKU, com o registro extraído que o teste quiser. */
  async function ocorrencia(
    hash: string,
    atributos: unknown,
    campos: Record<string, unknown> = {},
  ) {
    await conexao.db.insert(produtoExterno).values({
      skuId,
      tituloBruto: 'Refil bruto de anúncio',
      hashConteudo: hash,
      fonte: 'm2_publico' as const,
      atributosExtraidos: atributos,
      ...campos,
    });
  }

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeAnuncios(conexao.db);

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values([
        { slug: 'anuncios', nome: 'Perfil', regime: 'mei' as const },
        { slug: 'anuncios-outro', nome: 'Outro', regime: 'mei' as const },
      ])
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');
    outroPerfil = perfilId(perfis[1]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({
        perfilId: perfil,
        tituloInterno: 'Refil para purificador PA 21',
        ean: EAN,
        marca: 'Electrolux',
        categoriaMl: 'MLB1234',
        pesoG: 300,
        custoAtual: reaisParaCentavos(30),
      })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('recupera o tipo do produto do registro da ocorrência', async () => {
    // `sku` não tem coluna para isso, e o dado mora em `atributos_extraidos`.
    await ocorrencia('h1', {
      tipoProduto: 'refil de purificador de água',
      modeloPeca: 'EF-ELX-21',
      quantidadeEmbalagem: 2,
    });

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.tipoProduto).toBe('refil de purificador de água');
    expect(dados?.modeloPeca).toBe('EF-ELX-21');
    expect(dados?.quantidadeEmbalagem).toBe(2);
  });

  it('sem registro nenhum cai no título interno, que é o melhor palpite', async () => {
    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.tipoProduto).toBe('Refil para purificador PA 21');
    expect(dados?.modeloPeca).toBeNull();
  });

  it('entre duas ocorrências vence a mais completa, não a mais recente', async () => {
    // Uma ocorrência nova de distribuidor que só publica o código da peça é mais
    // recente e sabe menos que a antiga de um anúncio com a ficha inteira.
    await ocorrencia('h-rica', {
      tipoProduto: 'refil de purificador de água',
      marca: 'Electrolux',
      modeloPeca: 'EF-ELX-21',
      quantidadeEmbalagem: 2,
      material: 'carvão ativado',
    });
    await ocorrencia('h-pobre', { modeloPeca: 'EF-ELX-21' });

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.tipoProduto).toBe('refil de purificador de água');
  });

  it('voltagem, medida e categoria regulada vêm do cadastro', async () => {
    // As três ficavam em `null` na conferência porque ninguém as passava: duas não
    // existiam no schema, e a terceira existia e não era lida. Checklist e alerta
    // decidiam sobre nada.
    await conexao.db
      .update(sku)
      .set({ voltagem: 'Bivolt', medida: 'Rosca 1/2 polegada', categoriaRegulada: 'anvisa' })
      .where(eq(sku.id, skuId));

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.voltagem).toBe('Bivolt');
    expect(dados?.medida).toBe('Rosca 1/2 polegada');
    expect(dados?.categoriaRegulada).toBe('anvisa');
  });

  it('a quantidade do cadastro vence a extraída da ocorrência', async () => {
    // Mesma regra da marca: o número do cadastro é de quem tem a caixa na mão, e o do
    // registro é o que um LLM leu de anúncio de terceiro.
    await ocorrencia('h-quantidade', { quantidadeEmbalagem: 2 });
    await conexao.db.update(sku).set({ quantidadeEmbalagem: 3 }).where(eq(sku.id, skuId));

    expect((await repo.dadosDoSku(perfil, skuId))?.quantidadeEmbalagem).toBe(3);
  });

  it('sem quantidade no cadastro, ainda cai na extraída', async () => {
    await ocorrencia('h-so-extraida', { quantidadeEmbalagem: 4 });
    expect((await repo.dadosDoSku(perfil, skuId))?.quantidadeEmbalagem).toBe(4);
  });

  it('registro ilegível não impede a montagem', async () => {
    // `jsonb` gravado por versão anterior do schema não pode travar um anúncio.
    await ocorrencia('h-lixo', { tipoProduto: 42, modelosCompativeis: 'não é lista' });

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados).not.toBeNull();
    expect(dados?.tipoProduto).toBe('Refil para purificador PA 21');
  });

  it('traz as ocorrências para o alerta de catálogo poder avaliar', async () => {
    await ocorrencia(
      'h1',
      {},
      {
        plataformaOuSite: 'ml',
        url: 'https://www.mercadolivre.com.br/p/MLB12345678',
        vendedor: 'Loja A',
        ean: EAN,
      },
    );

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.ocorrencias).toHaveLength(1);
    expect(dados?.ocorrencias[0]?.url).toContain('/p/MLB');
  });

  it('monta a ficha separando publicável de retida', async () => {
    const aparelhos = await conexao.db
      .insert(aparelho)
      // `fonte` é obrigatória em toda tabela: nenhum registro entra sem procedência
      // (convenções, 3.3).
      .values([
        {
          tipo: 'purificador de agua',
          marca: 'Electrolux',
          modelo: 'PA21G',
          fonte: 'manual' as const,
        },
        {
          tipo: 'purificador de agua',
          marca: 'Electrolux',
          modelo: 'PA26G',
          fonte: 'manual' as const,
        },
      ])
      .returning({ id: aparelho.id });

    // `verificado_por` também é obrigatório: toda afirmação de compatibilidade diz
    // quem a verificou.
    await conexao.db.insert(compatibilidade).values([
      {
        skuId,
        aparelhoId: aparelhos[0]?.id ?? '',
        decisao: 'serve' as const,
        confiancaBp: TOTAL_BP,
        evidencias: [],
        verificadoPor: 'humano' as const,
      },
      {
        skuId,
        aparelhoId: aparelhos[1]?.id ?? '',
        decisao: 'serve' as const,
        confiancaBp: LIMIAR_PUBLICACAO_BP - 1,
        evidencias: [],
        verificadoPor: 'ia' as const,
      },
    ]);

    const dados = await repo.dadosDoSku(perfil, skuId);
    expect(dados?.ficha.publicaveis.map((l) => l.modelo)).toEqual(['PA21G']);
    expect(dados?.ficha.retidas.map((l) => l.modelo)).toEqual(['PA26G']);
  });

  it('gravar a categoria destrava a exportação, que é a razão do método existir', async () => {
    // `categoria` é o único atributo de nível `bloqueia` que ninguém tinha onde
    // preencher: o checklist apontava o problema sem caminho de conserto.
    expect((await repo.dadosDoSku(perfil, skuId))?.categoria).toBe('MLB1234');

    expect(await repo.definirCategoriaMl(perfil, skuId, 'MLB9999')).toBe(true);
    expect((await repo.dadosDoSku(perfil, skuId))?.categoria).toBe('MLB9999');
  });

  it('gravar categoria em SKU de outro perfil é recusado, não aplicado em silêncio', async () => {
    expect(await repo.definirCategoriaMl(outroPerfil, skuId, 'MLB9999')).toBe(false);
    expect((await repo.dadosDoSku(perfil, skuId))?.categoria).toBe('MLB1234');
  });

  it('SKU de outro perfil devolve nulo, e não lança', async () => {
    expect(await repo.dadosDoSku(outroPerfil, skuId)).toBeNull();
  });

  it('candidatos listam o SKU incompleto também, com o que falta', async () => {
    // Esconder o SKU sem EAN esconderia justamente o que o checklist existe para
    // mostrar.
    await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Item sem nada' })
      .returning({ id: sku.id });

    const candidatos = await repo.candidatos(perfil);
    expect(candidatos).toHaveLength(2);

    const incompleto = candidatos.find((c) => c.titulo === 'Item sem nada');
    expect(incompleto?.temEan).toBe(false);
    expect(incompleto?.temCusto).toBe(false);
    expect(incompleto?.compatibilidadesPublicaveis).toBe(0);

    const completo = candidatos.find((c) => c.titulo === 'Refil para purificador PA 21');
    expect(completo?.temEan).toBe(true);
    expect(completo?.temCusto).toBe(true);
  });

  it('candidatos não atravessam perfil', async () => {
    expect(await repo.candidatos(outroPerfil)).toHaveLength(0);
  });

  it('SKU inativo fica fora da lista', async () => {
    await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Desativado', ativo: false });
    const candidatos = await repo.candidatos(perfil);
    expect(candidatos.map((c) => c.titulo)).not.toContain('Desativado');
  });
});
