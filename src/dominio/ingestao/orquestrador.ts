/**
 * Orquestrador de ingestão — o campo único que aceita qualquer coisa.
 *
 * É a porta de entrada do M1: recebe URL, arquivo ou texto, **classifica**,
 * guarda o conteúdo e **enfileira**. Não extrai nada — extração é do executor, e
 * separar as duas coisas é o que faz a entrada responder rápido mesmo para uma
 * planilha de dez mil linhas.
 *
 * A chave de idempotência é o que costura o classificador à fila: colar o mesmo
 * link ou subir a mesma planilha duas vezes devolve o mesmo job, sem pagar
 * extração de novo.
 */
import { createHash } from 'node:crypto';
import type { ArmazenamentoDeConteudo } from '@/infra/armazenamento/conteudo';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import { classificar, ehConfiavel, type Classificacao, type Entrada } from './classificador';

/** Tipo de job que o executor conhece. */
export const TIPO_JOB_INGESTAO = 'ingestao';

/**
 * Payload do job de ingestão.
 *
 * Guarda o **hash** do conteúdo, não o conteúdo: ver
 * `infra/armazenamento/conteudo.ts` para o porquê.
 */
export interface EntradaDoJobDeIngestao {
  readonly classificacao: Classificacao;
  /** Hash no armazenamento de conteúdo. `null` quando a entrada é só uma URL. */
  readonly hashConteudo: string | null;
  readonly nomeArquivo: string | null;
  readonly url: string | null;
  /** Texto colado, quando curto o bastante para caber no payload. */
  readonly texto: string | null;
}

export type ResultadoDoRecebimento = (
  | {
      readonly tipo: 'enfileirado';
      readonly job: JobEnfileirado;
      readonly jaExistia: boolean;
      readonly classificacao: Classificacao;
    }
  | {
      /**
       * Classificação fraca demais para gastar extração.
       *
       * Vai para revisão **antes** de enfileirar trabalho: a especificação é
       * explícita de que não se descarta entrada, e igualmente explícita de que
       * agente sem critério de gasto não roda. Revisar primeiro respeita as duas.
       */
      readonly tipo: 'precisa_revisao';
      readonly job: JobEnfileirado;
      readonly classificacao: Classificacao;
      readonly motivo: string;
    }
) & {
  /**
   * Os jobs que esperavam este arquivo e voltaram à fila: ele tinha saído da nuvem, e
   * quem o enviou de novo não precisa achá-los (ADR 0016).
   */
  readonly devolvidosAFila: readonly string[];
};

/** Texto acima deste tamanho vai para o armazenamento em vez do payload. */
export const MAX_TEXTO_NO_PAYLOAD = 8 * 1024;

export class Orquestrador {
  constructor(
    private readonly fila: Fila,
    private readonly armazenamento: ArmazenamentoDeConteudo,
  ) {}

  /**
   * Recebe uma entrada, classifica e enfileira.
   *
   * Nunca lança por conteúdo. Entrada irreconhecível é enfileirada já em
   * `pendente_revisao`, o que preserva o registro e ainda dá à pessoa uma linha
   * na tela de jobs para agir.
   */
  async receber(params: {
    readonly entrada: Entrada;
    /** Bytes do arquivo, quando a entrada é arquivo. */
    readonly conteudo?: Uint8Array;
  }): Promise<ResultadoDoRecebimento> {
    const classificacao = classificar(params.entrada);

    // Texto longo demais para o payload vai para o armazenamento, como arquivo. Sem isso
    // a tabela colada de um fornecedor grande chegava ao executor sem texto nenhum.
    const conteudo =
      params.conteudo ??
      (params.entrada.tipo === 'texto' && params.entrada.valor.length > MAX_TEXTO_NO_PAYLOAD
        ? new TextEncoder().encode(params.entrada.valor)
        : undefined);
    const guardado =
      conteudo === undefined ? null : await this.armazenamento.guardarDizendo(conteudo);
    const hashConteudo = guardado?.hash ?? null;

    const payload = montarPayload({ entrada: params.entrada, classificacao, hashConteudo });
    const chave = chaveDeIdempotencia(payload);

    const { job, jaExistia } = await this.fila.enfileirar({
      tipo: TIPO_JOB_INGESTAO,
      chaveIdempotencia: chave,
      entrada: payload,
    });

    if (!ehConfiavel(classificacao)) {
      const motivo =
        `classificação pouco confiável (${String(classificacao.confiancaBp / 100)}%): ` +
        `${classificacao.motivo}. Revise antes de extrair.`;

      // Só manda para revisão se o job é novo ou ainda está pendente: um job já
      // concluído não deve regredir porque a mesma entrada foi colada de novo.
      if (!jaExistia || job.status === 'pendente') {
        await this.fila.mandarParaRevisao(job.id, motivo);
      }

      const devolvidosAFila = await this.devolverOsQueAguardavam(guardado);
      const atualizado = (await this.fila.buscarPorId(job.id)) ?? job;
      return { tipo: 'precisa_revisao', job: atualizado, classificacao, motivo, devolvidosAFila };
    }

    const devolvidosAFila = await this.devolverOsQueAguardavam(guardado);
    const atualizado = devolvidosAFila.includes(job.id)
      ? ((await this.fila.buscarPorId(job.id)) ?? job)
      : job;
    return { tipo: 'enfileirado', job: atualizado, jaExistia, classificacao, devolvidosAFila };
  }

  /**
   * O arquivo que não estava guardado pode ser um que saiu da nuvem e voltou: o job que
   * parou esperando por ele volta à fila. Arquivo que já estava guardado não devolve
   * nada — ninguém esperava por ele.
   */
  private async devolverOsQueAguardavam(
    guardado: { readonly hash: string; readonly jaEstava: boolean } | null,
  ): Promise<readonly string[]> {
    if (guardado === null || guardado.jaEstava) return [];
    return this.fila.reenfileirarOsQueAguardam(guardado.hash);
  }

  /**
   * Recebe uma lista de links como N entradas independentes.
   *
   * Um job por link, e não um job que percorre a lista: se o terceiro link falha,
   * os outros já concluíram e só ele reagenda. Um job só perderia isso.
   */
  async receberLista(urls: readonly string[]): Promise<readonly ResultadoDoRecebimento[]> {
    const resultados: ResultadoDoRecebimento[] = [];
    for (const url of urls) {
      resultados.push(await this.receber({ entrada: { tipo: 'url', valor: url } }));
    }
    return resultados;
  }
}

function montarPayload(params: {
  readonly entrada: Entrada;
  readonly classificacao: Classificacao;
  readonly hashConteudo: string | null;
}): EntradaDoJobDeIngestao {
  const { entrada, classificacao, hashConteudo } = params;

  return {
    classificacao,
    hashConteudo,
    nomeArquivo: entrada.tipo === 'arquivo' ? entrada.nome : null,
    url: entrada.tipo === 'url' ? entrada.valor : null,
    texto:
      entrada.tipo === 'texto' && entrada.valor.length <= MAX_TEXTO_NO_PAYLOAD
        ? entrada.valor
        : null,
  };
}

/**
 * Chave de idempotência de uma ingestão.
 *
 * Deriva do que identifica a unidade de trabalho, **não** do payload inteiro: o
 * payload carrega a classificação, e um ajuste na tabela de sinônimos mudaria a
 * classificação sem mudar a entrada — o que faria a mesma planilha virar um job
 * novo sem necessidade.
 *
 * Por isso a chave usa: tipo de entrada resolvido, hash do conteúdo, URL e nome
 * do arquivo. Cada parte entra prefixada pelo próprio tamanho, para nenhum
 * conteúdo conseguir simular a fronteira entre elas.
 */
export function chaveDeIdempotencia(payload: EntradaDoJobDeIngestao): string {
  const partes = [
    payload.classificacao.tipoDeEntrada,
    payload.hashConteudo ?? '',
    payload.url ?? '',
    payload.nomeArquivo ?? '',
    payload.texto ?? '',
  ];

  const canonico = partes.map((p) => `${String(p.length)}:${p}`).join('');
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}
