/**
 * O assento onde o LLM senta, com orçamento, cache e registro de custo.
 *
 * Seis módulos usam LLM (M1, M3, M4, M6, M12, M15) e **nenhum deles fala com um
 * provedor direto**. Todos passam por aqui, e a razão é a disciplina de custo do
 * ADR 0005, que não é um detalhe de implementação — é parte da decisão:
 *
 * 1. Toda chamada registra entrada, saída, custo, modelo e latência em `llm_call`.
 *    Sem isso não se sabe onde o dinheiro foi, e o teto de R$ 100/mês deixa de ser
 *    verificável.
 * 2. Todo resultado é cacheado pela entrada que o gerou. Resolver a identidade de
 *    um produto é caro e se faz **uma vez**.
 * 3. Toda saída é validada por Zod. Schema que falha vira `pendente_revisao`,
 *    nunca descarte e nunca gravação de lixo.
 * 4. **Agente sem teto de orçamento por execução não roda**, e isso é verificado
 *    no construtor, não por convenção.
 *
 * A outra metade do desenho é que **não haver chave é estado normal**, não erro de
 * configuração: hoje não há chave, e o sistema inteiro precisa continuar rodando —
 * o que não pode é fingir que rodou. `ChamadorAusente` é a implementação honesta
 * disso, e quem chama trata `sem_chave` como caminho previsto.
 */
import { createHash } from 'node:crypto';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { llmCall } from '@/infra/banco/schema';

/**
 * Para que a chamada serve.
 *
 * É a primeira coluna do índice de cache e a chave do relatório de custo por
 * finalidade — que é como se responde "por que a conta subiu" com um `SELECT`.
 */
export const PROPOSITOS = [
  'extracao',
  'julgamento_identidade',
  'embedding',
  'compatibilidade',
  'fiscal',
  'prospeccao',
  'leitura_serie',
] as const;
export type Proposito = (typeof PROPOSITOS)[number];

export interface PedidoAoModelo {
  readonly proposito: Proposito;
  readonly modelo: string;
  /** Tudo que determina a resposta. É o que vai para o hash e para o `jsonb`. */
  readonly entrada: unknown;
}

export interface RespostaDoModelo {
  readonly saida: unknown;
  readonly tokensEntrada?: number | undefined;
  readonly tokensSaida?: number | undefined;
  /** Centavos inteiros. `undefined` quando o provedor não informa. */
  readonly custoCentavos?: number | undefined;
}

/**
 * A porta para um provedor.
 *
 * Deliberadamente pequena: um método. Trocar de provedor, ou pôr um dublê em
 * teste, é implementar isto — e é assim que a suíte exercita cache, orçamento e
 * validação sem gastar um centavo nem depender de rede.
 */
export interface Chamador {
  readonly nome: string;
  chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
}

export class SemChaveDeLlm extends Error {
  override readonly name = 'SemChaveDeLlm';
  constructor() {
    super(
      'não há chave de LLM configurada (LLM_API_KEY). O caminho determinístico continua funcionando; ' +
        'o que depende de julgamento fica pendente até haver chave.',
    );
  }
}

/** O chamador que existe quando não há chave. Falha explicitamente, não em silêncio. */
export class ChamadorAusente implements Chamador {
  readonly nome = 'ausente';
  chamar(): Promise<RespostaDoModelo> {
    return Promise.reject(new SemChaveDeLlm());
  }
}

export class OrcamentoInvalido extends Error {
  override readonly name = 'OrcamentoInvalido';
}

export class OrcamentoEstourado extends Error {
  override readonly name = 'OrcamentoEstourado';
  constructor(
    readonly limite: { readonly centavos: number; readonly chamadas: number },
    readonly gasto: { readonly centavos: number; readonly chamadas: number },
  ) {
    super(
      `orçamento estourado: ${String(gasto.chamadas)}/${String(limite.chamadas)} chamadas, ` +
        `${String(gasto.centavos)}/${String(limite.centavos)} centavos`,
    );
  }
}

/**
 * Teto de gasto de uma execução.
 *
 * **Dois tetos, e os dois são obrigatórios.** Centavos é o teto que interessa ao
 * bolso, e chamadas é o que continua valendo quando o provedor não informa custo —
 * sem ele, um provedor calado transformaria o teto em nada e um laço com defeito
 * rodaria até a conta chegar.
 */
export class Orcamento {
  private centavosGastos = 0;
  private chamadasFeitas = 0;

  constructor(
    readonly limiteCentavos: number,
    readonly limiteChamadas: number,
  ) {
    if (!Number.isInteger(limiteCentavos) || limiteCentavos <= 0) {
      throw new OrcamentoInvalido(
        `teto em centavos precisa ser inteiro positivo, recebeu ${String(limiteCentavos)}`,
      );
    }
    if (!Number.isInteger(limiteChamadas) || limiteChamadas <= 0) {
      throw new OrcamentoInvalido(
        `teto de chamadas precisa ser inteiro positivo, recebeu ${String(limiteChamadas)}`,
      );
    }
  }

  get gasto(): { readonly centavos: number; readonly chamadas: number } {
    return { centavos: this.centavosGastos, chamadas: this.chamadasFeitas };
  }

  get esgotado(): boolean {
    return this.chamadasFeitas >= this.limiteChamadas || this.centavosGastos >= this.limiteCentavos;
  }

  /** Lança antes de gastar, que é o único momento em que o teto serve para algo. */
  exigirFolga(): void {
    if (this.esgotado) {
      throw new OrcamentoEstourado(
        { centavos: this.limiteCentavos, chamadas: this.limiteChamadas },
        this.gasto,
      );
    }
  }

  /** Registra o consumo. Chamada sem custo informado ainda consome uma chamada. */
  registrar(custoCentavos: number | undefined): void {
    this.chamadasFeitas += 1;
    this.centavosGastos += custoCentavos ?? 0;
  }
}

/**
 * Serialização estável de qualquer entrada, para o hash de cache.
 *
 * Chave de objeto é ordenada, porque a ordem de escrita de um literal não deveria
 * mudar o hash — e mudaria, silenciosamente, transformando o cache em decoração.
 * `undefined` some (não existe em JSON), `Date` vira ISO, e `NaN`/`Infinity` viram
 * `null` como o `JSON.stringify` faria.
 */
export function serializarEstavel(valor: unknown): string {
  if (valor === null) return 'null';
  if (valor === undefined) return 'null';
  if (typeof valor === 'number') return Number.isFinite(valor) ? JSON.stringify(valor) : 'null';
  if (typeof valor === 'boolean' || typeof valor === 'string') return JSON.stringify(valor);
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (Array.isArray(valor)) return `[${valor.map(serializarEstavel).join(',')}]`;
  if (typeof valor === 'object') {
    const registro = valor as Record<string, unknown>;
    const chaves = Object.keys(registro)
      .filter((k) => registro[k] !== undefined)
      .sort();
    const partes = chaves.map((k) => `${JSON.stringify(k)}:${serializarEstavel(registro[k])}`);
    return `{${partes.join(',')}}`;
  }
  // Função ou símbolo em entrada de LLM é erro de quem chamou, não dado.
  return 'null';
}

export function hashDeEntrada(entrada: unknown): string {
  return createHash('sha256').update(serializarEstavel(entrada), 'utf8').digest('hex');
}

export type ResultadoDoPedido<T> =
  | { readonly tipo: 'ok'; readonly valor: T; readonly deCache: boolean }
  | {
      readonly tipo: 'pendente_revisao';
      readonly problemas: readonly string[];
      readonly saidaBruta: unknown;
      readonly deCache: boolean;
    }
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'erro'; readonly mensagem: string };

export interface ParametrosDoPedido<T> {
  readonly proposito: Proposito;
  readonly modelo: string;
  readonly entrada: unknown;
  readonly esquema: z.ZodType<T>;
  readonly jobId?: string | undefined;
}

/**
 * O serviço que todo módulo de IA usa.
 *
 * **Só lança `OrcamentoEstourado`.** Todo o resto — falha de rede, schema
 * inválido, ausência de chave — volta como valor no tipo de retorno, porque são
 * situações previstas que o chamador trata de formas diferentes. Orçamento é a
 * exceção porque é a única em que continuar é sempre errado: um laço que trata
 * "estourei o teto" como "esse par falhou" segue para o par seguinte e estoura de
 * novo, uma vez por par.
 */
export class ServicoDeLlm {
  constructor(
    private readonly db: Banco,
    private readonly chamador: Chamador,
    private readonly orcamento: Orcamento,
  ) {}

  get gasto(): { readonly centavos: number; readonly chamadas: number } {
    return this.orcamento.gasto;
  }

  async pedir<T>(params: ParametrosDoPedido<T>): Promise<ResultadoDoPedido<T>> {
    const hashEntrada = hashDeEntrada(params.entrada);

    const cacheado = await this.lerCache(params.proposito, params.modelo, hashEntrada);
    if (cacheado !== null) {
      return this.validar(cacheado, params.esquema, true);
    }

    // O teto é verificado **depois** do cache e **antes** da chamada: resposta que
    // já foi paga não deve ser recusada por falta de orçamento.
    this.orcamento.exigirFolga();

    const comecou = Date.now();
    let resposta: RespostaDoModelo;
    try {
      resposta = await this.chamador.chamar({
        proposito: params.proposito,
        modelo: params.modelo,
        entrada: params.entrada,
      });
    } catch (erro) {
      const semChave = erro instanceof SemChaveDeLlm;
      // Ausência de chave não é falha da chamada e não consome orçamento: nada foi
      // enviado. Também não vai para `llm_call`, senão o registro de custo ficaria
      // cheio de linhas de uma chamada que não aconteceu.
      if (semChave) return { tipo: 'sem_chave' };

      const mensagem = erro instanceof Error ? erro.message : String(erro);
      this.orcamento.registrar(undefined);
      await this.registrarChamada({
        proposito: params.proposito,
        modelo: params.modelo,
        hashEntrada,
        entrada: params.entrada,
        saida: null,
        erro: mensagem,
        latenciaMs: Date.now() - comecou,
        jobId: params.jobId,
      });
      return { tipo: 'erro', mensagem };
    }

    this.orcamento.registrar(resposta.custoCentavos);

    await this.registrarChamada({
      proposito: params.proposito,
      modelo: params.modelo,
      hashEntrada,
      entrada: params.entrada,
      saida: resposta.saida,
      erro: null,
      latenciaMs: Date.now() - comecou,
      jobId: params.jobId,
      tokensEntrada: resposta.tokensEntrada,
      tokensSaida: resposta.tokensSaida,
      custoCentavos: resposta.custoCentavos,
    });

    return this.validar(resposta.saida, params.esquema, false);
  }

  private validar<T>(
    saidaBruta: unknown,
    esquema: z.ZodType<T>,
    deCache: boolean,
  ): ResultadoDoPedido<T> {
    const analise = esquema.safeParse(saidaBruta);
    if (!analise.success) {
      return {
        tipo: 'pendente_revisao',
        problemas: analise.error.issues.map((i) => {
          const campo = i.path.join('.');
          return campo === '' ? i.message : `${campo}: ${i.message}`;
        }),
        saidaBruta,
        deCache,
      };
    }
    return { tipo: 'ok', valor: analise.data, deCache };
  }

  /**
   * Lê o cache.
   *
   * A cláusula que importa é `saida is not null and erro is null`. Sem ela, uma
   * chamada que falhou uma vez ficaria em cache como falha **para sempre** — a
   * chave única é `(proposito, modelo, hash_entrada)`, então a linha de erro ocupa
   * exatamente o lugar da resposta boa. Foi o que o teste pegou.
   */
  private async lerCache(
    proposito: Proposito,
    modelo: string,
    hashEntrada: string,
  ): Promise<unknown> {
    const linhas = await this.db
      .select({ saida: llmCall.saida })
      .from(llmCall)
      .where(
        and(
          eq(llmCall.proposito, proposito),
          eq(llmCall.modelo, modelo),
          eq(llmCall.hashEntrada, hashEntrada),
          isNotNull(llmCall.saida),
          isNull(llmCall.erro),
        ),
      )
      .limit(1);

    const linha = linhas[0];
    return linha === undefined ? null : linha.saida;
  }

  /**
   * Grava a chamada.
   *
   * `onConflictDoUpdate` e não `insert` simples: a chave única é a chave de cache,
   * então a segunda tentativa de uma chamada que falhou colide com o próprio
   * registro de falha. Atualizar é o comportamento certo — a linha passa a ser a
   * resposta boa, e o erro anterior deixa de bloquear.
   */
  private async registrarChamada(dados: {
    proposito: Proposito;
    modelo: string;
    hashEntrada: string;
    entrada: unknown;
    saida: unknown;
    erro: string | null;
    latenciaMs: number;
    jobId?: string | undefined;
    tokensEntrada?: number | undefined;
    tokensSaida?: number | undefined;
    custoCentavos?: number | undefined;
  }): Promise<void> {
    const valores = {
      proposito: dados.proposito,
      modelo: dados.modelo,
      hashEntrada: dados.hashEntrada,
      entrada: dados.entrada,
      saida: dados.saida,
      erro: dados.erro,
      latenciaMs: dados.latenciaMs,
      jobId: dados.jobId ?? null,
      tokensEntrada: dados.tokensEntrada ?? null,
      tokensSaida: dados.tokensSaida ?? null,
      custoCentavos: dados.custoCentavos ?? null,
    };

    await this.db
      .insert(llmCall)
      .values(valores)
      .onConflictDoUpdate({
        target: [llmCall.proposito, llmCall.modelo, llmCall.hashEntrada],
        set: {
          saida: valores.saida,
          erro: valores.erro,
          latenciaMs: valores.latenciaMs,
          tokensEntrada: valores.tokensEntrada,
          tokensSaida: valores.tokensSaida,
          custoCentavos: valores.custoCentavos,
          criadoEm: new Date(),
        },
      });
  }
}

/** Gasto por finalidade em um período. É o relatório que o ADR 0005 promete. */
export async function gastoPorProposito(
  db: Banco,
  desde: Date,
): Promise<
  readonly { readonly proposito: string; readonly chamadas: number; readonly centavos: number }[]
> {
  const linhas = await db
    .select({
      proposito: llmCall.proposito,
      chamadas: sql<number>`count(*)::int`,
      centavos: sql<number>`coalesce(sum(${llmCall.custoCentavos}), 0)::int`,
    })
    .from(llmCall)
    // `gte` da coluna e não `sql` cru: o template cru manda a `Date` ao driver sem
    // o tipo da coluna, e o `postgres` recusa com "must be of type string".
    .where(gte(llmCall.criadoEm, desde))
    .groupBy(llmCall.proposito)
    .orderBy(llmCall.proposito);

  return linhas;
}
