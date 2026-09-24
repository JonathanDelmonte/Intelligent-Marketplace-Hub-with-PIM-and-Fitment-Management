/**
 * A conferência de fornecedor como tarefa do poller (M5, etapa 7.3).
 *
 * "Verificação automática" é a especificação: o fornecedor cadastrado é conferido sem
 * ninguém pedir, e de novo a cada noventa dias. O botão da tela faz a mesma conferência
 * na hora; esta é a que roda sozinha.
 *
 * Devagar de propósito. O buscador é gratuito e recusa quem pergunta demais, então a
 * tarefa confere **um** fornecedor por vez, com um minuto entre um e outro; quando o
 * buscador ou a Receita recusam, espera cinco minutos, dobrando até uma hora. Sem
 * fornecedor a conferir, olha a base de novo em dez minutos, e não a cada tique.
 */
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import type { Conferencia } from './conferencia';
import type { FornecedorGravado, RepositorioDeFornecedores } from './repositorio';

export const NOME_DA_TAREFA_DE_CONFERENCIA = 'conferencia_de_fornecedor';

/** Entre uma conferência e a próxima: três buscas por fornecedor já são bastante. */
export const INTERVALO_ENTRE_CONFERENCIAS_MS = 60_000;
/** Sem fornecedor a conferir: a base não muda a cada dois segundos. */
export const INTERVALO_SEM_TRABALHO_MS = 10 * 60_000;
export const ESPERA_INICIAL_POR_RECUSA_MS = 5 * 60_000;
export const ESPERA_MAXIMA_POR_RECUSA_MS = 60 * 60_000;

/** Confere um fornecedor: o CNPJ e as vitrines. Em produção, `conferirFornecedor`. */
export type Conferidor = (fornecedor: FornecedorGravado) => Promise<Conferencia>;

export type ResultadoDaConferenciaAutomatica =
  | { readonly tipo: 'sem_rede' }
  | { readonly tipo: 'em_espera'; readonly ate: Date }
  | { readonly tipo: 'nada_a_conferir' }
  | {
      readonly tipo: 'conferido';
      readonly fornecedorId: string;
      readonly lojas: number;
      readonly indicios: number;
      readonly respondeu: boolean;
      readonly recusa: string | null;
    };

/** O motivo, quando o buscador ou a Receita recusaram — o que manda esperar. */
function recusaDe(conferencia: Conferencia): string | null {
  if (conferencia.vitrine.falha !== null) return conferencia.vitrine.falha;
  return conferencia.cadastro.tipo === 'falhou' ? conferencia.cadastro.motivo : null;
}

export class ExecutorDeConferencia {
  private proximaEm = 0;
  private esperaPorRecusa = ESPERA_INICIAL_POR_RECUSA_MS;

  constructor(
    private readonly repositorio: RepositorioDeFornecedores,
    /** `null` sem rede — em teste, e em instalação que não sai para a internet. */
    private readonly conferir: Conferidor | null,
    private readonly relogio: () => number = Date.now,
  ) {}

  /** Confere o próximo da fila, se já for hora. Nunca lança por recusa de serviço. */
  async conferirProximo(): Promise<ResultadoDaConferenciaAutomatica> {
    if (this.conferir === null) return { tipo: 'sem_rede' };
    const agora = this.relogio();
    if (agora < this.proximaEm) return { tipo: 'em_espera', ate: new Date(this.proximaEm) };

    const [proximo] = await this.repositorio.paraConferir(new Date(agora));
    if (proximo === undefined) {
      this.proximaEm = agora + INTERVALO_SEM_TRABALHO_MS;
      return { tipo: 'nada_a_conferir' };
    }

    const conferencia = await this.conferir(proximo);
    const gravado = await this.repositorio.registrarConferencia(proximo.id, conferencia);

    const recusa = recusaDe(conferencia);
    if (recusa === null) {
      this.esperaPorRecusa = ESPERA_INICIAL_POR_RECUSA_MS;
      this.proximaEm = this.relogio() + INTERVALO_ENTRE_CONFERENCIAS_MS;
    } else {
      this.proximaEm = this.relogio() + this.esperaPorRecusa;
      this.esperaPorRecusa = Math.min(this.esperaPorRecusa * 2, ESPERA_MAXIMA_POR_RECUSA_MS);
    }

    return {
      tipo: 'conferido',
      fornecedorId: proximo.id,
      lojas: conferencia.vitrine.lojas.length,
      indicios: conferencia.vitrine.indicios.length,
      respondeu: gravado?.respondeu ?? false,
      recusa,
    };
  }
}

/** Tarefa que confere um fornecedor por tique, quando é hora. */
export function tarefaDeConferencia(
  executor: ExecutorDeConferencia,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_CONFERENCIA });

  return {
    nome: NOME_DA_TAREFA_DE_CONFERENCIA,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.conferirProximo();
      if (resultado.tipo !== 'conferido') return { ocioso: true };

      const campos = {
        fornecedorId: resultado.fornecedorId,
        lojas: resultado.lojas,
        indicios: resultado.indicios,
        respondeu: resultado.respondeu,
        ...(resultado.recusa === null ? {} : { recusa: resultado.recusa }),
      };
      if (resultado.recusa === null) log.info('conferencia.feita', campos);
      else log.aviso('conferencia.recusada', campos);
      return { ocioso: false, campos };
    },
  };
}
