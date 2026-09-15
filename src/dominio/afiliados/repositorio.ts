/**
 * Persistência das ofertas de afiliado (M13).
 *
 * A tabela `afiliado_oferta` existia desde a fase 0 e ninguém escrevia nela — mesmo
 * caso do `monitor_evento`. As regras da fase 11 (teto de oito por dia, espaçamento de
 * 45 minutos, conversão nula sem clique) eram puras e não tinham de onde ler.
 *
 * ## O que é gravado e o que é calculado
 *
 * Grava-se o link já com a tag, o preço, a referência contra a qual o desconto foi
 * medido, e **o score**: o desconto real em pontos-base. O score é gravado porque é a
 * afirmação daquele momento — a mediana de 90 dias muda amanhã, e recalcular o score
 * de uma oferta publicada semana passada reescreveria o passado.
 *
 * A **ordem** da fila, a decisão de publicar agora ou esperar, e o desempenho saem de
 * funções puras em `publicacao.ts`.
 *
 * `afiliado_oferta` não carrega `perfil_id`: é oferta do mercado, base compartilhada
 * (CLAUDE.md, seção 3.4) — o que é do perfil é a tag, e ela vive em ambiente.
 */
import { desc, eq, isNull, sql } from 'drizzle-orm';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { afiliadoOferta } from '@/infra/banco/schema';
import { centavos, pontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';
import type { OfertaMedida, OfertaNaFila } from './publicacao';

/** Uma oferta como ela chega da tela. */
export interface OfertaParaGravar {
  readonly plataforma: Plataforma;
  /** URL já com a tag de afiliado. */
  readonly urlAfiliado: string;
  readonly preco: Centavos;
  readonly precoAnterior?: Centavos | null;
  readonly medianaNoventaDias?: Centavos | null;
  readonly scoreDescontoBp: PontosBase;
  readonly skuExterno?: string | null;
  readonly comissaoBp?: number | null;
}

/** Uma oferta do jeito que a tela mostra, com o que a fila e o desempenho precisam. */
export interface OfertaGravada extends OfertaNaFila, OfertaMedida {
  readonly urlAfiliado: string;
  readonly preco: Centavos;
  readonly precoAnterior: Centavos | null;
  readonly medianaNoventaDias: Centavos | null;
  readonly skuExterno: string | null;
}

export class RepositorioDeOfertas {
  constructor(private readonly db: Banco) {}

  async registrar(oferta: OfertaParaGravar, fonte: Fonte = 'manual'): Promise<string> {
    const inseridas = await this.db
      .insert(afiliadoOferta)
      .values({
        plataforma: oferta.plataforma,
        urlAfiliado: oferta.urlAfiliado,
        preco: oferta.preco,
        precoAnterior: oferta.precoAnterior ?? null,
        medianaNoventaDias: oferta.medianaNoventaDias ?? null,
        scoreDescontoBp: oferta.scoreDescontoBp,
        skuExterno: oferta.skuExterno ?? null,
        comissaoBp: oferta.comissaoBp ?? null,
        fonte,
      })
      .returning({ id: afiliadoOferta.id });

    const id = inseridas[0]?.id;
    if (id === undefined) throw new Error('a oferta não foi gravada');
    return id;
  }

  /**
   * A fila inteira: pendentes e publicadas.
   *
   * Inteira de propósito. `proximaPublicacao` precisa do que **já foi publicado** para
   * contar o teto do dia e medir o intervalo desde a última — uma consulta que
   * devolvesse só as pendentes faria a função decidir sem os dados dela.
   */
  async fila(limite = 100): Promise<readonly OfertaGravada[]> {
    const linhas = await this.db
      .select({
        id: afiliadoOferta.id,
        plataforma: afiliadoOferta.plataforma,
        urlAfiliado: afiliadoOferta.urlAfiliado,
        preco: afiliadoOferta.preco,
        precoAnterior: afiliadoOferta.precoAnterior,
        medianaNoventaDias: afiliadoOferta.medianaNoventaDias,
        scoreDescontoBp: afiliadoOferta.scoreDescontoBp,
        skuExterno: afiliadoOferta.skuExterno,
        publicadoEmGrupo: afiliadoOferta.publicadoEmGrupo,
        cliques: afiliadoOferta.cliques,
        conversoes: afiliadoOferta.conversoes,
      })
      .from(afiliadoOferta)
      .orderBy(desc(afiliadoOferta.scoreDescontoBp), desc(afiliadoOferta.criadoEm))
      .limit(limite);

    return linhas.map((l): OfertaGravada => ({
      id: l.id,
      plataforma: l.plataforma,
      urlAfiliado: l.urlAfiliado,
      preco: centavos(l.preco),
      precoAnterior: l.precoAnterior === null ? null : centavos(l.precoAnterior),
      medianaNoventaDias: l.medianaNoventaDias === null ? null : centavos(l.medianaNoventaDias),
      scoreDescontoBp: pontosBase(l.scoreDescontoBp ?? 0),
      skuExterno: l.skuExterno,
      publicadoEmGrupo: l.publicadoEmGrupo,
      cliques: l.cliques,
      conversoes: l.conversoes,
    }));
  }

  /**
   * Marca como publicada.
   *
   * Só marca o que ainda não estava publicado: clicar duas vezes no botão não pode
   * reescrever a hora da publicação, porque é dela que sai o espaçamento de 45 minutos.
   */
  async marcarPublicada(id: string, quando: Date): Promise<boolean> {
    const alteradas = await this.db
      .update(afiliadoOferta)
      .set({ publicadoEmGrupo: quando, atualizadoEm: new Date() })
      .where(sql`${afiliadoOferta.id} = ${id} and ${afiliadoOferta.publicadoEmGrupo} is null`)
      .returning({ id: afiliadoOferta.id });

    return alteradas.length > 0;
  }

  /**
   * Informa clique e conversão, como o painel de afiliado os mostra.
   *
   * Substitui em vez de somar: o painel dá o **total** acumulado, e somar o total de
   * hoje ao de ontem contaria tudo duas vezes.
   */
  async informarDesempenho(
    id: string,
    numeros: { readonly cliques: number; readonly conversoes: number },
  ): Promise<boolean> {
    const alteradas = await this.db
      .update(afiliadoOferta)
      .set({
        cliques: Math.max(0, Math.trunc(numeros.cliques)),
        conversoes: Math.max(0, Math.trunc(numeros.conversoes)),
        atualizadoEm: new Date(),
      })
      .where(eq(afiliadoOferta.id, id))
      .returning({ id: afiliadoOferta.id });

    return alteradas.length > 0;
  }

  /** Quantas ofertas esperam publicação. */
  async pendentes(): Promise<number> {
    const linhas = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(afiliadoOferta)
      .where(isNull(afiliadoOferta.publicadoEmGrupo));
    return linhas[0]?.n ?? 0;
  }
}
