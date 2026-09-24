/**
 * Fornecedores (M5). **Base compartilhada: sem `perfil_id`.**
 *
 * CRM pequeno e brutalmente focado nas cinco perguntas que eliminam 90% dos
 * candidatos — `posta_com_etiqueta`, `emite_nf`, `prazo_postagem_dias`,
 * `pedido_minimo` e `vende_direto_marketplace`.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  auditoria,
  canalContatoEnum,
  centavos,
  fonteEnum,
  id,
  origemFornecedorEnum,
  procedencia,
} from './comum';
import { sku } from './catalogo';

export const fornecedor = pgTable(
  'fornecedor',
  {
    id: id(),
    nome: text('nome').notNull(),
    cnpj: text('cnpj'),
    site: text('site'),
    contato: text('contato'),
    canal: canalContatoEnum('canal'),

    // As cinco perguntas. `null` significa "ainda não perguntei", que é diferente
    // de `false` — e a diferença importa, porque `null` vira tarefa e `false` vira
    // descarte.
    postaComEtiqueta: boolean('posta_com_etiqueta'),
    emiteNf: boolean('emite_nf'),
    prazoPostagemDias: smallint('prazo_postagem_dias'),
    pedidoMinimoReais: centavos('pedido_minimo_reais'),
    pedidoMinimoUn: integer('pedido_minimo_un'),

    /**
     * O campo mais importante da tabela.
     *
     * `true` é **descarte automático**, com aviso na tela: fornecedor que vende na
     * mesma vitrine tem preço de fábrica e você tem o preço dele. Foi exatamente
     * contra isso que a primeira tentativa no Mercado Livre falhou, e o sistema
     * tem que lembrar disso pelo operador.
     */
    vendeDiretoMarketplace: boolean('vende_direto_marketplace'),
    /**
     * Quando a resposta de `vende_direto_marketplace` foi dada: à mão, ou pela conferência
     * automática por nome e CNPJ (7.3) que achou a loja. A resposta envelhece.
     */
    vendeDiretoVerificadoEm: timestamp('vende_direto_verificado_em', { withTimezone: true }),
    /**
     * De onde veio a resposta: `manual` é pessoa que perguntou ou olhou, e a conferência
     * automática nunca a troca (CLAUDE.md, 3.3); `m0_link` é a conferência, que achou a
     * loja pela busca.
     */
    vendeDiretoFonte: fonteEnum('vende_direto_fonte'),
    /**
     * A última conferência de CNPJ e vitrine (7.3): o que a Receita disse, e as lojas e
     * indícios que a busca achou, com os links. Lida de volta com Zod
     * (`dominio/fornecedores/conferencia`).
     */
    conferencia: jsonb('conferencia'),

    origem: origemFornecedorEnum('origem'),
    /** 0 a 5, alimentado por atraso real dos pedidos, não por impressão. */
    confiabilidade: smallint('confiabilidade'),
    notas: text('notas'),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    index('idx_fornecedor_cnpj').on(t.cnpj),
    // O filtro que mais se usa: quem não vende direto na vitrine.
    index('idx_fornecedor_vende_direto').on(t.vendeDiretoMarketplace),
  ],
);

/** Preço de um SKU num fornecedor. A tabela que responde "onde é mais barato". */
export const fornecedorSku = pgTable(
  'fornecedor_sku',
  {
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'cascade' }),
    codigoNoFornecedor: text('codigo_no_fornecedor'),
    preco: centavos('preco'),
    precoAtualizadoEm: timestamp('preco_atualizado_em', { withTimezone: true }),
    estoqueInformado: integer('estoque_informado'),
    urlOrigem: text('url_origem'),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    primaryKey({ columns: [t.fornecedorId, t.skuId] }),
    index('idx_fornecedor_sku_sku').on(t.skuId, t.preco),
  ],
);

/**
 * Histórico de preço por fornecedor e SKU.
 *
 * É o que detecta **aumento silencioso**: o fornecedor sobe o preço e ninguém
 * avisa, e a margem só aparece errada no fechamento do mês.
 */
export const fornecedorPrecoHistorico = pgTable(
  'fornecedor_preco_historico',
  {
    id: id(),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedor.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'cascade' }),
    preco: centavos('preco').notNull(),
    ...procedencia,
    criadoEm: auditoria.criadoEm,
  },
  (t) => [index('idx_fornecedor_preco_hist').on(t.fornecedorId, t.skuId, t.coletadoEm)],
);
