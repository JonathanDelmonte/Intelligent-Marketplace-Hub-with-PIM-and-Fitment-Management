/**
 * Recebe a cópia enviada pela tela e a restaura (ADR 0017).
 *
 * **Fica fora do porteiro, e confere a conta aqui.** Com o porteiro na frente, o Next
 * guarda o corpo do pedido na memória, para o porteiro também poder lê-lo, e corta o que
 * passa de 10 MB — sem erro, só cortado. A cópia de um banco de verdade passa disso, e
 * chegaria pela metade. Aqui o arquivo é lido enquanto chega, sem juntar na memória: a
 * lista do que fica fora do porteiro está em `acesso/constantes.ts`, e o teste do porteiro
 * confere que o `matcher` deixa de fora exatamente ela.
 *
 * Três portas, nesta ordem: a sessão (401 sem ela), o cabeçalho que só a tela manda (403
 * sem ele — outra página não dispara a restauração com a sessão de quem a visita) e o
 * arquivo. O resto é `restaurarDoNavegador`, que troca tudo numa transação só.
 */
import type { NextRequest } from 'next/server';
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { contaDoCookie } from '../../acesso/conferir';
import { COOKIE_DA_SESSAO } from '../../acesso/constantes';
import type { RespostaDaRestauracao } from '../apresentacao';
import { CABECALHO_DE_RESTAURAR } from '../constantes';
import { restaurarDoNavegador } from '../restauracao';

export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'copia_dos_dados' },
});

function responder(corpo: RespostaDaRestauracao, status: number): Response {
  return Response.json(corpo, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(pedido: NextRequest): Promise<Response> {
  let conta: Awaited<ReturnType<typeof contaDoCookie>>;
  try {
    conta = await contaDoCookie(pedido.cookies.get(COOKIE_DA_SESSAO)?.value, new Date());
  } catch (erro) {
    log.erro('copia.restauracao_sem_banco', { erro });
    return responder(
      { situacao: 'recusada', motivo: 'o banco não respondeu. Tente de novo em instantes' },
      503,
    );
  }
  if (conta === null) {
    return responder(
      { situacao: 'recusada', motivo: 'a sessão acabou. Entre de novo e restaure' },
      401,
    );
  }
  if (pedido.headers.get(CABECALHO_DE_RESTAURAR) !== 'sim') {
    return responder(
      { situacao: 'recusada', motivo: 'restauração que não veio da tela da cópia' },
      403,
    );
  }
  if (pedido.body === null) {
    return responder({ situacao: 'recusada', motivo: 'nenhum arquivo chegou' }, 400);
  }

  try {
    const resposta = await restaurarDoNavegador(
      banco(),
      pedido.body,
      lerAmbiente().BANCADA_PERFIL_PADRAO,
    );
    // Só contagem e quem pediu: o conteúdo da cópia é dado do negócio.
    if (resposta.situacao === 'restaurada') {
      log.info('copia.restaurada', {
        conta: conta.id,
        tabelas: resposta.tabelas,
        linhas: resposta.linhas,
        perfil: resposta.perfil,
      });
      return responder(resposta, 200);
    }
    log.aviso('copia.restauracao_recusada', { conta: conta.id });
    return responder(resposta, 422);
  } catch (erro) {
    log.erro('copia.restauracao_falhou', { conta: conta.id, erro });
    return responder(
      {
        situacao: 'recusada',
        motivo:
          'a restauração não terminou, e o banco desfaz o que ela tinha começado. Tente de novo; se repetir, veja o log do sistema',
      },
      500,
    );
  }
}
