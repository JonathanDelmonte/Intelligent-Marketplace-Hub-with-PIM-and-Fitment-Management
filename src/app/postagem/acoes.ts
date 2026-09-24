/**
 * Ações da tela de postagem.
 *
 * Três: confirmar que o pedido foi postado — o que tira o pedido da fila do dia —,
 * marcar que o repasse divergente já foi conferido no extrato, o que tira a linha da
 * lista de divergências, e desfazer essa marca.
 *
 * Desfazer existe porque a marca esconde um número de dinheiro: sem volta, um clique
 * errado tiraria de vista uma taxa não prevista e nada na tela diria que ela existiu.
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
import { caminhoDaLoja } from '../navegacao';
import { destinoComAviso, lerVolta, type Volta } from '../lojas/caminhos';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_postagem' },
});

/**
 * Para onde voltar: a aba da loja de onde o formulário saiu, ou "Postar hoje".
 *
 * `volta` já vem lida por `lerVolta`, que só aceita a área de uma loja — o texto do
 * campo nunca vira destino direto.
 */
function paraOnde(codigo: CodigoDeAviso, volta: Volta | null = null): string {
  return destinoComAviso(volta, CAMINHO, { r: codigo });
}

/** A tela que muda com a ação: "Postar hoje" sempre, e a área da loja quando veio dela. */
function revalidar(volta: Volta | null): void {
  revalidatePath(CAMINHO);
  if (volta !== null) revalidatePath(caminhoDaLoja(volta.plataforma));
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export async function confirmarPostagem(dados: FormData): Promise<void> {
  const db = banco();
  const pedidoId = texto(dados.get('pedidoId'));
  const volta = lerVolta(dados.get('voltar'));
  const rastreio = texto(dados.get('rastreio'));

  if (pedidoId === '') redirect(paraOnde('falha', volta));

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
    redirect(paraOnde('falha', volta));
  }

  revalidar(volta);
  redirect(paraOnde(destino, volta));
}

/**
 * Marca que a divergência de repasse já foi conferida no extrato.
 *
 * Tira a linha da lista e não muda o pedido: a divergência continua sendo verdade, e
 * continua recalculável. O que a data grava é que uma pessoa já olhou — que é a
 * diferença entre uma lista que se lê e uma que só cresce.
 */
export async function marcarRepasseConferido(dados: FormData): Promise<void> {
  const db = banco();
  const pedidoId = texto(dados.get('pedidoId'));
  const volta = lerVolta(dados.get('voltar'));

  if (pedidoId === '') redirect(paraOnde('falha', volta));

  let destino: CodigoDeAviso = 'repasse_conferido';

  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const repo = new RepositorioDePedidos(db);
    const marcou = await repo.marcarRepasseConferido(perfil.id, pedidoId, new Date());
    if (!marcou) destino = 'nao_encontrado';
  } catch (erro) {
    log.erro('postagem.conferencia_de_repasse_falhou', { pedidoId, erro });
    redirect(paraOnde('falha', volta));
  }

  revalidar(volta);
  redirect(paraOnde(destino, volta));
}

/** Devolve a divergência à lista. Mão dupla, pelo motivo no topo do arquivo. */
export async function desfazerConferenciaDeRepasse(dados: FormData): Promise<void> {
  const db = banco();
  const pedidoId = texto(dados.get('pedidoId'));
  const volta = lerVolta(dados.get('voltar'));

  if (pedidoId === '') redirect(paraOnde('falha', volta));

  let destino: CodigoDeAviso = 'repasse_de_volta';

  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const repo = new RepositorioDePedidos(db);
    const desfez = await repo.marcarRepasseConferido(perfil.id, pedidoId, null);
    if (!desfez) destino = 'nao_encontrado';
  } catch (erro) {
    log.erro('postagem.desfazer_conferencia_falhou', { pedidoId, erro });
    redirect(paraOnde('falha', volta));
  }

  revalidar(volta);
  redirect(paraOnde(destino, volta));
}
