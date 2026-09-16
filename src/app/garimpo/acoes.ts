/**
 * Ações da tela de garimpo.
 *
 * Uma: investigar um alvo. Ela abre o alvo quando ele é novo — escrevendo o plano e o
 * teto — e em seguida **enfileira** a investigação.
 *
 * Enfileira em vez de investigar aqui porque cada passo é uma chamada de ferramenta: no
 * dia em que a ferramenta for rede, rodar o laço dentro da ação seria a pessoa olhando
 * uma tela parada por minutos. A fila é a mesma de ingestão, identidade,
 * compatibilidade e pedido, com o mesmo poller.
 *
 * Alvo que já tem dossiê **não é reaberto**: `salvar` casa por chave e reescreveria o
 * plano em cima dos achados. O que acontece é só o enfileiramento, e investigar continua
 * de onde parou — com o teto que a pessoa acabou de pedir, que é como "continuar com um
 * teto maior" funciona.
 *
 * Não há ação de apagar dossiê: é conhecimento do mundo, e o parcial é o caminho normal.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está dentro
 * de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { abrirAlvo } from '@/dominio/prospector/abertura';
import { OrcamentoDaBusca, paraGravar } from '@/dominio/prospector/dossie';
import { FERRAMENTAS_PRONTAS } from '@/dominio/prospector/registro';
import { enfileirarInvestigacao, gatilhoDoMinuto } from '@/dominio/prospector/tarefa';
import { montarNucleo } from '@/infra/montagem';
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

export async function investigarAlvo(dados: FormData): Promise<void> {
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
  let enfileirou = false;

  try {
    const nucleo = montarNucleo();
    jaExistia = (await nucleo.dossies.porAlvo(lido.data.alvo)) !== null;

    if (!jaExistia) {
      // Motivo de parada nulo com zero passo é "esperando investigação", que é a
      // verdade: o plano está escrito e o job está na fila. Quem escreve o motivo de
      // verdade é o motor, quando parar.
      await nucleo.dossies.salvar(
        paraGravar({
          alvo: lido.data.alvo,
          estado: abrirAlvo(lido.data.alvo, FERRAMENTAS_PRONTAS),
          orcamento: new OrcamentoDaBusca(teto, lido.data.passos),
          motivoParada: null,
        }),
      );
    }

    enfileirou = await enfileirarInvestigacao(
      nucleo.fila,
      { alvo: lido.data.alvo, tetoCentavos: teto, tetoPassos: lido.data.passos },
      gatilhoDoMinuto(new Date()),
      log,
    );
  } catch (erro) {
    log.erro('garimpo.investigacao_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);

  if (!enfileirou) redirect(paraOnde('nao_enfileirou'));
  redirect(paraOnde(jaExistia ? 'na_fila' : 'aberto'));
}
