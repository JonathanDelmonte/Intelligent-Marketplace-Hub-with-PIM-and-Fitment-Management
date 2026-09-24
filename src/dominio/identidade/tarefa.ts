/**
 * A resolução de identidade como tarefa de poller (M3, o que faz o grafo crescer
 * sozinho).
 *
 * A especificação resume a fase 5 em uma frase: "daqui em diante o sistema fica mais
 * inteligente **a cada link colado**". Sem este arquivo a frase seria "a cada vez que
 * alguém abrir a tela e clicar" — e a diferença é o projeto inteiro: o grafo de
 * identidade é o ativo que acumula com uso, e acumular exige que aconteça sem pedir.
 *
 * Duas decisões que valem ser lidas antes do código:
 *
 * **Orçamento por job, não por processo.** O resolvedor é construído por job, com
 * orçamento novo. Um `Orcamento` único de poller esgotaria na primeira hora e nunca
 * mais deixaria nada rodar — e "teto por execução" do ADR 0005 viraria "teto por
 * vida do processo", que não é teto nenhum.
 *
 * **Teto estourado adia, não falha.** O job gravou o que decidiu, e o que falta é
 * retomável porque par avaliado não volta para avaliação. Usar `falhar` consumiria
 * uma tentativa por rodada e mandaria para a lista de mortos um job que progride.
 */
import { z } from 'zod';
import { ExecucaoInterrompida, LimiteDoProvedor } from '@/infra/llm';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { Registrador } from '@/infra/log';
import { registradorSilencioso } from '@/infra/log';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import type { ResolvedorDeIdentidade, ResultadoDaResolucao } from './resolucao';

export const TIPO_JOB_IDENTIDADE = 'resolver_identidade';
export const NOME_DA_TAREFA_DE_IDENTIDADE = 'identidade';

/** Quanto esperar para retomar um job adiado por orçamento. */
export const ESPERA_POR_ORCAMENTO_MS = 60_000;

export const esquemaEntradaDeIdentidade = z.object({
  produtoExternoId: z.string().uuid(),
});

export type EntradaDeIdentidade = z.infer<typeof esquemaEntradaDeIdentidade>;

/**
 * Chave de idempotência de um job de resolução.
 *
 * É o id da ocorrência: enfileirar duas vezes a mesma ocorrência colapsa em um job,
 * que é o que impede uma reimportação de planilha de gerar quatro mil jobs repetidos.
 */
export function chaveDeIdentidade(produtoExternoId: string): string {
  return produtoExternoId;
}

export type ResultadoDaResolucaoDeJob =
  | { readonly tipo: 'fila_vazia' }
  | {
      readonly tipo: 'concluido';
      readonly jobId: string;
      readonly resultado: ResultadoDaResolucao;
    }
  | { readonly tipo: 'adiado'; readonly jobId: string; readonly motivo: string }
  | { readonly tipo: 'pendente_revisao'; readonly jobId: string; readonly motivo: string }
  | {
      readonly tipo: 'falhou';
      readonly jobId: string;
      readonly erro: string;
      readonly reagendado: boolean;
    };

/** Fábrica de resolvedor por job. É o que faz o orçamento ser por execução. */
export type FabricaDeResolvedor = (jobId: string) => ResolvedorDeIdentidade;

export class ExecutorDeIdentidade {
  constructor(
    private readonly fila: Fila,
    private readonly criarResolvedor: FabricaDeResolvedor,
  ) {}

  /**
   * Processa um job de resolução. Devolve `fila_vazia` quando não há nada pronto.
   *
   * Nunca lança: entrada inválida vira `pendente_revisao`, orçamento estourado vira
   * `adiado`, e o resto vira `falhou` com reagendamento por backoff. Deixar escapar
   * faria o poller registrar o erro e seguir, mas o job ficaria `rodando` até o prazo
   * de execução estourar — quinze minutos de fila parada por um erro de uma linha.
   */
  async processarProximo(): Promise<ResultadoDaResolucaoDeJob> {
    const job = await this.fila.reivindicar({ tipos: [TIPO_JOB_IDENTIDADE] });
    if (job === null) return { tipo: 'fila_vazia' };

    const analise = esquemaEntradaDeIdentidade.safeParse(job.entrada);
    if (!analise.success) {
      const motivo = `entrada do job não valida: ${analise.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    try {
      return await this.resolver(job, analise.data.produtoExternoId);
    } catch (erro) {
      if (erro instanceof ExecucaoInterrompida) {
        const motivo = `adiado: ${erro.message}`;
        // A cota do provedor diz quando volta; o orçamento da execução volta no job
        // seguinte, que ganha um novo.
        await this.fila.adiar(job.id, {
          quando:
            erro instanceof LimiteDoProvedor
              ? erro.ate
              : new Date(Date.now() + ESPERA_POR_ORCAMENTO_MS),
          motivo,
        });
        return { tipo: 'adiado', jobId: job.id, motivo };
      }
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const { reagendado } = await this.fila.falhar(job.id, mensagem);
      return { tipo: 'falhou', jobId: job.id, erro: mensagem, reagendado };
    }
  }

  private async resolver(
    job: JobEnfileirado,
    produtoExternoId: string,
  ): Promise<ResultadoDaResolucaoDeJob> {
    const resolvedor = this.criarResolvedor(job.id);
    const resultado = await resolvedor.resolver(produtoExternoId);

    await this.fila.concluir(job.id, {
      produtoExternoId,
      formaCanonica: resultado.formaCanonica,
      chaveAgrupamento: resultado.chaveAgrupamento,
      candidatos: resultado.candidatos,
      agrupados: resultado.agrupados,
      separados: resultado.separados,
      paraRevisao: resultado.paraRevisao,
      descartados: resultado.descartados,
      julgamentos: resultado.julgamentos,
      pendenteDeLlm: resultado.pendenteDeLlm,
      registroInvalido: resultado.registroInvalido,
    });

    return { tipo: 'concluido', jobId: job.id, resultado };
  }
}

/** Campos de log de um resultado, sem o objeto inteiro no log. */
export function camposDaResolucao(resultado: ResultadoDaResolucaoDeJob): Record<string, unknown> {
  switch (resultado.tipo) {
    case 'fila_vazia':
      return {};
    case 'concluido':
      return {
        jobId: resultado.jobId,
        produtoExternoId: resultado.resultado.produtoId,
        candidatos: resultado.resultado.candidatos,
        agrupados: resultado.resultado.agrupados,
        separados: resultado.resultado.separados,
        paraRevisao: resultado.resultado.paraRevisao,
        julgamentos: resultado.resultado.julgamentos,
        // O número que interessa quando não há chave: quantos pares ficaram
        // esperando julgamento que ninguém pode fazer.
        ...(resultado.resultado.pendenteDeLlm === 0
          ? {}
          : { pendenteDeLlm: resultado.resultado.pendenteDeLlm }),
        ...(resultado.resultado.registroInvalido ? { registroInvalido: true } : {}),
      };
    case 'adiado':
      return { jobId: resultado.jobId, motivo: resultado.motivo };
    case 'pendente_revisao':
      return { jobId: resultado.jobId, motivo: resultado.motivo };
    case 'falhou':
      return { jobId: resultado.jobId, erro: resultado.erro, reagendado: resultado.reagendado };
  }
}

/** Tarefa que resolve a identidade de uma ocorrência por tique. */
export function tarefaDeIdentidade(
  executor: ExecutorDeIdentidade,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_IDENTIDADE });

  return {
    nome: NOME_DA_TAREFA_DE_IDENTIDADE,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.processarProximo();
      const campos = camposDaResolucao(resultado);

      switch (resultado.tipo) {
        case 'fila_vazia':
          return { ocioso: true };
        case 'falhou':
          log.aviso('identidade.job_falhou', campos);
          return { ocioso: false, campos };
        case 'adiado':
          log.info('identidade.job_adiado', campos);
          return { ocioso: false, campos };
        case 'pendente_revisao':
          log.info('identidade.job_para_revisao', campos);
          return { ocioso: false, campos };
        case 'concluido':
          log.info('identidade.job_concluido', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
