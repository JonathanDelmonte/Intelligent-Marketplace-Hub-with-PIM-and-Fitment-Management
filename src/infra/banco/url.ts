/**
 * A URL do banco como o driver precisa recebê-la.
 *
 * O `postgres.js` manda ao Postgres, como parâmetro de inicialização da sessão, **todo
 * parâmetro da URL que ele não conhece** (`parseOptions`, versão 3.4). O painel do Neon
 * entrega a string com `channel_binding=require`, e o servidor recusa a conexão com
 * `unrecognized configuration parameter "channel_binding"` — reproduzido contra o
 * Postgres local, não suposto.
 *
 * O `preparar:env` já tirava o parâmetro, mas só da URL que passa por ele. Colar a URL
 * do painel direto no `.env` — que é o que o README manda fazer quem usa o atalho sem
 * Docker — caía na migração do primeiro clique. Aqui é o ponto por onde toda conexão
 * passa (`criarBancoCom`), então aqui a armadilha acaba para qualquer caminho.
 */

/** Parâmetros que o driver repassaria ao servidor e que derrubam a conexão. */
const NAO_REPASSAR: ReadonlySet<string> = new Set(['channel_binding']);

function nomeDoParametro(parametro: string): string {
  const igual = parametro.indexOf('=');
  return igual === -1 ? parametro : parametro.slice(0, igual);
}

/**
 * Tira da URL os parâmetros de `NAO_REPASSAR`, e só eles.
 *
 * O resto sai **exatamente** como veio, e URL sem nada a tirar volta sem mudança
 * nenhuma. Reescrever a URL inteira (`new URL(...).toString()`) recodificaria senha e
 * parâmetro que ninguém pediu para mexer. Por nome, e não por texto: a versão com
 * expressão regular do `preparar:env` levava junto o `?` quando o parâmetro vinha
 * primeiro, e a URL perdia o resto da consulta.
 */
export function urlParaODriver(url: string): string {
  const interrogacao = url.indexOf('?');
  if (interrogacao === -1) return url;

  const parametros = url.slice(interrogacao + 1).split('&');
  const mantidos = parametros.filter((parametro) => !NAO_REPASSAR.has(nomeDoParametro(parametro)));
  if (mantidos.length === parametros.length) return url;

  const base = url.slice(0, interrogacao);
  return mantidos.length === 0 ? base : `${base}?${mantidos.join('&')}`;
}
