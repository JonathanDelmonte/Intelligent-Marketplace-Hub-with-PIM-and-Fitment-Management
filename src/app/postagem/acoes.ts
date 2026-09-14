/**
 * Ações da tela de postagem.
 *
 * Uma só: confirmar que o pedido foi postado, com o rastreio quando houver. É o
 * que tira o pedido da fila do dia.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está
 * dentro de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_postagem' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?r=${codigo}`;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export async function confirmarPostagem(dados: FormData): Promise<void> {
  const db = banco();
  const pedidoId = texto(dados.get('pedidoId'));
  const rastreio = texto(dados.get('rastreio'));

  if (pedidoId === '') redirect(paraOnde('falha'));

  let destino: CodigoDeAviso = 'postado';

  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const repo = new RepositorioDePedidos(db);
    const marcou = await repo.confirmarPostagem(
      perfil.id,
      pedidoId,
      new Date(),
      rastreio === '' ? null : rastreio,
    );
    if (!marcou) destino = 'nao_encontrado';
  } catch (erro) {
    log.erro('postagem.confirmacao_falhou', { pedidoId, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino));
}
