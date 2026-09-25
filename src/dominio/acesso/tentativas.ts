/**
 * Limite de tentativas de entrar (ADR 0011).
 *
 * Senha errada demais, do mesmo e-mail ou do mesmo endereço de rede, bloqueia por um
 * tempo. Sem isso, a tela de entrar num endereço público é um alvo para testar senha
 * atrás de senha — e o custo do `scrypt` protege o banco roubado, não a tela.
 *
 * ## Em memória, de propósito
 *
 * O sistema roda num processo só por servidor (ADR 0010), e a contagem mora nele. O
 * preço é que reiniciar zera a contagem — o que acontece a cada publicação, e é aceitável
 * para o tamanho de hoje. Com mais de um processo atendendo, a contagem vai para o banco.
 */

/** Falhas permitidas na janela antes do bloqueio. */
export const FALHAS_PERMITIDAS = 5;
/** A janela em que as falhas contam, e quanto dura o bloqueio. */
export const JANELA_MS = 15 * 60 * 1000;
/** Chaves guardadas, no máximo: um robô trocando de e-mail não pode encher a memória. */
const CHAVES_NO_MAXIMO = 10_000;

export class LimiteDeTentativas {
  private readonly falhas = new Map<string, number[]>();

  constructor(
    private readonly permitidas: number = FALHAS_PERMITIDAS,
    private readonly janelaMs: number = JANELA_MS,
  ) {}

  private recentes(chave: string, agora: Date): number[] {
    const limite = agora.getTime() - this.janelaMs;
    const lista = (this.falhas.get(chave) ?? []).filter((t) => t > limite);
    if (lista.length === 0) this.falhas.delete(chave);
    else this.falhas.set(chave, lista);
    return lista;
  }

  /**
   * Até quando as chaves estão bloqueadas. `null` é livre.
   *
   * Recebe várias chaves — o e-mail e o endereço de rede — e basta uma bloqueada: trocar
   * de e-mail não libera o endereço, e trocar de endereço não libera o e-mail.
   */
  bloqueadoAte(chaves: readonly string[], agora: Date): Date | null {
    let ate: number | null = null;
    for (const chave of chaves) {
      const lista = this.recentes(chave, agora);
      if (lista.length >= this.permitidas) {
        const libera = (lista[lista.length - this.permitidas] ?? 0) + this.janelaMs;
        ate = ate === null ? libera : Math.max(ate, libera);
      }
    }
    return ate === null ? null : new Date(ate);
  }

  registrarFalha(chaves: readonly string[], agora: Date): void {
    if (this.falhas.size >= CHAVES_NO_MAXIMO) this.falhas.clear();
    for (const chave of chaves) {
      const lista = this.recentes(chave, agora);
      lista.push(agora.getTime());
      this.falhas.set(chave, lista);
    }
  }

  /** Entrou: a contagem do e-mail zera. A do endereço, não — um acerto não apaga o resto. */
  limpar(chave: string): void {
    this.falhas.delete(chave);
  }
}
