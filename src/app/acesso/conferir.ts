/**
 * A conferência da sessão que o proxy faz em todo pedido (ADR 0011).
 *
 * Duas etapas, na ordem do custo: a assinatura do cookie, que não toca o banco e barra
 * cookie forjado ou vencido; depois o banco, que diz se a sessão foi encerrada (sair,
 * trocar senha) e se a conta continua ativa. O banco mora no mesmo servidor (ADR 0010),
 * e a consulta é por chave primária: cerca de um milissegundo por pedido.
 */
import { lerAmbiente } from '@/config/ambiente';
import { chaveDeSessao, lerSessaoAssinada } from '@/dominio/acesso/cookie';
import { RepositorioDeAcesso, type Usuario } from '@/dominio/acesso/repositorio';
import { banco } from '@/infra/banco/cliente';

let chaveEmCache: { readonly mestra: string; readonly chave: Buffer } | null = null;

/** A chave que assina o cookie, derivada uma vez por processo. */
export function chaveDoServidor(): Buffer {
  const mestra = lerAmbiente().CREDENCIAL_CHAVE_MESTRA;
  if (chaveEmCache?.mestra !== mestra) chaveEmCache = { mestra, chave: chaveDeSessao(mestra) };
  return chaveEmCache.chave;
}

/** A conta dona do cookie, ou `null` quando ele não abre nada. */
export async function contaDoCookie(
  valor: string | undefined,
  agora: Date,
): Promise<Usuario | null> {
  const sessao = lerSessaoAssinada(valor, chaveDoServidor(), agora);
  if (sessao === null) return null;
  return new RepositorioDeAcesso(banco()).usuarioDaSessao(sessao.id, agora);
}
