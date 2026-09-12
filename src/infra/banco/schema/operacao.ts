/**
 * Operação: anúncio, pedido e consignação. **Tudo aqui carrega `perfil_id`.**
 *
 * É a metade de higiene do sistema — a que a especificação classifica como
 * commodity, e a primeira a ser trocada por hub de prateleira se o custo de
 * manutenção passar da mensalidade.
 */
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditoria, centavos, fonteEnum, id, plataformaEnum, tipoAnuncioEnum } from './comum';
import { sku } from './catalogo';
import { perfilVendedor } from './perfil';

export const anuncio = pgTable(
  'anuncio',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'restrict' }),
    plataforma: plataformaEnum('plataforma').notNull(),
    /** ID na plataforma. Nulo enquanto o anúncio é rascunho local. */
    idExterno: text('id_externo'),
    url: text('url'),
    tipo: tipoAnuncioEnum('tipo'),
    preco: centavos('preco').notNull(),
    freteModo: text('frete_modo'),
    ativo: boolean('ativo').notNull().default(true),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }),
    /** Como o anúncio entrou: publicado por API, importado de planilha, à mão. */
    fonte: fonteEnum('fonte').notNull(),
    ...auditoria,
  },
  (t) => [
    index('idx_anuncio_perfil').on(t.perfilId, t.ativo),
    index('idx_anuncio_sku').on(t.skuId),
    unique('unq_anuncio_plataforma_externo').on(t.plataforma, t.idExterno),
  ],
);

/**
 * Pedido, com a margem **realizada** — não a prevista.
 *
 * `taxa_comissao`, `taxa_fixa`, `frete_pago` e `repasse_liquido` guardam o que a
 * plataforma efetivamente cobrou, para a conferência de repasse comparar com o
 * que M8 previu. É onde aparecem as taxas que ninguém previu.
 */
export const pedido = pgTable(
  'pedido',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    anuncioId: uuid('anuncio_id').references(() => anuncio.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id').references(() => sku.id, { onDelete: 'set null' }),
    plataforma: plataformaEnum('plataforma').notNull(),
    idExterno: text('id_externo').notNull(),
    data: timestamp('data', { withTimezone: true }).notNull(),
    qtd: integer('qtd').notNull().default(1),

    precoBruto: centavos('preco_bruto').notNull(),
    taxaComissao: centavos('taxa_comissao'),
    taxaFixa: centavos('taxa_fixa'),
    fretePago: centavos('frete_pago'),
    repasseLiquido: centavos('repasse_liquido'),
    custoNaVenda: centavos('custo_na_venda'),
    margemRealizada: centavos('margem_realizada'),

    statusEnvio: text('status_envio'),
    rastreio: text('rastreio'),
    /** Prazo de postagem, que ordena a fila do dia — a tela mais usada. */
    prazoPostagemAte: timestamp('prazo_postagem_ate', { withTimezone: true }),
    /** Confirmação de postagem pelo fornecedor, no fluxo de dropship. */
    postagemConfirmadaEm: timestamp('postagem_confirmada_em', { withTimezone: true }),
    /** Repasse conferido contra o previsto. Diferença aparece em relatório. */
    repasseConferidoEm: timestamp('repasse_conferido_em', { withTimezone: true }),
    fonte: fonteEnum('fonte').notNull(),
    ...auditoria,
  },
  (t) => [
    unique('unq_pedido_plataforma_externo').on(t.plataforma, t.idExterno),
    index('idx_pedido_perfil_data').on(t.perfilId, t.data),
    // A fila de postagem do dia: o que postar hoje, por prazo restante.
    index('idx_pedido_fila_postagem').on(t.perfilId, t.postagemConfirmadaEm, t.prazoPostagemAte),
    index('idx_pedido_sku').on(t.skuId),
  ],
);

/**
 * Consignação (M11): estoque que não é seu.
 *
 * O risco que a tabela existe para controlar: a loja parceira vender no balcão o
 * que você tem anunciado. Daí `conferido_em` e o alerta semanal.
 */
export const consignacao = pgTable(
  'consignacao',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    parceiroNome: text('parceiro_nome').notNull(),
    parceiroContato: text('parceiro_contato'),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'restrict' }),
    qtdDisponivel: integer('qtd_disponivel').notNull().default(0),
    precoAcordadoRepasse: centavos('preco_acordado_repasse'),
    conferidoEm: timestamp('conferido_em', { withTimezone: true }),
    ...auditoria,
  },
  (t) => [
    index('idx_consignacao_perfil').on(t.perfilId),
    // Alerta de conferência: o que está vencido de conferir.
    index('idx_consignacao_conferencia').on(t.perfilId, t.conferidoEm),
  ],
);

/**
 * Acumulado anual por perfil, para o controle de teto do MEI.
 *
 * Uma linha por perfil e ano. Existe como tabela em vez de `SUM(pedido)` porque
 * o teto considera receita bruta do regime, que pode incluir venda fora das
 * plataformas — e porque o aviso em 70% e 85% precisa de um número estável para
 * projetar, não de uma agregação que muda a cada importação.
 */
export const acumuladoAnual = pgTable(
  'acumulado_anual',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    ano: smallint('ano').notNull(),
    receitaBruta: centavos('receita_bruta').notNull().default(0),
    /** Receita informada à mão, fora das plataformas integradas. */
    receitaExterna: centavos('receita_externa').notNull().default(0),
    ...auditoria,
  },
  (t) => [unique('unq_acumulado_perfil_ano').on(t.perfilId, t.ano)],
);
