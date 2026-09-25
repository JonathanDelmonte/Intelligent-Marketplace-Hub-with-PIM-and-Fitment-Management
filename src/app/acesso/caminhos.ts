/**
 * Para onde vai quem ainda não entrou, e para onde volta quem acabou de entrar.
 *
 * Funções puras, com teste. A volta vem da URL (`/entrar?volta=/catalogo`) e é entrada
 * de fora: redirecionar para o texto que chegou seria um redirecionamento aberto — um
 * link para a tela de entrar que, depois da senha, leva para outro site. Só volta
 * caminho deste sistema.
 */
import type { Usuario } from '@/dominio/acesso/repositorio';
import { CAMINHO_DE_ENTRAR, CAMINHOS_PUBLICOS } from './constantes';

export function ehCaminhoPublico(caminho: string): boolean {
  return CAMINHOS_PUBLICOS.some((publico) => caminho === publico);
}

/**
 * O destino depois de entrar. Qualquer coisa que não seja caminho deste sistema vira a
 * visão geral — e as próprias telas de acesso também, para não voltar para o login.
 */
export function lerDestino(valor: FormDataEntryValue | string | null | undefined): string {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) return '/';
  let url: URL;
  try {
    url = new URL(valor, 'http://local.invalid');
  } catch {
    return '/';
  }
  if (url.host !== 'local.invalid' || valor.includes('\\')) return '/';
  if (ehCaminhoPublico(url.pathname)) return '/';
  return `${url.pathname}${url.search}`;
}

/** A tela de entrar, com a volta para onde a pessoa estava indo. */
export function caminhoDeEntrar(destino: string): string {
  const volta = lerDestino(destino);
  return volta === '/'
    ? CAMINHO_DE_ENTRAR
    : `${CAMINHO_DE_ENTRAR}?${new URLSearchParams({ volta }).toString()}`;
}

/**
 * O cookie precisa de `Secure`? Sim, a não ser no próprio computador.
 *
 * No servidor, o Caddy atende em https e avisa por `X-Forwarded-Proto`. No computador,
 * o endereço é `http://localhost` — e cookie `Secure` em http só é aceito ali porque os
 * navegadores tratam o próprio computador como seguro. A regra fica do lado de negar:
 * sem o aviso do Caddy e fora do próprio computador, é `Secure`.
 */
export function cookieDeveSerSeguro(protocolo: string | null, host: string | null): boolean {
  if (protocolo !== null) return protocolo.split(',')[0]?.trim() === 'https';
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host ?? '');
}

/**
 * O endereço de quem pede, para o limite de tentativas: o primeiro do `X-Forwarded-For`.
 *
 * Dá para confiar no primeiro porque, no servidor, quem escreve o cabeçalho é o Caddy, e
 * ele descarta o que o navegador mandou com esse nome (ADR 0010). O limite por e-mail
 * vale de qualquer jeito, então um endereço forjado não abre a porta sozinho.
 */
export function enderecoDeQuemPede(encaminhado: string | null): string {
  const primeiro = encaminhado?.split(',')[0]?.trim() ?? '';
  return primeiro === '' ? 'desconhecido' : primeiro.slice(0, 64);
}

/** A conta no cabeçalho que o proxy passa adiante. Nome com acento não cabe cru em cabeçalho. */
export function codificarConta(conta: Usuario): string {
  return encodeURIComponent(JSON.stringify({ id: conta.id, nome: conta.nome, email: conta.email }));
}

export function decodificarConta(valor: string | null | undefined): Usuario | null {
  if (valor === null || valor === undefined || valor === '') return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(decodeURIComponent(valor));
  } catch {
    return null;
  }
  if (
    typeof bruto !== 'object' ||
    bruto === null ||
    !('id' in bruto) ||
    !('nome' in bruto) ||
    !('email' in bruto)
  ) {
    return null;
  }
  const { id, nome, email } = bruto;
  return typeof id === 'string' && typeof nome === 'string' && typeof email === 'string'
    ? { id, nome, email }
    : null;
}
