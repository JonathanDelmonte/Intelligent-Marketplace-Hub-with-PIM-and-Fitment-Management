/**
 * O porteiro (ADR 0011): todo pedido passa por aqui antes de qualquer tela, ação ou
 * rota, e só segue com uma sessão válida.
 *
 * É o `proxy` do Next 16, que antes se chamava `middleware`, e roda no Node — por isso
 * pode ir ao banco. Vai em todo pedido que não seja arquivo estático: o banco mora no
 * mesmo servidor (ADR 0010), e a consulta é por chave primária.
 *
 * ## O que ele faz
 *
 * 1. Apaga o cabeçalho da conta (`x-conta`) que vier de fora. Só este arquivo escreve
 *    esse cabeçalho, e as telas confiam nele: um navegador que o mandasse pronto
 *    entraria como quem quisesse.
 * 2. Deixa passar as quatro rotas públicas (`CAMINHOS_PUBLICOS`).
 * 3. Confere o cookie: a assinatura, e depois o banco (sessão aberta, conta ativa).
 * 4. Sem sessão, manda para a tela de entrar com a volta para onde a pessoa ia. Ação
 *    de servidor recebe o mesmo endereço no cabeçalho que o cliente do Next entende;
 *    outro pedido que não é leitura recebe 401.
 * 5. Com sessão, segue com a conta no cabeçalho, para as telas saberem quem é.
 *
 * O `matcher` precisa ser literal: o Next o lê na compilação, e não avalia expressão.
 * O teste (`proxy.test.ts`) confere que ele pega as rotas e deixa os estáticos.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { caminhoDeEntrar, codificarConta, ehCaminhoPublico } from './app/acesso/caminhos';
import { contaDoCookie } from './app/acesso/conferir';
import { CABECALHO_DA_CONTA, COOKIE_DA_SESSAO } from './app/acesso/constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'porteiro' },
});

/** O cabeçalho em que o cliente do Next espera o destino de uma ação redirecionada. */
const CABECALHO_DE_REDIRECIONAR_ACAO = 'x-action-redirect';

function semSessao(pedido: NextRequest): NextResponse {
  const destino = caminhoDeEntrar(`${pedido.nextUrl.pathname}${pedido.nextUrl.search}`);

  let resposta: NextResponse;
  if (pedido.method === 'GET' || pedido.method === 'HEAD') {
    resposta = NextResponse.redirect(new URL(destino, pedido.url));
  } else if (pedido.headers.has('next-action')) {
    // Ação de servidor com a sessão vencida: sem este cabeçalho o clique acabaria em
    // "resposta inesperada do servidor". Com ele, o Next abre a tela de entrar.
    resposta = new NextResponse(null, {
      status: 401,
      headers: { [CABECALHO_DE_REDIRECIONAR_ACAO]: destino },
    });
  } else {
    resposta = NextResponse.json({ erro: 'A sessão acabou. Entre de novo.' }, { status: 401 });
  }

  // Cookie que não abre nada sai do navegador, para não ser conferido a cada pedido.
  if (pedido.cookies.has(COOKIE_DA_SESSAO)) resposta.cookies.delete(COOKIE_DA_SESSAO);
  return resposta;
}

export async function proxy(pedido: NextRequest): Promise<NextResponse> {
  const cabecalhos = new Headers(pedido.headers);
  cabecalhos.delete(CABECALHO_DA_CONTA);

  if (ehCaminhoPublico(pedido.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: cabecalhos } });
  }

  let conta: Awaited<ReturnType<typeof contaDoCookie>>;
  try {
    conta = await contaDoCookie(pedido.cookies.get(COOKIE_DA_SESSAO)?.value, new Date());
  } catch (erro) {
    // Sem banco não há como saber se a sessão vale, e na dúvida a porta fica fechada.
    log.erro('porteiro.conferencia_falhou', { erro });
    return new NextResponse('O banco de dados não respondeu. Tente de novo em instantes.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' },
    });
  }

  if (conta === null) return semSessao(pedido);

  cabecalhos.set(CABECALHO_DA_CONTA, codificarConta(conta));
  return NextResponse.next({ request: { headers: cabecalhos } });
}

export const config = {
  matcher: [
    '/((?!_next/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|webmanifest|js|css|txt|map|woff|woff2)$).*)',
  ],
};
