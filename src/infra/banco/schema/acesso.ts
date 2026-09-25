/**
 * Contas de acesso e sessões (ADR 0011).
 *
 * Infraestrutura, e não operação: não carrega `perfil_id`. Até existirem permissões,
 * toda conta opera os mesmos perfis — que é o uso pessoal de hoje. Quando o sistema
 * escalar, a ligação conta ↔ perfil, com o papel de cada uma, entra numa tabela
 * própria, e estas duas não mudam.
 */
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditoria, id } from './comum';

export const usuario = pgTable('usuario', {
  id: id(),
  nome: text('nome').notNull(),
  /** Sempre minúsculo e aparado: é a chave de entrada. */
  email: text('email').notNull().unique(),
  /** `scrypt$N$r$p$sal$hash`. A senha nunca é gravada (ver `dominio/acesso/senha.ts`). */
  senhaHash: text('senha_hash').notNull(),
  /** Conta desativada não entra, e as sessões dela deixam de valer. Nada é apagado. */
  ativo: boolean('ativo').notNull().default(true),
  ultimoAcessoEm: timestamp('ultimo_acesso_em', { withTimezone: true }),
  ...auditoria,
});

export const sessao = pgTable(
  'sessao',
  {
    id: id(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    /** Preenchida ao sair ou ao trocar a senha. Sessão encerrada não volta. */
    encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
    /** O navegador de onde a sessão foi aberta, para a pessoa reconhecer os aparelhos. */
    agente: text('agente'),
    ...auditoria,
  },
  (t) => [index('idx_sessao_usuario').on(t.usuarioId)],
);
