/**
 * Apoio a teste que precisa de banco de verdade.
 *
 * Alguns comportamentos **não são testáveis sem Postgres**, e são justamente os
 * que mais importam: `ON CONFLICT DO NOTHING` na idempotência,
 * `FOR UPDATE SKIP LOCKED` na reivindicação concorrente, e o tipo `vector`. Um
 * dublê de banco passaria nesses testes e o bug apareceria em produção.
 *
 * Sem `DATABASE_URL` a suíte é **pulada, não falsificada**: quem clonou o repo e
 * rodou `npm test` sem subir Postgres ainda vê o domínio inteiro passar, e vê
 * claramente que os testes de banco não rodaram.
 */
import { sql } from 'drizzle-orm';
import { criarBancoCom, type Banco } from './cliente';

export type BancoDeTeste = Banco;

export interface ConexaoDeTeste {
  readonly db: BancoDeTeste;
  readonly encerrar: () => Promise<void>;
}

/** Há banco configurado para teste? */
export function temBancoDeTeste(): boolean {
  const url = process.env['DATABASE_URL'];
  return url !== undefined && url.trim() !== '';
}

/**
 * Abre uma conexão de teste.
 *
 * Usa `criarBancoCom`, o mesmo construtor de produção, para que a configuração de
 * tipos do driver seja necessariamente a mesma. Pool pequeno porque a suíte roda
 * em paralelo e um pool grande por arquivo esgotaria as conexões.
 */
export function abrirBancoDeTeste(): ConexaoDeTeste {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error('DATABASE_URL não configurado; use temBancoDeTeste() antes de abrir');
  }
  return criarBancoCom(url, { max: 4, silenciarAvisos: true });
}

/**
 * Limpa as tabelas informadas.
 *
 * `TRUNCATE ... CASCADE` em vez de `DELETE`: é mais rápido e resolve as chaves
 * estrangeiras sem exigir ordem de remoção — ordem que mudaria a cada tabela
 * nova e seria esquecida.
 */
export async function limparTabelas(db: BancoDeTeste, tabelas: readonly string[]): Promise<void> {
  if (tabelas.length === 0) return;
  const lista = tabelas.map((t) => `"${t}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${lista} restart identity cascade`));
}
