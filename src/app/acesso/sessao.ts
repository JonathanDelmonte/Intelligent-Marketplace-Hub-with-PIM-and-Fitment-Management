/**
 * A sessão do lado das telas e das ações (ADR 0011): abrir, ler e encerrar.
 *
 * Quem confere a sessão em todo pedido é o proxy (`src/proxy.ts`), antes de qualquer
 * tela, ação ou rota. Daqui as telas só leem a conta que ele passou adiante, num
 * cabeçalho que ele sempre sobrescreve — o que chega de fora com o mesmo nome é
 * descartado lá.
 */
import { cookies, headers } from 'next/headers';
import { assinarSessao, lerSessaoAssinada } from '@/dominio/acesso/cookie';
import { RepositorioDeAcesso, type Usuario } from '@/dominio/acesso/repositorio';
import { banco } from '@/infra/banco/cliente';
import { cookieDeveSerSeguro, decodificarConta } from './caminhos';
import { chaveDoServidor } from './conferir';
import { CABECALHO_DA_CONTA, COOKIE_DA_SESSAO, DIAS_DE_SESSAO } from './constantes';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** A conta de quem está usando, como o proxy conferiu. `null` nas telas públicas. */
export async function contaAtual(): Promise<Usuario | null> {
  return decodificarConta((await headers()).get(CABECALHO_DA_CONTA));
}

/**
 * Abre a sessão e grava o cookie. Só em ação de servidor, que é onde o Next deixa
 * escrever cookie.
 */
export async function abrirSessao(conta: Usuario, agora: Date): Promise<void> {
  const cabecalhos = await headers();
  const expiraEm = new Date(agora.getTime() + DIAS_DE_SESSAO * MS_POR_DIA);
  const repo = new RepositorioDeAcesso(banco());
  const id = await repo.abrirSessao({
    usuarioId: conta.id,
    expiraEm,
    agente: cabecalhos.get('user-agent'),
    agora,
  });
  // A faxina das sessões velhas vai junto de abrir uma nova: acontece de vez em quando,
  // sem agenda própria, e nunca no caminho de quem só está navegando.
  await repo.limparSessoesAntigas(agora);

  (await cookies()).set(COOKIE_DA_SESSAO, assinarSessao({ id, expiraEm }, chaveDoServidor()), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiraEm,
    secure: cookieDeveSerSeguro(cabecalhos.get('x-forwarded-proto'), cabecalhos.get('host')),
  });
}

/** Encerra a sessão deste navegador, no banco e no cookie. Sem sessão, só apaga o cookie. */
export async function encerrarSessaoAtual(agora: Date): Promise<void> {
  const jarro = await cookies();
  const sessao = lerSessaoAssinada(jarro.get(COOKIE_DA_SESSAO)?.value, chaveDoServidor(), agora);
  if (sessao !== null) await new RepositorioDeAcesso(banco()).encerrarSessao(sessao.id, agora);
  jarro.delete(COOKIE_DA_SESSAO);
}
