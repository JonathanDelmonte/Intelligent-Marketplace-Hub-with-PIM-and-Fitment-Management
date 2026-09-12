/**
 * Compatibilidade (M4) — o fosso. **Base compartilhada: sem `perfil_id`.**
 *
 * Na categoria de reposição, a busca do comprador não é por preço: é por "serve
 * no meu modelo?". Quem tem o cadastro de compatibilidade correto e completo ganha
 * a venda sem disputar centavo, e é a parte que ninguém no mercado brasileiro faz
 * bem — daí ser a razão de construir em vez de assinar.
 *
 * O campo que faz esta tabela valer é `evidencias`. Sem saber **de onde** veio cada
 * afirmação não há como auditar um erro, e erro de compatibilidade em peça de
 * reposição gera devolução e reclamação — que é pior que não vender.
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditoria, id, procedencia, verificadoPorEnum } from './comum';
import { sku } from './catalogo';

/** O "em que serve". Um aparelho, com a faixa de ano que a peça atende. */
export const aparelho = pgTable(
  'aparelho',
  {
    id: id(),
    /** `purificador`, `secadora`, `ar-condicionado`, … */
    tipo: text('tipo').notNull(),
    marca: text('marca').notNull(),
    modelo: text('modelo').notNull(),
    anoDe: smallint('ano_de'),
    anoAte: smallint('ano_ate'),
    /** Variação de cor, voltagem ou mercado, quando muda a peça. */
    variante: text('variante'),
    /**
     * Família inferida pela gramática de nomenclatura do fabricante.
     *
     * `PA21G`, `PA26G`, `PE11B` seguem gramática: `PA` = purificador de água,
     * o número é a linha, o sufixo é variação. Escrever a gramática por marca
     * permite **inferir famílias** em vez de cadastrar item por item — e aqui a
     * abordagem é parser e regra, não LLM, porque é determinística e auditável.
     */
    familia: text('familia'),
    atributos: jsonb('atributos'),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    unique('unq_aparelho_identidade').on(t.tipo, t.marca, t.modelo, t.variante),
    index('idx_aparelho_marca_modelo').on(t.marca, t.modelo),
    index('idx_aparelho_familia').on(t.familia),
  ],
);

/**
 * Uma evidência de compatibilidade, com a força da fonte.
 *
 * A confiança é **graduada por quem afirmou**, e a escala vem da especificação:
 * afirmação do fabricante = 1,0; três concorrentes concordando = 0,8; um fórum =
 * 0,4. O anúncio só publica compatibilidade acima de 0,7, e o resto vai para fila
 * de revisão.
 */
export interface Evidencia {
  readonly tipo:
    | 'manual_fabricante'
    | 'pagina_oficial'
    | 'concorrente'
    | 'forum'
    | 'catalogo_distribuidor'
    | 'humano';
  readonly url: string | null;
  /** Trecho citado, para conferir sem reabrir a fonte. */
  readonly trecho: string | null;
  readonly em: string;
  /** `true` quando a evidência afirma que a peça **não** serve. */
  readonly negativa: boolean;
}

/** Confiança mínima para publicar compatibilidade num anúncio. */
export const LIMIAR_PUBLICACAO_COMPATIBILIDADE_BP = 7000;

export const compatibilidade = pgTable(
  'compatibilidade',
  {
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'cascade' }),
    aparelhoId: uuid('aparelho_id')
      .notNull()
      .references(() => aparelho.id, { onDelete: 'cascade' }),
    /**
     * Confiança em pontos-base: 0 a 10 000. Inteiro, não float, pelo mesmo motivo
     * de dinheiro ser inteiro — comparar `0.7` com `0.7` em IEEE-754 é convite a
     * bug num corte de publicação.
     */
    confiancaBp: integer('confianca_bp').notNull(),
    /** De onde veio cada afirmação. Sem isto não se audita um erro. */
    evidencias: jsonb('evidencias').$type<Evidencia[]>().notNull().default([]),
    verificadoPor: verificadoPorEnum('verificado_por').notNull(),
    verificadoEm: timestamp('verificado_em', { withTimezone: true }),
    /**
     * Conflito entre fontes, quando houver.
     *
     * Fontes discordam, e a resolução é por restrição: "peça P serve em A",
     * "P não serve em B", "A e B são da mesma família". Inconsistência é
     * **sinalizada para revisão**, nunca resolvida em silêncio escolhendo um lado.
     */
    conflito: text('conflito'),
    ...auditoria,
  },
  (t) => [
    primaryKey({ columns: [t.skuId, t.aparelhoId] }),
    // O índice que responde "que aparelhos esta peça atende, publicáveis" —
    // usado pelo gerador de descrição (M9) e pelo pós-venda (M16).
    index('idx_compat_sku_confianca').on(t.skuId, t.confiancaBp),
    index('idx_compat_aparelho').on(t.aparelhoId),
    // A fila de revisão: o que tem conflito aberto.
    index('idx_compat_conflito').on(t.conflito),
  ],
);
