/**
 * A leitura do monitor por IA (M15, etapa 11.1): a hipótese e a recomendação de cada
 * grupo de eventos, em linguagem natural.
 *
 * É a parte que a especificação usa para separar inteligência de automação — "caiu 8% e
 * o estoque subiu ao mesmo tempo: provável troca de fornecedor, e o piso do nicho baixou
 * de forma permanente". Julgamento sobre evidência incompleta, que é onde a IA entra
 * (CLAUDE.md, 3.5). O agrupamento e a leitura por regra continuam em `eventos.ts`, e
 * continuam vindo primeiro na tela: a IA entra **em cima**, marcada como hipótese.
 *
 * ## Gratuito e em lote
 *
 * Vários grupos por pedido, cada um com a série de preço do alvo e a leitura que o
 * sistema já fez por regra (CLAUDE.md, 3.7). Cota esgotada é teto: quem espera é o
 * executor. Resposta que não serve para o lote inteiro volta na tentativa seguinte, com
 * o número da tentativa na pergunta — resposta fora do formato também vira cache, e a
 * mesma pergunta devolveria a mesma resposta ruim.
 *
 * ## Onde fica
 *
 * Em cada evento do grupo (`monitor_evento.leitura_ia`), como JSON. O grupo não é
 * gravado — é recalculado na leitura, como sempre foi —, então a leitura mora nos
 * eventos: evento novo que entra num grupo já lido chega sem leitura, e o grupo é lido de
 * novo, com ele.
 */
import { z } from 'zod';
import type { ServicoDeLlm } from '@/infra/llm';
import { diaNoFuso } from '@/dominio/pedidos/fila-do-dia';
import { centavosParaReais, centavos } from '@/lib/dinheiro';
import { agruparEventos, type Evento, type GrupoDeEventos, type TipoDeMudanca } from './eventos';
import type { PrecoObservado } from './queda';
import { JANELA_DE_REFERENCIA_DIAS } from './queda';
import type { RepositorioDoMonitor } from './repositorio';

export const PROPOSITO_DA_LEITURA = 'leitura_serie' as const;

/** Grupos por pedido. Oito cabem com folga na resposta, e a cota gratuita é por pedido. */
export const GRUPOS_POR_PEDIDO = 8;

/** Tentativas por grupo antes de desistir dele — e o grupo fica só com a leitura por regra. */
export const MAX_TENTATIVAS_DE_LEITURA = 3;

/** Pontos da série de preço mandados por alvo: o bastante para ver tendência. */
export const PONTOS_DA_SERIE = 12;

/** Eventos não lidos considerados por passada. */
const EVENTOS_POR_PASSADA = 200;

// ─── O que fica gravado ─────────────────────────────────────────────────────

const esquemaDaLeituraGravada = z.discriminatedUnion('estado', [
  z.object({
    estado: z.literal('lida'),
    hipotese: z.string(),
    recomendacao: z.string(),
    modelo: z.string(),
    em: z.string(),
  }),
  z.object({
    estado: z.literal('tentando'),
    tentativas: z.number().int().min(1),
    problemas: z.array(z.string()),
  }),
  z.object({
    estado: z.literal('sem_leitura'),
    tentativas: z.number().int().min(1),
    problemas: z.array(z.string()),
  }),
]);
export type LeituraGravada = z.infer<typeof esquemaDaLeituraGravada>;

/** Lê a coluna. Texto que não é desta forma conta como "sem leitura ainda". */
export function lerLeituraGravada(texto: string | null): LeituraGravada | null {
  if (texto === null || texto.trim() === '') return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  const lida = esquemaDaLeituraGravada.safeParse(bruto);
  return lida.success ? lida.data : null;
}

export type LeituraDoGrupo =
  | {
      readonly tipo: 'lida';
      readonly hipotese: string;
      readonly recomendacao: string;
      readonly modelo: string;
      readonly em: string;
    }
  | { readonly tipo: 'pendente'; readonly tentativas: number }
  | { readonly tipo: 'sem_leitura' };

/**
 * O estado da leitura de um grupo, pelas leituras dos eventos dele.
 *
 * Algum evento sem leitura, ou em nova tentativa: o grupo está pendente — é o evento
 * novo que chegou num grupo já lido. Senão, vale a leitura mais recente; e, sem nenhuma,
 * a IA desistiu do grupo, que fica com a leitura por regra.
 */
export function leituraDoGrupo(leituras: readonly (LeituraGravada | null)[]): LeituraDoGrupo {
  let tentativas = 0;
  let pendente = false;
  let maisRecente: Extract<LeituraGravada, { estado: 'lida' }> | null = null;
  for (const leitura of leituras) {
    if (leitura === null) {
      pendente = true;
    } else if (leitura.estado === 'tentando') {
      pendente = true;
      tentativas = Math.max(tentativas, leitura.tentativas);
    } else if (leitura.estado === 'lida') {
      if (maisRecente === null || leitura.em > maisRecente.em) maisRecente = leitura;
    }
  }
  if (pendente) return { tipo: 'pendente', tentativas };
  if (maisRecente !== null) {
    return {
      tipo: 'lida',
      hipotese: maisRecente.hipotese,
      recomendacao: maisRecente.recomendacao,
      modelo: maisRecente.modelo,
      em: maisRecente.em,
    };
  }
  return { tipo: 'sem_leitura' };
}

// ─── O pedido ───────────────────────────────────────────────────────────────

export const INSTRUCOES_DA_LEITURA = `Você lê o monitor de mercado de um vendedor de peças de reposição em marketplace (Mercado Livre, Shopee, Amazon).
Cada grupo reúne as mudanças de um mesmo alvo — um concorrente, um fornecedor ou um produto — na mesma semana, com a série de preço do alvo quando há, e a leitura que o sistema já fez por regra.
Para cada grupo, escreva:
- "hipotese": o que provavelmente aconteceu, em uma ou duas frases, dizendo a evidência que sustenta (por exemplo: "o preço caiu 12% e o estoque subiu na mesma semana: parece fornecedor novo, não queima de estoque"). Se os dados não bastam para escolher, diga quais explicações continuam possíveis e o que as distinguiria.
- "recomendacao": o que o vendedor deve fazer agora, numa frase curta e concreta (conferir o custo com o fornecedor, esperar uma semana antes de mexer no preço, rever o preço mínimo...).
Use só os dados do grupo. Não invente número, nome, data nem fato de fora. Português do Brasil.
Responda um item por grupo, com o mesmo "id" do grupo.`;

const TIPOS_DE_PRECO: ReadonlySet<TipoDeMudanca> = new Set([
  'preco_concorrente_caiu',
  'preco_concorrente_subiu',
  'custo_fornecedor_subiu',
]);

/** Valor gravado em centavos, como reais para o modelo ler; o resto, como está. */
function valorLegivel(tipo: TipoDeMudanca, valor: string | null): number | string | null {
  if (valor === null) return null;
  if (!TIPOS_DE_PRECO.has(tipo)) return valor;
  const n = Number(valor);
  return Number.isInteger(n) ? centavosParaReais(centavos(n)) : valor;
}

export interface GrupoParaLer {
  readonly grupo: GrupoDeEventos;
  /** A série de preço de cada produto do grupo, do mais antigo para o mais novo. */
  readonly series: ReadonlyMap<string, readonly PrecoObservado[]>;
}

/** O id do grupo no pedido: curto e estável, em vez da chave com o nome do vendedor. */
export function idDoGrupo(indice: number): string {
  return `g${String(indice + 1)}`;
}

/**
 * A pergunta. É ela que vai para o hash de cache: o mesmo grupo, com os mesmos eventos e
 * a mesma série, não é perguntado de novo. A tentativa entra a partir da segunda.
 */
export function pedidoDaLeitura(grupos: readonly GrupoParaLer[], tentativa: number): unknown {
  return {
    grupos: grupos.map(({ grupo, series }, indice) => ({
      id: idDoGrupo(indice),
      sobre: grupo.sobre,
      leituraDoSistema: grupo.leitura,
      eventos: grupo.eventos.map((e) => ({
        tipo: e.tipo,
        dia: diaNoFuso(e.detectadoEm),
        antes: valorLegivel(e.tipo, e.valorAntes),
        depois: valorLegivel(e.tipo, e.valorDepois),
        variacaoPct: e.variacaoBp === null ? null : e.variacaoBp / 100,
        severidade: e.severidade,
      })),
      seriesDePreco: [...new Set(grupo.eventos.flatMap((e) => e.entidadeId ?? []))].flatMap(
        (id) => {
          const serie = series.get(id);
          return serie === undefined || serie.length === 0
            ? []
            : [serie.map((p) => ({ dia: diaNoFuso(p.em), reais: centavosParaReais(p.preco) }))];
        },
      ),
    })),
    ...(tentativa > 0 ? { tentativa: tentativa + 1 } : {}),
  };
}

const esquemaDoItem = z.object({
  id: z.string(),
  hipotese: z.string().trim().min(10).max(800),
  recomendacao: z.string().trim().min(5).max(500),
});

/**
 * A resposta. Cada item é conferido sozinho, depois: um item torto não derruba os outros
 * sete — o que cabe na forma é lido, e o resto volta na próxima passada.
 */
export const esquemaDaResposta = z.object({ leituras: z.array(z.unknown()).max(50) });

// ─── O leitor ───────────────────────────────────────────────────────────────

export type ResultadoDaLeitura =
  | { readonly tipo: 'nada_a_ler' }
  | {
      readonly tipo: 'lote';
      readonly grupos: number;
      readonly lidos: number;
      readonly paraTentarDeNovo: number;
      readonly semLeitura: number;
      readonly chamada: 'feita' | 'sem_chave' | 'erro';
      /** A resposta não serviu para o lote inteiro: o próximo lote é menor. */
      readonly loteInutilizavel: boolean;
      readonly erro?: string;
    };

export interface OpcoesDoLeitor {
  readonly llm: ServicoDeLlm;
  readonly modelo: string;
  readonly agora?: (() => Date) | undefined;
}

export class LeitorDoMonitor {
  constructor(
    private readonly repositorio: RepositorioDoMonitor,
    private readonly opcoes: OpcoesDoLeitor,
  ) {}

  private agora(): Date {
    return this.opcoes.agora?.() ?? new Date();
  }

  /** Os grupos que esperam leitura, com o estado de cada um. */
  private async pendentes(
    tamanho: number,
  ): Promise<readonly { readonly grupo: GrupoDeEventos; readonly tentativas: number }[]> {
    const linhas = await this.repositorio.naoLidosComLeitura(EVENTOS_POR_PASSADA);
    const leituras = new Map(linhas.map((l) => [l.evento.id, lerLeituraGravada(l.leitura)]));
    const eventos: Evento[] = linhas.map((l) => l.evento);

    return agruparEventos(eventos)
      .map((grupo) => ({
        grupo,
        estado: leituraDoGrupo(grupo.eventos.map((e) => leituras.get(e.id) ?? null)),
      }))
      .flatMap(({ grupo, estado }) =>
        estado.tipo === 'pendente' ? [{ grupo, tentativas: estado.tentativas }] : [],
      )
      .slice(0, tamanho);
  }

  /** Grava o que cada grupo ficou sendo: lido, para tentar de novo, ou sem leitura. */
  private async marcarFalha(
    grupo: GrupoDeEventos,
    tentativas: number,
    problemas: readonly string[],
  ): Promise<'tentando' | 'sem_leitura'> {
    const proxima = tentativas + 1;
    const estado = proxima >= MAX_TENTATIVAS_DE_LEITURA ? 'sem_leitura' : 'tentando';
    await this.repositorio.gravarLeitura(
      grupo.eventos.map((e) => e.id),
      JSON.stringify({ estado, tentativas: proxima, problemas: problemas.slice(0, 5) }),
    );
    return estado;
  }

  /** Lê um lote de grupos. Lança só `ExecucaoInterrompida` — cota e teto —, como o serviço. */
  async lerLote(tamanho: number = GRUPOS_POR_PEDIDO): Promise<ResultadoDaLeitura> {
    const pendentes = await this.pendentes(Math.max(1, tamanho));
    if (pendentes.length === 0) return { tipo: 'nada_a_ler' };

    const agora = this.agora();
    const desde = new Date(agora.getTime() - JANELA_DE_REFERENCIA_DIAS * 24 * 60 * 60 * 1000);
    const series = await this.repositorio.seriesDePreco(
      [...new Set(pendentes.flatMap((p) => p.grupo.eventos.flatMap((e) => e.entidadeId ?? [])))],
      desde,
      PONTOS_DA_SERIE,
    );

    const tentativa = Math.max(...pendentes.map((p) => p.tentativas));
    const resultado = await this.opcoes.llm.pedir({
      proposito: PROPOSITO_DA_LEITURA,
      modelo: this.opcoes.modelo,
      instrucoes: INSTRUCOES_DA_LEITURA,
      entrada: pedidoDaLeitura(
        pendentes.map((p) => ({ grupo: p.grupo, series })),
        tentativa,
      ),
      esquema: esquemaDaResposta,
    });

    const base = { tipo: 'lote' as const, grupos: pendentes.length };
    // Sem chave e provedor fora não são culpa do grupo: nada é marcado, e o executor
    // espera. Contar como tentativa faria uma chave recusada desistir de tudo.
    if (
      resultado.tipo === 'sem_chave' ||
      (resultado.tipo === 'erro' && resultado.natureza === 'provedor')
    ) {
      return {
        ...base,
        lidos: 0,
        paraTentarDeNovo: 0,
        semLeitura: 0,
        chamada: resultado.tipo,
        loteInutilizavel: false,
        ...(resultado.tipo === 'erro' ? { erro: resultado.mensagem } : {}),
      };
    }

    const porId = new Map<string, z.infer<typeof esquemaDoItem>>();
    if (resultado.tipo === 'ok') {
      for (const bruto of resultado.valor.leituras) {
        const item = esquemaDoItem.safeParse(bruto);
        if (item.success && !porId.has(item.data.id)) porId.set(item.data.id, item.data);
      }
    }
    const problemasDoLote =
      resultado.tipo === 'pendente_revisao'
        ? resultado.problemas.slice(0, 5)
        : resultado.tipo === 'erro'
          ? [resultado.mensagem]
          : ['o modelo não devolveu leitura para este grupo'];

    let lidos = 0;
    let paraTentarDeNovo = 0;
    let semLeitura = 0;
    for (const [indice, { grupo, tentativas }] of pendentes.entries()) {
      const item = porId.get(idDoGrupo(indice));
      if (item === undefined) {
        const estado = await this.marcarFalha(grupo, tentativas, problemasDoLote);
        if (estado === 'tentando') paraTentarDeNovo += 1;
        else semLeitura += 1;
        continue;
      }
      await this.repositorio.gravarLeitura(
        grupo.eventos.map((e) => e.id),
        JSON.stringify({
          estado: 'lida',
          hipotese: item.hipotese,
          recomendacao: item.recomendacao,
          modelo: this.opcoes.modelo,
          em: agora.toISOString(),
        } satisfies LeituraGravada),
      );
      lidos += 1;
    }

    return {
      ...base,
      lidos,
      paraTentarDeNovo,
      semLeitura,
      chamada: 'feita',
      loteInutilizavel: resultado.tipo !== 'ok',
      ...(resultado.tipo === 'erro' ? { erro: resultado.mensagem } : {}),
    };
  }
}
