/**
 * Peças compartilhadas do schema.
 *
 * Dois compromissos que valem para todas as tabelas:
 *
 * 1. **Dinheiro é `bigint` de centavos**, nunca `numeric` e nunca
 *    `double precision` (ADR 0004).
 * 2. **Todo dado do mundo carrega procedência** — `fonte` e `coletado_em` —
 *    porque dado sem origem não é auditável, e erro de compatibilidade sem
 *    auditoria vira devolução sem explicação (ADR 0002).
 */
import { sql } from 'drizzle-orm';
import { bigint, pgEnum, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { VERIFICADORES } from '@/dominio/compatibilidade/evidencia';
import { DECISOES_DE_COMPATIBILIDADE } from '@/dominio/compatibilidade/resolucao';
import { FONTES } from '@/dominio/procedencia';
import { PLATAFORMAS, REGIMES_FISCAIS, TIPOS_ANUNCIO_ML } from '@/dominio/precificacao/tipos';

/**
 * Enums do banco derivados das constantes do domínio.
 *
 * Derivar em vez de redigitar é o que garante que o banco e o TypeScript nunca
 * divirjam: acrescentar uma plataforma no domínio quebra a migração até o enum
 * ser atualizado, o que é exatamente o alarme que se quer.
 */
export const fonteEnum = pgEnum('fonte', FONTES);
export const plataformaEnum = pgEnum('plataforma', PLATAFORMAS);
export const regimeFiscalEnum = pgEnum('regime_fiscal', REGIMES_FISCAIS);
export const tipoAnuncioEnum = pgEnum('tipo_anuncio', TIPOS_ANUNCIO_ML);

export const tipoSkuEnum = pgEnum('tipo_sku', ['proprio', 'revenda', 'consignado']);
export const tipoCredencialEnum = pgEnum('tipo_credencial', ['oauth', 'planilha', 'nenhuma']);
export const canalContatoEnum = pgEnum('canal_contato', ['whatsapp', 'email', 'telefone']);
export const origemFornecedorEnum = pgEnum('origem_fornecedor', ['nacional', 'importado', 'china']);
export const verificadoPorEnum = pgEnum('verificado_por', VERIFICADORES);
export const decisaoCompatibilidadeEnum = pgEnum(
  'decisao_compatibilidade',
  DECISOES_DE_COMPATIBILIDADE,
);
export const severidadeEnum = pgEnum('severidade', ['vermelho', 'amarelo', 'informativo']);
export const statusJobEnum = pgEnum('status_job', [
  'pendente',
  'rodando',
  'concluido',
  'falhou',
  'pendente_revisao',
]);

/** Chave primária padrão. UUID v4 gerado no banco. */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/** Valor monetário em centavos inteiros. Ver ADR 0004. */
export const centavos = (nome: string) => bigint(nome, { mode: 'number' });

/** Registro de criação e atualização, presente em toda tabela. */
export const auditoria = {
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Procedência de dado do mundo.
 *
 * Só as tabelas de conhecimento compartilhado carregam isso. Tabela operacional
 * não precisa: o dado é do próprio vendedor, e a origem é ele.
 */
export const procedencia = {
  fonte: fonteEnum('fonte').notNull(),
  coletadoEm: timestamp('coletado_em', { withTimezone: true }).notNull().defaultNow(),
  /** URL, caminho do arquivo ou identificador do endpoint que gerou o registro. */
  origemUrl: text('origem_url'),
};
