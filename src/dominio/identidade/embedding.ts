/**
 * Geração de embedding em lote (M3, etapa 5.2).
 *
 * A busca de vizinhos por `pgvector` (5.3) estava pronta e exercitada com vetor
 * sintético; faltava o vetor. Ele vem da **forma canônica** — `tipo + marca + modelo
 * normalizado` —, nunca do título bruto, que mede quanta palavra-chave cada vendedor
 * usou (`vizinhos.ts`).
 *
 * ## Gratuito, em lote, e sem repetir
 *
 * O modelo padrão é gratuito (CLAUDE.md, 3.7) e a cota é a mesma dos outros modelos
 * gratuitos, então: cinquenta textos por pedido, e texto que já tem vetor neste modelo
 * não vai de novo — o mesmo refil vendido por dez vendedores tem a mesma forma canônica,
 * e um vetor serve aos dez.
 *
 * ## O tamanho do vetor
 *
 * O índice guarda 1536 dimensões (`DIMENSAO_EMBEDDING`), e o modelo gratuito devolve
 * menos — 1024. O vetor é completado com zeros, e isso não muda nada do que se mede: a
 * distância de cosseno só enxerga o produto interno e as normas, e zero não soma em
 * nenhum dos dois. Vetor de um modelo nunca é comparado com vetor de outro, porque a
 * busca filtra pelo modelo. Maior que o índice é recusado: cortar mudaria a distância.
 */
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { embedding, produtoExterno } from '@/infra/banco/schema';
import type { ServicoDeLlm } from '@/infra/llm';
import { ResolvedorDeIdentidade } from './resolucao';
import {
  DIMENSAO_EMBEDDING,
  EmbeddingInvalido,
  RepositorioDeEmbeddings,
  validarVetor,
} from './vizinhos';

/** Textos por pedido. Forma canônica é curta: cinquenta cabem com folga. */
export const TAMANHO_DO_LOTE_DE_EMBEDDING = 50;

/**
 * O vetor no tamanho do índice, completado com zeros.
 *
 * Lança `EmbeddingInvalido` quando o vetor é maior que o índice, ou inválido — `NaN`,
 * tudo zero —, com o motivo.
 */
export function noTamanhoDoIndice(vetor: readonly number[]): number[] {
  if (vetor.length > DIMENSAO_EMBEDDING) {
    throw new EmbeddingInvalido(
      `o modelo devolveu ${String(vetor.length)} dimensões, e o índice guarda ${String(DIMENSAO_EMBEDDING)}: escolha outro modelo de embedding.`,
    );
  }
  const completo = [...vetor, ...new Array<number>(DIMENSAO_EMBEDDING - vetor.length).fill(0)];
  validarVetor(completo);
  return completo;
}

export interface OpcoesDoGerador {
  readonly llm: ServicoDeLlm;
  readonly modelo: string;
}

export type ResultadoDoEmbedding =
  | { readonly tipo: 'nada_a_gerar' }
  | {
      readonly tipo: 'lote';
      readonly selecionados: number;
      /** Produtos que ganharam vetor copiado de outro de mesma forma canônica. */
      readonly copiados: number;
      /** Textos distintos que foram ao modelo. */
      readonly enviados: number;
      /** Produtos com vetor novo — os que a resolução de identidade precisa rever. */
      readonly gerados: readonly string[];
      /** Produtos cujo vetor veio inválido: marcados, e não voltam sozinhos. */
      readonly recusados: number;
      readonly chamada: 'feita' | 'nenhuma' | 'sem_chave' | 'nao_suportado' | 'erro';
      readonly erro?: string | undefined;
    };

interface Pendente {
  readonly id: string;
  readonly texto: string;
}

export class GeradorDeEmbeddings {
  private readonly repositorio: RepositorioDeEmbeddings;

  constructor(
    private readonly db: Banco,
    private readonly opcoes: OpcoesDoGerador,
  ) {
    this.repositorio = new RepositorioDeEmbeddings(db);
  }

  /**
   * Gera um lote: no máximo um pedido ao modelo.
   *
   * Propaga `ExecucaoInterrompida` — cota ou teto —, e o que foi copiado antes dela já
   * está gravado. O resto volta como valor.
   */
  async gerarLote(): Promise<ResultadoDoEmbedding> {
    // O determinístico antes: forma canônica ainda não calculada é calculada aqui, de
    // graça. Sem isso ela esperava o job de identidade de cada produto, e o vetor saía
    // um pedido por produto — o teste de ponta a ponta pegou.
    await new ResolvedorDeIdentidade(this.db).prepararLote(TAMANHO_DO_LOTE_DE_EMBEDDING);

    const pendentes = await this.selecionar();
    if (pendentes.length === 0) return { tipo: 'nada_a_gerar' };

    const textos = [...new Set(pendentes.map((p) => p.texto))];
    const gerados: string[] = [];
    let copiados = 0;

    // Texto que já tem vetor neste modelo: copia, sem perguntar.
    const existentes = await this.vetoresPorTexto(textos);
    for (const pendente of pendentes) {
      const vetor = existentes.get(pendente.texto);
      if (vetor === undefined) continue;
      await this.repositorio.gravar({
        produtoExternoId: pendente.id,
        textoCanonico: pendente.texto,
        modelo: this.opcoes.modelo,
        vetor,
      });
      gerados.push(pendente.id);
      copiados += 1;
    }

    const aPedir = textos.filter((t) => !existentes.has(t));
    const base = { tipo: 'lote' as const, selecionados: pendentes.length, copiados };
    if (aPedir.length === 0) {
      return { ...base, enviados: 0, gerados, recusados: 0, chamada: 'nenhuma' };
    }

    const resultado = await this.opcoes.llm.gerarEmbeddings({
      modelo: this.opcoes.modelo,
      textos: aPedir,
    });
    if (resultado.tipo !== 'ok') {
      return {
        ...base,
        enviados: aPedir.length,
        gerados,
        recusados: 0,
        chamada: resultado.tipo,
        ...(resultado.tipo === 'erro' ? { erro: resultado.mensagem } : {}),
      };
    }

    let recusados = 0;
    for (const [indice, texto] of aPedir.entries()) {
      const bruto = resultado.vetores[indice] ?? [];
      const donos = pendentes.filter((p) => p.texto === texto);
      let vetor: number[];
      try {
        vetor = noTamanhoDoIndice(bruto);
      } catch (erro) {
        if (!(erro instanceof EmbeddingInvalido)) throw erro;
        for (const dono of donos) await this.recusar(dono.id, erro.message);
        recusados += donos.length;
        continue;
      }
      for (const dono of donos) {
        await this.repositorio.gravar({
          produtoExternoId: dono.id,
          textoCanonico: texto,
          modelo: this.opcoes.modelo,
          vetor,
        });
        gerados.push(dono.id);
      }
    }

    return { ...base, enviados: aPedir.length, gerados, recusados, chamada: 'feita' };
  }

  /**
   * Quem espera vetor neste modelo: com forma canônica, sem vetor, e sem recusa
   * registrada para este modelo.
   *
   * Forma canônica vazia fica de fora: vetor de texto vazio seria vizinho de todos os
   * outros vetores vazios.
   */
  private async selecionar(): Promise<readonly Pendente[]> {
    const linhas = await this.db
      .select({ id: produtoExterno.id, texto: produtoExterno.formaCanonica })
      .from(produtoExterno)
      .where(
        and(
          isNotNull(produtoExterno.formaCanonica),
          ne(produtoExterno.formaCanonica, ''),
          sql`not exists (
            select 1 from ${embedding} e
            where e.produto_externo_id = ${produtoExterno.id} and e.modelo = ${this.opcoes.modelo}
          )`,
          sql`coalesce(${produtoExterno.atributosExtraidos}->'embeddingRecusado'->>'modelo', '') <> ${this.opcoes.modelo}`,
        ),
      )
      .orderBy(asc(produtoExterno.criadoEm), asc(produtoExterno.id))
      .limit(TAMANHO_DO_LOTE_DE_EMBEDDING);

    return linhas.flatMap((l) => (l.texto === null ? [] : [{ id: l.id, texto: l.texto }]));
  }

  private async vetoresPorTexto(
    textos: readonly string[],
  ): Promise<ReadonlyMap<string, readonly number[]>> {
    const mapa = new Map<string, readonly number[]>();
    if (textos.length === 0) return mapa;
    const linhas = await this.db
      .select({ texto: embedding.textoCanonico, vetor: embedding.vetor })
      .from(embedding)
      .where(
        and(
          eq(embedding.modelo, this.opcoes.modelo),
          inArray(embedding.textoCanonico, [...textos]),
        ),
      );
    for (const linha of linhas) {
      if (!mapa.has(linha.texto)) mapa.set(linha.texto, linha.vetor);
    }
    return mapa;
  }

  /** Vetor inválido para este produto: marcado, com o motivo, e fora da fila deste modelo. */
  private async recusar(produtoId: string, motivo: string): Promise<void> {
    const recusa = { modelo: this.opcoes.modelo, motivo, em: new Date().toISOString() };
    await this.db
      .update(produtoExterno)
      .set({
        atributosExtraidos: sql`coalesce(${produtoExterno.atributosExtraidos}, '{}'::jsonb) || jsonb_build_object('embeddingRecusado', ${JSON.stringify(recusa)}::jsonb)`,
        atualizadoEm: new Date(),
      })
      .where(eq(produtoExterno.id, produtoId));
  }
}
