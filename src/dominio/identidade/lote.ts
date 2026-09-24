/**
 * O que as tarefas em lote da identidade têm em comum: esperar o provedor, e mandar de
 * volta para a resolução quem ganhou dado novo.
 *
 * Duas tarefas usam — a extração de registro (5.1) e o embedding (5.2) —, e as duas
 * falam com o mesmo provedor, sob a mesma cota. Duas cópias da espera divergiriam do
 * jeito que as trinta classes de estilo divergiram: uma dobrando, a outra não. Por isso
 * a espera mora em `infra/llm/espera.ts`, e a leitura do monitor usa a mesma.
 */
import type { Fila } from '@/infra/fila/fila';
import { TIPO_JOB_IDENTIDADE, chaveDeIdentidade } from './tarefa';

// A espera mora na camada do provedor (`infra/llm/espera.ts`): o monitor também pergunta
// ao mesmo provedor, sob a mesma cota. Reexportada daqui para quem já a importava.
export {
  ESPERA_INICIAL_POR_FALHA_MS,
  ESPERA_MAXIMA_POR_FALHA_MS,
  ESPERA_POR_ORCAMENTO_MS,
  EsperaDoProvedor,
} from '@/infra/llm/espera';

/**
 * Manda de volta para a resolução de identidade quem ganhou dado novo.
 *
 * Registro lido ou vetor novo trazem candidato que a passada anterior não via. O job
 * de identidade do produto é reaberto se já tinha concluído, e criado se não existia;
 * pendente fica como está, porque vai rodar com o dado novo de qualquer jeito.
 */
export async function reabrirResolucao(fila: Fila, ids: readonly string[]): Promise<number> {
  let reabertos = 0;
  for (const id of ids) {
    const chave = chaveDeIdentidade(id);
    const existente = await fila.buscarPorChave(TIPO_JOB_IDENTIDADE, chave);
    if (existente === null) {
      await fila.enfileirar({
        tipo: TIPO_JOB_IDENTIDADE,
        chaveIdempotencia: chave,
        entrada: { produtoExternoId: id },
      });
      reabertos += 1;
    } else if (existente.status === 'concluido') {
      await fila.reenfileirar(existente.id);
      reabertos += 1;
    }
  }
  return reabertos;
}
