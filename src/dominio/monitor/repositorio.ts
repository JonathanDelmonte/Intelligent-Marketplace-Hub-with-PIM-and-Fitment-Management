/**
 * Persistência do monitor (M15).
 *
 * ## Por que existe agora, e não na fase 11
 *
 * A fase 11 entregou as regras — o piso de 3% que cala o monitor, a assimetria entre
 * queda e alta, o agrupamento por semana, e o veredito de queda real. Todas puras e
 * testadas, e **nenhuma ligada a banco**: a tabela `monitor_evento` existia no schema
 * desde a fase 0 e ninguém escrevia nela.
 *
 * Isto é o que liga as duas pontas. E a ponta que faltava é do lado da escrita: a
 * ingestão já detectava preço diferente numa recaptura e gravava a série histórica,
 * mas não registrava o **evento**. Sem isso, a tela do monitor mostraria sempre zero.
 *
 * ## `sobre` é derivado na leitura, e de propósito
 *
 * O agrupamento é por "sobre quem" — um concorrente, um fornecedor. A tabela guarda
 * `entidade_tipo` e `entidade_id`, e não o nome: nome de vendedor muda, e um evento de
 * três meses atrás com o nome velho gravado agruparia separado do de hoje. Derivando na
 * leitura, os dois caem no mesmo grupo.
 *
 * `monitor_evento` **não** carrega `perfil_id`: é observação sobre o mercado, que é
 * base de conhecimento compartilhada entre perfis (CLAUDE.md, seção 3.4).
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { monitorEvento, precoHistorico, produtoExterno } from '@/infra/banco/schema';
import { centavos, proporcaoEmPontosBase, type Centavos } from '@/lib/dinheiro';
import { ehTipoDeMudanca, type Evento } from './eventos';
import { JANELA_DE_REFERENCIA_DIAS, OBSERVACOES_MINIMAS, type PrecoObservado } from './queda';

/** Um produto externo com a série de preço que o detector de queda precisa. */
export interface CandidatoDeQueda {
  readonly produtoExternoId: string;
  readonly titulo: string;
  readonly vendedor: string | null;
  readonly plataformaOuSite: string | null;
  readonly precoAtual: Centavos;
  readonly historico: readonly PrecoObservado[];
}

export class RepositorioDoMonitor {
  constructor(private readonly db: Banco) {}

  /**
   * Grava um evento detectado.
   *
   * Recebe o `Evento` inteiro, com o `id` que quem detectou gerou: o detector é função
   * pura e precisa do id para montar o evento, então gerar aqui obrigaria a devolver
   * outro id e a ter dois no mesmo caminho.
   */
  async registrar(evento: Evento): Promise<void> {
    await this.db.insert(monitorEvento).values({
      id: evento.id,
      entidadeTipo: evento.entidadeTipo,
      entidadeId: evento.entidadeId,
      tipoMudanca: evento.tipo,
      valorAntes: evento.valorAntes,
      valorDepois: evento.valorDepois,
      severidade: evento.severidade,
      detectadoEm: evento.detectadoEm,
    });
  }

  /**
   * Os eventos que ainda não foram lidos, do mais recente para o mais antigo.
   *
   * O `sobre` sai do vendedor quando há um, e cai para a plataforma e depois para o
   * título — o agrupamento precisa de alguma chave, e "sem vendedor informado" agrupa
   * tudo de uma planilha no mesmo balde, que é pior que agrupar por título.
   *
   * Tipo de mudança que não é mais conhecido pelo código é **descartado** na leitura,
   * com o resto do evento intacto no banco: a tela não sabe o que dizer sobre um tipo
   * que ela não tem, e inventar texto para ele seria pior que não mostrar.
   */
  async naoLidos(limite = 100): Promise<readonly Evento[]> {
    const linhas = await this.db
      .select({
        id: monitorEvento.id,
        tipo: monitorEvento.tipoMudanca,
        entidadeTipo: monitorEvento.entidadeTipo,
        entidadeId: monitorEvento.entidadeId,
        valorAntes: monitorEvento.valorAntes,
        valorDepois: monitorEvento.valorDepois,
        severidade: monitorEvento.severidade,
        detectadoEm: monitorEvento.detectadoEm,
        vendedor: produtoExterno.vendedor,
        plataformaOuSite: produtoExterno.plataformaOuSite,
        titulo: produtoExterno.tituloBruto,
      })
      .from(monitorEvento)
      .leftJoin(produtoExterno, eq(produtoExterno.id, monitorEvento.entidadeId))
      .where(eq(monitorEvento.lido, false))
      .orderBy(desc(monitorEvento.detectadoEm))
      .limit(limite);

    return linhas.flatMap((l): Evento[] => {
      if (!ehTipoDeMudanca(l.tipo)) return [];
      const antes = Number(l.valorAntes);
      const depois = Number(l.valorDepois);
      const temNumeros = Number.isFinite(antes) && Number.isFinite(depois) && antes > 0;

      return [
        {
          id: l.id,
          tipo: l.tipo,
          sobre: l.vendedor ?? l.plataformaOuSite ?? l.titulo ?? 'origem não informada',
          entidadeTipo: l.entidadeTipo,
          entidadeId: l.entidadeId,
          valorAntes: l.valorAntes,
          valorDepois: l.valorDepois,
          severidade: l.severidade,
          detectadoEm: l.detectadoEm,
          // Recalculado na leitura pelo mesmo motivo de sempre: é derivado dos dois
          // valores, e guardar derivado é guardar duas verdades.
          variacaoBp: temNumeros
            ? proporcaoEmPontosBase(centavos(Math.abs(depois - antes)), centavos(antes), 'baixo')
            : null,
        },
      ];
    });
  }

  /** Marca eventos como lidos. Devolve quantos mudaram. */
  async marcarLidos(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const alterados = await this.db
      .update(monitorEvento)
      .set({ lido: true, atualizadoEm: new Date() })
      .where(inArray(monitorEvento.id, [...ids]))
      .returning({ id: monitorEvento.id });
    return alterados.length;
  }

  /**
   * Produtos externos com série de preço suficiente para o veredito de queda.
   *
   * Filtra no banco quem tem pelo menos `OBSERVACOES_MINIMAS` observações na janela —
   * abaixo disso o veredito é sempre `sem_referencia`, e carregar a série para descobrir
   * isso é consulta paga para nada. O veredito em si fica em `avaliarQueda`, que é pura.
   */
  async candidatosAQueda(
    limite = 25,
    opcoes: { readonly agora?: Date; readonly janelaDias?: number } = {},
  ): Promise<readonly CandidatoDeQueda[]> {
    const agora = opcoes.agora ?? new Date();
    const janela = opcoes.janelaDias ?? JANELA_DE_REFERENCIA_DIAS;
    const desde = new Date(agora.getTime() - janela * 86_400_000);

    const comSerie = await this.db
      .select({
        id: produtoExterno.id,
        titulo: produtoExterno.tituloBruto,
        vendedor: produtoExterno.vendedor,
        plataformaOuSite: produtoExterno.plataformaOuSite,
        preco: produtoExterno.preco,
        observacoes: sql<number>`count(${precoHistorico.id})::int`,
        ultima: sql<Date>`max(${precoHistorico.coletadoEm})`,
      })
      .from(produtoExterno)
      .innerJoin(precoHistorico, eq(precoHistorico.produtoExternoId, produtoExterno.id))
      .where(and(gte(precoHistorico.coletadoEm, desde), sql`${produtoExterno.preco} is not null`))
      .groupBy(
        produtoExterno.id,
        produtoExterno.tituloBruto,
        produtoExterno.vendedor,
        produtoExterno.plataformaOuSite,
        produtoExterno.preco,
      )
      .having(sql`count(${precoHistorico.id}) >= ${OBSERVACOES_MINIMAS}`)
      .orderBy(desc(sql`max(${precoHistorico.coletadoEm})`))
      .limit(limite);

    if (comSerie.length === 0) return [];

    const series = await this.db
      .select({
        produtoExternoId: precoHistorico.produtoExternoId,
        preco: precoHistorico.preco,
        coletadoEm: precoHistorico.coletadoEm,
      })
      .from(precoHistorico)
      .where(
        and(
          inArray(
            precoHistorico.produtoExternoId,
            comSerie.map((c) => c.id),
          ),
          gte(precoHistorico.coletadoEm, desde),
        ),
      );

    const porProduto = new Map<string, PrecoObservado[]>();
    for (const linha of series) {
      const atual = porProduto.get(linha.produtoExternoId) ?? [];
      atual.push({ preco: centavos(linha.preco), em: linha.coletadoEm });
      porProduto.set(linha.produtoExternoId, atual);
    }

    return comSerie.map((c): CandidatoDeQueda => ({
      produtoExternoId: c.id,
      titulo: c.titulo,
      vendedor: c.vendedor,
      plataformaOuSite: c.plataformaOuSite,
      precoAtual: centavos(c.preco ?? 0),
      historico: porProduto.get(c.id) ?? [],
    }));
  }
}
