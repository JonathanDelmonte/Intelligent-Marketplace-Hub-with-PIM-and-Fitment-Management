/**
 * A leitura do monitor por IA como tarefa do poller (M15, etapa 11.1).
 *
 * Como a extração e o embedding: sem job por evento, a tarefa varre os grupos que esperam
 * leitura, oito por pedido. Vem depois das filas de dado — ingestão, identidade, pedidos
 * — porque divide a mesma cota gratuita com elas, e dado novo vale mais que a hipótese
 * sobre dado velho.
 *
 * Cota esgotada e provedor fora viram espera, a mesma da identidade (`infra/llm/espera`).
 * Resposta que não serve para o lote inteiro faz o próximo lote ter a metade do tamanho,
 * até um grupo por pedido; a primeira resposta boa devolve o tamanho cheio.
 */
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { ExecucaoInterrompida } from '@/infra/llm';
import { EsperaDoProvedor } from '@/infra/llm/espera';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import { GRUPOS_POR_PEDIDO, type LeitorDoMonitor, type ResultadoDaLeitura } from './leitura';

export const NOME_DA_TAREFA_DE_LEITURA = 'leitura_do_monitor';

/** Um leitor por lote, com orçamento novo a cada um. `undefined` sem chave. */
export type FabricaDeLeitor = () => LeitorDoMonitor | undefined;

export type ResultadoDoLoteDeLeitura =
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'em_espera'; readonly ate: Date; readonly motivo: string }
  | { readonly tipo: 'interrompido'; readonly ate: Date; readonly motivo: string }
  | { readonly tipo: 'leitura'; readonly resultado: ResultadoDaLeitura; readonly tamanho: number };

export class ExecutorDeLeituraDoMonitor {
  private readonly espera: EsperaDoProvedor;
  private tamanho = GRUPOS_POR_PEDIDO;

  constructor(
    private readonly criarLeitor: FabricaDeLeitor,
    relogio: () => number = Date.now,
  ) {
    this.espera = new EsperaDoProvedor(relogio);
  }

  /** Lê um lote. Nunca lança por causa do provedor: cota e falha viram espera. */
  async processarLote(): Promise<ResultadoDoLoteDeLeitura> {
    const vigente = this.espera.vigente();
    if (vigente !== null) return { tipo: 'em_espera', ...vigente };

    const leitor = this.criarLeitor();
    if (leitor === undefined) return { tipo: 'sem_chave' };

    const tamanho = this.tamanho;
    let resultado: ResultadoDaLeitura;
    try {
      resultado = await leitor.lerLote(tamanho);
    } catch (erro) {
      if (!(erro instanceof ExecucaoInterrompida)) throw erro;
      return { tipo: 'interrompido', ate: this.espera.interrompida(erro), motivo: erro.message };
    }

    if (resultado.tipo === 'lote') {
      if (resultado.chamada === 'sem_chave') this.espera.falhou('sem chave de LLM');
      else if (resultado.chamada === 'erro' && !resultado.loteInutilizavel) {
        this.espera.falhou(`o provedor falhou: ${resultado.erro ?? 'sem mensagem'}`);
      } else {
        this.espera.funcionou();
        this.tamanho = resultado.loteInutilizavel
          ? Math.max(1, Math.floor(tamanho / 2))
          : GRUPOS_POR_PEDIDO;
      }
    }
    return { tipo: 'leitura', resultado, tamanho };
  }
}

/** Campos de log de um lote. */
export function camposDaLeitura(lote: ResultadoDoLoteDeLeitura): Record<string, unknown> {
  switch (lote.tipo) {
    case 'sem_chave':
      return {};
    case 'em_espera':
    case 'interrompido':
      return { ate: lote.ate.toISOString(), motivo: lote.motivo };
    case 'leitura': {
      const r = lote.resultado;
      if (r.tipo === 'nada_a_ler') return {};
      return {
        grupos: r.grupos,
        lidos: r.lidos,
        paraTentarDeNovo: r.paraTentarDeNovo,
        semLeitura: r.semLeitura,
        chamada: r.chamada,
        tamanho: lote.tamanho,
        ...(r.erro === undefined ? {} : { erro: r.erro }),
      };
    }
  }
}

/** Tarefa que lê um lote de grupos por tique. */
export function tarefaDeLeituraDoMonitor(
  executor: ExecutorDeLeituraDoMonitor,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_LEITURA });

  return {
    nome: NOME_DA_TAREFA_DE_LEITURA,
    async executar(): Promise<ResultadoDoTique> {
      const lote = await executor.processarLote();
      const campos = camposDaLeitura(lote);

      switch (lote.tipo) {
        case 'sem_chave':
        case 'em_espera':
          return { ocioso: true };
        case 'interrompido':
          log.info('leitura_do_monitor.interrompida', campos);
          return { ocioso: true };
        case 'leitura':
          if (lote.resultado.tipo === 'nada_a_ler') return { ocioso: true };
          if (lote.resultado.chamada === 'erro') log.aviso('leitura_do_monitor.falhou', campos);
          else log.info('leitura_do_monitor.lote', campos);
          // Chave ausente ou provedor fora: a tarefa não trabalhou de verdade, e o poller
          // não deve correr para o próximo tique como se tivesse.
          return lote.resultado.chamada === 'feita' ? { ocioso: false, campos } : { ocioso: true };
      }
    },
  };
}
