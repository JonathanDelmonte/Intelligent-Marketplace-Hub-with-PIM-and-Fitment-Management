/**
 * Carrega o `.env` para quem não é o Next.
 *
 * Existe por um defeito que só apareceu quando alguém foi rodar o projeto numa
 * máquina de verdade: **o `.env` só era lido pela aplicação.** O Next carrega
 * `.env` sozinho, então `npm run dev` funcionava — e todo o resto não:
 *
 * - `npm run db:migrate` e `db:seed` falhavam com "DATABASE_URL é obrigatório",
 *   com o `.env` ali, correto, do lado.
 * - `npm run poller` idem.
 * - E o pior: `vitest` **pulava os 202 testes de banco em silêncio**. O resumo
 *   dizia "202 skipped", que é exatamente o que ele diz para quem não tem banco
 *   configurado — ninguém suspeitaria de que tinha.
 *
 * `process.loadEnvFile` é API nativa do Node (22+), então isto não acrescenta
 * dependência. A precedência é a certa e foi medida: **variável do shell vence a
 * do arquivo**, então o `DATABASE_URL` do CI continua ganhando de um `.env`
 * esquecido, e quem quiser sobrescrever para um teste só exporta a variável.
 *
 * Chamar mais de uma vez é inofensivo.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let carregado = false;

/**
 * Lê o `.env` da raiz do projeto, se existir.
 *
 * Não lança quando o arquivo falta: em CI não há `.env` — as variáveis vêm do
 * ambiente do workflow —, e falhar ali transformaria a correção em quebra.
 */
export function carregarEnv(diretorio: string = process.cwd()): void {
  if (carregado) return;
  carregado = true;

  const caminho = resolve(diretorio, '.env');
  if (!existsSync(caminho)) return;
  process.loadEnvFile(caminho);
}
