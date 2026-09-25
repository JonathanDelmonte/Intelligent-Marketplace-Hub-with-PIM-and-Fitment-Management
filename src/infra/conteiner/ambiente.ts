/**
 * O ambiente do sistema quando ele sobe inteiro num contêiner só — o Render gratuito
 * (ADR 0013), por `scripts/conteiner.ts`.
 *
 * Função pura, para o teste passar um objeto em vez de mexer em `process.env`. Três
 * coisas que o servidor próprio resolvia na publicação e aqui se resolvem na subida:
 *
 * - **A versão.** No servidor próprio, o commit vem como argumento da imagem. O Render
 *   monta a imagem sozinho e diz o commit em `RENDER_GIT_COMMIT`; a hora é a da subida,
 *   que é quando a versão entrou no ar.
 * - **O banco por TLS.** O banco é de outra empresa, do outro lado da internet, e o
 *   endereço que o painel do Supabase dá não pede TLS. Falta `sslmode`, entra
 *   `require` — menos para um banco na própria máquina, que não tem certificado.
 */

const COMMIT = /^[0-9a-f]{7,40}$/;
const MAQUINA_LOCAL: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Devolve um ambiente novo, do mesmo tipo do que entrou; o original não é tocado. */
export function prepararAmbienteDoConteiner<A extends Readonly<Record<string, string | undefined>>>(
  original: A,
  agora: Date,
): A {
  const acrescimos: Record<string, string> = {};

  const commit = original['RENDER_GIT_COMMIT'];
  if (!original['VERSAO'] && commit !== undefined && COMMIT.test(commit)) {
    acrescimos['VERSAO'] = commit;
  }
  if (!original['VERSAO_EM']) {
    acrescimos['VERSAO_EM'] = agora.toISOString();
  }

  const url = original['DATABASE_URL'];
  if (url) acrescimos['DATABASE_URL'] = comTls(url);

  return { ...original, ...acrescimos };
}

/**
 * Acrescenta `sslmode=require` sem reescrever o resto: `new URL(...).toString()`
 * recodificaria a senha (ver `banco/url.ts`, que tem o mesmo cuidado).
 */
export function comTls(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (MAQUINA_LOCAL.has(host) || /[?&]sslmode=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sslmode=require`;
}
