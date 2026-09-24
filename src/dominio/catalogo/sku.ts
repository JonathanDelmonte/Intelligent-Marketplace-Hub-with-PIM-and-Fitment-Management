/**
 * Catálogo de SKU (M2, etapa 3.10).
 *
 * Um `sku` é a verdade única sobre o que o perfil vende, e é criado **por decisão
 * humana** a partir de um ou mais `produto_externo`. Margem realizada só existe
 * porque isto existe.
 *
 * **Toda operação aqui exige `PerfilId`, e o compilador recusa a chamada sem ele.**
 * É a aplicação mecânica do ADR 0003: esquecer o filtro de perfil é um bug
 * silencioso — a query funciona e devolve dado do perfil errado. Um tipo nominal
 * transforma esse bug silencioso em erro de compilação.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Centavos } from '@/lib/dinheiro';
import type { Banco } from '@/infra/banco/cliente';
import { ehGtinValido } from '@/dominio/gtin';
import { produtoExterno, sku } from '@/infra/banco/schema';

declare const marcaPerfilId: unique symbol;

/**
 * Identificador de perfil, nominal.
 *
 * Um `string` cru não é aceito onde se espera `PerfilId`, então não há como
 * passar o id errado por acidente — nem esquecer de passar.
 */
export type PerfilId = string & { readonly [marcaPerfilId]: true };

export function perfilId(valor: string): PerfilId {
  const analise = z.string().uuid().safeParse(valor);
  if (!analise.success) {
    throw new CatalogoError(`perfil_id precisa ser UUID, recebeu ${JSON.stringify(valor)}`);
  }
  return valor as PerfilId;
}

export class CatalogoError extends Error {
  override readonly name = 'CatalogoError';
}

export const TIPOS_SKU = ['proprio', 'revenda', 'consignado'] as const;
export type TipoSku = (typeof TIPOS_SKU)[number];

export const esquemaNovoSku = z.object({
  tituloInterno: z.string().trim().min(3, 'título interno muito curto'),
  /**
   * GTIN do produto, validado por dígito verificador.
   *
   * Conferir só a quantidade de dígitos deixaria passar código digitado errado, e
   * é aqui que o erro é mais barato de corrigir — depois ele vira um SKU que o
   * leitor de código de barras nunca acha. Código interno de fornecedor que não é
   * GTIN tem campo próprio, e a mensagem aponta para ele.
   */
  ean: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s.\-_]/g, ''))
    .refine(
      (v) => ehGtinValido(v),
      'não é um GTIN válido: confira os dígitos. Código interno de fornecedor vai em sku_vendedor',
    )
    .nullable()
    .default(null),
  marca: z.string().trim().nullable().default(null),
  categoriaMl: z.string().trim().nullable().default(null),
  categoriaShopee: z.string().trim().nullable().default(null),
  pesoG: z.number().int().positive().nullable().default(null),
  dimMm: z
    .object({
      comprimento: z.number().positive(),
      largura: z.number().positive(),
      altura: z.number().positive(),
    })
    .nullable()
    .default(null),
  ncm: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'NCM tem 8 dígitos')
    .nullable()
    .default(null),
  cest: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'CEST tem 7 dígitos')
    .nullable()
    .default(null),
  cst: z.string().trim().nullable().default(null),
  cclasstrib: z.string().trim().nullable().default(null),
  categoriaRegulada: z.string().trim().nullable().default(null),
  voltagem: z.string().trim().max(60).nullable().default(null),
  medida: z.string().trim().max(120).nullable().default(null),
  quantidadeEmbalagem: z.number().int().positive().nullable().default(null),
  custoAtual: z.number().int().nonnegative().nullable().default(null),
  tipo: z.enum(TIPOS_SKU).default('revenda'),
  taxaDevolucaoEsperadaBp: z.number().int().min(0).max(10_000).nullable().default(null),
});

export type NovoSku = z.input<typeof esquemaNovoSku>;

export interface Dimensoes {
  readonly comprimento: number;
  readonly largura: number;
  readonly altura: number;
}

export interface SkuGravado {
  readonly id: string;
  readonly perfilId: string;
  readonly tituloInterno: string;
  readonly ean: string | null;
  readonly marca: string | null;
  readonly custoAtual: number | null;
  /**
   * Quando o custo foi informado.
   *
   * Não é enfeite e não é auditoria: é o que permite avisar que o custo envelheceu —
   * ver `custoDefasado` em `catalogo/custo.ts`. Ficou fora de `SkuGravado` até a tela
   * de catálogo existir, e sem ele a tela mostraria custo de oito meses com a mesma
   * cara de custo de ontem.
   */
  readonly custoAtualizadoEm: Date | null;
  readonly pesoG: number | null;
  readonly dimMm: Dimensoes | null;
  /**
   * Voltagem, medida funcional e quantas peças vêm na embalagem.
   *
   * As três são cobradas pelo checklist de atributos no nível `devolucao` (M9 — 8.3), e
   * até a migração 0010 nenhuma tinha coluna: o checklist cobrava o que ninguém tinha
   * onde preencher. `medida` é a medida que decide se a peça encaixa — não é `dimMm`,
   * que é a caixa e serve ao frete.
   */
  readonly voltagem: string | null;
  readonly medida: string | null;
  readonly quantidadeEmbalagem: number | null;
  /** Taxa de devolução esperada, em pontos-base. Entra como custo no M8. */
  readonly taxaDevolucaoEsperadaBp: number | null;
  readonly categoriaMl: string | null;
  readonly tipo: TipoSku;
  readonly ncm: string | null;
  readonly cst: string | null;
  readonly cclasstrib: string | null;
  readonly ativo: boolean;
}

/** Pendências fiscais que bloqueiam emissão de NF-e a partir de 04/01/2027. */
export interface PendenciaFiscal {
  readonly skuId: string;
  readonly tituloInterno: string;
  readonly faltando: readonly ('ncm' | 'cst' | 'cclasstrib')[];
}

export class RepositorioDeSku {
  constructor(private readonly db: Banco) {}

  /**
   * Cria um SKU, opcionalmente ligando `produto_externo` já capturados.
   *
   * A ligação é feita aqui e não na captura: é decisão sua que aquelas ocorrências
   * são o mesmo produto físico. Fundir na captura é o erro que destrói a base.
   */
  async criar(params: {
    readonly perfil: PerfilId;
    readonly dados: NovoSku;
    /** `produto_externo` que originaram este SKU. Revisável depois. */
    readonly produtosExternosIds?: readonly string[];
  }): Promise<SkuGravado> {
    const analise = esquemaNovoSku.safeParse(params.dados);
    if (!analise.success) {
      const problemas = analise.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new CatalogoError(`SKU inválido:\n  ${problemas.join('\n  ')}`);
    }

    const dados = analise.data;

    const criados = await this.db
      .insert(sku)
      .values({
        perfilId: params.perfil,
        ...dados,
        custoAtualizadoEm: dados.custoAtual === null ? null : new Date(),
      })
      .returning();

    const criado = criados[0];
    if (criado === undefined) throw new CatalogoError('falha ao criar SKU');

    if (params.produtosExternosIds !== undefined && params.produtosExternosIds.length > 0) {
      await this.ligarProdutosExternos({
        perfil: params.perfil,
        skuId: criado.id,
        produtosExternosIds: params.produtosExternosIds,
      });
    }

    return paraSku(criado);
  }

  /**
   * Liga `produto_externo` a um SKU.
   *
   * Confere que o SKU é do perfil informado **antes** de escrever: sem isso, um id
   * de outro perfil ligaria ocorrências ao catálogo errado, e o erro não
   * apareceria até alguém estranhar a margem.
   */
  async ligarProdutosExternos(params: {
    readonly perfil: PerfilId;
    readonly skuId: string;
    readonly produtosExternosIds: readonly string[];
  }): Promise<number> {
    const alvo = await this.buscarPorId(params.perfil, params.skuId);
    if (alvo === null) {
      throw new CatalogoError(`SKU ${params.skuId} não existe neste perfil`);
    }

    const ligados = await this.db
      .update(produtoExterno)
      .set({ skuId: params.skuId, atualizadoEm: new Date() })
      .where(sql`${produtoExterno.id} = any(${sql.param([...params.produtosExternosIds])})`)
      .returning({ id: produtoExterno.id });

    return ligados.length;
  }

  /** Desfaz a ligação. A resolução de identidade é revisável por construção. */
  async desligarProdutoExterno(params: {
    readonly perfil: PerfilId;
    readonly produtoExternoId: string;
  }): Promise<boolean> {
    const atual = await this.db
      .select({ skuId: produtoExterno.skuId })
      .from(produtoExterno)
      .where(eq(produtoExterno.id, params.produtoExternoId))
      .limit(1);

    const skuId = atual[0]?.skuId;
    if (skuId === null || skuId === undefined) return false;

    // Só desliga se o SKU for do perfil que pediu.
    if ((await this.buscarPorId(params.perfil, skuId)) === null) {
      throw new CatalogoError('o produto externo está ligado a um SKU de outro perfil');
    }

    await this.db
      .update(produtoExterno)
      .set({ skuId: null, atualizadoEm: new Date() })
      .where(eq(produtoExterno.id, params.produtoExternoId));
    return true;
  }

  async buscarPorId(perfil: PerfilId, id: string): Promise<SkuGravado | null> {
    const linhas = await this.db
      .select()
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, id)))
      .limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraSku(linha);
  }

  async buscarPorEan(perfil: PerfilId, ean: string): Promise<SkuGravado | null> {
    const linhas = await this.db
      .select()
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.ean, ean)))
      .limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraSku(linha);
  }

  /**
   * O produto com este nome, sem diferença de maiúscula nem de espaço repetido.
   *
   * Existe para o "Publicar em" do garimpo não cadastrar duas vezes o mesmo alvo: o
   * formulário de produto novo, aberto com o nome do alvo, avisa quando o nome já está no
   * catálogo e leva ao que existe. Ativo vem antes de desativado — é o que se quer abrir.
   */
  async buscarPorTitulo(perfil: PerfilId, titulo: string): Promise<SkuGravado | null> {
    const linhas = await this.db
      .select()
      .from(sku)
      .where(
        and(
          eq(sku.perfilId, perfil),
          // `[[:space:]]`, e não `\s`: dentro do `sql` (template do JavaScript), a barra
          // some e o Postgres recebia `s+` — trocava letras "s" em vez de espaços.
          sql`lower(regexp_replace(trim(${sku.tituloInterno}), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(trim(${titulo}), '[[:space:]]+', ' ', 'g'))`,
        ),
      )
      .orderBy(desc(sku.ativo))
      .limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraSku(linha);
  }

  async listar(
    perfil: PerfilId,
    opcoes: { readonly apenasAtivos?: boolean; readonly limite?: number } = {},
  ): Promise<readonly SkuGravado[]> {
    const condicoes = [eq(sku.perfilId, perfil)];
    if (opcoes.apenasAtivos !== false) condicoes.push(eq(sku.ativo, true));

    const linhas = await this.db
      .select()
      .from(sku)
      .where(and(...condicoes))
      .limit(opcoes.limite ?? 200);
    return linhas.map(paraSku);
  }

  /**
   * Atualiza o custo e marca quando.
   *
   * `custo_atualizado_em` não é enfeite: custo velho é a causa mais comum de
   * margem otimista, e o sistema precisa poder avisar que o custo está defasado.
   */
  async atualizarCusto(params: {
    readonly perfil: PerfilId;
    readonly skuId: string;
    readonly custo: Centavos;
  }): Promise<boolean> {
    if (params.custo < 0) throw new CatalogoError('custo não pode ser negativo');

    const atualizados = await this.db
      .update(sku)
      .set({ custoAtual: params.custo, custoAtualizadoEm: new Date(), atualizadoEm: new Date() })
      .where(and(eq(sku.perfilId, params.perfil), eq(sku.id, params.skuId)))
      .returning({ id: sku.id });

    return atualizados.length > 0;
  }

  /**
   * Atualiza os campos da ficha que a margem usa.
   *
   * Um método e não sete porque quem preenche preenche de uma vez, olhando a peça na
   * mão: peso na balança, medida na régua, voltagem na etiqueta, quantidade na caixa.
   * Campo ausente do objeto **não é tocado** — é o que separa "não informei agora" de
   * "apaguei o que tinha".
   *
   * Não mexe em custo: custo tem `atualizarCusto`, que grava a data. Juntar os dois
   * faria um salvamento de peso reescrever a data do custo, e a data do custo é o que
   * responde se ele ainda vale.
   */
  async atualizarFicha(params: {
    readonly perfil: PerfilId;
    readonly skuId: string;
    readonly pesoG?: number | null;
    readonly dimMm?: Dimensoes | null;
    readonly taxaDevolucaoEsperadaBp?: number | null;
    readonly marca?: string | null;
    readonly categoriaMl?: string | null;
    readonly voltagem?: string | null;
    readonly medida?: string | null;
    readonly quantidadeEmbalagem?: number | null;
  }): Promise<boolean> {
    if (params.pesoG !== undefined && params.pesoG !== null && params.pesoG <= 0) {
      throw new CatalogoError('peso precisa ser positivo');
    }
    if (
      params.quantidadeEmbalagem !== undefined &&
      params.quantidadeEmbalagem !== null &&
      (!Number.isInteger(params.quantidadeEmbalagem) || params.quantidadeEmbalagem <= 0)
    ) {
      // Zero é recusado e não virou `null` de propósito: "vem zero unidade" não é um
      // cadastro possível, e aceitar como "não informado" esconderia o erro de digitação
      // num campo que decide devolução.
      throw new CatalogoError('quantidade da embalagem precisa ser inteiro positivo');
    }
    if (
      params.taxaDevolucaoEsperadaBp !== undefined &&
      params.taxaDevolucaoEsperadaBp !== null &&
      (params.taxaDevolucaoEsperadaBp < 0 || params.taxaDevolucaoEsperadaBp > 10_000)
    ) {
      throw new CatalogoError('taxa de devolução precisa estar entre 0 e 100%');
    }
    if (params.dimMm !== undefined && params.dimMm !== null) {
      const { comprimento, largura, altura } = params.dimMm;
      if (comprimento <= 0 || largura <= 0 || altura <= 0) {
        throw new CatalogoError('dimensão precisa ser positiva nos três lados');
      }
    }

    const campos = {
      ...(params.pesoG === undefined ? {} : { pesoG: params.pesoG }),
      ...(params.dimMm === undefined ? {} : { dimMm: params.dimMm }),
      ...(params.taxaDevolucaoEsperadaBp === undefined
        ? {}
        : { taxaDevolucaoEsperadaBp: params.taxaDevolucaoEsperadaBp }),
      ...(params.marca === undefined ? {} : { marca: params.marca }),
      ...(params.categoriaMl === undefined ? {} : { categoriaMl: params.categoriaMl }),
      ...(params.voltagem === undefined ? {} : { voltagem: params.voltagem }),
      ...(params.medida === undefined ? {} : { medida: params.medida }),
      ...(params.quantidadeEmbalagem === undefined
        ? {}
        : { quantidadeEmbalagem: params.quantidadeEmbalagem }),
    };

    // Nada a mudar não é erro e não é escrita: um formulário enviado sem alteração
    // nenhuma não deve mexer em `atualizado_em`.
    if (Object.keys(campos).length === 0) return false;

    const atualizados = await this.db
      .update(sku)
      .set({ ...campos, atualizadoEm: new Date() })
      .where(and(eq(sku.perfilId, params.perfil), eq(sku.id, params.skuId)))
      .returning({ id: sku.id });

    return atualizados.length > 0;
  }

  /** Desativa em vez de apagar: pedido antigo ainda precisa resolver para o SKU. */
  async desativar(perfil: PerfilId, id: string): Promise<boolean> {
    return this.definirAtivo(perfil, id, false);
  }

  /**
   * Desfaz a desativação.
   *
   * Existe porque desativar é um clique, e clique errado precisa de volta com o mesmo
   * custo — sem ela, o produto desativado por engano só voltaria por código.
   */
  async reativar(perfil: PerfilId, id: string): Promise<boolean> {
    return this.definirAtivo(perfil, id, true);
  }

  private async definirAtivo(perfil: PerfilId, id: string, ativo: boolean): Promise<boolean> {
    const atualizados = await this.db
      .update(sku)
      .set({ ativo, atualizadoEm: new Date() })
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, id)))
      .returning({ id: sku.id });
    return atualizados.length > 0;
  }

  /** Os desativados, o mais recente primeiro: é de onde se reativa. */
  async desativados(perfil: PerfilId, limite = 100): Promise<readonly SkuGravado[]> {
    const linhas = await this.db
      .select()
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.ativo, false)))
      .orderBy(desc(sku.atualizadoEm))
      .limit(limite);
    return linhas.map(paraSku);
  }

  /** Ocorrências ligadas a um SKU: é o grafo de identidade em forma de lista. */
  async ocorrencias(
    perfil: PerfilId,
    skuId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly tituloBruto: string;
      readonly preco: number | null;
      readonly plataformaOuSite: string | null;
      readonly url: string | null;
    }[]
  > {
    if ((await this.buscarPorId(perfil, skuId)) === null) return [];

    return this.db
      .select({
        id: produtoExterno.id,
        tituloBruto: produtoExterno.tituloBruto,
        preco: produtoExterno.preco,
        plataformaOuSite: produtoExterno.plataformaOuSite,
        url: produtoExterno.url,
      })
      .from(produtoExterno)
      .where(eq(produtoExterno.skuId, skuId));
  }

  /** `produto_externo` ainda sem SKU. É a fila de trabalho do M3. */
  async naoResolvidos(
    limite = 100,
  ): Promise<
    readonly { readonly id: string; readonly tituloBruto: string; readonly preco: number | null }[]
  > {
    return this.db
      .select({
        id: produtoExterno.id,
        tituloBruto: produtoExterno.tituloBruto,
        preco: produtoExterno.preco,
      })
      .from(produtoExterno)
      .where(isNull(produtoExterno.skuId))
      .limit(limite);
  }

  /**
   * SKUs sem o cadastro fiscal que passa a ser obrigatório.
   *
   * NF-e de MEI e Simples sem os grupos de IBS/CBS começa a ser **rejeitada em
   * 04/01/2027**. Fazer esse cadastro com 20 SKUs é uma tarde; com 200 no meio da
   * operação é uma semana perdida em janeiro. Esta consulta é o que permite ver o
   * tamanho da dívida antes de ela vencer.
   */
  async pendenciasFiscais(perfil: PerfilId): Promise<readonly PendenciaFiscal[]> {
    const linhas = await this.db
      .select({
        id: sku.id,
        tituloInterno: sku.tituloInterno,
        ncm: sku.ncm,
        cst: sku.cst,
        cclasstrib: sku.cclasstrib,
      })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.ativo, true)));

    return linhas.flatMap((linha) => {
      const faltando: ('ncm' | 'cst' | 'cclasstrib')[] = [];
      if (linha.ncm === null || linha.ncm === '') faltando.push('ncm');
      if (linha.cst === null || linha.cst === '') faltando.push('cst');
      if (linha.cclasstrib === null || linha.cclasstrib === '') faltando.push('cclasstrib');

      return faltando.length === 0
        ? []
        : [{ skuId: linha.id, tituloInterno: linha.tituloInterno, faltando }];
    });
  }
}

interface LinhaDeSku {
  id: string;
  perfilId: string;
  tituloInterno: string;
  ean: string | null;
  marca: string | null;
  custoAtual: number | null;
  custoAtualizadoEm: Date | null;
  pesoG: number | null;
  dimMm: Dimensoes | null;
  voltagem: string | null;
  medida: string | null;
  quantidadeEmbalagem: number | null;
  taxaDevolucaoEsperadaBp: number | null;
  categoriaMl: string | null;
  tipo: string | null;
  ncm: string | null;
  cst: string | null;
  cclasstrib: string | null;
  ativo: boolean;
}

function paraSku(linha: LinhaDeSku): SkuGravado {
  const tipo = z.enum(TIPOS_SKU).safeParse(linha.tipo);
  return {
    id: linha.id,
    perfilId: linha.perfilId,
    tituloInterno: linha.tituloInterno,
    ean: linha.ean,
    marca: linha.marca,
    custoAtual: linha.custoAtual,
    custoAtualizadoEm: linha.custoAtualizadoEm,
    pesoG: linha.pesoG,
    dimMm: linha.dimMm,
    voltagem: linha.voltagem,
    medida: linha.medida,
    quantidadeEmbalagem: linha.quantidadeEmbalagem,
    taxaDevolucaoEsperadaBp: linha.taxaDevolucaoEsperadaBp,
    categoriaMl: linha.categoriaMl,
    tipo: tipo.success ? tipo.data : 'revenda',
    ncm: linha.ncm,
    cst: linha.cst,
    cclasstrib: linha.cclasstrib,
    ativo: linha.ativo,
  };
}
