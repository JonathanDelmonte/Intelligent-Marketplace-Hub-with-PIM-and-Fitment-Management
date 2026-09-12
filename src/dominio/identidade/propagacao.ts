/**
 * Propagação de SKU pelo grafo de equivalência (M3, a saída que vira dinheiro).
 *
 * A resolução de identidade produz afirmações do tipo "estas duas ocorrências são o
 * mesmo produto". Isso é **conhecimento compartilhado** e não carrega perfil. Ligar
 * uma ocorrência a um `sku` é o contrário: é operacional, o SKU pertence a um perfil,
 * e é criado por decisão humana.
 *
 * Este arquivo é a ponte entre os dois, e a ponte exige `PerfilId` no tipo — ADR
 * 0003 aplicado mecanicamente: sem o perfil o compilador recusa a chamada, porque a
 * mesma ocorrência pode ser o SKU `X` do perfil A e o SKU `Y` do perfil B.
 *
 * O que a propagação entrega, e é o parágrafo da especificação que justifica o
 * módulo inteiro: um SKU com N ocorrências de plataformas e fornecedores diferentes
 * dá **imediatamente** qual fornecedor é mais barato, a que preço o mercado vende, e
 * qual é a margem real.
 */
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Banco } from '@/infra/banco/cliente';
import { parIdentidade, produtoExterno, sku } from '@/infra/banco/schema';

export interface ResultadoDaPropagacao {
  readonly skuId: string;
  /** Ocorrências ligadas agora. */
  readonly ligadas: readonly string[];
  /**
   * Ocorrências equivalentes que **já pertencem a outro SKU**.
   *
   * Não são religadas: duas ocorrências equivalentes em SKUs diferentes significa
   * que ou a equivalência está errada, ou os dois SKUs são o mesmo produto cadastrado
   * duas vezes. Fundir SKU é decisão humana com consequência fiscal e de anúncio, e
   * automação que faz isso sozinha é automação que ninguém consegue auditar depois.
   */
  readonly conflitos: readonly { readonly produtoId: string; readonly skuId: string }[];
}

/**
 * Liga ao SKU toda ocorrência afirmada equivalente às que já estão nele.
 *
 * Um passo por chamada, de propósito: `A ≡ B` e `B ≡ C` não implicam `A ≡ C` sem
 * transitividade, e transitividade automática em grafo de identidade é o caminho
 * conhecido para juntar coisas que ninguém juntaria à mão — basta uma aresta errada
 * para o componente inteiro virar um SKU. Quem quiser fechar o fecho transitivo
 * chama de novo e vê o que aparece, com a decisão na mão.
 */
export async function propagarSku(
  db: Banco,
  params: {
    readonly perfil: PerfilId;
    readonly skuId: string;
    /** Confiança mínima da aresta para valer propagação. */
    readonly confiancaMinimaBp?: number;
  },
): Promise<ResultadoDaPropagacao> {
  const alvo = await db
    .select({ id: sku.id })
    .from(sku)
    .where(and(eq(sku.perfilId, params.perfil), eq(sku.id, params.skuId)))
    .limit(1);

  if (alvo[0] === undefined) {
    throw new Error(`SKU ${params.skuId} não existe neste perfil`);
  }

  const ancoras = await db
    .select({ id: produtoExterno.id })
    .from(produtoExterno)
    .where(eq(produtoExterno.skuId, params.skuId));

  if (ancoras.length === 0) {
    return { skuId: params.skuId, ligadas: [], conflitos: [] };
  }

  const idsAncora = ancoras.map((a) => a.id);
  const minima = params.confiancaMinimaBp ?? 0;

  // Arestas de equivalência que toquem uma âncora. `decisao = 'mesmo'` cobre o que
  // o determinístico, o LLM acima do limiar e uma pessoa afirmaram — os três viram
  // a mesma aresta, e é por isso que a origem fica gravada na linha.
  const arestas = await db
    .select({
      a: parIdentidade.produtoAId,
      b: parIdentidade.produtoBId,
      origem: parIdentidade.origem,
      confiancaBp: parIdentidade.confiancaBp,
    })
    .from(parIdentidade)
    .where(
      and(
        eq(parIdentidade.decisao, 'mesmo'),
        ne(parIdentidade.status, 'descartado'),
        or(
          inArray(parIdentidade.produtoAId, idsAncora),
          inArray(parIdentidade.produtoBId, idsAncora),
        ),
      ),
    );

  const conjuntoAncora = new Set(idsAncora);
  const equivalentes = new Set<string>();
  for (const aresta of arestas) {
    if (aresta.origem !== 'humano' && aresta.confiancaBp < minima) continue;
    const outro = conjuntoAncora.has(aresta.a) ? aresta.b : aresta.a;
    if (!conjuntoAncora.has(outro)) equivalentes.add(outro);
  }

  if (equivalentes.size === 0) {
    return { skuId: params.skuId, ligadas: [], conflitos: [] };
  }

  const alvos = [...equivalentes];

  const jaComOutroSku = await db
    .select({ id: produtoExterno.id, skuId: produtoExterno.skuId })
    .from(produtoExterno)
    .where(and(inArray(produtoExterno.id, alvos), sql`${produtoExterno.skuId} is not null`));

  const conflitos = jaComOutroSku.flatMap((l) =>
    l.skuId === null || l.skuId === params.skuId ? [] : [{ produtoId: l.id, skuId: l.skuId }],
  );

  const ligadas = await db
    .update(produtoExterno)
    .set({ skuId: params.skuId, atualizadoEm: new Date() })
    .where(and(inArray(produtoExterno.id, alvos), isNull(produtoExterno.skuId)))
    .returning({ id: produtoExterno.id });

  return { skuId: params.skuId, ligadas: ligadas.map((l) => l.id), conflitos };
}

/**
 * As ocorrências de um SKU com preço, para a comparação que interessa.
 *
 * Ordenado por preço: a primeira linha é o fornecedor mais barato que o grafo
 * conhece, e a última é o preço mais alto que o mercado está praticando. É a resposta
 * que o grafo de identidade existe para dar.
 */
export async function ocorrenciasDoSku(
  db: Banco,
  perfil: PerfilId,
  skuId: string,
): Promise<
  readonly {
    readonly id: string;
    readonly tituloBruto: string;
    readonly preco: number | null;
    readonly vendedor: string | null;
    readonly plataformaOuSite: string | null;
    readonly fonte: string;
    readonly coletadoEm: Date;
  }[]
> {
  const existe = await db
    .select({ id: sku.id })
    .from(sku)
    .where(and(eq(sku.perfilId, perfil), eq(sku.id, skuId)))
    .limit(1);
  if (existe[0] === undefined) return [];

  return await db
    .select({
      id: produtoExterno.id,
      tituloBruto: produtoExterno.tituloBruto,
      preco: produtoExterno.preco,
      vendedor: produtoExterno.vendedor,
      plataformaOuSite: produtoExterno.plataformaOuSite,
      fonte: produtoExterno.fonte,
      coletadoEm: produtoExterno.coletadoEm,
    })
    .from(produtoExterno)
    .where(eq(produtoExterno.skuId, skuId))
    .orderBy(sql`${produtoExterno.preco} asc nulls last`);
}
