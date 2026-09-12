/**
 * Decisão humana virando exemplo para as chamadas seguintes (M3, etapa 5.6).
 *
 * "Cada decisão humana vira exemplo para os prompts seguintes." É o que faz o
 * sistema ficar mais **inteligente** com uso, e não só maior — a diferença entre
 * acumular base e acumular conhecimento.
 *
 * O exemplo é guardado como par de **formas canônicas**, não de ids: o que ensina o
 * modelo é "estes dois textos descrevem o mesmo produto físico", e o texto viaja
 * entre perfis e sobrevive a apagar o `produto_externo` que o originou.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { exemploIdentidade } from '@/infra/banco/schema';

/**
 * A decisão como uma pessoa a dá.
 *
 * `incerto` existe porque forçar sim/não em quem não sabe produz exemplo errado —
 * e exemplo errado é pior que exemplo nenhum, porque é ensinado com autoridade.
 */
export const DECISOES_HUMANAS = ['sim', 'nao', 'incerto'] as const;
export type DecisaoHumana = (typeof DECISOES_HUMANAS)[number];

export interface Exemplo {
  readonly canonicoA: string;
  readonly canonicoB: string;
  readonly mesmoProduto: 'sim' | 'nao';
  readonly justificativa: string | null;
}

/** Quantos exemplos entram em um prompt. Mais que isso é token sem ganho. */
export const EXEMPLOS_PADRAO = 8;

export class ExemploInvalido extends Error {
  override readonly name = 'ExemploInvalido';
}

/**
 * Ordena o par de textos.
 *
 * A chave única é `(canonico_a, canonico_b)`, então sem ordenação a mesma decisão
 * entra duas vezes — e nada impede que as duas linhas se contradigam. Ordenar é o
 * que faz a chave única significar "uma decisão por par".
 */
export function ordenarCanonicos(a: string, b: string): readonly [string, string] {
  const na = a.trim();
  const nb = b.trim();
  if (na === '' || nb === '') {
    throw new ExemploInvalido('exemplo precisa de forma canônica dos dois lados');
  }
  if (na === nb) {
    throw new ExemploInvalido(`exemplo de um texto com ele mesmo: ${na}`);
  }
  return na < nb ? [na, nb] : [nb, na];
}

export class RepositorioDeExemplos {
  constructor(private readonly db: Banco) {}

  /** Grava a decisão. Decidir de novo o mesmo par atualiza em vez de duplicar. */
  async registrar(dados: {
    readonly canonicoA: string;
    readonly canonicoB: string;
    readonly decisao: DecisaoHumana;
    readonly justificativa?: string | undefined;
  }): Promise<void> {
    const [a, b] = ordenarCanonicos(dados.canonicoA, dados.canonicoB);

    await this.db
      .insert(exemploIdentidade)
      .values({
        canonicoA: a,
        canonicoB: b,
        mesmoProduto: dados.decisao,
        justificativa: dados.justificativa ?? null,
      })
      .onConflictDoUpdate({
        target: [exemploIdentidade.canonicoA, exemploIdentidade.canonicoB],
        set: {
          mesmoProduto: dados.decisao,
          justificativa: dados.justificativa ?? null,
          atualizadoEm: new Date(),
        },
      });
  }

  /**
   * Exemplos para um prompt, **equilibrados entre sim e não**.
   *
   * O equilíbrio não é estética. Um prompt com dez exemplos de "sim" e nenhum de
   * "não" ensina o modelo a dizer sim — e em resolução de identidade o erro de
   * dizer sim é o caro: funde dois produtos em um SKU, e a margem passa a ser
   * calculada sobre o custo do produto errado.
   *
   * Por isso cada lado recebe no máximo metade do limite, e o total pode vir
   * **menor** que o limite. Encher com a classe abundante desfaria o equilíbrio.
   *
   * `incerto` fica fora: não ensina nada, e como exemplo só gasta token.
   */
  async paraPrompt(limite = EXEMPLOS_PADRAO): Promise<readonly Exemplo[]> {
    const metade = Math.max(1, Math.floor(limite / 2));

    const [sim, nao] = await Promise.all([this.doTipo('sim', metade), this.doTipo('nao', metade)]);

    // Intercalado: se o modelo vier a receber a lista truncada por tamanho de
    // contexto, o que sobreviver continua equilibrado.
    const saida: Exemplo[] = [];
    for (let i = 0; i < Math.max(sim.length, nao.length); i += 1) {
      const s = sim[i];
      const n = nao[i];
      if (s !== undefined) saida.push(s);
      if (n !== undefined) saida.push(n);
    }
    return saida;
  }

  private async doTipo(tipo: 'sim' | 'nao', limite: number): Promise<readonly Exemplo[]> {
    const linhas = await this.db
      .select({
        canonicoA: exemploIdentidade.canonicoA,
        canonicoB: exemploIdentidade.canonicoB,
        mesmoProduto: exemploIdentidade.mesmoProduto,
        justificativa: exemploIdentidade.justificativa,
      })
      .from(exemploIdentidade)
      .where(and(eq(exemploIdentidade.mesmoProduto, tipo), ne(exemploIdentidade.canonicoA, '')))
      // Mais recente primeiro: decisão recente reflete a base como ela está hoje.
      .orderBy(sql`${exemploIdentidade.atualizadoEm} desc`)
      .limit(limite);

    return linhas.map((l) => ({ ...l, mesmoProduto: tipo }));
  }

  async contar(): Promise<Readonly<Record<DecisaoHumana, number>>> {
    const linhas = await this.db
      .select({ decisao: exemploIdentidade.mesmoProduto, n: sql<number>`count(*)::int` })
      .from(exemploIdentidade)
      .groupBy(exemploIdentidade.mesmoProduto);

    const saida: Record<DecisaoHumana, number> = { sim: 0, nao: 0, incerto: 0 };
    for (const linha of linhas) {
      if ((DECISOES_HUMANAS as readonly string[]).includes(linha.decisao)) {
        saida[linha.decisao as DecisaoHumana] = linha.n;
      }
    }
    return saida;
  }
}
