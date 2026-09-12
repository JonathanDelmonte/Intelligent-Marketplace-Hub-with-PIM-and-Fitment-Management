/**
 * Perfil de vendedor e credenciais — o lado **operacional** do modelo.
 *
 * `perfil_vendedor` existe desde o primeiro dia, mesmo com uma linha só. É o que
 * permite operar dois negócios no mesmo painel e o que permite vender o sistema
 * depois, sem refatorar marca para fora do código (ADR 0003).
 *
 * "Essencial Emporium" é **uma linha aqui**, não o nome do sistema.
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
import type { MarcaVisual } from '@/config/marca';
import {
  auditoria,
  centavos,
  id,
  plataformaEnum,
  regimeFiscalEnum,
  tipoCredencialEnum,
} from './comum';

export const perfilVendedor = pgTable(
  'perfil_vendedor',
  {
    id: id(),
    /** Identificador estável para URL e configuração. */
    slug: text('slug').notNull().unique(),
    nome: text('nome').notNull(),
    cnpjOuCpf: text('cnpj_ou_cpf'),
    regime: regimeFiscalEnum('regime').notNull(),
    inscricaoEstadual: text('inscricao_estadual'),
    /** Teto anual do regime, em centavos. R$ 81.000 no MEI. */
    tetoAnual: centavos('teto_anual'),
    /** Configuração do emissor de NF-e integrado. Não se reescreve emissor. */
    emissorNfConfig: jsonb('emissor_nf_config'),
    /** Identidade visual. Validada por `esquemaMarcaVisual` antes de gravar. */
    marcaVisual: jsonb('marca_visual').$type<MarcaVisual>(),
    /** Valor mensal do DAS, quando o regime é MEI. Alimenta M8. */
    dasMensal: centavos('das_mensal'),
    /** Alíquota efetiva do Simples em pontos-base, quando o regime é Simples. */
    aliquotaSimplesBp: integer('aliquota_simples_bp'),
    ativo: boolean('ativo').notNull().default(true),
    ...auditoria,
  },
  (t) => [index('idx_perfil_ativo').on(t.ativo)],
);

/**
 * Credencial de plataforma, cifrada em repouso.
 *
 * Nunca em `.env`: credencial em variável de ambiente amarra uma conta ao deploy,
 * e no dia do segundo perfil não há onde colocar a segunda. Além disso o token
 * OAuth muda em runtime por refresh, e variável de ambiente não é escrita por
 * processo. Ver ADR 0007.
 */
export const credencial = pgTable(
  'credencial',
  {
    id: id(),
    perfilId: uuid('perfil_id')
      .notNull()
      .references(() => perfilVendedor.id, { onDelete: 'cascade' }),
    plataforma: plataformaEnum('plataforma').notNull(),
    tipo: tipoCredencialEnum('tipo').notNull(),
    /** AES-256-GCM. O AAD liga o texto cifrado a (perfil, plataforma, campo). */
    tokenCifrado: text('token_cifrado'),
    refreshTokenCifrado: text('refresh_token_cifrado'),
    expiraEm: timestamp('expira_em', { withTimezone: true }),
    escopos: text('escopos').array(),
    ativo: boolean('ativo').notNull().default(true),
    ...auditoria,
  },
  (t) => [
    // Uma credencial ativa por perfil e plataforma. Duas seriam ambiguidade
    // sobre qual token usar, e o bug apareceria só no refresh.
    unique('unq_credencial_perfil_plataforma').on(t.perfilId, t.plataforma),
    index('idx_credencial_expira').on(t.expiraEm),
  ],
);
