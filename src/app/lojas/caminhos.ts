/**
 * Os endereços da área da loja, e a volta dos formulários para ela.
 *
 * A área da loja reaproveita os formulários de outras telas — confirmar postagem,
 * conferir repasse, colar perguntas —, e cada ação de servidor redireciona ao fim. Sem
 * volta, quem confirmou uma postagem na área da Shopee cairia em "Postar hoje". O
 * formulário manda um campo `voltar`, e a ação o lê **por aqui**.
 *
 * ## A volta é remontada, nunca repetida
 *
 * O campo vem do navegador e pode ser qualquer coisa. Redirecionar para o texto que
 * chegou seria um redirecionamento aberto — um link para o sistema que termina em outro
 * site. Então a volta é lida em partes conhecidas (loja do domínio, aba da lista) e o
 * endereço é montado de novo a partir delas. O que não se lê vira `null`, e a ação
 * segue para o destino de sempre.
 */
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';
import { caminhoDaLoja } from '../navegacao';

export const ABAS_DA_LOJA = [
  'resumo',
  'pedidos',
  'anuncios',
  'perguntas',
  'repasse',
  'conexao',
] as const;

export type AbaDaLoja = (typeof ABAS_DA_LOJA)[number];

export function ehAbaDaLoja(valor: unknown): valor is AbaDaLoja {
  return ABAS_DA_LOJA.some((a) => a === valor);
}

/** A aba da URL. Valor que não é aba abre o resumo, em vez de derrubar a tela. */
export function lerAba(bruto: string | string[] | undefined): AbaDaLoja {
  const texto = Array.isArray(bruto) ? bruto[0] : bruto;
  return ehAbaDaLoja(texto) ? texto : 'resumo';
}

/** O endereço de uma aba. O resumo é a própria área, sem parâmetro. */
export function caminhoDaAba(plataforma: Plataforma, aba: AbaDaLoja): string {
  return aba === 'resumo' ? caminhoDaLoja(plataforma) : `${caminhoDaLoja(plataforma)}?aba=${aba}`;
}

export interface Volta {
  readonly plataforma: Plataforma;
  readonly aba: AbaDaLoja;
}

/**
 * Lê o campo `voltar` de um formulário: `/lojas/<plataforma>` com `?aba=` opcional.
 *
 * Qualquer outra coisa — outro caminho, outro host, loja que não existe, aba que não
 * existe — devolve `null`.
 */
export function lerVolta(valor: FormDataEntryValue | null): Volta | null {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(valor, 'http://local.invalid');
  } catch {
    return null;
  }
  if (url.host !== 'local.invalid') return null;

  const partes = url.pathname.split('/').filter((p) => p !== '');
  if (partes.length !== 2 || partes[0] !== 'lojas') return null;

  const plataforma = partes[1];
  if (!ehPlataforma(plataforma)) return null;

  const aba = url.searchParams.get('aba') ?? 'resumo';
  return ehAbaDaLoja(aba) ? { plataforma, aba } : null;
}

/** O destino do redirecionamento: a aba de volta, ou o padrão da tela, com o aviso. */
export function destinoComAviso(
  volta: Volta | null,
  padrao: string,
  aviso: Readonly<Record<string, string>>,
): string {
  const base = volta === null ? padrao : caminhoDaAba(volta.plataforma, volta.aba);
  const busca = new URLSearchParams(aviso).toString();
  if (busca === '') return base;
  return `${base}${base.includes('?') ? '&' : '?'}${busca}`;
}
