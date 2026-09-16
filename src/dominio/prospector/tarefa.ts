/**
 * A investigação como tarefa de poller (M6).
 *
 * Por que pela fila e não direto da tela: uma investigação gasta N passos e cada passo
 * é uma chamada de ferramenta. Fazer isso dentro de uma ação de servidor seria a
 * pessoa olhando uma tela parada — e no dia em que a ferramenta for rede, seria a
 * pessoa olhando uma tela parada por minutos.
 *
 * Pela fila, a tela responde na hora ("está na fila"), o poller trabalha, e o dossiê
 * aparece preenchido na próxima olhada. O poller é o mesmo de ingestão, identidade,
 * compatibilidade e pedido; a fila é a mesma tabela, com o mesmo prazo de execução e o
 * mesmo reagendamento.
 *
 * ## Erro de ferramenta é falha de job, e é de propósito
 *
 * O motor deixa o erro escapar, e aqui ele vira `fila.falhar` — com reagendamento e,
 * depois do teto de tentativas, revisão. É o comportamento certo para as duas causas:
 * falha passageira (rede) é resolvida pela retentativa, e falha permanente aparece na
 * tela de importação em vez de virar um dossiê que "não achou nada".
 *
 * O dossiê parcial já está gravado quando isso acontece, então a retentativa continua
 * de onde parou em vez de recomeçar.
 */
import { z } from 'zod';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import type { Registrador } from '@/infra/log';
import { registradorSilencioso } from '@/infra/log';
import { centavos } from '@/lib/dinheiro';
import type { MotorDoProspector } from './motor';
import { chaveDoAlvo } from './repositorio';

export const TIPO_JOB_PROSPECTOR = 'investigar_alvo';
export const NOME_DA_TAREFA_DO_PROSPECTOR = 'prospector';

/**
 * A entrada do job: o alvo e os dois tetos.
 *
 * Os tetos viajam na entrada, e não são lidos do dossiê no momento de rodar, porque é
 * o teto **pedido por quem mandou investigar** que vale — é assim que "continuar com um
 * teto maior" funciona. Sem teto não há job: `OrcamentoDaBusca` recusa, e a validação
 * aqui é para o job não ser reivindicado só para falhar no construtor.
 */
export const esquemaEntradaDoProspector = z.object({
  alvo: z.string().trim().min(3).max(120),
  tetoCentavos: z.number().int().positive(),
  tetoPassos: z.number().int().positive().max(500),
});

export type EntradaDoProspector = z.infer<typeof esquemaEntradaDoProspector>;

/**
 * Chave de idempotência: o alvo normalizado **e o gatilho**.
 *
 * O alvo sozinho estaria errado do mesmo jeito que na coleta de compatibilidade: a fila
 * colapsa por `(tipo, chave)` para sempre, então o primeiro job concluído bloquearia
 * toda investigação futura daquele alvo — e investigar de novo, com teto maior ou com
 * ferramenta nova registrada, é o uso normal deste módulo.
 *
 * O gatilho que a tela usa é o minuto do clique: clicar duas vezes no botão não
 * enfileira dois jobs, e clicar amanhã enfileira um novo.
 */
export function chaveDoProspector(alvo: string, gatilho: string): string {
  return `${chaveDoAlvo(alvo)}:${gatilho}`;
}

/** Minuto corrente, que é o gatilho que colapsa clique repetido. */
export function gatilhoDoMinuto(agora: Date): string {
  return agora.toISOString().slice(0, 16);
}

/**
 * Enfileira a investigação de um alvo.
 *
 * Nunca lança, pelo mesmo motivo da coleta de compatibilidade: a ação da tela já gravou
 * o que tinha de gravar, e falhar em enfileirar não pode derrubar o que deu certo.
 */
export async function enfileirarInvestigacao(
  fila: Fila,
  entrada: EntradaDoProspector,
  gatilho: string,
  registrador: Registrador = registradorSilencioso,
): Promise<boolean> {
  try {
    await fila.enfileirar({
      tipo: TIPO_JOB_PROSPECTOR,
      entrada,
      chaveIdempotencia: chaveDoProspector(entrada.alvo, gatilho),
    });
    return true;
  } catch (erro) {
    registrador.aviso('prospector.nao_enfileirou', { alvo: entrada.alvo, gatilho, erro });
    return false;
  }
}

export type ResultadoDoJobDoProspector =
  | { readonly tipo: 'fila_vazia' }
  | {
      readonly tipo: 'concluido';
      readonly jobId: string;
      readonly alvo: string;
      readonly passos: number;
      readonly achados: number;
      readonly motivo: string;
    }
  | { readonly tipo: 'pendente_revisao'; readonly jobId: string; readonly motivo: string }
  | {
      readonly tipo: 'falhou';
      readonly jobId: string;
      readonly erro: string;
      readonly reagendado: boolean;
    };

export class ExecutorDoProspector {
  constructor(
    private readonly fila: Fila,
    private readonly motor: MotorDoProspector,
  ) {}

  /**
   * Processa um job. Nunca lança, pelo mesmo motivo dos outros executores: erro que
   * escapa deixa o job em `rodando` até o prazo de execução estourar.
   */
  async processarProximo(): Promise<ResultadoDoJobDoProspector> {
    const job = await this.fila.reivindicar({ tipos: [TIPO_JOB_PROSPECTOR] });
    if (job === null) return { tipo: 'fila_vazia' };

    const analise = esquemaEntradaDoProspector.safeParse(job.entrada);
    if (!analise.success) {
      const motivo = `entrada do job não valida: ${analise.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    try {
      return await this.investigar(job, analise.data);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const { reagendado } = await this.fila.falhar(job.id, mensagem);
      return { tipo: 'falhou', jobId: job.id, erro: mensagem, reagendado };
    }
  }

  private async investigar(
    job: JobEnfileirado,
    entrada: EntradaDoProspector,
  ): Promise<ResultadoDoJobDoProspector> {
    const resultado = await this.motor.investigar({
      alvo: entrada.alvo,
      tetoCentavos: centavos(entrada.tetoCentavos),
      tetoPassos: entrada.tetoPassos,
    });

    const saida = {
      alvo: resultado.dossie.alvo,
      dossieId: resultado.dossie.id,
      passos: resultado.passosNestaExecucao,
      achados: resultado.dossie.achados.length,
      motivo: resultado.motivo,
      gastoCentavos: resultado.dossie.gastoCentavos,
    };

    await this.fila.concluir(job.id, saida);

    return {
      tipo: 'concluido',
      jobId: job.id,
      alvo: saida.alvo,
      passos: saida.passos,
      achados: saida.achados,
      motivo: saida.motivo,
    };
  }
}

/** Campos de log, sem o objeto inteiro. */
export function camposDaInvestigacao(
  resultado: ResultadoDoJobDoProspector,
): Record<string, unknown> {
  switch (resultado.tipo) {
    case 'fila_vazia':
      return {};
    case 'concluido':
      return {
        jobId: resultado.jobId,
        alvo: resultado.alvo,
        passos: resultado.passos,
        achados: resultado.achados,
        motivo: resultado.motivo,
      };
    case 'pendente_revisao':
      return { jobId: resultado.jobId, motivo: resultado.motivo };
    case 'falhou':
      return { jobId: resultado.jobId, erro: resultado.erro, reagendado: resultado.reagendado };
  }
}

/** Tarefa que investiga um alvo por tique. */
export function tarefaDoProspector(
  executor: ExecutorDoProspector,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DO_PROSPECTOR });

  return {
    nome: NOME_DA_TAREFA_DO_PROSPECTOR,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.processarProximo();
      const campos = camposDaInvestigacao(resultado);

      switch (resultado.tipo) {
        case 'fila_vazia':
          return { ocioso: true };
        case 'falhou':
          log.aviso('prospector.job_falhou', campos);
          return { ocioso: false, campos };
        case 'pendente_revisao':
          log.info('prospector.job_para_revisao', campos);
          return { ocioso: false, campos };
        case 'concluido':
          log.info('prospector.job_concluido', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
