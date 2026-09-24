/**
 * O embedding em lote como tarefa do poller (M3, etapa 5.2).
 *
 * Como a extração: sem job por produto, a tarefa varre quem espera vetor, cinquenta por
 * vez, e pega também o que foi importado antes de haver chave. Vem depois da extração e
 * antes da identidade na `tarefaCompleta`: a extração é que dá a forma canônica de onde o
 * vetor sai, e a resolução é que usa os vizinhos.
 *
 * Produto que ganhou vetor volta para a resolução (`reabrirResolucao`): a vizinhança nova
 * traz candidato que a primeira passada não tinha como ver.
 */
import type { Fila } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { ExecucaoInterrompida } from '@/infra/llm';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import type { GeradorDeEmbeddings, ResultadoDoEmbedding } from './embedding';
import { EsperaDoProvedor, reabrirResolucao } from './lote';

export const NOME_DA_TAREFA_DE_EMBEDDING = 'embedding';

/** Um gerador por lote, com orçamento novo a cada um. `undefined` sem chave. */
export type FabricaDeGerador = () => GeradorDeEmbeddings | undefined;

export type ResultadoDoLoteDeEmbedding =
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'em_espera'; readonly ate: Date; readonly motivo: string }
  | { readonly tipo: 'interrompido'; readonly ate: Date; readonly motivo: string }
  | {
      readonly tipo: 'embedding';
      readonly resultado: ResultadoDoEmbedding;
      readonly reabertos: number;
    };

export class ExecutorDeEmbedding {
  private readonly espera: EsperaDoProvedor;

  constructor(
    private readonly fila: Fila,
    private readonly criarGerador: FabricaDeGerador,
    relogio: () => number = Date.now,
  ) {
    this.espera = new EsperaDoProvedor(relogio);
  }

  /** Gera um lote. Nunca lança por causa do provedor: cota e falha viram espera. */
  async processarLote(): Promise<ResultadoDoLoteDeEmbedding> {
    const vigente = this.espera.vigente();
    if (vigente !== null) return { tipo: 'em_espera', ...vigente };

    const gerador = this.criarGerador();
    if (gerador === undefined) return { tipo: 'sem_chave' };

    let resultado: ResultadoDoEmbedding;
    try {
      resultado = await gerador.gerarLote();
    } catch (erro) {
      if (!(erro instanceof ExecucaoInterrompida)) throw erro;
      return { tipo: 'interrompido', ate: this.espera.interrompida(erro), motivo: erro.message };
    }

    if (resultado.tipo === 'lote') {
      switch (resultado.chamada) {
        case 'erro':
          this.espera.falhou(`o provedor falhou: ${resultado.erro ?? 'sem mensagem'}`);
          break;
        case 'sem_chave':
          this.espera.falhou('sem chave de LLM');
          break;
        case 'nao_suportado':
          this.espera.falhou('o provedor configurado não gera embedding');
          break;
        case 'feita':
          this.espera.funcionou();
          break;
        case 'nenhuma':
          break;
      }
    }

    const reabertos =
      resultado.tipo === 'lote' ? await reabrirResolucao(this.fila, resultado.gerados) : 0;
    return { tipo: 'embedding', resultado, reabertos };
  }
}

/** Campos de log de um lote, sem os vetores no log. */
export function camposDoEmbedding(lote: ResultadoDoLoteDeEmbedding): Record<string, unknown> {
  switch (lote.tipo) {
    case 'sem_chave':
      return {};
    case 'em_espera':
    case 'interrompido':
      return { ate: lote.ate.toISOString(), motivo: lote.motivo };
    case 'embedding': {
      const r = lote.resultado;
      if (r.tipo === 'nada_a_gerar') return {};
      return {
        selecionados: r.selecionados,
        copiados: r.copiados,
        enviados: r.enviados,
        gerados: r.gerados.length,
        recusados: r.recusados,
        chamada: r.chamada,
        reabertos: lote.reabertos,
        ...(r.erro === undefined ? {} : { erro: r.erro }),
      };
    }
  }
}

/** Tarefa que gera um lote de vetores por tique. */
export function tarefaDeEmbedding(
  executor: ExecutorDeEmbedding,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_EMBEDDING });

  return {
    nome: NOME_DA_TAREFA_DE_EMBEDDING,
    async executar(): Promise<ResultadoDoTique> {
      const lote = await executor.processarLote();
      const campos = camposDoEmbedding(lote);

      switch (lote.tipo) {
        case 'sem_chave':
        case 'em_espera':
          return { ocioso: true };
        case 'interrompido':
          log.info('embedding.interrompido', campos);
          return { ocioso: true };
        case 'embedding':
          if (lote.resultado.tipo === 'nada_a_gerar') return { ocioso: true };
          if (lote.resultado.chamada === 'erro') log.aviso('embedding.provedor_falhou', campos);
          else log.info('embedding.lote', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
