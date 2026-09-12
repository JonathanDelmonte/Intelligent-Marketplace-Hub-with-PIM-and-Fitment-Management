/**
 * Pares de identidade: a decisão gravada e a fila de revisão (M3, etapa 5.5).
 *
 * "Acima de um limiar, agrupa automaticamente. Na zona cinzenta, vai para uma fila
 * de revisão sua, de dois cliques." Este módulo é as duas coisas — e a segunda é a
 * que precisa de tabela, porque fila que não é persistida é recalculada a cada tela
 * e perde a decisão de quem já olhou.
 *
 * **A regra de procedência do ADR 0002 vale para decisão de identidade também:**
 * origem fraca não sobrescreve origem forte. Uma pessoa que decidiu "não são o
 * mesmo produto" não pode ser desfeita pela próxima varredura automática que
 * discordar. Isso está no `setWhere` do upsert, e não em uma convenção.
 */
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { parIdentidade, produtoExterno } from '@/infra/banco/schema';
import type { Decisao, NivelDeCasamento } from './casamento';

export const ORIGENS_DA_DECISAO = ['deterministico', 'llm', 'humano'] as const;
export type OrigemDaDecisao = (typeof ORIGENS_DA_DECISAO)[number];

/**
 * Situação do par.
 *
 * - `automatico`: o sistema decidiu e não precisa de ninguém.
 * - `pendente`: está na fila de revisão.
 * - `resolvido`: uma pessoa decidiu.
 * - `descartado`: alguém marcou como não vale olhar (ruído do gerador de candidato).
 */
export const STATUS_DO_PAR = ['automatico', 'pendente', 'resolvido', 'descartado'] as const;
export type StatusDoPar = (typeof STATUS_DO_PAR)[number];

export class ParInvalido extends Error {
  override readonly name = 'ParInvalido';
}

/**
 * Ordena o par pelos ids.
 *
 * O banco também garante (`chk_par_identidade_ordenado`), e a redundância é de
 * propósito: aqui o erro é uma mensagem que diz o que aconteceu, e no banco seria
 * uma violação de constraint no meio de um laço de mil pares.
 */
export function ordenarPar(a: string, b: string): readonly [string, string] {
  if (a === b) {
    throw new ParInvalido(`par de um produto com ele mesmo: ${a}`);
  }
  return a < b ? [a, b] : [b, a];
}

export interface DecisaoDoPar {
  readonly produtoA: string;
  readonly produtoB: string;
  readonly decisao: Decisao;
  readonly origem: OrigemDaDecisao;
  readonly nivel: NivelDeCasamento | 'embedding';
  readonly confiancaBp: number;
  readonly status: StatusDoPar;
  readonly justificativa?: string | undefined;
  readonly distanciaBp?: number | undefined;
  readonly inconsistencias?: readonly string[] | undefined;
  readonly llmCallId?: string | undefined;
}

export interface LadoDaFila {
  readonly id: string;
  readonly tituloBruto: string;
  readonly ean: string | null;
  readonly preco: number | null;
  readonly vendedor: string | null;
  readonly plataformaOuSite: string | null;
  readonly url: string | null;
  readonly formaCanonica: string | null;
  readonly skuId: string | null;
}

export interface ParDaFila {
  readonly id: string;
  readonly decisao: Decisao;
  readonly origem: OrigemDaDecisao;
  readonly nivel: string;
  readonly confiancaBp: number;
  readonly justificativa: string | null;
  readonly inconsistencias: readonly string[];
  readonly criadoEm: Date;
  readonly a: LadoDaFila;
  readonly b: LadoDaFila;
}

export class RepositorioDePares {
  constructor(private readonly db: Banco) {}

  /**
   * Grava a decisão sobre um par.
   *
   * `onConflictDoUpdate` com `setWhere`: reexecutar a resolução atualiza a decisão
   * automática, e **não toca** no par que uma pessoa já decidiu. Sem o `setWhere`, a
   * próxima varredura apagaria em silêncio o trabalho de revisão — que é o
   * conhecimento mais caro que o sistema acumula.
   */
  async registrar(
    dados: DecisaoDoPar,
  ): Promise<{ readonly id: string; readonly gravado: boolean }> {
    const [a, b] = ordenarPar(dados.produtoA, dados.produtoB);

    const valores = {
      produtoAId: a,
      produtoBId: b,
      decisao: dados.decisao,
      origem: dados.origem,
      nivel: dados.nivel,
      confiancaBp: dados.confiancaBp,
      status: dados.status,
      justificativa: dados.justificativa ?? null,
      distanciaBp: dados.distanciaBp ?? null,
      inconsistencias: dados.inconsistencias ?? [],
      llmCallId: dados.llmCallId ?? null,
    };

    const gravadas = await this.db
      .insert(parIdentidade)
      .values(valores)
      .onConflictDoUpdate({
        target: [parIdentidade.produtoAId, parIdentidade.produtoBId],
        set: { ...valores, atualizadoEm: new Date() },
        // Decisão humana é a mais forte e não é sobrescrita por automação. A
        // condição é espalhada em vez de passada como `undefined` porque
        // `exactOptionalPropertyTypes` distingue "ausente" de "presente e
        // undefined" — e o Drizzle só aceita a primeira forma.
        ...(dados.origem === 'humano' ? {} : { setWhere: ne(parIdentidade.origem, 'humano') }),
      })
      .returning({ id: parIdentidade.id });

    const gravada = gravadas[0];
    if (gravada !== undefined) return { id: gravada.id, gravado: true };

    // O `setWhere` recusou: existe decisão humana. Devolve o id dela, sem tocar.
    const existente = await this.buscar(a, b);
    if (existente === null) {
      throw new ParInvalido(`par ${a}/${b} não gravou e não existe`);
    }
    return { id: existente.id, gravado: false };
  }

  async buscar(
    produtoA: string,
    produtoB: string,
  ): Promise<{
    readonly id: string;
    readonly decisao: string;
    readonly origem: string;
    readonly status: string;
    readonly confiancaBp: number;
  } | null> {
    const [a, b] = ordenarPar(produtoA, produtoB);
    const linhas = await this.db
      .select({
        id: parIdentidade.id,
        decisao: parIdentidade.decisao,
        origem: parIdentidade.origem,
        status: parIdentidade.status,
        confiancaBp: parIdentidade.confiancaBp,
      })
      .from(parIdentidade)
      .where(and(eq(parIdentidade.produtoAId, a), eq(parIdentidade.produtoBId, b)))
      .limit(1);
    return linhas[0] ?? null;
  }

  /**
   * Pares já avaliados que envolvem um produto.
   *
   * Serve para não pagar duas vezes: quem já foi julgado não volta para julgamento.
   * Devolve o id do **outro** lado, que é o que o chamador precisa comparar.
   */
  async jaAvaliados(produtoId: string): Promise<ReadonlySet<string>> {
    const linhas = await this.db
      .select({ a: parIdentidade.produtoAId, b: parIdentidade.produtoBId })
      .from(parIdentidade)
      .where(or(eq(parIdentidade.produtoAId, produtoId), eq(parIdentidade.produtoBId, produtoId)));

    return new Set(linhas.map((l) => (l.a === produtoId ? l.b : l.a)));
  }

  /**
   * A fila de revisão, mais confiante primeiro.
   *
   * A ordem não é cronológica de propósito: o par que o sistema quase decidiu é o
   * que uma pessoa resolve em dois segundos, e resolver os fáceis primeiro é o que
   * faz a fila andar. Par cru fica para depois.
   */
  async fila(limite = 50): Promise<readonly ParDaFila[]> {
    const a = this.aliasLado('a');
    const b = this.aliasLado('b');

    const linhas = await this.db
      .select({
        id: parIdentidade.id,
        decisao: parIdentidade.decisao,
        origem: parIdentidade.origem,
        nivel: parIdentidade.nivel,
        confiancaBp: parIdentidade.confiancaBp,
        justificativa: parIdentidade.justificativa,
        inconsistencias: parIdentidade.inconsistencias,
        criadoEm: parIdentidade.criadoEm,
        a,
        b,
      })
      .from(parIdentidade)
      .innerJoin(produtoExterno, eq(produtoExterno.id, parIdentidade.produtoAId))
      .innerJoin(sql`${produtoExterno} as pb`, sql`pb.id = ${parIdentidade.produtoBId}`)
      .where(eq(parIdentidade.status, 'pendente'))
      .orderBy(desc(parIdentidade.confiancaBp), desc(parIdentidade.criadoEm))
      .limit(limite);

    return linhas.map((l) => ({
      id: l.id,
      decisao: l.decisao as Decisao,
      origem: l.origem as OrigemDaDecisao,
      nivel: l.nivel,
      confiancaBp: l.confiancaBp,
      justificativa: l.justificativa,
      inconsistencias: Array.isArray(l.inconsistencias) ? (l.inconsistencias as string[]) : [],
      criadoEm: l.criadoEm,
      a: l.a,
      b: l.b,
    }));
  }

  /** Contagem por status, para a tela dizer quanto há sem carregar tudo. */
  async contarPorStatus(): Promise<Readonly<Record<StatusDoPar, number>>> {
    const linhas = await this.db
      .select({ status: parIdentidade.status, n: sql<number>`count(*)::int` })
      .from(parIdentidade)
      .groupBy(parIdentidade.status);

    const zerado: Record<StatusDoPar, number> = {
      automatico: 0,
      pendente: 0,
      resolvido: 0,
      descartado: 0,
    };
    for (const linha of linhas) {
      if ((STATUS_DO_PAR as readonly string[]).includes(linha.status)) {
        zerado[linha.status as StatusDoPar] = linha.n;
      }
    }
    return zerado;
  }

  /** Marca pares como resolvidos por pessoa. Devolve quantos mudaram. */
  async marcarStatus(ids: readonly string[], status: StatusDoPar): Promise<number> {
    if (ids.length === 0) return 0;
    const alterados = await this.db
      .update(parIdentidade)
      .set({ status, atualizadoEm: new Date() })
      .where(inArray(parIdentidade.id, ids))
      .returning({ id: parIdentidade.id });
    return alterados.length;
  }

  /** Um par por id, com os dois lados. Para a ação da tela validar antes de gravar. */
  async porId(id: string): Promise<ParDaFila | null> {
    const linhas = await this.db
      .select({
        id: parIdentidade.id,
        decisao: parIdentidade.decisao,
        origem: parIdentidade.origem,
        nivel: parIdentidade.nivel,
        confiancaBp: parIdentidade.confiancaBp,
        justificativa: parIdentidade.justificativa,
        inconsistencias: parIdentidade.inconsistencias,
        criadoEm: parIdentidade.criadoEm,
        a: this.aliasLado('a'),
        b: this.aliasLado('b'),
      })
      .from(parIdentidade)
      .innerJoin(produtoExterno, eq(produtoExterno.id, parIdentidade.produtoAId))
      .innerJoin(sql`${produtoExterno} as pb`, sql`pb.id = ${parIdentidade.produtoBId}`)
      .where(eq(parIdentidade.id, id))
      .limit(1);

    const linha = linhas[0];
    if (linha === undefined) return null;
    return {
      ...linha,
      decisao: linha.decisao as Decisao,
      origem: linha.origem as OrigemDaDecisao,
      inconsistencias: Array.isArray(linha.inconsistencias)
        ? (linha.inconsistencias as string[])
        : [],
    };
  }

  /**
   * As colunas de um lado do par.
   *
   * O lado B vem de um alias em `sql` cru porque o mesmo `produto_externo` aparece
   * duas vezes no `join`. É o preço de guardar o par como duas colunas em uma linha —
   * e guardar assim é o que dá a chave única que torna a reexecução idempotente.
   */
  private aliasLado(lado: 'a' | 'b') {
    const p = lado === 'a' ? sql`produto_externo` : sql`pb`;
    return {
      id: sql<string>`${p}.id`,
      tituloBruto: sql<string>`${p}.titulo_bruto`,
      ean: sql<string | null>`${p}.ean`,
      preco: sql<number | null>`${p}.preco`,
      vendedor: sql<string | null>`${p}.vendedor`,
      plataformaOuSite: sql<string | null>`${p}.plataforma_ou_site`,
      url: sql<string | null>`${p}.url`,
      formaCanonica: sql<string | null>`${p}.forma_canonica`,
      skuId: sql<string | null>`${p}.sku_id`,
    };
  }
}
