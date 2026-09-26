/**
 * A nuvem guarda só o que ainda serve (ADR 0016).
 *
 * Quem envia uma planilha tem o original no computador. A cópia na nuvem existe para a
 * fila ler; depois de lida, é espaço gasto no 1 GB do plano gratuito. A limpeza apaga o
 * arquivo que passou `retencaoDias` sem uso, e "sem uso" são duas condições juntas:
 *
 * - **gravado há mais que isso** — enviar de novo o que tinha saído grava de novo, e
 *   renova;
 * - **nenhum job que ainda vá rodar com ele**, e o último movimento dos jobs que o citam
 *   também há mais que isso. Job pendente guarda o arquivo pelo tempo que for, mesmo
 *   agendado para daqui a uma semana.
 *
 * Arquivo que nenhum job cita — de um envio que quebrou antes de enfileirar — sai pelo
 * mesmo prazo. E o job que tentar ler um arquivo que já saiu vai para revisão dizendo
 * para enviá-lo de novo; enviá-lo o devolve à fila (`Orquestrador.receber`).
 *
 * No computador de quem usa, com o conteúdo em disco, nada disto roda: o espaço é dele,
 * e reprocessar sem reenviar continua possível. A montagem só dá prazo ao depósito na
 * nuvem.
 *
 * **Uma corrida aceita.** Quem envia de novo um arquivo que ainda está lá, no minuto em
 * que a limpeza decide apagá-lo, pode ficar sem ele. O job novo vai para revisão pedindo
 * o arquivo, e reenviar resolve. Fechar isso pediria trava entre site e fila, para um
 * caso de segundos a cada seis horas.
 */
import type { Fila, UsoNaFila } from '../fila/fila';
import type { ResultadoDoTique, Tarefa } from '../fila/poller';
import { registradorSilencioso, type Registrador } from '../log';
import type { ArmazenamentoDeConteudo, ConteudoGuardado } from './conteudo';

/**
 * Quantos dias o arquivo enviado fica na nuvem depois do último uso. Decisão do dono,
 * 26/09/2026 (ADR 0016): o bastante para rodar de novo o que deu errado na mesma semana.
 */
export const RETENCAO_NA_NUVEM_DIAS = 7;

/**
 * O campo da entrada do job que cita o conteúdo guardado.
 *
 * É convenção, e a limpeza depende dela: a ingestão (`EntradaDoJobDeIngestao`) e a
 * importação de pedidos usam este nome, e um tipo de job novo que guardar arquivo com
 * outro nome teria o arquivo apagado com o job ainda pendente. O teste da limpeza
 * enfileira pelos dois caminhos de verdade e confere que a fila os vê.
 */
export const CAMPO_DO_CONTEUDO_NA_ENTRADA = 'hashConteudo';

/** De quanto em quanto tempo a limpeza olha. O prazo é em dias; seis horas sobra. */
export const INTERVALO_DA_LIMPEZA_MS = 6 * 60 * 60_000;

/** Depois de uma limpeza que falhou — nuvem fora —, quanto esperar para tentar de novo. */
export const INTERVALO_APOS_FALHA_MS = 15 * 60_000;

/** Teto de apagados por vez, para uma limpeza atrasada não ocupar a fila de uma vez. */
export const APAGADOS_POR_VEZ = 200;

const DIA_MS = 24 * 60 * 60_000;

/**
 * O que apagar. Função pura: a regra inteira está aqui, e o resto é ler e apagar.
 */
export function escolherOQueApagar(params: {
  readonly guardados: readonly ConteudoGuardado[];
  readonly uso: ReadonlyMap<string, UsoNaFila>;
  readonly agora: Date;
  readonly retencaoDias: number;
}): readonly ConteudoGuardado[] {
  const limite = params.agora.getTime() - params.retencaoDias * DIA_MS;
  return params.guardados.filter((guardado) => {
    if (guardado.gravadoEm.getTime() > limite) return false;
    const uso = params.uso.get(guardado.hash);
    if (uso === undefined) return true;
    return !uso.ativo && uso.ultimoMovimento.getTime() <= limite;
  });
}

export interface ResultadoDaLimpeza {
  /** `false` quando o armazenamento guarda para sempre, e não havia o que olhar. */
  readonly temPrazo: boolean;
  readonly guardados: number;
  readonly apagados: number;
  readonly bytesApagados: number;
}

export class LimpezaDoConteudo {
  constructor(
    private readonly armazenamento: ArmazenamentoDeConteudo,
    private readonly fila: Fila,
    private readonly opcoes: {
      readonly agora?: () => Date;
      readonly apagadosPorVez?: number;
    } = {},
  ) {}

  async limpar(): Promise<ResultadoDaLimpeza> {
    const retencaoDias = this.armazenamento.retencaoDias;
    if (retencaoDias === null) {
      return { temPrazo: false, guardados: 0, apagados: 0, bytesApagados: 0 };
    }

    const guardados: ConteudoGuardado[] = [];
    for await (const guardado of this.armazenamento.listar()) guardados.push(guardado);

    // A fila é lida depois da listagem, de propósito: o job enfileirado entre as duas
    // leituras aparece no uso, e o arquivo gravado entre elas é novo demais para sair.
    const uso = await this.fila.usoPorCampoDaEntrada(CAMPO_DO_CONTEUDO_NA_ENTRADA);
    const agora = (this.opcoes.agora ?? (() => new Date()))();
    const apagar = escolherOQueApagar({ guardados, uso, agora, retencaoDias }).slice(
      0,
      this.opcoes.apagadosPorVez ?? APAGADOS_POR_VEZ,
    );

    let bytesApagados = 0;
    for (const guardado of apagar) {
      await this.armazenamento.apagar(guardado.hash);
      bytesApagados += guardado.bytes;
    }
    return { temPrazo: true, guardados: guardados.length, apagados: apagar.length, bytesApagados };
  }
}

export const NOME_DA_TAREFA_DE_LIMPEZA = 'limpeza_do_conteudo';

/**
 * A limpeza como tarefa do poller: roda na primeira vez que a fila está ociosa, e depois
 * a cada `INTERVALO_DA_LIMPEZA_MS`. Entre uma e outra, o tique custa uma comparação.
 *
 * É a última da fila de propósito: `tarefasEmOrdem` só chega a ela num tique em que
 * nenhuma outra tinha trabalho.
 *
 * Nuvem fora não para a fila: a falha vira aviso no log, e a limpeza tenta de novo em
 * `INTERVALO_APOS_FALHA_MS`. Nada se perde esperando — o arquivo só fica mais um pouco.
 */
export function tarefaDeLimpeza(
  limpeza: Pick<LimpezaDoConteudo, 'limpar'>,
  registrador: Registrador = registradorSilencioso,
  opcoes: { readonly agora?: () => Date; readonly intervaloMs?: number } = {},
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_LIMPEZA });
  const agora = opcoes.agora ?? (() => new Date());
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_DA_LIMPEZA_MS;
  let proximaEm = 0;

  return {
    nome: NOME_DA_TAREFA_DE_LIMPEZA,
    async executar(): Promise<ResultadoDoTique> {
      const inicio = agora().getTime();
      if (inicio < proximaEm) return { ocioso: true };

      let resultado: ResultadoDaLimpeza;
      try {
        resultado = await limpeza.limpar();
      } catch (erro) {
        proximaEm = inicio + Math.min(intervaloMs, INTERVALO_APOS_FALHA_MS);
        log.aviso('conteudo.limpeza_falhou', { erro });
        return { ocioso: true };
      }
      proximaEm = inicio + intervaloMs;

      if (resultado.apagados === 0) {
        if (resultado.temPrazo) log.debug('conteudo.limpeza_sem_o_que_apagar', { ...resultado });
        return { ocioso: true };
      }
      const campos = {
        guardados: resultado.guardados,
        apagados: resultado.apagados,
        bytesApagados: resultado.bytesApagados,
      };
      log.info('conteudo.limpeza', campos);
      return { ocioso: false, campos };
    },
  };
}
