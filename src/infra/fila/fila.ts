/**
 * Fila de trabalho sobre a tabela `job` (M1, etapa 3.8).
 *
 * O princípio de robustez do ADR 0006: **todo job é idempotente e retomável.**
 * Extração que falha não perde o que já extraiu, e reexecutar é seguro.
 *
 * Três decisões que sustentam isso:
 *
 * 1. **Chave de idempotência.** Dois enfileiramentos da mesma unidade de trabalho
 *    colapsam num job só. Colar o mesmo link duas vezes não paga extração duas
 *    vezes — e como extração usa LLM, isso é dinheiro.
 * 2. **Progresso parcial.** `salvarProgresso` grava o que já foi feito. Uma
 *    listagem que quebrou na página 7 de 20 retoma da 7, não da 1.
 * 3. **`pendente_revisao` é status, não erro.** Schema de saída que falha manda o
 *    registro para revisão. Descartar é o erro que a especificação proíbe.
 *
 * A reivindicação usa `FOR UPDATE SKIP LOCKED`, então dois processos podem rodar
 * a fila sem pegar o mesmo job — e sem precisar de Redis.
 */
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '../banco/cliente';
import { job } from '../banco/schema';

export const STATUS_JOB = [
  'pendente',
  'rodando',
  'concluido',
  'falhou',
  'pendente_revisao',
] as const;
export type StatusJob = (typeof STATUS_JOB)[number];

export interface JobEnfileirado {
  readonly id: string;
  readonly tipo: string;
  readonly status: StatusJob;
  readonly entrada: unknown;
  readonly progresso: unknown;
  readonly tentativas: number;
  readonly maxTentativas: number;
  readonly chaveIdempotencia: string;
  readonly erro: string | null;
}

/**
 * Job com tudo o que a tela de observabilidade precisa.
 *
 * Separado de `JobEnfileirado` de propósito. O executor só precisa do que usa
 * para trabalhar, e `reivindicar` usa SQL cru por causa do `SKIP LOCKED` — cada
 * coluna acrescentada ali entra em `returning` e em `paraJob`. A tela, que lê por
 * caminho normal do Drizzle, pode pedir tudo sem custo nenhum no caminho quente.
 */
export interface JobDetalhado extends JobEnfileirado {
  readonly resultado: unknown;
  readonly criadoEm: Date;
  readonly agendadoPara: Date;
  readonly iniciadoEm: Date | null;
  readonly terminadoEm: Date | null;
}

export class FilaError extends Error {
  override readonly name = 'FilaError';
}

/** O que a fila diz sobre os jobs que têm um mesmo valor num campo da entrada. */
export interface UsoNaFila {
  /** Algum deles ainda vai rodar: pendente, mesmo que agendado para depois, ou rodando. */
  readonly ativo: boolean;
  /** O último movimento de qualquer um deles. */
  readonly ultimoMovimento: Date;
}

/**
 * Backoff exponencial entre tentativas.
 *
 * Extração que falha por bloqueio de IP ou limite de requisição precisa esperar,
 * e esperar mais a cada tentativa. Reexecutar em seguida é a forma mais rápida de
 * levar bloqueio permanente — e cache agressivo e backoff são também defesa
 * (seção 10, item 7).
 */
export function atrasoDaTentativa(tentativa: number): number {
  const base = 30_000;
  const teto = 30 * 60_000;
  return Math.min(base * 2 ** Math.max(0, tentativa - 1), teto);
}

export class Fila {
  constructor(private readonly db: Banco) {}

  /**
   * Enfileira, ou devolve o job que já existe para a mesma chave.
   *
   * `ON CONFLICT DO NOTHING` mais um `SELECT` de fallback: a corrida entre dois
   * enfileiramentos simultâneos resolve no banco, não em `if` na aplicação.
   */
  async enfileirar(params: {
    readonly tipo: string;
    readonly chaveIdempotencia: string;
    readonly entrada: unknown;
    readonly maxTentativas?: number;
    readonly agendadoPara?: Date;
  }): Promise<{ readonly job: JobEnfileirado; readonly jaExistia: boolean }> {
    if (params.tipo.trim() === '' || params.chaveIdempotencia.trim() === '') {
      throw new FilaError('tipo e chave de idempotência não podem ser vazios');
    }

    const valores = {
      tipo: params.tipo,
      chaveIdempotencia: params.chaveIdempotencia,
      entrada: params.entrada,
      ...(params.maxTentativas === undefined ? {} : { maxTentativas: params.maxTentativas }),
      ...(params.agendadoPara === undefined ? {} : { agendadoPara: params.agendadoPara }),
    };

    const inseridos = await this.db.insert(job).values(valores).onConflictDoNothing().returning();

    const criado = inseridos[0];
    if (criado !== undefined) {
      return { job: paraJob(criado), jaExistia: false };
    }

    const existente = await this.buscarPorChave(params.tipo, params.chaveIdempotencia);
    if (existente === null) {
      throw new FilaError(
        `conflito ao enfileirar ${params.tipo}/${params.chaveIdempotencia}, mas o job não foi encontrado`,
      );
    }
    return { job: existente, jaExistia: true };
  }

  async buscarPorChave(tipo: string, chaveIdempotencia: string): Promise<JobEnfileirado | null> {
    const linhas = await this.db
      .select()
      .from(job)
      .where(and(eq(job.tipo, tipo), eq(job.chaveIdempotencia, chaveIdempotencia)))
      .limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraJob(linha);
  }

  async buscarPorId(id: string): Promise<JobEnfileirado | null> {
    const linhas = await this.db.select().from(job).where(eq(job.id, id)).limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraJob(linha);
  }

  /**
   * Reivindica o próximo job pronto para rodar.
   *
   * `SKIP LOCKED` é o que permite mais de um processo consumindo a fila sem que
   * dois peguem o mesmo job. Sem isso seria preciso um lock de aplicação, que é
   * onde nasce job rodando em duplicidade.
   *
   * Reivindica também job `rodando` cujo prazo estourou: se o processo morreu no
   * meio, o job voltaria a ficar preso para sempre.
   *
   * ## O "agora" é o do banco, não o da aplicação
   *
   * `agendado_para` é escrito pelo relógio do **banco** (`now()`), com precisão de
   * microssegundo. `new Date()` do JavaScript trunca em **milissegundo**. Comparar
   * os dois deixa um job invisível quando ele é enfileirado e reivindicado dentro
   * do mesmo milissegundo: gravado em `.764154`, o relógio da aplicação diz
   * `.764000`, e `agendado_para <= agora` é falso.
   *
   * O defeito se cura sozinho no tique seguinte de um poller, então em produção
   * seria invisível — e em qualquer fluxo que enfileira e processa em sequência
   * (endpoint síncrono, comando de linha, teste) seria intermitente e difícil de
   * diagnosticar. Ver o diário de bordo.
   *
   * `agora` explícito continua aceito, para teste que precisa de tempo
   * determinístico.
   */
  async reivindicar(
    params: {
      readonly tipos?: readonly string[];
      /** Tempo de referência. Quando ausente, usa o relógio do banco. */
      readonly agora?: Date;
      /** Tempo após o qual um job `rodando` é considerado abandonado. */
      readonly prazoDeExecucaoMs?: number;
    } = {},
  ): Promise<JobEnfileirado | null> {
    const prazoMs = params.prazoDeExecucaoMs ?? 15 * 60_000;

    // `= any(array)` em vez de `in (...)`: funciona para qualquer quantidade de
    // tipos com um único parâmetro, enquanto `in ${array}` só acerta com um.
    const filtroDeTipo =
      params.tipos === undefined || params.tipos.length === 0
        ? sql`true`
        : sql`${job.tipo} = any(${sql.param([...params.tipos])})`;

    // Timestamp explícito vai como texto ISO com cast: o driver não serializa
    // `Date` dentro de template de SQL cru, e o erro só apareceria em runtime.
    const agoraSql =
      params.agora === undefined ? sql`now()` : sql`${params.agora.toISOString()}::timestamptz`;

    const prazoSql =
      params.agora === undefined
        ? sql`now() - make_interval(secs => ${prazoMs / 1000})`
        : sql`${new Date(params.agora.getTime() - prazoMs).toISOString()}::timestamptz`;

    const reivindicados = await this.db.execute(sql`
      with proximo as (
        select ${job.id} as id
        from ${job}
        where ${filtroDeTipo}
          and (
            (${job.status} = 'pendente' and ${job.agendadoPara} <= ${agoraSql})
            or (${job.status} = 'rodando' and ${job.iniciadoEm} <= ${prazoSql})
          )
        order by ${job.agendadoPara} asc
        limit 1
        for update skip locked
      )
      update ${job}
      set status = 'rodando',
          iniciado_em = ${agoraSql},
          tentativas = ${job.tentativas} + 1,
          atualizado_em = ${agoraSql}
      where ${job.id} in (select id from proximo)
      returning ${job.id}, ${job.tipo}, ${job.status}, ${job.entrada}, ${job.progresso},
                ${job.tentativas}, ${job.maxTentativas}, ${job.chaveIdempotencia}, ${job.erro}
    `);

    const linha = (reivindicados as unknown as { rows?: unknown[] }).rows?.[0] ?? reivindicados[0];
    return linha === undefined ? null : paraJob(linha as LinhaDeJob);
  }

  /**
   * Salva progresso parcial sem mudar o status.
   *
   * É o que torna o job retomável. Extração de listagem que caiu na página 7 de
   * 20 grava `{ paginaAtual: 7 }` e retoma de lá.
   */
  async salvarProgresso(id: string, progresso: unknown): Promise<void> {
    await this.db.update(job).set({ progresso, atualizadoEm: new Date() }).where(eq(job.id, id));
  }

  async concluir(id: string, resultado: unknown): Promise<void> {
    const agora = new Date();
    await this.db
      .update(job)
      .set({ status: 'concluido', resultado, erro: null, terminadoEm: agora, atualizadoEm: agora })
      .where(eq(job.id, id));
  }

  /**
   * Marca falha, reagendando com backoff enquanto houver tentativa.
   *
   * Esgotadas as tentativas, o job fica `falhou` com o erro visível — não
   * desaparece. A tela dos últimos 100 jobs existe para isso.
   */
  async falhar(id: string, erro: string): Promise<{ readonly reagendado: boolean }> {
    const atual = await this.buscarPorId(id);
    if (atual === null) throw new FilaError(`job ${id} não existe`);

    const agora = new Date();
    const podeTentarDeNovo = atual.tentativas < atual.maxTentativas;

    if (podeTentarDeNovo) {
      await this.db
        .update(job)
        .set({
          status: 'pendente',
          erro,
          agendadoPara: new Date(agora.getTime() + atrasoDaTentativa(atual.tentativas)),
          atualizadoEm: agora,
        })
        .where(eq(job.id, id));
      return { reagendado: true };
    }

    await this.db
      .update(job)
      .set({ status: 'falhou', erro, terminadoEm: agora, atualizadoEm: agora })
      .where(eq(job.id, id));
    return { reagendado: false };
  }

  /**
   * Manda para revisão humana.
   *
   * Usado quando a saída não valida contra o schema, ou quando a classificação
   * veio com confiança baixa. **Não é falha e não consome tentativa**: é o
   * caminho que a especificação exige em vez de descartar o registro.
   */
  async mandarParaRevisao(
    id: string,
    motivo: string,
    opcoes: {
      /** O hash do arquivo que faltou: enviá-lo de novo devolve o job à fila. */
      readonly aguardandoConteudo?: string;
    } = {},
  ): Promise<void> {
    const agora = new Date();
    await this.db
      .update(job)
      .set({
        status: 'pendente_revisao',
        erro: motivo,
        terminadoEm: agora,
        atualizadoEm: agora,
        ...(opcoes.aguardandoConteudo === undefined
          ? {}
          : { aguardandoConteudo: opcoes.aguardandoConteudo }),
      })
      .where(eq(job.id, id));
  }

  /**
   * Devolve à fila os jobs que pararam esperando este arquivo, e devolve os ids.
   *
   * É a outra ponta da revisão com `aguardandoConteudo`: o arquivo saiu da nuvem, o job
   * parou dizendo para enviá-lo de novo, e enviá-lo basta — ninguém precisa achar o job e
   * apertar "tentar de novo" (ADR 0016).
   */
  async reenfileirarOsQueAguardam(hash: string): Promise<readonly string[]> {
    const agora = new Date();
    const devolvidos = await this.db
      .update(job)
      .set({
        status: 'pendente',
        tentativas: 0,
        erro: null,
        aguardandoConteudo: null,
        agendadoPara: agora,
        iniciadoEm: null,
        terminadoEm: null,
        atualizadoEm: agora,
      })
      .where(
        and(eq(job.aguardandoConteudo, hash), inArray(job.status, ['pendente_revisao', 'falhou'])),
      )
      .returning({ id: job.id });
    return devolvidos.map((d) => d.id);
  }

  /**
   * Para cada valor que `campo` tem na entrada dos jobs: se algum deles ainda vai rodar,
   * e o último movimento de todos.
   *
   * É a pergunta da limpeza do conteúdo antes de apagar um arquivo da nuvem (ADR 0016):
   * o de job que ainda vai rodar fica; o dos outros sai depois de uns dias parado.
   * Agrupa pela posição (`group by 1`) porque o campo vai como parâmetro, e o Postgres
   * não reconhece `entrada ->> $1` e `entrada ->> $2` como a mesma expressão.
   */
  async usoPorCampoDaEntrada(campo: string): Promise<ReadonlyMap<string, UsoNaFila>> {
    const valor = sql<string>`${job.entrada} ->> ${campo}`;
    const linhas = await this.db
      .select({
        valor,
        ativo: sql<boolean>`bool_or(${job.status} in ('pendente', 'rodando'))`,
        ultimoMovimento: sql<Date>`max(${job.atualizadoEm})`,
      })
      .from(job)
      .where(sql`${job.entrada} ->> ${campo} is not null`)
      .groupBy(sql`1`);

    return new Map(
      linhas.map((l) => [
        l.valor,
        { ativo: l.ativo, ultimoMovimento: new Date(l.ultimoMovimento) },
      ]),
    );
  }

  /** Os últimos N jobs, mais recentes primeiro. É a tela de observabilidade. */
  async ultimos(limite = 100): Promise<readonly JobDetalhado[]> {
    const linhas = await this.db.select().from(job).orderBy(desc(job.criadoEm)).limit(limite);
    return linhas.map(paraJobDetalhado);
  }

  /** Jobs esperando decisão humana. */
  async aguardandoRevisao(limite = 100): Promise<readonly JobDetalhado[]> {
    const linhas = await this.db
      .select()
      .from(job)
      .where(eq(job.status, 'pendente_revisao'))
      .orderBy(asc(job.criadoEm))
      .limit(limite);
    return linhas.map(paraJobDetalhado);
  }

  /** Um job com todos os campos, para a tela de detalhe e para a ação de retomar. */
  async buscarDetalhado(id: string): Promise<JobDetalhado | null> {
    const linhas = await this.db.select().from(job).where(eq(job.id, id)).limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : paraJobDetalhado(linha);
  }

  /** Quantos jobs prontos para rodar agora. Para saber se o poller tem trabalho. */
  async quantidadePronta(agora?: Date): Promise<number> {
    // O "agora" é o do banco pelo mesmo motivo de `reivindicar`: comparar o
    // relógio da aplicação com `agendado_para` esconderia um job enfileirado no
    // mesmo milissegundo, e esta contagem é o que decide se o poller tem trabalho.
    const limite = agora === undefined ? sql`now()` : sql`${agora.toISOString()}::timestamptz`;

    const linhas = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(job)
      .where(and(eq(job.status, 'pendente'), sql`${job.agendadoPara} <= ${limite}`));

    return linhas[0]?.n ?? 0;
  }

  /** Contagem por status, para o painel. */
  async contagemPorStatus(): Promise<Readonly<Record<StatusJob, number>>> {
    const linhas = await this.db
      .select({ status: job.status, n: sql<number>`count(*)::int` })
      .from(job)
      .groupBy(job.status);

    const base = Object.fromEntries(STATUS_JOB.map((s) => [s, 0])) as Record<StatusJob, number>;
    for (const linha of linhas) {
      if (linha.status !== null) base[linha.status] = linha.n;
    }
    return base;
  }

  /**
   * Devolve um job em execução à fila, para continuar depois.
   *
   * **Não é falha, e por isso não é `falhar`.** O caso que trouxe este método:
   * resolução de identidade que gastou o teto de orçamento da execução. O job fez
   * trabalho, gravou o que decidiu, e o que falta é retomável — usar `falhar`
   * consumiria uma tentativa a cada rodada e mandaria para a lista de mortos um job
   * que está progredindo.
   *
   * A tentativa é **devolvida**, e essa linha é a que importa: `reivindicar`
   * incrementa `tentativas` em toda reivindicação, e é o **mesmo contador** que
   * `falhar` usa para decidir se ainda há backoff. Sem devolver, um job adiado três
   * vezes chegaria ao primeiro erro de verdade já sem direito a retentativa — e
   * iria para `falhou` de uma vez, por ter sido pausado, não por ter errado.
   *
   * `greatest(… - 1, 0)` porque o contador nunca deve ficar negativo, e porque
   * `adiar` só aceita job `rodando` — então houve exatamente uma reivindicação a
   * desfazer.
   */
  async adiar(
    id: string,
    params: { readonly quando?: Date; readonly motivo?: string; readonly progresso?: unknown } = {},
  ): Promise<void> {
    const atual = await this.buscarPorId(id);
    if (atual === null) throw new FilaError(`job ${id} não existe`);
    if (atual.status !== 'rodando') {
      throw new FilaError(`job ${id} não está rodando; só job em execução é adiável`);
    }

    const agora = new Date();
    await this.db
      .update(job)
      .set({
        status: 'pendente',
        agendadoPara: params.quando ?? agora,
        iniciadoEm: null,
        tentativas: sql`greatest(${job.tentativas} - 1, 0)`,
        // O motivo fica em `erro` por falta de coluna melhor, e é visível na tela —
        // que é onde ele serve: "adiado por orçamento" explica um job que reaparece.
        erro: params.motivo ?? null,
        ...(params.progresso === undefined ? {} : { progresso: params.progresso }),
        atualizadoEm: agora,
      })
      .where(eq(job.id, id));
  }

  /** Reenfileira um job que falhou ou foi revisado, zerando as tentativas. */
  async reenfileirar(id: string): Promise<void> {
    const atual = await this.buscarPorId(id);
    if (atual === null) throw new FilaError(`job ${id} não existe`);
    if (atual.status === 'rodando') {
      throw new FilaError(`job ${id} está rodando; interrompa antes de reenfileirar`);
    }

    const agora = new Date();
    await this.db
      .update(job)
      .set({
        status: 'pendente',
        tentativas: 0,
        erro: null,
        aguardandoConteudo: null,
        agendadoPara: agora,
        iniciadoEm: null,
        terminadoEm: null,
        atualizadoEm: agora,
      })
      .where(eq(job.id, id));
  }

  /** Remove jobs concluídos antigos, para a tabela não crescer sem limite. */
  async limparConcluidos(antesDe: Date): Promise<number> {
    const removidos = await this.db
      .delete(job)
      .where(and(or(eq(job.status, 'concluido')), lte(job.terminadoEm, antesDe)))
      .returning({ id: job.id });
    return removidos.length;
  }
}

// ─── Mapeamento de linha ─────────────────────────────────────────────────────

interface LinhaDeJob {
  id: string;
  tipo: string;
  status: string | null;
  entrada: unknown;
  progresso: unknown;
  tentativas: number | string | null;
  max_tentativas?: number | string | null;
  maxTentativas?: number | string | null;
  chave_idempotencia?: string;
  chaveIdempotencia?: string;
  erro: string | null;
}

const esquemaStatus = z.enum(STATUS_JOB);

/**
 * Converte linha do banco para o tipo do domínio.
 *
 * Aceita as duas convenções de nome de coluna porque o caminho do Drizzle
 * devolve `camelCase` e o de SQL cru devolve `snake_case`, e `reivindicar` usa
 * SQL cru por causa do `SKIP LOCKED`.
 */
function paraJob(linha: LinhaDeJob): JobEnfileirado {
  const status = esquemaStatus.safeParse(linha.status);
  if (!status.success) {
    throw new FilaError(`status de job desconhecido no banco: ${String(linha.status)}`);
  }

  const inteiro = (v: number | string | null | undefined, padrao: number): number =>
    v === null || v === undefined ? padrao : Number(v);

  return {
    id: linha.id,
    tipo: linha.tipo,
    status: status.data,
    entrada: linha.entrada,
    progresso: linha.progresso ?? null,
    tentativas: inteiro(linha.tentativas, 0),
    maxTentativas: inteiro(linha.maxTentativas ?? linha.max_tentativas, 3),
    chaveIdempotencia: linha.chaveIdempotencia ?? linha.chave_idempotencia ?? '',
    erro: linha.erro,
  };
}

/**
 * Converte linha completa do Drizzle para `JobDetalhado`.
 *
 * Só o caminho do Drizzle passa por aqui, então os nomes são sempre `camelCase` e
 * os `timestamp` já vêm como `Date` — não há a ambiguidade que `paraJob` precisa
 * tratar.
 */
function paraJobDetalhado(linha: LinhaCompletaDeJob): JobDetalhado {
  return {
    ...paraJob(linha),
    resultado: linha.resultado ?? null,
    criadoEm: linha.criadoEm,
    agendadoPara: linha.agendadoPara,
    iniciadoEm: linha.iniciadoEm,
    terminadoEm: linha.terminadoEm,
  };
}

interface LinhaCompletaDeJob extends LinhaDeJob {
  resultado: unknown;
  criadoEm: Date;
  agendadoPara: Date;
  iniciadoEm: Date | null;
  terminadoEm: Date | null;
}
