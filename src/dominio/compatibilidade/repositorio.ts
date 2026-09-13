/**
 * Persistência de aparelho, evidência e compatibilidade resolvida.
 *
 * Duas responsabilidades, e a separação importa: **gravar evidência** é acumular
 * afirmação com procedência, e **resolver** é recalcular a decisão a partir de
 * tudo que se acumulou. Gravar nunca decide sozinho — toda gravação recalcula a
 * linha inteira, então a ordem de chegada das fontes não muda o resultado.
 *
 * ## Aparelho é base compartilhada, compatibilidade também
 *
 * Nenhum dos dois carrega `perfil_id` (ADR 0003): "o refil serve no PA26G" é
 * verdade sobre o mundo, não sobre o vendedor, e o dia em que houver um segundo
 * perfil ele herda o grafo inteiro. O `sku_id` é que é do perfil, e o filtro por
 * perfil entra quando se lê pelo SKU.
 */
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Fonte } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { aparelho, compatibilidade, sku } from '@/infra/banco/schema';
import { lerEvidencias, type Evidencia } from './evidencia';
import { analisarModelo, type RegistroDeGramaticas } from './gramatica';
import { GRAMATICAS_SEMENTE } from './gramaticas';
import {
  LIMIAR_PUBLICACAO_BP,
  resolverCompatibilidade,
  type Decisao,
  type Resolucao,
} from './resolucao';

export interface DadosDoAparelho {
  readonly tipo: string;
  readonly marca: string;
  readonly modelo: string;
  readonly variante?: string | null;
  readonly anoDe?: number | null;
  readonly anoAte?: number | null;
  readonly fonte: Fonte;
  readonly origemUrl?: string | null;
}

export interface AparelhoGravado {
  readonly id: string;
  readonly tipo: string;
  readonly marca: string;
  readonly modelo: string;
  readonly variante: string | null;
  readonly familia: string | null;
  readonly linhagem: string | null;
}

/** Como o aparelho aparece na tela e na explicação de auditoria. */
export function rotuloDoAparelho(a: {
  readonly marca: string;
  readonly modelo: string;
  readonly variante?: string | null;
}): string {
  const variante = a.variante ?? null;
  return variante === null || variante === ''
    ? `${a.marca} ${a.modelo}`
    : `${a.marca} ${a.modelo} ${variante}`;
}

export interface CompatibilidadeGravada {
  readonly skuId: string;
  readonly aparelhoId: string;
  readonly decisao: Decisao;
  readonly confiancaBp: number;
  readonly conflito: string | null;
  readonly evidencias: readonly Evidencia[];
  readonly aparelho: AparelhoGravado;
}

export class RepositorioDeCompatibilidade {
  constructor(
    private readonly db: Banco,
    private readonly gramaticas: RegistroDeGramaticas = GRAMATICAS_SEMENTE,
  ) {}

  /**
   * Grava o aparelho, ou devolve o existente, sempre recalculando família.
   *
   * Família e linhagem são **derivadas** da gramática, e recalcular em toda
   * gravação é o que faz uma correção de gramática valer para o cadastro antigo.
   * Se fossem só escritas na criação, corrigir a gramática deixaria o banco com
   * dois agrupamentos diferentes conforme a data do cadastro.
   */
  async garantirAparelho(dados: DadosDoAparelho): Promise<AparelhoGravado> {
    const analise = analisarModelo(dados.marca, dados.modelo, this.gramaticas);
    const derivado = analise.ok
      ? { familia: analise.analise.familia, linhagem: analise.analise.linhagem }
      : { familia: null, linhagem: null };

    const valores = {
      tipo: dados.tipo,
      marca: dados.marca,
      modelo: dados.modelo,
      variante: dados.variante ?? null,
      anoDe: dados.anoDe ?? null,
      anoAte: dados.anoAte ?? null,
      familia: derivado.familia,
      linhagem: derivado.linhagem,
      fonte: dados.fonte,
      origemUrl: dados.origemUrl ?? null,
    };

    const gravados = await this.db
      .insert(aparelho)
      .values(valores)
      .onConflictDoUpdate({
        target: [aparelho.tipo, aparelho.marca, aparelho.modelo, aparelho.variante],
        set: {
          familia: derivado.familia,
          linhagem: derivado.linhagem,
          atualizadoEm: new Date(),
        },
      })
      .returning({
        id: aparelho.id,
        tipo: aparelho.tipo,
        marca: aparelho.marca,
        modelo: aparelho.modelo,
        variante: aparelho.variante,
        familia: aparelho.familia,
        linhagem: aparelho.linhagem,
      });

    const criado = gravados[0];
    if (criado !== undefined) return criado;

    // `variante` nulo não casa em `on conflict` por igualdade de NULL, então o
    // upsert pode não devolver linha. Buscar é o caminho correto, não erro.
    const achado = await this.buscarAparelho(dados);
    if (achado === null) {
      throw new Error(`aparelho ${rotuloDoAparelho(dados)} não gravou e não existe`);
    }
    return achado;
  }

  async buscarAparelho(dados: {
    readonly tipo: string;
    readonly marca: string;
    readonly modelo: string;
    readonly variante?: string | null;
  }): Promise<AparelhoGravado | null> {
    const variante = dados.variante ?? null;
    const linhas = await this.db
      .select({
        id: aparelho.id,
        tipo: aparelho.tipo,
        marca: aparelho.marca,
        modelo: aparelho.modelo,
        variante: aparelho.variante,
        familia: aparelho.familia,
        linhagem: aparelho.linhagem,
      })
      .from(aparelho)
      .where(
        and(
          eq(aparelho.tipo, dados.tipo),
          eq(aparelho.marca, dados.marca),
          eq(aparelho.modelo, dados.modelo),
          variante === null ? sql`${aparelho.variante} is null` : eq(aparelho.variante, variante),
        ),
      )
      .limit(1);
    return linhas[0] ?? null;
  }

  /** Todos os aparelhos, para a tela e para o casamento por código de modelo. */
  async aparelhos(limite = 500): Promise<readonly AparelhoGravado[]> {
    return this.db
      .select({
        id: aparelho.id,
        tipo: aparelho.tipo,
        marca: aparelho.marca,
        modelo: aparelho.modelo,
        variante: aparelho.variante,
        familia: aparelho.familia,
        linhagem: aparelho.linhagem,
      })
      .from(aparelho)
      .orderBy(aparelho.marca, aparelho.modelo)
      .limit(limite);
  }

  /**
   * Acrescenta evidência e recalcula a linha.
   *
   * Evidência igual não duplica: mesmo tipo, mesma URL e mesmo lado já registrados
   * atualizam a data e nada mais. Sem isso, reexecutar o coletor inflaria a
   * confiança a cada passada — e a passada é automática, então inflaria sozinha.
   */
  async registrarEvidencia(params: {
    readonly skuId: string;
    readonly aparelhoId: string;
    readonly evidencia: Evidencia;
  }): Promise<{ readonly resolucao: Resolucao; readonly nova: boolean }> {
    const atual = await this.db
      .select({ evidencias: compatibilidade.evidencias })
      .from(compatibilidade)
      .where(
        and(
          eq(compatibilidade.skuId, params.skuId),
          eq(compatibilidade.aparelhoId, params.aparelhoId),
        ),
      )
      .limit(1);

    const anteriores = lerEvidencias(atual[0]?.evidencias ?? []);
    const mesma = (e: Evidencia) =>
      e.tipo === params.evidencia.tipo &&
      e.url === params.evidencia.url &&
      e.negativa === params.evidencia.negativa;
    const nova = !anteriores.some(mesma);
    const evidencias = nova
      ? [...anteriores, params.evidencia]
      : anteriores.map((e) => (mesma(e) ? params.evidencia : e));

    const resolucao = resolverCompatibilidade(evidencias);
    await this.gravarResolucao({ ...params, evidencias, resolucao });
    return { resolucao, nova };
  }

  /** Grava a linha resolvida. Separado porque a inferência também escreve. */
  async gravarResolucao(params: {
    readonly skuId: string;
    readonly aparelhoId: string;
    readonly evidencias: readonly Evidencia[];
    readonly resolucao: Resolucao;
  }): Promise<void> {
    const valores = {
      skuId: params.skuId,
      aparelhoId: params.aparelhoId,
      decisao: params.resolucao.decisao,
      confiancaBp: params.resolucao.confiancaBp,
      evidencias: [...params.evidencias],
      verificadoPor: params.resolucao.verificadoPor,
      verificadoEm: params.resolucao.verificadoPor === 'humano' ? new Date() : null,
      conflito: params.resolucao.conflito,
    };
    await this.db
      .insert(compatibilidade)
      .values(valores)
      .onConflictDoUpdate({
        target: [compatibilidade.skuId, compatibilidade.aparelhoId],
        set: { ...valores, atualizadoEm: new Date() },
      });
  }

  /** Tudo que se sabe sobre um SKU, com o aparelho já junto. */
  async doSku(skuId: string): Promise<readonly CompatibilidadeGravada[]> {
    const linhas = await this.db
      .select({
        skuId: compatibilidade.skuId,
        aparelhoId: compatibilidade.aparelhoId,
        decisao: compatibilidade.decisao,
        confiancaBp: compatibilidade.confiancaBp,
        conflito: compatibilidade.conflito,
        evidencias: compatibilidade.evidencias,
        aparelhoTipo: aparelho.tipo,
        aparelhoMarca: aparelho.marca,
        aparelhoModelo: aparelho.modelo,
        aparelhoVariante: aparelho.variante,
        aparelhoFamilia: aparelho.familia,
        aparelhoLinhagem: aparelho.linhagem,
      })
      .from(compatibilidade)
      .innerJoin(aparelho, eq(aparelho.id, compatibilidade.aparelhoId))
      .where(eq(compatibilidade.skuId, skuId))
      .orderBy(desc(compatibilidade.confiancaBp), aparelho.marca, aparelho.modelo);

    return linhas.map((l) => ({
      skuId: l.skuId,
      aparelhoId: l.aparelhoId,
      decisao: l.decisao,
      confiancaBp: l.confiancaBp,
      conflito: l.conflito,
      evidencias: lerEvidencias(l.evidencias),
      aparelho: {
        id: l.aparelhoId,
        tipo: l.aparelhoTipo,
        marca: l.aparelhoMarca,
        modelo: l.aparelhoModelo,
        variante: l.aparelhoVariante,
        familia: l.aparelhoFamilia,
        linhagem: l.aparelhoLinhagem,
      },
    }));
  }

  /**
   * A fila de revisão do perfil: o que precisa de uma pessoa.
   *
   * Três coisas entram: conflito aberto, indefinido, e "serve" abaixo do corte de
   * publicação — que é onde a inferência de família cai por construção. Ordenada
   * por confiança decrescente pelo mesmo motivo da fila de identidade: o que o
   * sistema quase decidiu é o que se resolve em dois segundos, e resolver os
   * fáceis primeiro é o que faz a fila andar.
   */
  async fila(
    perfil: PerfilId,
    limite = 25,
  ): Promise<readonly (CompatibilidadeGravada & { readonly skuTitulo: string })[]> {
    const linhas = await this.db
      .select({
        skuId: compatibilidade.skuId,
        aparelhoId: compatibilidade.aparelhoId,
        decisao: compatibilidade.decisao,
        confiancaBp: compatibilidade.confiancaBp,
        conflito: compatibilidade.conflito,
        evidencias: compatibilidade.evidencias,
        skuTitulo: sku.tituloInterno,
        aparelhoTipo: aparelho.tipo,
        aparelhoMarca: aparelho.marca,
        aparelhoModelo: aparelho.modelo,
        aparelhoVariante: aparelho.variante,
        aparelhoFamilia: aparelho.familia,
        aparelhoLinhagem: aparelho.linhagem,
      })
      .from(compatibilidade)
      .innerJoin(sku, eq(sku.id, compatibilidade.skuId))
      .innerJoin(aparelho, eq(aparelho.id, compatibilidade.aparelhoId))
      .where(
        and(
          eq(sku.perfilId, perfil),
          ne(compatibilidade.verificadoPor, 'humano'),
          or(
            isNotNull(compatibilidade.conflito),
            eq(compatibilidade.decisao, 'indefinido'),
            and(
              eq(compatibilidade.decisao, 'serve'),
              sql`${compatibilidade.confiancaBp} < ${LIMIAR_PUBLICACAO_BP}`,
            ),
          ),
        ),
      )
      .orderBy(desc(compatibilidade.confiancaBp))
      .limit(limite);

    return linhas.map((l) => ({
      skuId: l.skuId,
      aparelhoId: l.aparelhoId,
      decisao: l.decisao,
      confiancaBp: l.confiancaBp,
      conflito: l.conflito,
      evidencias: lerEvidencias(l.evidencias),
      skuTitulo: l.skuTitulo,
      aparelho: {
        id: l.aparelhoId,
        tipo: l.aparelhoTipo,
        marca: l.aparelhoMarca,
        modelo: l.aparelhoModelo,
        variante: l.aparelhoVariante,
        familia: l.aparelhoFamilia,
        linhagem: l.aparelhoLinhagem,
      },
    }));
  }

  /** Contagem por situação, para a tela dizer o tamanho da base sem varrer tudo. */
  async estado(perfil: PerfilId): Promise<{
    readonly publicaveis: number;
    readonly emRevisao: number;
    readonly comConflito: number;
    readonly naoServe: number;
    readonly aparelhos: number;
  }> {
    const [contagens, aparelhosContados] = await Promise.all([
      this.db
        .select({
          publicaveis: sql<number>`count(*) filter (where ${compatibilidade.decisao} = 'serve' and ${compatibilidade.confiancaBp} >= ${LIMIAR_PUBLICACAO_BP} and ${compatibilidade.conflito} is null)`,
          emRevisao: sql<number>`count(*) filter (where ${compatibilidade.conflito} is not null or ${compatibilidade.decisao} = 'indefinido' or (${compatibilidade.decisao} = 'serve' and ${compatibilidade.confiancaBp} < ${LIMIAR_PUBLICACAO_BP}))`,
          comConflito: sql<number>`count(*) filter (where ${compatibilidade.conflito} is not null)`,
          naoServe: sql<number>`count(*) filter (where ${compatibilidade.decisao} = 'nao_serve')`,
        })
        .from(compatibilidade)
        .innerJoin(sku, eq(sku.id, compatibilidade.skuId))
        .where(eq(sku.perfilId, perfil)),
      this.db.select({ total: sql<number>`count(*)` }).from(aparelho),
    ]);

    const c = contagens[0];
    return {
      publicaveis: Number(c?.publicaveis ?? 0),
      emRevisao: Number(c?.emRevisao ?? 0),
      comConflito: Number(c?.comConflito ?? 0),
      naoServe: Number(c?.naoServe ?? 0),
      aparelhos: Number(aparelhosContados[0]?.total ?? 0),
    };
  }

  /** Aparelhos de um conjunto de ids, para a inferência montar os grupos. */
  async aparelhosPorId(ids: readonly string[]): Promise<readonly AparelhoGravado[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: aparelho.id,
        tipo: aparelho.tipo,
        marca: aparelho.marca,
        modelo: aparelho.modelo,
        variante: aparelho.variante,
        familia: aparelho.familia,
        linhagem: aparelho.linhagem,
      })
      .from(aparelho)
      .where(inArray(aparelho.id, [...ids]));
  }
}
