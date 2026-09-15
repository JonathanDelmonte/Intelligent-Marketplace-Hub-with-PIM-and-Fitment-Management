/**
 * Ações da tela de garimpo.
 *
 * Uma: abrir um alvo. Não há ação de investigar — o executor, o laço que gasta passo e
 * chama ferramenta, não existe (ver roadmap, fase 10). E não há ação de apagar dossiê:
 * dossiê é conhecimento do mundo, e o parcial é o caminho normal.
 *
 * Abrir um alvo que já tem dossiê é **recusado**, e essa é a decisão que importa deste
 * arquivo. `salvar` faz upsert por alvo normalizado, então reabrir gravaria um plano em
 * branco em cima dos achados — e achado perdido é investigação paga duas vezes.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { abrirAlvo } from '@/dominio/prospector/abertura';
import { OrcamentoDaBusca, paraGravar } from '@/dominio/prospector/dossie';
import { ferramentasDisponiveis } from '@/dominio/prospector/ferramentas';
import { proximoPasso } from '@/dominio/prospector/fronteira';
import { RepositorioDeDossies } from '@/dominio/prospector/repositorio';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { lerTeto, type CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_garimpo' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?${new URLSearchParams({ r: codigo }).toString()}`;
}

const esquemaDoAlvo = z.object({
  /**
   * Três caracteres no mínimo.
   *
   * Alvo curto é alvo largo, e alvo largo é o crawler que a especificação recusa: sem
   * objetivo, investigar "peças" gasta o teto inteiro sem responder nada.
   */
  alvo: z.string().trim().min(3).max(120),
  teto: z.string().trim().min(1).max(24),
  passos: z.coerce.number().int().min(1).max(500),
});

export async function abrirUmAlvo(dados: FormData): Promise<void> {
  const lido = esquemaDoAlvo.safeParse({
    alvo: dados.get('alvo') ?? '',
    teto: dados.get('teto') ?? '',
    passos: dados.get('passos') ?? '',
  });

  if (!lido.success) {
    log.aviso('garimpo.formulario_invalido', { erro: lido.error.message });
    redirect(paraOnde('alvo_invalido'));
  }

  const teto = lerTeto(lido.data.teto);
  if (teto === null) redirect(paraOnde('teto_invalido'));

  let jaExistia = false;
  try {
    const repo = new RepositorioDeDossies(banco());
    jaExistia = (await repo.porAlvo(lido.data.alvo)) !== null;

    if (!jaExistia) {
      const ferramentas = ferramentasDisponiveis({
        temChaveDeLlm: lerAmbiente().LLM_API_KEY !== undefined,
      });

      const estado = abrirAlvo(lido.data.alvo, ferramentas);

      // O motivo de parada sai da própria máquina, e não de um palpite da tela: sem
      // ferramenta para nenhum item, `proximoPasso` devolve `fronteira_vazia`, que é
      // exatamente o que aconteceu — e é diferente de "em andamento".
      const passo = proximoPasso(estado, { passos: lido.data.passos, ferramentas });

      await repo.salvar(
        paraGravar({
          alvo: lido.data.alvo,
          estado,
          orcamento: new OrcamentoDaBusca(teto, lido.data.passos),
          motivoParada: passo.tipo === 'parar' ? passo.motivo : null,
        }),
      );
    }
  } catch (erro) {
    log.erro('garimpo.abertura_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(jaExistia ? 'ja_aberto' : 'aberto'));
}
