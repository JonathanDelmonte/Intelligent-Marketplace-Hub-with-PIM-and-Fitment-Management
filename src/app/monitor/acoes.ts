/**
 * Ações da tela do monitor.
 *
 * Uma: marcar como lido. Não há ação de apagar evento, e é de propósito — o histórico
 * do que mudou é o que permite olhar para trás e entender um nicho, e quem apaga o
 * incômodo apaga a série.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { RepositorioDoMonitor } from '@/dominio/monitor/repositorio';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_monitor' },
});

function paraOnde(codigo: CodigoDeAviso, quantidade?: number): string {
  const busca = new URLSearchParams({ r: codigo });
  if (quantidade !== undefined) busca.set('n', String(quantidade));
  return `${CAMINHO}?${busca.toString()}`;
}

/**
 * Ids de evento que vieram do formulário.
 *
 * Um grupo tem vários eventos, e o botão marca o grupo inteiro: são vários campos
 * `id` no mesmo formulário. Id fora de forma é descartado em vez de derrubar a ação —
 * página velha aberta em outra aba não é erro de quem clicou.
 */
const esquemaDeIds = z.array(z.string().trim().uuid());

export async function marcarLido(dados: FormData): Promise<void> {
  const brutos = dados.getAll('id').filter((v): v is string => typeof v === 'string');
  const ids = esquemaDeIds.safeParse(brutos);

  if (!ids.success || ids.data.length === 0) {
    log.aviso('monitor.ids_invalidos', { quantidade: brutos.length });
    redirect(paraOnde('nada_para_ler'));
  }

  let marcados = 0;
  try {
    marcados = await new RepositorioDoMonitor(banco()).marcarLidos(ids.data);
  } catch (erro) {
    log.erro('monitor.marcar_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(marcados === 0 ? paraOnde('nada_para_ler') : paraOnde('lido', marcados));
}
