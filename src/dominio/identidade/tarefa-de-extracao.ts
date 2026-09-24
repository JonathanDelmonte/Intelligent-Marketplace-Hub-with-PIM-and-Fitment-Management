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
 * Cota esgotada e falha do provedor viram espera (`lote.ts`), sem marcar nenhum item:
 * a falha não é do item.
 */
import type { Fila } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { ExecucaoInterrompida } from '@/infra/llm';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import type { ExtratorDeRegistros, ResultadoDaExtracao } from './extracao';
import { EsperaDoProvedor, reabrirResolucao } from './lote';

export const NOME_DA_TAREFA_DE_EXTRACAO = 'extracao';

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
  private readonly espera: EsperaDoProvedor;

  constructor(
    private readonly fila: Fila,
    private readonly criarExtrator: FabricaDeExtrator,
    relogio: () => number = Date.now,
  ) {
    this.espera = new EsperaDoProvedor(relogio);
  }

  /** Extrai um lote. Nunca lança por causa do provedor: cota e falha viram espera. */
  async processarLote(): Promise<ResultadoDoLoteDeExtracao> {
    const vigente = this.espera.vigente();
    if (vigente !== null) return { tipo: 'em_espera', ...vigente };

    const extrator = this.criarExtrator();
    if (extrator === undefined) return { tipo: 'sem_chave' };

    let resultado: ResultadoDaExtracao;
    try {
      resultado = await extrator.extrairLote();
    } catch (erro) {
      if (!(erro instanceof ExecucaoInterrompida)) throw erro;
      return { tipo: 'interrompido', ate: this.espera.interrompida(erro), motivo: erro.message };
    }

    if (resultado.tipo === 'lote') {
      if (resultado.chamada === 'erro') {
        this.espera.falhou(`o provedor falhou: ${resultado.erro ?? 'sem mensagem'}`);
      } else if (resultado.chamada === 'sem_chave') {
        this.espera.falhou('sem chave de LLM');
      } else if (resultado.chamada !== 'nenhuma') {
        this.espera.funcionou();
      }
    }

    const reabertos =
      resultado.tipo === 'lote' ? await reabrirResolucao(this.fila, resultado.lidos) : 0;
    return { tipo: 'extracao', resultado, reabertos };
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
