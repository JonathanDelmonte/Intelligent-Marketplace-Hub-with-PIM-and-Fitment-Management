/**
 * Persistência das perguntas de comprador (M16).
 *
 * ## Por que guardar, e não só processar o que foi colado
 *
 * O detector precisa de **cinco** perguntas parecidas para acusar o anúncio, e cinco
 * não chegam de uma vez: chegam ao longo de semanas. Processando só o que está na tela
 * naquele instante, o detector praticamente nunca dispararia — e a entrega dele é
 * justamente "esta dúvida repetiu, o anúncio está furado aqui".
 *
 * ## O que é gravado e o que é recalculado
 *
 * Grava-se **o texto cru**. Tema e código de modelo saem de `assuntoDaPergunta` na
 * leitura, porque a gramática de modelo melhora — melhorou duas vezes na fase 6 — e
 * pergunta classificada com a gramática velha ficaria errada para sempre.
 *
 * `perfil_id` em toda query: pergunta é sobre **o seu** anúncio (CLAUDE.md, seção 3.4).
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { perguntaRecebida } from '@/infra/banco/schema';
import type { PerguntaRecebida } from './recorrente';

/** Uma pergunta como ela chega da tela ou de uma planilha do painel. */
export interface PerguntaParaGravar {
  readonly anuncioExterno: string;
  readonly texto: string;
  readonly recebidaEm?: Date;
  /** A loja de onde veio. `null` quando quem colou não disse (ADR 0009). */
  readonly plataforma?: Plataforma | null;
}

export interface ResultadoDoLote {
  readonly gravadas: number;
  /** Já existia com o mesmo texto no mesmo anúncio. Colar a lista duas vezes é normal. */
  readonly repetidas: number;
}

/**
 * Chave de duplicata: texto normalizado.
 *
 * Minúsculas, acento fora e espaço colapsado — a mesma pergunta copiada do painel
 * duas vezes costuma variar só nisso. Pontuação **fica**: "serve na PA21G?" e "serve
 * na PA21G" são a mesma pergunta, mas remover pontuação junto com o resto mudaria
 * pouco e esconderia diferença real em pergunta com número.
 */
export function chaveDaPergunta(texto: string): string {
  const normalizado = texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
  return createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

export class RepositorioDePerguntas {
  constructor(private readonly db: Banco) {}

  /**
   * Grava um lote, ignorando o que já existia.
   *
   * A pessoa cola a lista do painel, e colar de novo amanhã traz as de ontem junto —
   * é o uso normal, não erro. A chave única é perfil, anúncio e texto normalizado, e
   * o conflito é silencioso de propósito: o que interessa devolver é **quantas eram
   * novas**, que é o que a tela diz.
   */
  async registrarLote(
    perfil: PerfilId,
    perguntas: readonly PerguntaParaGravar[],
    fonte: Fonte = 'manual',
  ): Promise<ResultadoDoLote> {
    if (perguntas.length === 0) return { gravadas: 0, repetidas: 0 };

    const gravadas = await this.db
      .insert(perguntaRecebida)
      .values(
        perguntas.map((p) => ({
          perfilId: perfil,
          anuncioExterno: p.anuncioExterno,
          plataforma: p.plataforma ?? null,
          texto: p.texto,
          hashTexto: chaveDaPergunta(p.texto),
          fonte,
          ...(p.recebidaEm === undefined ? {} : { recebidaEm: p.recebidaEm }),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: perguntaRecebida.id });

    return { gravadas: gravadas.length, repetidas: perguntas.length - gravadas.length };
  }

  /**
   * As perguntas da janela, da mais recente para a mais antiga.
   *
   * A janela existe porque dúvida recorrente é sobre o anúncio de **hoje**: cinco
   * perguntas de voltagem há oito meses, num anúncio já corrigido, não são um buraco
   * aberto — e continuariam acusando para sempre.
   *
   * `plataforma` restringe às perguntas de uma loja, para a área dela. Sem ela vêm
   * todas, inclusive as que não dizem a loja.
   */
  async recentes(
    perfil: PerfilId,
    opcoes: {
      readonly dias?: number;
      readonly limite?: number;
      readonly agora?: Date;
      readonly plataforma?: Plataforma;
    } = {},
  ): Promise<readonly PerguntaRecebida[]> {
    const dias = opcoes.dias ?? 90;
    const agora = opcoes.agora ?? new Date();
    const desde = new Date(agora.getTime() - dias * 86_400_000);

    const linhas = await this.db
      .select({
        id: perguntaRecebida.id,
        texto: perguntaRecebida.texto,
        em: perguntaRecebida.recebidaEm,
        anuncioId: perguntaRecebida.anuncioExterno,
      })
      .from(perguntaRecebida)
      .where(
        and(
          eq(perguntaRecebida.perfilId, perfil),
          gte(perguntaRecebida.recebidaEm, desde),
          opcoes.plataforma === undefined
            ? undefined
            : eq(perguntaRecebida.plataforma, opcoes.plataforma),
        ),
      )
      .orderBy(desc(perguntaRecebida.recebidaEm))
      .limit(opcoes.limite ?? 500);

    return linhas;
  }

  /** Quantas perguntas o perfil tem guardadas, na janela e no total. */
  async contar(
    perfil: PerfilId,
    opcoes: { readonly dias?: number; readonly agora?: Date } = {},
  ): Promise<{ readonly naJanela: number; readonly total: number }> {
    const dias = opcoes.dias ?? 90;
    const agora = opcoes.agora ?? new Date();
    const desde = new Date(agora.getTime() - dias * 86_400_000);

    // Duas consultas, e não um `count(*) filter (...)` com a data no template: `Date`
    // dentro de `sql` cru chega ao driver sem o tipo da coluna e o `postgres` recusa
    // (está no diário, e é a segunda vez). O operador tipado informa o tipo.
    const [total, naJanela] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(perguntaRecebida)
        .where(eq(perguntaRecebida.perfilId, perfil)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(perguntaRecebida)
        .where(and(eq(perguntaRecebida.perfilId, perfil), gte(perguntaRecebida.recebidaEm, desde))),
    ]);

    return { naJanela: naJanela[0]?.n ?? 0, total: total[0]?.n ?? 0 };
  }
}
