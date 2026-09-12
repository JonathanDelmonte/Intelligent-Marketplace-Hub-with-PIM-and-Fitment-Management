/**
 * Fila local de leituras, para o leitor funcionar sem rede.
 *
 * A especificação é direta: "funciona offline com fila de sincronização — loja tem
 * sinal ruim". Isso quer dizer que **a leitura é gravada antes de qualquer
 * tentativa de rede**, e que a rede é um detalhe que acontece depois, quando e se
 * puder.
 *
 * ## O armazenamento é injetável, e isso não é cerimônia
 *
 * IndexedDB não existe em Node, então uma fila amarrada a ele é uma fila sem
 * teste. E o que pode dar errado aqui é lógica, não armazenamento: ordem de
 * descarga, o que fazer com o que o servidor recusou, não perder leitura quando a
 * descarga falha no meio. Com a interface separada, essas regras têm teste; a
 * implementação de IndexedDB fica sendo três funções óbvias.
 *
 * ## O que nunca pode acontecer
 *
 * **Perder leitura.** A pessoa escaneou quarenta itens no balcão de um parceiro;
 * essa é a informação que transforma a conversa de consignação em proposta no
 * mesmo dia. Por isso a leitura só sai da fila depois de o servidor confirmar, e
 * falha de descarga deixa tudo onde estava.
 */

export interface LeituraLocal {
  /** Gerado no dispositivo, antes de existir rede. É a chave de idempotência. */
  readonly idLocal: string;
  readonly gtin: string;
  readonly custoUnitario: number | null;
  readonly unidadesNoLote: number | null;
  readonly veredito: string;
  readonly precoDeReferencia: number | null;
  readonly margemBp: number | null;
  readonly confiancaBp: number | null;
  readonly motivos: readonly { codigo: string; severidade: string; mensagem: string }[] | null;
  readonly decisao: string | null;
  readonly local: string | null;
  /** ISO, porque atravessa serialização. */
  readonly lidoEm: string;
  /** Quantas vezes já tentamos mandar. Para não insistir para sempre em silêncio. */
  readonly tentativas: number;
}

/** O mínimo que a fila precisa de um armazenamento. */
export interface ArmazenamentoDeFila {
  todas(): Promise<readonly LeituraLocal[]>;
  gravar(leitura: LeituraLocal): Promise<void>;
  remover(idsLocais: readonly string[]): Promise<void>;
}

export interface ResultadoDaDescarga {
  readonly enviadas: number;
  readonly confirmadas: number;
  readonly recusadas: number;
  /** `true` quando não havia rede ou o envio falhou por inteiro. */
  readonly falhou: boolean;
  readonly motivo?: string;
}

/** O que o servidor devolve para uma descarga. */
export interface RespostaDaSincronizacao {
  readonly gravadas: number;
  readonly atualizadas: number;
  readonly recusadas: readonly { readonly idLocal: string; readonly motivo: string }[];
}

export type EnviarLeituras = (
  leituras: readonly LeituraLocal[],
) => Promise<RespostaDaSincronizacao>;

/** Depois disto, a leitura para de ser reenviada automaticamente. */
export const MAX_TENTATIVAS = 5;

/** Quantas leituras por descarga. Fila maior vai em mais de uma ida. */
export const TAMANHO_DA_DESCARGA = 50;

export class FilaDeLeituras {
  constructor(
    private readonly armazenamento: ArmazenamentoDeFila,
    private readonly enviar: EnviarLeituras,
  ) {}

  /** Grava a leitura localmente. Não toca em rede. */
  async enfileirar(leitura: Omit<LeituraLocal, 'tentativas'>): Promise<void> {
    await this.armazenamento.gravar({ ...leitura, tentativas: 0 });
  }

  async pendentes(): Promise<readonly LeituraLocal[]> {
    const todas = await this.armazenamento.todas();
    // Mais antiga primeiro: a ordem em que aconteceram é a ordem em que importam.
    return [...todas].sort((a, b) => a.lidoEm.localeCompare(b.lidoEm));
  }

  async quantidadePendente(): Promise<number> {
    return (await this.armazenamento.todas()).length;
  }

  /**
   * Tenta mandar o que está na fila.
   *
   * Só remove o que o servidor confirmou. Falha de rede **não** mexe na fila além
   * de contar a tentativa: o dispositivo não sabe se o servidor recebeu, e apagar
   * na dúvida é perder leitura. Duplicar não é problema — a sincronização do
   * servidor é idempotente por `idLocal`, e foi projetada para exatamente isto.
   */
  async descarregar(): Promise<ResultadoDaDescarga> {
    const fila = (await this.pendentes()).filter((l) => l.tentativas < MAX_TENTATIVAS);
    if (fila.length === 0) {
      return { enviadas: 0, confirmadas: 0, recusadas: 0, falhou: false };
    }

    const lote = fila.slice(0, TAMANHO_DA_DESCARGA);

    let resposta: RespostaDaSincronizacao;
    try {
      resposta = await this.enviar(lote);
    } catch (erro) {
      // Conta a tentativa para a tela poder dizer "tentei 3 vezes" em vez de
      // ficar girando para sempre sem explicação.
      for (const l of lote) {
        await this.armazenamento.gravar({ ...l, tentativas: l.tentativas + 1 });
      }
      return {
        enviadas: lote.length,
        confirmadas: 0,
        recusadas: 0,
        falhou: true,
        motivo: erro instanceof Error ? erro.message : 'falha ao sincronizar',
      };
    }

    const recusados = new Set(resposta.recusadas.map((r) => r.idLocal));
    const confirmados = lote.filter((l) => !recusados.has(l.idLocal)).map((l) => l.idLocal);

    if (confirmados.length > 0) await this.armazenamento.remover(confirmados);

    // O que o servidor recusou fica, com a tentativa contada. Recusa é defeito de
    // forma, não falha de rede: insistir não resolve, mas apagar esconde.
    for (const l of lote) {
      if (!recusados.has(l.idLocal)) continue;
      await this.armazenamento.gravar({ ...l, tentativas: l.tentativas + 1 });
    }

    return {
      enviadas: lote.length,
      confirmadas: confirmados.length,
      recusadas: recusados.size,
      falhou: false,
    };
  }

  /** Leituras que desistimos de mandar sozinhos. A tela mostra e oferece ação. */
  async travadas(): Promise<readonly LeituraLocal[]> {
    return (await this.pendentes()).filter((l) => l.tentativas >= MAX_TENTATIVAS);
  }

  /** Zera as tentativas de tudo, para uma nova tentativa pedida à mão. */
  async destravar(): Promise<number> {
    const travadas = await this.travadas();
    for (const l of travadas) await this.armazenamento.gravar({ ...l, tentativas: 0 });
    return travadas.length;
  }
}

// ─── Armazenamento em memória ────────────────────────────────────────────────

/** Para teste, e para navegador sem IndexedDB. Perde no recarregamento. */
export class ArmazenamentoEmMemoria implements ArmazenamentoDeFila {
  private readonly mapa = new Map<string, LeituraLocal>();

  todas(): Promise<readonly LeituraLocal[]> {
    return Promise.resolve([...this.mapa.values()]);
  }

  gravar(leitura: LeituraLocal): Promise<void> {
    this.mapa.set(leitura.idLocal, leitura);
    return Promise.resolve();
  }

  remover(idsLocais: readonly string[]): Promise<void> {
    for (const id of idsLocais) this.mapa.delete(id);
    return Promise.resolve();
  }
}

// ─── Armazenamento em IndexedDB ──────────────────────────────────────────────

export const BANCO_LOCAL = 'bancada-leitor';
export const DEPOSITO = 'leituras';

/**
 * IndexedDB, e não `localStorage`.
 *
 * `localStorage` é síncrono e trava a interface, tem teto de 5 MB por origem, e
 * guarda texto — o que obriga a serializar a fila inteira a cada gravação. Numa
 * sessão de quarenta leituras isso é quarenta reserializações da lista completa.
 */
export class ArmazenamentoIndexedDb implements ArmazenamentoDeFila {
  private banco: IDBDatabase | null = null;

  private abrir(): Promise<IDBDatabase> {
    if (this.banco !== null) return Promise.resolve(this.banco);

    return new Promise((resolve, reject) => {
      const pedido = indexedDB.open(BANCO_LOCAL, 1);

      pedido.onupgradeneeded = () => {
        const banco = pedido.result;
        if (!banco.objectStoreNames.contains(DEPOSITO)) {
          banco.createObjectStore(DEPOSITO, { keyPath: 'idLocal' });
        }
      };
      pedido.onsuccess = () => {
        this.banco = pedido.result;
        resolve(pedido.result);
      };
      pedido.onerror = () => {
        reject(pedido.error ?? new Error('falha ao abrir o banco local'));
      };
    });
  }

  async todas(): Promise<readonly LeituraLocal[]> {
    const banco = await this.abrir();
    return new Promise((resolve, reject) => {
      const pedido = banco.transaction(DEPOSITO, 'readonly').objectStore(DEPOSITO).getAll();
      pedido.onsuccess = () => resolve(pedido.result as LeituraLocal[]);
      pedido.onerror = () => {
        reject(pedido.error ?? new Error('falha ao ler a fila local'));
      };
    });
  }

  async gravar(leitura: LeituraLocal): Promise<void> {
    const banco = await this.abrir();
    return new Promise((resolve, reject) => {
      const transacao = banco.transaction(DEPOSITO, 'readwrite');
      transacao.objectStore(DEPOSITO).put(leitura);
      transacao.oncomplete = () => resolve();
      transacao.onerror = () => {
        reject(transacao.error ?? new Error('falha ao gravar na fila local'));
      };
    });
  }

  async remover(idsLocais: readonly string[]): Promise<void> {
    if (idsLocais.length === 0) return;
    const banco = await this.abrir();
    return new Promise((resolve, reject) => {
      const transacao = banco.transaction(DEPOSITO, 'readwrite');
      const deposito = transacao.objectStore(DEPOSITO);
      for (const id of idsLocais) deposito.delete(id);
      transacao.oncomplete = () => resolve();
      transacao.onerror = () => {
        reject(transacao.error ?? new Error('falha ao limpar a fila local'));
      };
    });
  }
}

/**
 * Escolhe o armazenamento disponível.
 *
 * Navegador em modo privado pode recusar IndexedDB. Cair para memória é pior que
 * persistir e melhor que não funcionar — e a tela avisa, porque perder a fila no
 * recarregamento é consequência que a pessoa precisa saber que existe.
 */
export function escolherArmazenamento(): {
  readonly armazenamento: ArmazenamentoDeFila;
  readonly persistente: boolean;
} {
  try {
    if (typeof indexedDB !== 'undefined') {
      return { armazenamento: new ArmazenamentoIndexedDb(), persistente: true };
    }
  } catch {
    // Acesso a `indexedDB` pode lançar em contexto restrito.
  }
  return { armazenamento: new ArmazenamentoEmMemoria(), persistente: false };
}
