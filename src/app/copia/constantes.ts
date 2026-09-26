/**
 * Constantes da tela da cópia dos dados, num módulo sem dependência nenhuma: o porteiro
 * (`proxy.ts`) lê o caminho da restauração, e o que ele importa entra em todo pedido.
 */

/** Onde a cópia se baixa. */
export const CAMINHO_DO_DOWNLOAD = '/copia/baixar';

/** Onde a cópia enviada pela tela é restaurada (ADR 0017). Fica fora do porteiro. */
export const CAMINHO_DA_RESTAURACAO = '/copia/restaurar';

/**
 * O cabeçalho que só o `fetch` da tela manda. Um site de fora não consegue mandá-lo sem
 * que o navegador pergunte antes (CORS), e ninguém aqui responde que pode — é o que
 * impede outra página de disparar a restauração com a sessão de quem a visita.
 */
export const CABECALHO_DE_RESTAURAR = 'x-restaurar';
