/**
 * Inferência de compatibilidade por família de modelo, e a restrição que a limita.
 *
 * É o que transforma cadastro item por item em cadastro por família. Se o manual
 * confirma que o refil serve no `PA21G`, e a gramática da marca diz que o sufixo é
 * variação de cor, então `PA21X` é o mesmo aparelho em outra cor e a peça
 * provavelmente serve — **provavelmente**, e é toda a questão.
 *
 * ## Inferência propõe; evidência publica
 *
 * A confiança herdada é uma fração da origem, calibrada para que inferência a
 * partir da fonte mais forte que existe — o manual do fabricante, 1,0 — caia
 * **abaixo** do corte de publicação. O efeito é o desenhado: a gramática levanta a
 * hipótese e enche a fila de revisão; uma pessoa ou uma segunda fonte confirma; o
 * anúncio publica. Compatibilidade errada em peça de reposição gera devolução, e
 * devolução por palpite de parser seria a pior forma de perder dinheiro aqui.
 *
 * ## Inferência não encadeia
 *
 * Uma inferência nunca serve de origem para outra. Sem essa regra, a confiança
 * decairia de irmão em irmão e o catálogo inteiro acabaria "compatível com tudo"
 * a partir de uma única afirmação — e o rastro de auditoria teria mil passos.
 *
 * ## A restrição, que é o ponto da especificação
 *
 * `serve(P, A) ∧ ¬serve(P, B) ∧ mesma_familia(A, B)` é insatisfazível: a família
 * afirma que A e B são a mesma máquina, e a evidência afirma que a peça serve em
 * uma e não na outra. Uma das duas coisas está errada — a gramática agrupou demais,
 * ou existe subvariante que ninguém registrou. **Isso é sinalizado para revisão, e
 * enquanto está sinalizado nada propaga naquela família**, porque propagar a partir
 * de uma premissa quebrada é multiplicar o erro.
 */
import type { Evidencia } from './evidencia';
import { TOTAL_BP, type Decisao } from './resolucao';

/**
 * Fração da confiança da origem que a inferência de família herda.
 *
 * 60% escolhido por uma propriedade, não por gosto: `10 000 × 0,60 = 6 000`, que
 * fica abaixo do corte de 7 000. Inferência da melhor fonte possível ainda precisa
 * de confirmação.
 */
export const FATOR_FAMILIA_BP = 6_000;

/**
 * Fração herdada entre linhas diferentes da mesma linhagem.
 *
 * `PA21` e `PA26` são purificadores da mesma marca e aparelhos diferentes — capacidade
 * diferente pode significar filtro diferente. 25% é sugestão de onde olhar, não
 * afirmação, e nenhuma soma de sugestões chega ao corte (o teto do tipo é 4 000).
 */
export const FATOR_LINHAGEM_BP = 2_500;

export const GRAUS = ['familia', 'linhagem'] as const;
export type Grau = (typeof GRAUS)[number];

export interface AparelhoConhecido {
  readonly id: string;
  readonly familia: string | null;
  readonly linhagem: string | null;
  /** Como o aparelho aparece na explicação: `Electrolux PA26G`. */
  readonly rotulo: string;
}

/** O que já se sabe sobre o par (peça, aparelho), depois de resolvido. */
export interface AfirmacaoConhecida {
  readonly aparelhoId: string;
  readonly decisao: Decisao;
  readonly confiancaBp: number;
  /** `true` quando a própria afirmação já veio de inferência. Não encadeia. */
  readonly inferida: boolean;
}

export interface Inferencia {
  readonly aparelhoId: string;
  readonly origemAparelhoId: string;
  readonly grau: Grau;
  /** Chave do grupo que autorizou a propagação. Auditoria. */
  readonly grupo: string;
  readonly confiancaBp: number;
  /** Pronta para entrar em `compatibilidade.evidencias`. */
  readonly evidencia: Evidencia;
  readonly motivo: string;
}

export interface InconsistenciaDeFamilia {
  readonly grupo: string;
  readonly serveEm: readonly string[];
  readonly naoServeEm: readonly string[];
  readonly descricao: string;
}

export interface ResultadoDaInferencia {
  readonly inferencias: readonly Inferencia[];
  readonly inconsistencias: readonly InconsistenciaDeFamilia[];
}

export interface EntradaDaInferencia {
  readonly aparelhos: readonly AparelhoConhecido[];
  readonly afirmacoes: readonly AfirmacaoConhecida[];
  /** Momento gravado na evidência. Parâmetro para o teste não depender do relógio. */
  readonly agora: Date;
}

/** Aplica um fator em pontos-base, truncando para baixo. */
function escalar(valorBp: number, fatorBp: number): number {
  return Math.trunc((valorBp * fatorBp) / TOTAL_BP);
}

/** Agrupa aparelhos por uma chave, ignorando os que não têm. */
function agrupar(
  aparelhos: readonly AparelhoConhecido[],
  chave: (a: AparelhoConhecido) => string | null,
): ReadonlyMap<string, readonly AparelhoConhecido[]> {
  const grupos = new Map<string, AparelhoConhecido[]>();
  for (const a of aparelhos) {
    const k = chave(a);
    if (k === null) continue;
    const atual = grupos.get(k);
    if (atual === undefined) grupos.set(k, [a]);
    else atual.push(a);
  }
  return grupos;
}

/**
 * A afirmação mais forte de "serve" vinda de evidência, não de inferência.
 *
 * Desempate por `id` para que duas execuções com a mesma base produzam a mesma
 * origem — auditoria que muda de resposta entre execuções não serve de auditoria.
 */
function melhorOrigem(
  membros: readonly AparelhoConhecido[],
  por: ReadonlyMap<string, AfirmacaoConhecida>,
): { readonly aparelho: AparelhoConhecido; readonly afirmacao: AfirmacaoConhecida } | null {
  let escolhido: { aparelho: AparelhoConhecido; afirmacao: AfirmacaoConhecida } | null = null;
  for (const m of membros) {
    const a = por.get(m.id);
    if (a === undefined || a.inferida || a.decisao !== 'serve') continue;
    if (
      escolhido === null ||
      a.confiancaBp > escolhido.afirmacao.confiancaBp ||
      (a.confiancaBp === escolhido.afirmacao.confiancaBp && m.id < escolhido.aparelho.id)
    ) {
      escolhido = { aparelho: m, afirmacao: a };
    }
  }
  return escolhido;
}

/** Tem afirmação de "não serve" vinda de evidência? */
function negaComEvidencia(
  membros: readonly AparelhoConhecido[],
  por: ReadonlyMap<string, AfirmacaoConhecida>,
): readonly AparelhoConhecido[] {
  return membros.filter((m) => {
    const a = por.get(m.id);
    return a !== undefined && !a.inferida && a.decisao === 'nao_serve';
  });
}

/** Nada a dizer sobre este aparelho: ninguém afirmou nada dele ainda. */
function estaEmAberto(id: string, por: ReadonlyMap<string, AfirmacaoConhecida>): boolean {
  const a = por.get(id);
  return a === undefined || a.decisao === 'indefinido';
}

export function inferirCompatibilidade(entrada: EntradaDaInferencia): ResultadoDaInferencia {
  const { aparelhos, afirmacoes, agora } = entrada;
  const por = new Map(afirmacoes.map((a) => [a.aparelhoId, a]));
  const em = agora.toISOString();

  const inferencias: Inferencia[] = [];
  const inconsistencias: InconsistenciaDeFamilia[] = [];
  /** Famílias cuja premissa está quebrada: nada entra nem sai delas. */
  const familiasSuspeitas = new Set<string>();

  const familias = agrupar(aparelhos, (a) => a.familia);
  for (const [grupo, membros] of [...familias].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const origem = melhorOrigem(membros, por);
    const negam = negaComEvidencia(membros, por);

    if (origem !== null && negam.length > 0) {
      familiasSuspeitas.add(grupo);
      inconsistencias.push({
        grupo,
        serveEm: membros
          .filter((m) => por.get(m.id)?.decisao === 'serve')
          .map((m) => m.id)
          .sort(),
        naoServeEm: negam.map((m) => m.id).sort(),
        descricao: `a gramática diz que ${origem.aparelho.rotulo} e ${negam[0]?.rotulo ?? '?'} são o mesmo aparelho, e a evidência diz que a peça serve em um e não no outro`,
      });
      continue;
    }
    if (origem === null) continue;

    const confiancaBp = escalar(origem.afirmacao.confiancaBp, FATOR_FAMILIA_BP);
    if (confiancaBp === 0) continue;

    for (const alvo of membros) {
      if (alvo.id === origem.aparelho.id) continue;
      if (!estaEmAberto(alvo.id, por)) continue;
      inferencias.push({
        aparelhoId: alvo.id,
        origemAparelhoId: origem.aparelho.id,
        grau: 'familia',
        grupo,
        confiancaBp,
        evidencia: {
          tipo: 'inferencia_familia',
          url: null,
          trecho: `mesma família ${grupo} de ${origem.aparelho.rotulo}, confirmado`,
          em,
          negativa: false,
          forcaBp: confiancaBp,
        },
        motivo: `${alvo.rotulo} é variação de ${origem.aparelho.rotulo}, que está confirmado`,
      });
    }
  }

  const jaInferidos = new Set(inferencias.map((i) => i.aparelhoId));
  const linhagens = agrupar(aparelhos, (a) => a.linhagem);
  for (const [grupo, membros] of [...linhagens].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Linha diferente é aparelho diferente por construção, então "serve num e não
    // no outro" aqui **não** é inconsistência — é a gramática funcionando. Mas é
    // sinal de que a peça distingue linha, e aí sugerir por linhagem só geraria
    // ruído na fila.
    if (negaComEvidencia(membros, por).length > 0) continue;
    const origem = melhorOrigem(membros, por);
    if (origem === null) continue;
    if (origem.aparelho.familia !== null && familiasSuspeitas.has(origem.aparelho.familia))
      continue;

    const confiancaBp = escalar(origem.afirmacao.confiancaBp, FATOR_LINHAGEM_BP);
    if (confiancaBp === 0) continue;

    for (const alvo of membros) {
      if (alvo.id === origem.aparelho.id) continue;
      if (jaInferidos.has(alvo.id)) continue;
      if (!estaEmAberto(alvo.id, por)) continue;
      if (alvo.familia !== null && familiasSuspeitas.has(alvo.familia)) continue;
      // Mesma família já foi tratada com fator maior; aqui é só o que cruza linha.
      if (alvo.familia !== null && alvo.familia === origem.aparelho.familia) continue;
      inferencias.push({
        aparelhoId: alvo.id,
        origemAparelhoId: origem.aparelho.id,
        grau: 'linhagem',
        grupo,
        confiancaBp,
        evidencia: {
          tipo: 'inferencia_linhagem',
          url: null,
          trecho: `mesma linha ${grupo} de ${origem.aparelho.rotulo}, confirmado`,
          em,
          negativa: false,
          forcaBp: confiancaBp,
        },
        motivo: `${alvo.rotulo} é da mesma linha de ${origem.aparelho.rotulo} — vale conferir, não vale publicar`,
      });
    }
  }

  return {
    inferencias: [...inferencias].sort((a, b) => (a.aparelhoId < b.aparelhoId ? -1 : 1)),
    inconsistencias,
  };
}
