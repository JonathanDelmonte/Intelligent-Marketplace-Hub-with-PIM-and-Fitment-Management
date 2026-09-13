/**
 * Apoio a teste que precisa de banco de verdade.
 *
 * Alguns comportamentos **não são testáveis sem Postgres**, e são justamente os
 * que mais importam: `ON CONFLICT DO NOTHING` na idempotência,
 * `FOR UPDATE SKIP LOCKED` na reivindicação concorrente, e o tipo `vector`. Um
 * dublê de banco passaria nesses testes e o bug apareceria em produção.
 *
 * Sem banco de teste a suíte é **pulada, não falsificada**: quem clonou o repo e
 * rodou `npm test` sem subir Postgres ainda vê o domínio inteiro passar, e vê
 * claramente que os testes de banco não rodaram.
 *
 * ## A variável é `DATABASE_URL_TESTE`, e isso é uma correção de segurança
 *
 * Estes testes fazem `truncate` em tabela real. Enquanto liam `DATABASE_URL`, a
 * suíte apagava o banco **da aplicação** — e o `CLAUDE.md` manda rodar
 * `npm run check` antes de todo commit. Quem tivesse configurado um Postgres
 * gerenciado com dados de verdade perderia os dados obedecendo às instruções do
 * próprio projeto. Descoberto aqui do pior jeito possível: os dados da
 * demonstração desapareceram no meio de uma conferência de tela, e por sorte eram
 * dados de demonstração.
 *
 * **Não há retorno para `DATABASE_URL`.** Retorno automático é exatamente como
 * isto aconteceu, e a consequência de faltar a variável é "222 testes pulam",
 * enquanto a de acertar por engano é "os dados foram apagados". Só uma das duas
 * se desfaz.
 */
import { sql } from 'drizzle-orm';
import { criarBancoCom, type Banco } from './cliente';

export type BancoDeTeste = Banco;

export interface ConexaoDeTeste {
  readonly db: BancoDeTeste;
  readonly encerrar: () => Promise<void>;
}

/** Nome da variável que aponta o banco **descartável** dos testes. */
export const VARIAVEL_DE_TESTE = 'DATABASE_URL_TESTE';

function urlDeTeste(): string | null {
  const url = process.env[VARIAVEL_DE_TESTE];
  return url === undefined || url.trim() === '' ? null : url.trim();
}

/** Há banco configurado para teste? */
export function temBancoDeTeste(): boolean {
  return urlDeTeste() !== null;
}

/**
 * Abre uma conexão de teste.
 *
 * Usa `criarBancoCom`, o mesmo construtor de produção, para que a configuração de
 * tipos do driver seja necessariamente a mesma. Pool pequeno porque a suíte roda
 * em paralelo e um pool grande por arquivo esgotaria as conexões.
 */
export function abrirBancoDeTeste(): ConexaoDeTeste {
  const url = urlDeTeste();
  if (url === null) {
    throw new Error(`${VARIAVEL_DE_TESTE} não configurado; use temBancoDeTeste() antes de abrir`);
  }

  // Guarda contra a forma mais provável de reintroduzir o estrago: apontar a
  // variável de teste para o mesmo banco da aplicação, para "fazer os testes
  // rodarem". A suíte trunca tabela; apontar as duas para o mesmo lugar apaga os
  // dados de verdade. Falhar aqui é a resposta certa, e a mensagem diz o caminho.
  const daAplicacao = process.env['DATABASE_URL']?.trim();
  if (daAplicacao !== undefined && daAplicacao !== '' && daAplicacao === url) {
    throw new Error(
      `${VARIAVEL_DE_TESTE} aponta para o mesmo banco de DATABASE_URL. A suíte apaga tabelas: ` +
        'use um banco separado (em Postgres gerenciado, uma branch de teste serve).',
    );
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
