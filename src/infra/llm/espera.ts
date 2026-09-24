/**
 * Até quando não vale perguntar ao provedor de IA, e por quê.
 *
 * Mora na camada do provedor porque é dele que se espera: a extração (5.1), o embedding
 * (5.2) e a leitura do monitor (11.1) perguntam ao mesmo provedor, sob a mesma cota
 * gratuita, e duas cópias da espera divergiriam — uma dobrando, a outra não.
 */
import { LimiteDoProvedor, type ExecucaoInterrompida } from './index';

/** Primeira espera depois de uma falha do provedor que não é cota. Dobra a cada falha. */
export const ESPERA_INICIAL_POR_FALHA_MS = 5 * 60_000;
export const ESPERA_MAXIMA_POR_FALHA_MS = 60 * 60_000;

/** Espera depois do teto da execução — que é por lote, então quase não acontece. */
export const ESPERA_POR_ORCAMENTO_MS = 60_000;

/**
 * Até quando não vale perguntar ao provedor, e por quê.
 *
 * Cota esgotada: até a hora que o provedor disse. Falha que não é cota — chave
 * recusada, privacidade do gratuito desligada —: cinco minutos, dobrando até uma hora.
 * Sem isso, o poller perguntaria de novo a cada tique, e cada pergunta recusada ainda
 * conta na cota do dia. Mora no executor, que é um por processo: espera que se esquece a
 * cada tique não é espera.
 */
export class EsperaDoProvedor {
  private espera: { readonly ate: number; readonly motivo: string } | null = null;
  private proximaPorFalha = ESPERA_INICIAL_POR_FALHA_MS;

  constructor(private readonly relogio: () => number = Date.now) {}

  agora(): number {
    return this.relogio();
  }

  /** A espera em curso, ou `null` quando já pode perguntar. */
  vigente(): { readonly ate: Date; readonly motivo: string } | null {
    if (this.espera === null) return null;
    if (this.relogio() >= this.espera.ate) {
      this.espera = null;
      return null;
    }
    return { ate: new Date(this.espera.ate), motivo: this.espera.motivo };
  }

  /** Cota ou teto: espera a hora dita, ou um minuto. Devolve até quando. */
  interrompida(erro: ExecucaoInterrompida): Date {
    const ate =
      erro instanceof LimiteDoProvedor
        ? erro.ate
        : new Date(this.relogio() + ESPERA_POR_ORCAMENTO_MS);
    this.espera = { ate: ate.getTime(), motivo: erro.message };
    return ate;
  }

  /** Falha que não é cota: espera, e a próxima espera é o dobro. */
  falhou(motivo: string): void {
    const espera = this.proximaPorFalha;
    this.proximaPorFalha = Math.min(espera * 2, ESPERA_MAXIMA_POR_FALHA_MS);
    this.espera = { ate: this.relogio() + espera, motivo };
  }

  /** Deu certo: a próxima falha volta a esperar pouco. */
  funcionou(): void {
    this.proximaPorFalha = ESPERA_INICIAL_POR_FALHA_MS;
  }
}
