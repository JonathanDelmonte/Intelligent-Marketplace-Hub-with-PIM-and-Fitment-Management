/**
 * Poller da fila — o laço que faz o sistema andar sozinho.
 *
 * Até aqui a ingestão inteira era chamável por código e por teste: alguém tinha
 * que pedir `processarProximo()`. Este arquivo é o "alguém".
 *
 * O poller **não conhece ingestão**. Recebe uma `Tarefa`, que é qualquer coisa
 * capaz de executar uma unidade de trabalho e dizer se havia trabalho. É o que
 * mantém `infra/` sem dependência de `dominio/` e o que vai permitir que o mesmo
 * laço rode extração, resolução de identidade e monitor de preço mais tarde.
 *
 * ## As quatro decisões que sustentam o laço
 *
 * 1. **Espera adaptativa.** Tique que trabalhou espera quase nada, para uma
 *    planilha de 40 jobs drenar em sequência; tique ocioso espera segundos, para
 *    não martelar o banco com `SELECT` a cada milissegundo. Fila em tabela é
 *    barata, não gratuita.
 *
 * 2. **Exceção não mata o laço.** A tarefa de ingestão já promete não lançar, mas
 *    o poller não pode *depender* disso: banco que cai lança dentro de
 *    `reivindicar`, antes de qualquer tratamento da tarefa. Erro vira log e
 *    backoff, nunca fim de processo.
 *
 * 3. **Falha de job não é erro de poller.** `{ tipo: 'falhou' }` já foi tratado
 *    pela fila, com backoff e tentativa. Aplicar backoff de poller em cima disso
 *    puniria a fila inteira pelo defeito de um job — que é exatamente o que a
 *    fila existe para evitar. Só exceção conta como erro de poller.
 *
 * 4. **O sono é interrompível.** Sem isso, `Ctrl-C` durante uma espera de dois
 *    segundos parece travamento, e em produção o contêiner leva `SIGKILL` antes
 *    de o job em andamento terminar. `parar()` acorda o sono na hora.
 */
import type { Campos, Registrador } from '../log';
import { registradorSilencioso } from '../log';

/** O que um tique fez. */
export interface ResultadoDoTique {
  /** Não havia trabalho pronto. Decide a espera até o próximo tique. */
  readonly ocioso: boolean;
  /** Campos nomeados para o log, produzidos pela própria tarefa. */
  readonly campos?: Campos;
}

/** Uma unidade de trabalho que o poller sabe repetir. */
export interface Tarefa {
  /** Nome curto, usado no log. */
  readonly nome: string;
  /**
   * Executa **uma** unidade. Deve tratar erro de conteúdo por conta própria;
   * exceção aqui é entendida como falha de infraestrutura.
   */
  executar(): Promise<ResultadoDoTique>;
}

/**
 * Junta tarefas numa só, na ordem informada.
 *
 * O poller roda **uma** tarefa, e o sistema tem duas filas: ingestão e resolução de
 * identidade. Rodar dois pollers seria dois processos, duas conexões e dois
 * encerramentos para acertar; rodar as duas por tique é o suficiente.
 *
 * O tique para na **primeira tarefa que trabalhou**, e a ordem é a da prioridade:
 * ingestão antes de identidade. A razão é de fila, não de gosto — identidade só tem
 * o que fazer depois que a ingestão gravou a ocorrência, e uma fila de identidade
 * grande não deve atrasar a entrada de dado novo.
 *
 * O tique é ocioso só quando **todas** as tarefas estão ociosas. Dizer o contrário
 * faria o poller acelerar a espera com a fila vazia.
 */
export function tarefasEmOrdem(nome: string, tarefas: readonly Tarefa[]): Tarefa {
  if (tarefas.length === 0) {
    throw new Error('tarefasEmOrdem precisa de ao menos uma tarefa');
  }

  return {
    nome,
    async executar(): Promise<ResultadoDoTique> {
      for (const tarefa of tarefas) {
        const resultado = await tarefa.executar();
        if (!resultado.ocioso) {
          return {
            ocioso: false,
            campos: { ...resultado.campos, tarefa: tarefa.nome },
          };
        }
      }
      return { ocioso: true };
    },
  };
}

/**
 * Agendamento de espera. Devolve a função que cancela.
 *
 * Injetável para o teste poder observar **quanto** o poller pediu para esperar
 * sem esperar de verdade — o que é a única forma de testar espera adaptativa em
 * uma suíte que roda em segundos.
 */
export type Temporizador = (ms: number, acao: () => void) => () => void;

const temporizadorReal: Temporizador = (ms, acao) => {
  const t = setTimeout(acao, ms);
  return () => {
    clearTimeout(t);
  };
};

export interface OpcoesDoPoller {
  /** Espera depois de um tique que trabalhou. Padrão: 25 ms. */
  readonly intervaloAtivoMs?: number;
  /** Espera depois de um tique ocioso. Padrão: 2 s. */
  readonly intervaloOciosoMs?: number;
  /** Teto do backoff depois de exceção. Padrão: 1 min. */
  readonly intervaloMaximoAposErroMs?: number;
  /** Para depois de N tiques. Sem valor, roda até `parar()`. */
  readonly limiteDeTiques?: number;
  /** Para no primeiro tique ocioso — modo "drena e sai", para cron e comando. */
  readonly pararQuandoOcioso?: boolean;
  readonly registrador?: Registrador;
  readonly temporizador?: Temporizador;
  readonly agora?: () => Date;
}

export interface EstatisticasDoPoller {
  readonly tiques: number;
  readonly comTrabalho: number;
  readonly ociosos: number;
  readonly errosTotais: number;
  readonly errosConsecutivos: number;
  readonly iniciadoEm: Date | null;
  readonly ultimoTiqueEm: Date | null;
  readonly parando: boolean;
  readonly rodando: boolean;
}

export class Poller {
  private readonly intervaloAtivoMs: number;
  private readonly intervaloOciosoMs: number;
  private readonly intervaloMaximoAposErroMs: number;
  private readonly limiteDeTiques: number | null;
  private readonly pararQuandoOcioso: boolean;
  private readonly log: Registrador;
  private readonly temporizador: Temporizador;
  private readonly agora: () => Date;

  private parando = false;
  private ativo = false;
  private acordar: (() => void) | null = null;

  private tiques = 0;
  private comTrabalho = 0;
  private ociosos = 0;
  private errosTotais = 0;
  private errosConsecutivos = 0;
  private iniciadoEm: Date | null = null;
  private ultimoTiqueEm: Date | null = null;

  constructor(
    private readonly tarefa: Tarefa,
    opcoes: OpcoesDoPoller = {},
  ) {
    this.intervaloAtivoMs = opcoes.intervaloAtivoMs ?? 25;
    this.intervaloOciosoMs = opcoes.intervaloOciosoMs ?? 2_000;
    this.intervaloMaximoAposErroMs = opcoes.intervaloMaximoAposErroMs ?? 60_000;
    this.limiteDeTiques = opcoes.limiteDeTiques ?? null;
    this.pararQuandoOcioso = opcoes.pararQuandoOcioso ?? false;
    this.temporizador = opcoes.temporizador ?? temporizadorReal;
    this.agora = opcoes.agora ?? (() => new Date());
    this.log = (opcoes.registrador ?? registradorSilencioso).com({ poller: tarefa.nome });
  }

  get estatisticas(): EstatisticasDoPoller {
    return {
      tiques: this.tiques,
      comTrabalho: this.comTrabalho,
      ociosos: this.ociosos,
      errosTotais: this.errosTotais,
      errosConsecutivos: this.errosConsecutivos,
      iniciadoEm: this.iniciadoEm,
      ultimoTiqueEm: this.ultimoTiqueEm,
      parando: this.parando,
      rodando: this.ativo,
    };
  }

  /**
   * Roda o laço até `parar()`, até o limite de tiques, ou até a fila esvaziar
   * quando em modo "drena e sai".
   *
   * Resolve com as estatísticas. Não lança: exceção de tarefa é tratada dentro.
   */
  async iniciar(): Promise<EstatisticasDoPoller> {
    if (this.ativo) throw new Error('este poller já está rodando');

    this.ativo = true;
    this.parando = false;
    this.iniciadoEm = this.agora();
    this.log.info('poller.iniciou', {
      intervaloAtivoMs: this.intervaloAtivoMs,
      intervaloOciosoMs: this.intervaloOciosoMs,
      ...(this.limiteDeTiques === null ? {} : { limiteDeTiques: this.limiteDeTiques }),
      ...(this.pararQuandoOcioso ? { modo: 'drena_e_sai' } : {}),
    });

    try {
      while (!this.parando) {
        if (this.limiteDeTiques !== null && this.tiques >= this.limiteDeTiques) break;

        const espera = await this.tique();
        if (this.parando) break;
        if (espera === 'sair') break;

        await this.esperar(espera);
      }
    } finally {
      this.ativo = false;
      this.acordar = null;
      this.log.info('poller.parou', {
        tiques: this.tiques,
        comTrabalho: this.comTrabalho,
        ociosos: this.ociosos,
        errosTotais: this.errosTotais,
      });
    }

    return this.estatisticas;
  }

  /**
   * Pede o encerramento e acorda o sono.
   *
   * Não interrompe o tique em andamento — de propósito. Job pela metade é pior
   * que job que demora: interromper no meio deixaria `rodando` no banco até o
   * prazo de execução estourar. O tique atual termina, e o laço não começa outro.
   */
  parar(): void {
    if (this.parando) return;
    this.parando = true;
    this.log.info('poller.encerrando');
    this.acordar?.();
  }

  /** Um tique. Devolve quanto esperar, ou `sair` quando é hora de encerrar. */
  private async tique(): Promise<number | 'sair'> {
    this.tiques += 1;
    this.ultimoTiqueEm = this.agora();

    try {
      const resultado = await this.tarefa.executar();
      this.errosConsecutivos = 0;

      if (resultado.ocioso) {
        this.ociosos += 1;
        this.log.debug('poller.ocioso', resultado.campos ?? {});
        return this.pararQuandoOcioso ? 'sair' : this.intervaloOciosoMs;
      }

      this.comTrabalho += 1;
      this.log.info('poller.trabalhou', resultado.campos ?? {});
      return this.intervaloAtivoMs;
    } catch (erro) {
      this.errosTotais += 1;
      this.errosConsecutivos += 1;

      const espera = this.backoffDeErro();
      this.log.erro('poller.erro', {
        erro,
        errosConsecutivos: this.errosConsecutivos,
        proximaTentativaEmMs: espera,
      });
      return espera;
    }
  }

  /**
   * Backoff depois de exceção.
   *
   * Parte do intervalo ocioso e dobra a cada erro consecutivo, até o teto. Banco
   * que caiu volta em segundos ou em minutos, e martelar durante a queda só
   * enche o log de linhas idênticas.
   */
  private backoffDeErro(): number {
    const expoente = Math.max(0, this.errosConsecutivos - 1);
    // O expoente é limitado antes de virar potência: `2 ** 1030` é `Infinity`, e
    // `Math.min(Infinity, teto)` daria o teto certo por acidente. Depender de
    // acidente em código de recuperação de falha é como se perde a recuperação.
    const fator = 2 ** Math.min(expoente, 30);
    return Math.min(this.intervaloOciosoMs * fator, this.intervaloMaximoAposErroMs);
  }

  /** Espera interrompível por `parar()`. */
  private esperar(ms: number): Promise<void> {
    if (ms <= 0 || this.parando) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let pronto = false;
      const terminar = (): void => {
        if (pronto) return;
        pronto = true;
        this.acordar = null;
        resolve();
      };

      const cancelar = this.temporizador(ms, terminar);

      // O temporizador pode disparar de imediato — é o que o teste faz para não
      // esperar de verdade. Sem esta guarda, `this.acordar` ficaria apontando
      // para uma espera já terminada, e o próximo `parar()` acordaria o nada.
      if (pronto) return;

      this.acordar = () => {
        cancelar();
        terminar();
      };
    });
  }
}

/**
 * Liga `SIGINT` e `SIGTERM` ao encerramento limpo.
 *
 * Devolve a função que desfaz a ligação, para o processo não acumular ouvinte
 * quando roda mais de um poller.
 *
 * Segundo sinal encerra na força: se o primeiro `Ctrl-C` pediu educadamente e o
 * tique está preso, a pessoa precisa de uma saída que funcione.
 */
export function ligarSinaisDeEncerramento(
  poller: Poller,
  opcoes: {
    readonly processo?: Pick<NodeJS.Process, 'on' | 'off' | 'exit'>;
    readonly registrador?: Registrador;
  } = {},
): () => void {
  const processo = opcoes.processo ?? process;
  const log = opcoes.registrador ?? registradorSilencioso;
  const sinais: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  let jaPediu = false;

  const tratar = (sinal: NodeJS.Signals): void => {
    if (jaPediu) {
      log.aviso('poller.encerramento_forcado', { sinal });
      processo.exit(130);
      return;
    }
    jaPediu = true;
    log.info('poller.sinal', { sinal });
    poller.parar();
  };

  const ouvintes = sinais.map((sinal) => {
    const ouvinte = (): void => {
      tratar(sinal);
    };
    processo.on(sinal, ouvinte);
    return { sinal, ouvinte } as const;
  });

  return () => {
    for (const { sinal, ouvinte } of ouvintes) processo.off(sinal, ouvinte);
  };
}
