/**
 * A coleta de compatibilidade como tarefa de poller.
 *
 * É o que faz o fosso crescer sem ninguém pedir. A fase 5 encerrou com o grafo de
 * identidade crescendo a cada link colado; aqui a cadeia fecha: planilha →
 * ocorrência → identidade → SKU → **compatibilidade**. Quem cola um link ganha
 * uma linha de ficha de compatibilidade sem abrir tela nenhuma.
 *
 * Sem LLM e sem orçamento, diferente do job de identidade: a coleta é comparação
 * de texto normalizado contra aparelhos cadastrados, então não há teto a respeitar
 * e não existe o caminho de adiar por custo.
 */
import { z } from 'zod';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import type { Registrador } from '@/infra/log';
import { registradorSilencioso } from '@/infra/log';
import type { ColetorDeCompatibilidade, ResultadoDaColeta } from './coletor';

export const TIPO_JOB_COMPATIBILIDADE = 'coletar_compatibilidade';
export const NOME_DA_TAREFA_DE_COMPATIBILIDADE = 'compatibilidade';

export const esquemaEntradaDeCompatibilidade = z.object({
  skuId: z.string().uuid(),
});

export type EntradaDeCompatibilidade = z.infer<typeof esquemaEntradaDeCompatibilidade>;

/**
 * Chave de idempotência: o SKU **e o que disparou a coleta**.
 *
 * O gatilho no meio da chave não é enfeite, e a primeira versão sem ele estava
 * errada de um jeito silencioso: a chave era só o `skuId`, e como a fila colapsa
 * por `(tipo, chave)` para sempre — não "enquanto o job está pendente" —, o
 * primeiro job concluído bloqueava **toda** coleta futura daquele SKU. O sintoma
 * era o pior tipo: nada falha, a ficha simplesmente para de crescer, e só o teste
 * da terceira ocorrência pegou.
 *
 * Diferente do job de identidade, cuja chave é o id da ocorrência de propósito: lá
 * uma ocorrência é resolvida uma vez e pronto. Aqui a coleta é sobre o SKU inteiro
 * e reabre a cada ocorrência nova, então a chave tem que identificar o **evento**,
 * não o alvo. O que colapsa é o mesmo evento repetido: decidir duas vezes o mesmo
 * par gera um job, não dois.
 */
export function chaveDeCompatibilidade(skuId: string, gatilho: string): string {
  return `${skuId}:${gatilho}`;
}

/**
 * Enfileira a coleta para um SKU. Ponto único, usado pela tela e pelos executores.
 *
 * Nunca lança: a coleta é ganho adicional, e falhar em enfileirá-la não pode
 * derrubar a ação que a pessoa estava fazendo. Foi exatamente o erro cometido na
 * fase 5 — a propagação de SKU dentro do mesmo `try` da decisão fez a tela dizer
 * "a decisão não foi gravada" com a decisão gravada.
 */
export async function enfileirarColetaDeCompatibilidade(
  fila: Fila,
  skuId: string,
  gatilho: string,
  registrador: Registrador = registradorSilencioso,
): Promise<boolean> {
  try {
    await fila.enfileirar({
      tipo: TIPO_JOB_COMPATIBILIDADE,
      entrada: { skuId },
      chaveIdempotencia: chaveDeCompatibilidade(skuId, gatilho),
    });
    return true;
  } catch (erro) {
    registrador.aviso('compatibilidade.nao_enfileirou', { skuId, gatilho, erro });
    return false;
  }
}

export type ResultadoDoJobDeCompatibilidade =
  | { readonly tipo: 'fila_vazia' }
  | {
      readonly tipo: 'concluido';
      readonly jobId: string;
      readonly skuId: string;
      readonly resultado: ResultadoDaColeta;
    }
  | { readonly tipo: 'pendente_revisao'; readonly jobId: string; readonly motivo: string }
  | {
      readonly tipo: 'falhou';
      readonly jobId: string;
      readonly erro: string;
      readonly reagendado: boolean;
    };

export class ExecutorDeCompatibilidade {
  constructor(
    private readonly fila: Fila,
    private readonly coletor: ColetorDeCompatibilidade,
  ) {}

  /**
   * Processa um job. Nunca lança, pelo mesmo motivo do executor de identidade:
   * erro que escapa deixa o job em `rodando` até o prazo de execução estourar, e
   * são quinze minutos de fila parada por um erro de uma linha.
   */
  async processarProximo(): Promise<ResultadoDoJobDeCompatibilidade> {
    const job = await this.fila.reivindicar({ tipos: [TIPO_JOB_COMPATIBILIDADE] });
    if (job === null) return { tipo: 'fila_vazia' };

    const analise = esquemaEntradaDeCompatibilidade.safeParse(job.entrada);
    if (!analise.success) {
      const motivo = `entrada do job não valida: ${analise.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    try {
      return await this.coletar(job, analise.data.skuId);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const { reagendado } = await this.fila.falhar(job.id, mensagem);
      return { tipo: 'falhou', jobId: job.id, erro: mensagem, reagendado };
    }
  }

  private async coletar(
    job: JobEnfileirado,
    skuId: string,
  ): Promise<ResultadoDoJobDeCompatibilidade> {
    const resultado = await this.coletor.coletarDoSku(skuId);
    await this.fila.concluir(job.id, { skuId, ...resultado });
    return { tipo: 'concluido', jobId: job.id, skuId, resultado };
  }
}

/** Campos de log, sem o objeto inteiro. */
export function camposDaColeta(
  resultado: ResultadoDoJobDeCompatibilidade,
): Record<string, unknown> {
  switch (resultado.tipo) {
    case 'fila_vazia':
      return {};
    case 'concluido':
      return {
        jobId: resultado.jobId,
        skuId: resultado.skuId,
        anuncios: resultado.resultado.anuncios,
        evidenciasNovas: resultado.resultado.evidenciasNovas,
        inferencias: resultado.resultado.inferencias,
        // Só aparecem quando existem: inconsistência e ambiguidade são o que uma
        // pessoa precisa ver, e zero delas não é notícia.
        ...(resultado.resultado.inconsistencias === 0
          ? {}
          : { inconsistencias: resultado.resultado.inconsistencias }),
        ...(resultado.resultado.ambiguos.length === 0
          ? {}
          : { ambiguos: resultado.resultado.ambiguos }),
      };
    case 'pendente_revisao':
      return { jobId: resultado.jobId, motivo: resultado.motivo };
    case 'falhou':
      return { jobId: resultado.jobId, erro: resultado.erro, reagendado: resultado.reagendado };
  }
}

/** Tarefa que coleta a compatibilidade de um SKU por tique. */
export function tarefaDeCompatibilidade(
  executor: ExecutorDeCompatibilidade,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_COMPATIBILIDADE });

  return {
    nome: NOME_DA_TAREFA_DE_COMPATIBILIDADE,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.processarProximo();
      const campos = camposDaColeta(resultado);

      switch (resultado.tipo) {
        case 'fila_vazia':
          return { ocioso: true };
        case 'falhou':
          log.aviso('compatibilidade.job_falhou', campos);
          return { ocioso: false, campos };
        case 'pendente_revisao':
          log.info('compatibilidade.job_para_revisao', campos);
          return { ocioso: false, campos };
        case 'concluido':
          log.info('compatibilidade.job_concluido', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
