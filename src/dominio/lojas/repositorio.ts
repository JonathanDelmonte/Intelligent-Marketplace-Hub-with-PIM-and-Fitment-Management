/**
 * Leituras por loja: em que pé cada uma está, e os números dela (ADR 0009).
 *
 * Toda consulta é do perfil (ADR 0003) e agrupa pela coluna `plataforma` do pedido. É
 * o único filtro que a área da loja usa — nenhuma leitura pergunta o nome de uma
 * plataforma, e é isso que faz loja nova não precisar de consulta nova.
 */
import { and, count, desc, eq, gte, lt, max, sql, type SQL } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import type { Banco } from '@/infra/banco/cliente';
import { credencial, pedido, sku } from '@/infra/banco/schema';
import { centavos, pontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';
import type { NumerosDaLoja } from './estado';
import type { Janela, PontoDaSerie, SomaDaLoja } from './painel';

/** Um produto entre os mais vendidos de uma janela. */
export interface MaisVendido {
  /** `null` agrupa os pedidos que não casaram com produto do catálogo. */
  readonly skuId: string | null;
  readonly titulo: string | null;
  readonly pedidos: number;
  readonly faturamento: Centavos;
  /** Margem dos pedidos deste produto que têm custo. `null` sem nenhum. */
  readonly margemBp: PontosBase | null;
}

/**
 * Soma de `bigint` chega do driver como texto. Um conversor só, para não haver dez
 * `Number(...)` espalhados — e para o `centavos` recusar o que não for inteiro.
 */
function somaEmCentavos(valor: string | number | null): Centavos {
  return centavos(Number(valor ?? 0));
}

const FATURAMENTO = sql<string>`coalesce(sum(${pedido.precoBruto}), 0)`;
const FATURAMENTO_COM_MARGEM = sql<string>`coalesce(sum(${pedido.precoBruto}) filter (where ${pedido.margemRealizada} is not null), 0)`;
const MARGEM = sql<string>`coalesce(sum(${pedido.margemRealizada}), 0)`;

/** Pedidos do perfil na janela — e, quando dada, só os de uma loja. */
function naJanela(perfil: PerfilId, janela: Janela, plataforma?: Plataforma): SQL | undefined {
  return and(
    eq(pedido.perfilId, perfil),
    gte(pedido.data, janela.desde),
    lt(pedido.data, janela.ate),
    plataforma === undefined ? undefined : eq(pedido.plataforma, plataforma),
  );
}

export class RepositorioDeLojas {
  constructor(private readonly db: Banco) {}

  /**
   * Pedidos, pedido mais recente e conexão de cada loja, na ordem do domínio.
   *
   * Loja sem pedido nenhum volta com zero, e não some: a barra mostra todas as lojas
   * que o sistema atende, e "sem dados" é um estado da loja, não a ausência dela.
   *
   * Conectada é credencial OAuth ativa. A validade do token não entra: token vencido
   * com refresh válido continua conectado, e o refresh que falhar desliga a credencial.
   */
  async numeros(perfil: PerfilId): Promise<readonly NumerosDaLoja[]> {
    const [pedidos, conexoes] = await Promise.all([
      this.db
        .select({
          plataforma: pedido.plataforma,
          pedidos: count(),
          ultimo: max(pedido.data),
        })
        .from(pedido)
        .where(eq(pedido.perfilId, perfil))
        .groupBy(pedido.plataforma),
      this.db
        .select({ plataforma: credencial.plataforma })
        .from(credencial)
        .where(
          and(
            eq(credencial.perfilId, perfil),
            eq(credencial.ativo, true),
            eq(credencial.tipo, 'oauth'),
          ),
        ),
    ]);

    const conectadas = new Set<Plataforma>(conexoes.map((c) => c.plataforma));
    return PLATAFORMAS.map((plataforma) => {
      const linha = pedidos.find((p) => p.plataforma === plataforma);
      return {
        plataforma,
        pedidos: linha?.pedidos ?? 0,
        ultimoPedidoEm: linha?.ultimo ?? null,
        conectada: conectadas.has(plataforma),
      };
    });
  }

  /**
   * Faturamento, pedidos, margem e repasse de cada loja na janela, na ordem do domínio.
   *
   * Loja sem pedido volta zerada: a visão geral mostra todas, e "zero nesta janela" é
   * diferente de "loja que não existe".
   */
  async somas(perfil: PerfilId, janela: Janela): Promise<readonly SomaDaLoja[]> {
    const linhas = await this.db
      .select({
        plataforma: pedido.plataforma,
        pedidos: count(),
        faturamento: FATURAMENTO,
        faturamentoComMargem: FATURAMENTO_COM_MARGEM,
        margem: MARGEM,
        pedidosSemMargem: sql<number>`(count(*) filter (where ${pedido.margemRealizada} is null))::int`,
        repasse: sql<string>`coalesce(sum(${pedido.repasseLiquido}), 0)`,
      })
      .from(pedido)
      .where(naJanela(perfil, janela))
      .groupBy(pedido.plataforma);

    return PLATAFORMAS.map((plataforma) => {
      const l = linhas.find((x) => x.plataforma === plataforma);
      return {
        plataforma,
        pedidos: l?.pedidos ?? 0,
        faturamento: somaEmCentavos(l?.faturamento ?? 0),
        faturamentoComMargem: somaEmCentavos(l?.faturamentoComMargem ?? 0),
        margem: somaEmCentavos(l?.margem ?? 0),
        pedidosSemMargem: l?.pedidosSemMargem ?? 0,
        repasse: somaEmCentavos(l?.repasse ?? 0),
      };
    });
  }

  /**
   * Faturamento e pedidos por dia, no fuso do vendedor. Só os dias com pedido: quem
   * completa os outros com zero é `completarSerie`.
   *
   * O agrupamento é pela primeira coluna (`group by 1`), e não pela expressão repetida:
   * o fuso entra como parâmetro, e o Postgres não reconhece como iguais duas expressões
   * com parâmetros de número diferente — recusaria a consulta.
   */
  async serieDiaria(
    perfil: PerfilId,
    janela: Janela,
    plataforma?: Plataforma,
    fuso: string = FUSO_PADRAO,
  ): Promise<readonly PontoDaSerie[]> {
    const linhas = await this.db
      .select({
        dia: sql<string>`to_char(${pedido.data} at time zone ${fuso}, 'YYYY-MM-DD')`,
        faturamento: FATURAMENTO,
        pedidos: count(),
      })
      .from(pedido)
      .where(naJanela(perfil, janela, plataforma))
      .groupBy(sql`1`);

    return linhas.map((l) => ({
      dia: l.dia,
      faturamento: somaEmCentavos(l.faturamento),
      pedidos: l.pedidos,
    }));
  }

  /** Os produtos que mais faturaram na janela, do maior para o menor. */
  async maisVendidos(
    perfil: PerfilId,
    janela: Janela,
    plataforma?: Plataforma,
    limite = 5,
  ): Promise<readonly MaisVendido[]> {
    const linhas = await this.db
      .select({
        skuId: pedido.skuId,
        titulo: sql<string | null>`max(${sku.tituloInterno})`,
        pedidos: count(),
        faturamento: FATURAMENTO,
        faturamentoComMargem: FATURAMENTO_COM_MARGEM,
        margem: MARGEM,
      })
      .from(pedido)
      .leftJoin(sku, eq(sku.id, pedido.skuId))
      .where(naJanela(perfil, janela, plataforma))
      .groupBy(pedido.skuId)
      .orderBy(desc(sql`sum(${pedido.precoBruto})`))
      .limit(limite);

    return linhas.map((l) => {
      const base = Number(l.faturamentoComMargem);
      return {
        skuId: l.skuId,
        titulo: l.titulo,
        pedidos: l.pedidos,
        faturamento: somaEmCentavos(l.faturamento),
        margemBp: base === 0 ? null : pontosBase(Math.trunc((Number(l.margem) * 10_000) / base)),
      };
    });
  }
}
