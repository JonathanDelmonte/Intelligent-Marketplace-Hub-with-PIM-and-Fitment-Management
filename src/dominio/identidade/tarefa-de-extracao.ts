/**
 * A extração em lote como tarefa do poller (M3, etapa 5.1).
 *
 * Sem job por produto: a tarefa varre quem espera extração, vinte por vez — e por isso
 * pega também o que foi importado antes de haver chave. O catálogo que esperava a IA
 * ligar é lido nos primeiros minutos depois dela, sem ninguém reimportar nada.
 *
 * ## Antes da resolução, de propósito
 *
 * O poller para na primeira tarefa que trabalhou (`tarefasEmOrdem`), e na
 * `tarefaCompleta` a extração vem antes da identidade. Com extração pendente, a
 * resolução espera — e resolve já com marca e modelo, em vez de resolver sem e ter de
 * resolver de novo.
 *
 * ## Quem ganhou registro volta para a resolução
 *
 * A chave de agrupamento nova traz candidato que a primeira passada não tinha como ver.
 * O job de identidade do produto é reaberto se já tinha concluído, e criado se não
 * existia; pendente fica como está, porque vai rodar com o registro novo de qualquer
 * jeito.
 *
 * ## Espera
 *
 * Cota do provedor esgotada: espera a hora que ele disse. Falha do provedor que não é
 * cota — chave recusada, privacidade do gratuito desligada —: espera cinco minutos e
 * dobra até uma hora, sem marcar nenhum item. Sem essa espera, o poller perguntaria de
 * novo a cada tique, e cada pergunta recusada ainda conta na cota do dia.
 */
import type { Fila } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { ExecucaoInterrompida, LimiteDoProvedor } from '@/infra/llm';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import type { ExtratorDeRegistros, ResultadoDaExtracao } from './extracao';
import { TIPO_JOB_IDENTIDADE, chaveDeIdentidade } from './tarefa';

export const NOME_DA_TAREFA_DE_EXTRACAO = 'extracao';

/** Primeira espera depois de uma falha do provedor que não é cota. Dobra a cada falha. */
export const ESPERA_INICIAL_POR_FALHA_MS = 5 * 60_000;
export const ESPERA_MAXIMA_POR_FALHA_MS = 60 * 60_000;

/** Espera depois do teto da execução — que é por lote, então quase não acontece. */
export const ESPERA_POR_ORCAMENTO_MS = 60_000;

/** Um extrator por lote, e é isso que faz o orçamento ser novo a cada um. `undefined` sem chave. */
export type FabricaDeExtrator = () => ExtratorDeRegistros | undefined;

export type ResultadoDoLoteDeExtracao =
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'em_espera'; readonly ate: Date; readonly motivo: string }
  | { readonly tipo: 'interrompido'; readonly ate: Date; readonly motivo: string }
  | {
      readonly tipo: 'extracao';
      readonly resultado: ResultadoDaExtracao;
      /** Jobs de identidade reabertos ou criados para quem ganhou registro. */
      readonly reabertos: number;
    };

export class ExecutorDeExtracao {
  private espera: { readonly ate: number; readonly motivo: string } | null = null;
  private proximaEsperaPorFalha = ESPERA_INICIAL_POR_FALHA_MS;

  constructor(
    private readonly fila: Fila,
    private readonly criarExtrator: FabricaDeExtrator,
    private readonly relogio: () => number = Date.now,
  ) {}

  /** Extrai um lote. Nunca lança por causa do provedor: cota e falha viram espera. */
  async processarLote(): Promise<ResultadoDoLoteDeExtracao> {
    const agora = this.relogio();
    if (this.espera !== null && agora < this.espera.ate) {
      return { tipo: 'em_espera', ate: new Date(this.espera.ate), motivo: this.espera.motivo };
    }
    this.espera = null;

    const extrator = this.criarExtrator();
    if (extrator === undefined) return { tipo: 'sem_chave' };

    let resultado: ResultadoDaExtracao;
    try {
      resultado = await extrator.extrairLote();
    } catch (erro) {
      if (!(erro instanceof ExecucaoInterrompida)) throw erro;
      const ate =
        erro instanceof LimiteDoProvedor ? erro.ate : new Date(agora + ESPERA_POR_ORCAMENTO_MS);
      this.espera = { ate: ate.getTime(), motivo: erro.message };
      return { tipo: 'interrompido', ate, motivo: erro.message };
    }

    if (resultado.tipo === 'lote') {
      if (resultado.chamada === 'erro' || resultado.chamada === 'sem_chave') {
        const espera = this.proximaEsperaPorFalha;
        this.proximaEsperaPorFalha = Math.min(espera * 2, ESPERA_MAXIMA_POR_FALHA_MS);
        this.espera = {
          ate: agora + espera,
          motivo:
            resultado.chamada === 'erro'
              ? `o provedor falhou: ${resultado.erro ?? 'sem mensagem'}`
              : 'sem chave de LLM',
        };
      } else if (resultado.chamada !== 'nenhuma') {
        this.proximaEsperaPorFalha = ESPERA_INICIAL_POR_FALHA_MS;
      }
    }

    const reabertos = resultado.tipo === 'lote' ? await this.reabrirResolucao(resultado.lidos) : 0;
    return { tipo: 'extracao', resultado, reabertos };
  }

  private async reabrirResolucao(ids: readonly string[]): Promise<number> {
    let reabertos = 0;
    for (const id of ids) {
      const chave = chaveDeIdentidade(id);
      const existente = await this.fila.buscarPorChave(TIPO_JOB_IDENTIDADE, chave);
      if (existente === null) {
        await this.fila.enfileirar({
          tipo: TIPO_JOB_IDENTIDADE,
          chaveIdempotencia: chave,
          entrada: { produtoExternoId: id },
        });
        reabertos += 1;
      } else if (existente.status === 'concluido') {
        await this.fila.reenfileirar(existente.id);
        reabertos += 1;
      }
    }
    return reabertos;
  }
}

/** Campos de log de um lote, sem o objeto inteiro no log. */
export function camposDaExtracao(lote: ResultadoDoLoteDeExtracao): Record<string, unknown> {
  switch (lote.tipo) {
    case 'sem_chave':
      return {};
    case 'em_espera':
    case 'interrompido':
      return { ate: lote.ate.toISOString(), motivo: lote.motivo };
    case 'extracao': {
      const r = lote.resultado;
      if (r.tipo === 'nada_a_extrair') return {};
      return {
        selecionados: r.selecionados,
        semPedido: r.semPedido,
        enviados: r.enviados,
        lidos: r.lidos.length,
        recusados: r.recusados,
        paraTentarDeNovo: r.paraTentarDeNovo,
        descartes: r.descartes,
        chamada: r.chamada,
        reabertos: lote.reabertos,
        ...(r.erro === undefined ? {} : { erro: r.erro }),
      };
    }
  }
}

/** Tarefa que extrai um lote por tique. */
export function tarefaDeExtracao(
  executor: ExecutorDeExtracao,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_EXTRACAO });

  return {
    nome: NOME_DA_TAREFA_DE_EXTRACAO,
    async executar(): Promise<ResultadoDoTique> {
      const lote = await executor.processarLote();
      const campos = camposDaExtracao(lote);

      switch (lote.tipo) {
        case 'sem_chave':
        case 'em_espera':
          return { ocioso: true };
        case 'interrompido':
          // Ocioso: não há o que fazer até a hora dita, e as outras filas seguem.
          log.info('extracao.interrompida', campos);
          return { ocioso: true };
        case 'extracao':
          if (lote.resultado.tipo === 'nada_a_extrair') return { ocioso: true };
          if (lote.resultado.chamada === 'erro') log.aviso('extracao.provedor_falhou', campos);
          else log.info('extracao.lote', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
