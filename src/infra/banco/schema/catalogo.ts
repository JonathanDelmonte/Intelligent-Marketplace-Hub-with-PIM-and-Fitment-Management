/**
 * Catálogo: `sku` (operacional) e `produto_externo` (conhecimento do mundo).
 *
 * A separação entre os dois é a decisão que impede o erro que destrói a base.
 * Você captura dezenas de ocorrências do mesmo produto em lugares diferentes
 * **antes** de saber que são o mesmo produto. Fundir na captura perde a
 * informação de que eram fontes distintas, e com ela a possibilidade de comparar
 * preço entre fornecedores e de auditar de onde veio cada afirmação.
 *
 * A ligação é feita pelo módulo de resolução de identidade (M3), é revisável, e
 * `sku_id` fica nulo até alguém — pessoa ou LLM acima do limiar — decidir.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditoria, centavos, id, procedencia, tipoSkuEnum } from './comum';
import { perfilVendedor } from './perfil';

/**
 * A verdade única sobre o que o perfil vende. **Operacional: carrega `perfil_id`.**
 *
 * Um SKU é criado por decisão humana, a partir de um ou mais `produto_externo`.
 * Margem realizada só existe porque isto existe.
 */
export const sku = pgTable(
  'sku',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    ean: text('ean'),
    tituloInterno: text('titulo_interno').notNull(),
    marca: text('marca'),
    categoriaMl: text('categoria_ml'),
    categoriaShopee: text('categoria_shopee'),
    pesoG: integer('peso_g'),
    /** Dimensões em milímetros: `{ comprimento, largura, altura }`. */
    dimMm: jsonb('dim_mm').$type<{ comprimento: number; largura: number; altura: number }>(),

    // Fiscal. `cst` e `cClassTrib` passam a ser obrigatórios: NF-e de MEI e
    // Simples sem os grupos de IBS/CBS começa a ser rejeitada em 04/01/2027.
    // Fazer esse cadastro com 20 SKUs é uma tarde; com 200 é uma semana perdida.
    ncm: text('ncm'),
    cest: text('cest'),
    cst: text('cst'),
    cclasstrib: text('cclasstrib'),
    /** Categoria com regra de órgão regulador (ANVISA em suplemento). */
    categoriaRegulada: text('categoria_regulada'),

    custoAtual: centavos('custo_atual'),
    custoAtualizadoEm: timestamp('custo_atualizado_em', { withTimezone: true }),
    tipo: tipoSkuEnum('tipo').notNull().default('revenda'),
    fornecedorPrincipalId: uuid('fornecedor_principal_id'),
    /** Taxa de devolução esperada da categoria, em pontos-base. Alimenta M8. */
    taxaDevolucaoEsperadaBp: integer('taxa_devolucao_esperada_bp'),
    ativo: boolean('ativo').notNull().default(true),
    ...auditoria,
  },
  (t) => [
    // Toda leitura operacional filtra por perfil (ADR 0003), então o índice
    // começa por `perfil_id`.
    index('idx_sku_perfil').on(t.perfilId, t.ativo),
    index('idx_sku_ean').on(t.ean),
    unique('unq_sku_perfil_ean').on(t.perfilId, t.ean),
  ],
);

/**
 * Cada ocorrência de um produto no mundo. **Base compartilhada: sem `perfil_id`.**
 *
 * É o que faz o sistema ficar mais valioso a cada perfil que entra: o grafo que o
 * perfil A construiu serve ao perfil B no dia zero.
 */
export const produtoExterno = pgTable(
  'produto_externo',
  {
    id: id(),
    /** Nulo até a resolução de identidade (M3) ligar. Revisável. */
    skuId: uuid('sku_id').references(() => sku.id, { onDelete: 'set null' }),
    url: text('url'),
    plataformaOuSite: text('plataforma_ou_site'),
    tituloBruto: text('titulo_bruto').notNull(),
    /**
     * GTIN na forma canônica de 13 dígitos, quando o dígito verificador confere.
     *
     * Coluna e não atributo do `jsonb` porque é a chave de **consulta** do leitor
     * de código de barras (M14): a pessoa está na loja com o celular na mão, e
     * varredura de `jsonb` para achar um EAN não responde em dois segundos.
     *
     * Não é único: o mesmo GTIN aparece em vários anúncios, de vários vendedores,
     * e é justamente esse conjunto que forma a evidência de preço praticado.
     */
    ean: text('ean'),
    preco: centavos('preco'),
    moeda: text('moeda').notNull().default('BRL'),
    vendedor: text('vendedor'),
    vendasEstimadas: integer('vendas_estimadas'),
    /** Registro estruturado extraído por LLM. Atributo ausente é `null`, nunca invenção. */
    atributosExtraidos: jsonb('atributos_extraidos'),
    /**
     * Hash do conteúdo capturado.
     *
     * É a chave de cache de todo resultado de LLM sobre este registro. Resolver a
     * identidade de um produto é caro e se faz **uma vez**: re-resolver o mesmo
     * produto a cada varredura é o jeito mais rápido de transformar um projeto
     * barato em conta alta (ADR 0005).
     */
    hashConteudo: text('hash_conteudo').notNull(),
    /** Forma canônica usada para gerar o embedding, não o título bruto. */
    formaCanonica: text('forma_canonica'),
    /**
     * Chave determinística de agrupamento: `marca|modelo da peça`, normalizados.
     *
     * Coluna e indexada porque é o **gerador de candidato que funciona sem
     * embedding** — e sem chave de LLM não há embedding nenhum. Com ela, achar as
     * outras ocorrências do mesmo `PA21G` da Electrolux é uma igualdade indexada;
     * sem ela seria varredura da tabela inteira, ou nada.
     *
     * Nula quando falta marca ou modelo, e a nulidade é significativa: não há chave,
     * então não há candidato por esta via. Nunca `''` — string vazia casaria com
     * toda outra string vazia e fundiria a base.
     */
    chaveAgrupamento: text('chave_agrupamento'),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    unique('unq_produto_externo_hash').on(t.hashConteudo),
    index('idx_produto_externo_sku').on(t.skuId),
    index('idx_produto_externo_captura').on(t.coletadoEm),
    // A consulta do leitor de código de barras: GTIN para evidência de preço.
    index('idx_produto_externo_ean').on(t.ean),
    // O gerador de candidato de M3 que roda sem embedding.
    index('idx_produto_externo_chave_agrupamento').on(t.chaveAgrupamento),
  ],
);

/**
 * Série histórica de preço por `produto_externo`.
 *
 * Existe separada do registro porque alimenta duas coisas: o detector de aumento
 * silencioso de fornecedor (M5) e o detector de **queda real** de preço (M13), que
 * compara com a mediana dos últimos 90 dias e não com o "preço de" anunciado —
 * que é o truque de subir para depois "baixar".
 */
export const precoHistorico = pgTable(
  'preco_historico',
  {
    id: id(),
    produtoExternoId: uuid('produto_externo_id')
      .notNull()
      .references(() => produtoExterno.id, { onDelete: 'cascade' }),
    preco: centavos('preco').notNull(),
    ...procedencia,
    criadoEm: auditoria.criadoEm,
  },
  (t) => [index('idx_preco_historico_produto').on(t.produtoExternoId, t.coletadoEm)],
);
