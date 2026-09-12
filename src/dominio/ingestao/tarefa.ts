/**
 * A ingestão vista como tarefa de poller.
 *
 * Camada fina de propósito: traduz `ResultadoDoProcessamento` para o contrato que
 * o poller entende (`ocioso` mais campos de log) e nada mais. O poller fica sem
 * conhecer ingestão, e o executor fica sem conhecer poller.
 *
 * É aqui também que mora o log por job — e não dentro do executor. O executor
 * devolve o que aconteceu; quem decide o que disso vale uma linha de log é quem
 * está rodando o laço.
 */
import type { Tarefa, ResultadoDoTique } from '@/infra/fila/poller';
import type { Registrador } from '@/infra/log';
import { registradorSilencioso } from '@/infra/log';
import type { ExecutorDeIngestao, ResultadoDoProcessamento } from './executor';

export const NOME_DA_TAREFA_DE_INGESTAO = 'ingestao';

/** Campos de log de um resultado de processamento. */
export function camposDoResultado(resultado: ResultadoDoProcessamento): Record<string, unknown> {
  switch (resultado.tipo) {
    case 'fila_vazia':
      return {};

    case 'concluido':
      return {
        jobId: resultado.jobId,
        tipoDeEntrada: resultado.tipoDeEntrada,
        gravados: resultado.contagem.gravados,
        duplicados: resultado.contagem.duplicados,
        rejeitados: resultado.contagem.rejeitados,
        // Coluna não reconhecida é o sinal de que o mapeamento de uma plataforma
        // envelheceu. Fica no log porque é o aviso mais cedo possível disso.
        ...(resultado.colunasNaoReconhecidas.length === 0
          ? {}
          : { colunasNaoReconhecidas: resultado.colunasNaoReconhecidas }),
      };

    case 'enfileirou_filhos':
      return { jobId: resultado.jobId, filhos: resultado.quantidade };

    case 'pendente_revisao':
      return { jobId: resultado.jobId, motivo: resultado.motivo };

    case 'falhou':
      return { jobId: resultado.jobId, erro: resultado.erro, reagendado: resultado.reagendado };
  }
}

/**
 * Tarefa que consome um job de ingestão por tique.
 *
 * Um job por tique, não todos: é o que deixa `parar()` responder rápido e o que
 * impede uma planilha gigante de bloquear o encerramento por minutos.
 */
export function tarefaDeIngestao(
  executor: ExecutorDeIngestao,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_INGESTAO });

  return {
    nome: NOME_DA_TAREFA_DE_INGESTAO,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.processarProximo();
      const campos = camposDoResultado(resultado);

      switch (resultado.tipo) {
        case 'fila_vazia':
          return { ocioso: true };

        case 'falhou':
          // `aviso`, não `erro`: a fila já reagendou ou já encerrou com o erro
          // visível na tela. Erro de verdade, para o poller, é o que impede o
          // laço de continuar — e isso vem como exceção, não como resultado.
          log.aviso('ingestao.job_falhou', campos);
          return { ocioso: false, campos };

        case 'pendente_revisao':
          log.info('ingestao.job_para_revisao', campos);
          return { ocioso: false, campos };

        case 'enfileirou_filhos':
          log.info('ingestao.filhos_enfileirados', campos);
          return { ocioso: false, campos };

        case 'concluido':
          log.info('ingestao.job_concluido', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
