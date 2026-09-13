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
import type { Evidencia } from '@/dominio/compatibilidade/evidencia';
import { LIMIAR_PUBLICACAO_BP } from '@/dominio/compatibilidade/resolucao';
import { auditoria, decisaoCompatibilidadeEnum, id, procedencia, verificadoPorEnum } from './comum';
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
    /**
     * Grupo largo: marca + prefixo, todas as linhas juntas (`electrolux:pa`).
     *
     * Separada de `familia` porque as duas autorizam coisas diferentes. Família é
     * "o mesmo aparelho em outra cor" e propaga compatibilidade como hipótese
     * forte; linhagem é "a linha vizinha", que é outro aparelho e só serve para
     * sugerir onde olhar.
     */
    linhagem: text('linhagem'),
    atributos: jsonb('atributos'),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    // `nullsNotDistinct` não é detalhe: sem ele a unicidade **não existe** no caso
    // mais comum. `variante` é nula em quase todo aparelho, e um índice único
    // trata NULL como valor distinto por padrão — então duas linhas de
    // `(purificador, Electrolux, PA21G, NULL)` entram as duas, o `on conflict`
    // nunca dispara, e o upsert duplica em silêncio. Aqui `variante` nula quer
    // dizer "o modelo sem variante", que é **um** aparelho, não infinitos.
    unique('unq_aparelho_identidade').on(t.tipo, t.marca, t.modelo, t.variante).nullsNotDistinct(),
    index('idx_aparelho_marca_modelo').on(t.marca, t.modelo),
    index('idx_aparelho_familia').on(t.familia),
    index('idx_aparelho_linhagem').on(t.linhagem),
  ],
);

/**
 * Evidência e limiar moram no domínio, não aqui.
 *
 * `Evidencia` e `LIMIAR_PUBLICACAO_BP` vêm de `@/dominio/compatibilidade` pelo
 * mesmo motivo que os enums vêm de constantes do domínio: dois lugares com a
 * mesma definição divergem na primeira mudança, e aqui a divergência seria entre
 * o que o banco aceita e o que o código acha que gravou.
 */
export type { Evidencia } from '@/dominio/compatibilidade/evidencia';

/** Confiança mínima para publicar compatibilidade num anúncio. */
export const LIMIAR_PUBLICACAO_COMPATIBILIDADE_BP = LIMIAR_PUBLICACAO_BP;

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
     * Serve, não serve, ou ninguém sabe ainda.
     *
     * Faltava, e a falta só apareceu ao implementar a resolução: sem este campo,
     * `confianca_bp = 9 000` é ambíguo entre "com certeza serve" e "com certeza
     * **não** serve", e uma fonte forte dizendo que a peça não serve não tinha
     * onde ser gravada. Confiança é confiança **na decisão**, não na compatibilidade.
     */
    decisao: decisaoCompatibilidadeEnum('decisao').notNull().default('indefinido'),
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
    index('idx_compat_sku_confianca').on(t.skuId, t.decisao, t.confiancaBp),
    index('idx_compat_aparelho').on(t.aparelhoId),
    // A fila de revisão: o que tem conflito aberto.
    index('idx_compat_conflito').on(t.conflito),
  ],
);
