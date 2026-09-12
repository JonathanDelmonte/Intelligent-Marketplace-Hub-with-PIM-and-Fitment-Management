/**
 * Busca de vizinhos por similaridade vetorial (M3, etapa 5.3).
 *
 * É o passo que transforma "comparar cada produto com cada produto" — que é
 * quadrático e inviável a partir de alguns milhares — em "comparar cada produto com
 * os vinte mais parecidos". O `pgvector` é a razão de o banco ser Postgres e não
 * SQLite (ADR 0006).
 *
 * **O vetor vem da forma canônica, nunca do título bruto.** Título de marketplace é
 * escrito para buscador, e a similaridade entre dois títulos mede sobretudo quanta
 * palavra-chave cada vendedor usou.
 *
 * Este módulo não gera embedding — gerar custa chamada de API, e quem faz isso é o
 * serviço de LLM. Aqui é só guardar, indexar e buscar, e é por isso que a suíte
 * exercita a busca inteira com **vetor sintético**, sem chave e sem rede.
 */
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { embedding, produtoExterno } from '@/infra/banco/schema';
import { DIMENSAO_EMBEDDING } from '@/infra/banco/schema/infra';

export { DIMENSAO_EMBEDDING };

/**
 * Distância de corte para um vizinho virar candidato.
 *
 * Distância de cosseno: 0 é idêntico, 1 é ortogonal, 2 é oposto. `0.35` é o ponto
 * a partir do qual o par deixa de valer o julgamento — e é um número **não
 * calibrado**, porque calibrar exige uma base com embedding de verdade, que exige
 * chave. Está aqui como constante nomeada, em um lugar, justamente para ser
 * ajustado quando houver com o que medir.
 */
export const DISTANCIA_MAXIMA_PADRAO = 0.35;

/** Quantos vizinhos considerar por produto. Acima disso o ganho não paga o custo. */
export const VIZINHOS_PADRAO = 20;

export class EmbeddingInvalido extends Error {
  override readonly name = 'EmbeddingInvalido';
}

export interface Vizinho {
  readonly produtoExternoId: string;
  readonly textoCanonico: string;
  /** Distância de cosseno. Menor é mais parecido. */
  readonly distancia: number;
}

/**
 * Valida o vetor antes de ele chegar ao Postgres.
 *
 * Três motivos para não deixar o banco recusar:
 *
 * - **Dimensão errada** dá erro de tipo do Postgres, que chega ao log como
 *   "expected 1536 dimensions" sem dizer de qual produto.
 * - **`NaN` ou `Infinity`** o `pgvector` aceita e depois contamina toda distância
 *   calculada contra esse vetor, silenciosamente.
 * - **Vetor nulo** (todos os componentes zero) faz a distância de cosseno dividir
 *   por zero. O `pgvector` devolve `NaN`, e `NaN` ordena de forma imprevisível.
 */
export function validarVetor(vetor: readonly number[]): void {
  if (vetor.length !== DIMENSAO_EMBEDDING) {
    throw new EmbeddingInvalido(
      `embedding precisa de ${String(DIMENSAO_EMBEDDING)} dimensões, recebeu ${String(vetor.length)}`,
    );
  }
  let soma = 0;
  for (const componente of vetor) {
    if (!Number.isFinite(componente)) {
      throw new EmbeddingInvalido('embedding contém NaN ou Infinity');
    }
    soma += componente * componente;
  }
  if (soma === 0) {
    throw new EmbeddingInvalido(
      'embedding com todos os componentes zero: distância de cosseno seria indefinida',
    );
  }
}

/**
 * Distância de cosseno entre a coluna e um vetor informado.
 *
 * O literal é montado à mão e **castado para `vector`**, em vez de usar o helper
 * `cosineDistance` do Drizzle. A razão apareceu como erro do Postgres: o parâmetro
 * chega como `double precision` e o operador `<=>` não existe para
 * `vector <=> double precision`. O `customType` do schema sabe converter na
 * escrita, e não em parâmetro de `sql` cru.
 *
 * E a expressão inteira vai entre parênteses porque `::float8` grudaria no último
 * token — que é o parâmetro, não a conta.
 */
function distanciaDeCosseno(vetor: readonly number[]) {
  return sql`${embedding.vetor} <=> ${`[${vetor.join(',')}]`}::vector`;
}

export class RepositorioDeEmbeddings {
  constructor(private readonly db: Banco) {}

  /**
   * Grava o embedding de um produto.
   *
   * Chave única em `(produto_externo_id, modelo)`: regravar com o mesmo modelo
   * atualiza, e trocar de modelo **acrescenta linha** em vez de sobrescrever — o
   * que permite comparar dois modelos de embedding na mesma base antes de escolher.
   */
  async gravar(params: {
    readonly produtoExternoId: string;
    readonly textoCanonico: string;
    readonly modelo: string;
    readonly vetor: readonly number[];
  }): Promise<void> {
    validarVetor(params.vetor);

    await this.db
      .insert(embedding)
      .values({
        produtoExternoId: params.produtoExternoId,
        textoCanonico: params.textoCanonico,
        modelo: params.modelo,
        vetor: [...params.vetor],
      })
      .onConflictDoUpdate({
        target: [embedding.produtoExternoId, embedding.modelo],
        set: {
          textoCanonico: params.textoCanonico,
          vetor: [...params.vetor],
          criadoEm: new Date(),
        },
      });
  }

  /** Os vizinhos mais próximos de um vetor, do mais parecido para o menos. */
  async vizinhosDeVetor(params: {
    readonly vetor: readonly number[];
    readonly modelo: string;
    readonly limite?: number;
    readonly distanciaMaxima?: number;
    /** Produto a excluir do resultado: normalmente ele mesmo. */
    readonly excluirProdutoId?: string | undefined;
  }): Promise<readonly Vizinho[]> {
    validarVetor(params.vetor);

    const distancia = distanciaDeCosseno(params.vetor);
    const corte = params.distanciaMaxima ?? DISTANCIA_MAXIMA_PADRAO;

    const condicoes = [eq(embedding.modelo, params.modelo), sql`${distancia} <= ${corte}`];
    if (params.excluirProdutoId !== undefined) {
      condicoes.push(ne(embedding.produtoExternoId, params.excluirProdutoId));
    }

    const linhas = await this.db
      .select({
        produtoExternoId: embedding.produtoExternoId,
        textoCanonico: embedding.textoCanonico,
        distancia: sql<number>`(${distancia})::float8`,
      })
      .from(embedding)
      .where(and(...condicoes))
      .orderBy(distancia)
      .limit(params.limite ?? VIZINHOS_PADRAO);

    return linhas;
  }

  /**
   * Os vizinhos de um produto que já tem embedding.
   *
   * Devolve `null` — e não lista vazia — quando o produto não tem embedding no
   * modelo pedido. A diferença importa: lista vazia significa "procurei e não achei
   * parecido", e `null` significa "não pude procurar". Tratar os dois como o mesmo
   * faria um produto sem embedding parecer um produto sem par.
   */
  async vizinhosDe(params: {
    readonly produtoExternoId: string;
    readonly modelo: string;
    readonly limite?: number;
    readonly distanciaMaxima?: number;
  }): Promise<readonly Vizinho[] | null> {
    const linhas = await this.db
      .select({ vetor: embedding.vetor })
      .from(embedding)
      .where(
        and(
          eq(embedding.produtoExternoId, params.produtoExternoId),
          eq(embedding.modelo, params.modelo),
        ),
      )
      .limit(1);

    const proprio = linhas[0];
    if (proprio === undefined) return null;

    return await this.vizinhosDeVetor({
      vetor: proprio.vetor,
      modelo: params.modelo,
      excluirProdutoId: params.produtoExternoId,
      ...(params.limite === undefined ? {} : { limite: params.limite }),
      ...(params.distanciaMaxima === undefined ? {} : { distanciaMaxima: params.distanciaMaxima }),
    });
  }

  /**
   * A fila de trabalho: produtos com forma canônica e sem embedding neste modelo.
   *
   * É o que um job de embedding consome. Exige forma canônica não vazia porque
   * gerar vetor de string vazia custa token para produzir um vizinho de todos os
   * outros vetores vazios.
   */
  async semEmbedding(params: {
    readonly modelo: string;
    readonly limite?: number;
  }): Promise<readonly { readonly id: string; readonly formaCanonica: string }[]> {
    const jaTem = this.db
      .select({ id: embedding.produtoExternoId })
      .from(embedding)
      .where(eq(embedding.modelo, params.modelo));

    const linhas = await this.db
      .select({ id: produtoExterno.id, formaCanonica: produtoExterno.formaCanonica })
      .from(produtoExterno)
      .where(
        and(
          isNotNull(produtoExterno.formaCanonica),
          ne(produtoExterno.formaCanonica, ''),
          sql`${produtoExterno.id} not in ${jaTem}`,
        ),
      )
      .orderBy(produtoExterno.criadoEm)
      .limit(params.limite ?? 100);

    return linhas.flatMap((l) =>
      l.formaCanonica === null ? [] : [{ id: l.id, formaCanonica: l.formaCanonica }],
    );
  }

  /** Grava a forma canônica calculada. Determinística, então não espera por chave. */
  async gravarFormaCanonica(produtoExternoId: string, formaCanonica: string): Promise<void> {
    await this.db
      .update(produtoExterno)
      .set({ formaCanonica, atualizadoEm: new Date() })
      .where(eq(produtoExterno.id, produtoExternoId));
  }

  /** Produtos sem forma canônica calculada. Roda hoje, sem chave de LLM. */
  async semFormaCanonica(limite = 500): Promise<readonly string[]> {
    const linhas = await this.db
      .select({ id: produtoExterno.id })
      .from(produtoExterno)
      .where(isNull(produtoExterno.formaCanonica))
      .orderBy(produtoExterno.criadoEm)
      .limit(limite);
    return linhas.map((l) => l.id);
  }
}
