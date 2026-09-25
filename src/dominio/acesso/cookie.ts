/**
 * O cookie de sessão, assinado (ADR 0011).
 *
 * O cookie leva o id da sessão e quando ela vence, com uma assinatura HMAC por cima.
 * É o que deixa o proxy do Next barrar cookie forjado em **todo** pedido sem consultar
 * o banco — a assinatura só sai com a chave, e a chave só existe no servidor. O banco
 * continua sendo quem diz se a sessão foi encerrada (sair, trocar senha): essa conferência
 * mora junto do acesso aos dados, e não no proxy, que roda até em pré-carregamento.
 *
 * ## A chave vem da chave mestra, com outro rótulo
 *
 * `CREDENCIAL_CHAVE_MESTRA` já é obrigatória e já é segredo do servidor. A chave da sessão
 * é derivada dela por HKDF com um rótulo próprio: as duas nunca são a mesma chave (o que
 * cifra credencial não assina cookie), e ninguém precisa configurar um segredo a mais.
 * Trocar a chave mestra encerra todas as sessões — que é o esperado de uma troca de chave.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** Rótulo da derivação. Mudar o rótulo invalida todo cookie emitido — é a versão do formato. */
const ROTULO_DA_CHAVE = 'sessao-v1';

/** Uuid no formato do banco: é o id da sessão. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A chave que assina o cookie, derivada da chave mestra (32 bytes em base64). */
export function chaveDeSessao(chaveMestraBase64: string): Buffer {
  const mestra = Buffer.from(chaveMestraBase64, 'base64');
  return Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), ROTULO_DA_CHAVE, 32));
}

function assinatura(conteudo: string, chave: Buffer): Buffer {
  return createHmac('sha256', chave).update(conteudo, 'utf8').digest();
}

export interface SessaoNoCookie {
  readonly id: string;
  readonly expiraEm: Date;
}

/** `id.vencimentoEmSegundos.assinatura` — o valor do cookie. */
export function assinarSessao(sessao: SessaoNoCookie, chave: Buffer): string {
  const conteudo = `${sessao.id}.${String(Math.floor(sessao.expiraEm.getTime() / 1000))}`;
  return `${conteudo}.${assinatura(conteudo, chave).toString('base64url')}`;
}

/**
 * Lê o cookie: `null` quando ele não é deste servidor, foi alterado ou venceu.
 *
 * A assinatura é comparada em tempo constante, e antes de qualquer outra leitura do
 * conteúdo — cookie adulterado não chega a ser interpretado.
 */
export function lerSessaoAssinada(
  valor: string | undefined,
  chave: Buffer,
  agora: Date,
): SessaoNoCookie | null {
  if (valor === undefined || valor.length > 200) return null;
  const partes = valor.split('.');
  if (partes.length !== 3) return null;
  const [id = '', vence = '', recebida = ''] = partes;

  const esperada = assinatura(`${id}.${vence}`, chave);
  const informada = Buffer.from(recebida, 'base64url');
  if (informada.length !== esperada.length || !timingSafeEqual(informada, esperada)) return null;

  if (!UUID.test(id) || !/^\d{1,12}$/.test(vence)) return null;
  const expiraEm = new Date(Number(vence) * 1000);
  if (expiraEm.getTime() <= agora.getTime()) return null;
  return { id, expiraEm };
}
