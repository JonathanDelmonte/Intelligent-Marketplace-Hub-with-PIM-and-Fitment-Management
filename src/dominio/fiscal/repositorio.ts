/**
 * Persistência do cadastro fiscal e do acumulado do ano (M12).
 *
 * **Operacional: `perfil_id` em toda query** (ADR 0003). Dado fiscal é do perfil que
 * emite a nota.
 *
 * ## O acumulado é tabela, não `SUM(pedido)`
 *
 * E a razão está no schema desde o começo: o teto considera **receita bruta do
 * regime**, que inclui venda fora das plataformas integradas. Uma soma de `pedido`
 * diria um número menor que o real, e menor do lado errado — o vendedor acharia que
 * tem folga que não tem.
 *
 * A receita das plataformas é somada dos pedidos e **gravada** na linha do ano; a de
 * fora entra à mão. Os dois campos existem separados para a pessoa saber de onde
 * veio cada parte quando o número não fechar.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { RegimeFiscal } from '@/dominio/precificacao/tipos';
import type { Banco } from '@/infra/banco/cliente';
import {
  acumuladoAnual,
  aparelho,
  compatibilidade,
  pedido,
  perfilVendedor,
  sku,
} from '@/infra/banco/schema';
import { centavos, type Centavos } from '@/lib/dinheiro';
import type { ProdutoParaClassificar } from './classificador';
import { OBRIGATORIOS_EM_2027, estadoFiscal, type CampoFiscal, type EstadoFiscal } from './codigos';
import { avaliarRegulacao, type AvaliacaoDeRegulacao } from './regulada';
import { avaliarTeto, type AvaliacaoDoTeto } from './teto';

export interface SkuFiscal {
  readonly id: string;
  readonly tituloInterno: string;
  readonly ncm: string | null;
  readonly cest: string | null;
  readonly cst: string | null;
  readonly cclasstrib: string | null;
  readonly categoriaRegulada: string | null;
  /** Recalculado na leitura: é julgamento sobre o cadastro de agora. */
  readonly estado: EstadoFiscal;
  readonly regulacao: AvaliacaoDeRegulacao;
}

export interface ResumoFiscal {
  readonly skus: readonly SkuFiscal[];
  readonly pendentes: number;
  readonly regulados: number;
  readonly regime: RegimeFiscal;
}

/**
 * O que gravar. Campo **ausente** fica como está; campo `null` apaga.
 *
 * A distinção é usada pela tela: apagar um código errado é operação legítima, e
 * confundir "não mandei" com "apague" perderia cadastro em silêncio.
 */
export type CodigosParaGravar = Partial<Record<CampoFiscal | 'categoriaRegulada', string | null>>;

export class RepositorioFiscal {
  constructor(private readonly db: Banco) {}

  /**
   * Quantos produtos ativos ainda não têm o cadastro que 2027 exige.
   *
   * Existe separado de `resumo` porque a tela inicial quer **o número**, e `resumo`
   * carrega o catálogo inteiro para calcular o estado de cada item — custo que não se
   * paga numa tela que só mostra a contagem.
   *
   * A condição é derivada de `OBRIGATORIOS_EM_2027`, e não escrita à mão em SQL: a
   * lista é a mesma que `estadoFiscal` usa, então acrescentar um campo obrigatório
   * amanhã muda os dois lugares de uma vez. SQL escrito à mão aqui seria a segunda
   * definição da mesma regra, e as duas divergiriam na primeira mudança.
   */
  async contarPendentes(perfil: PerfilId): Promise<number> {
    // Vazio aqui é "nulo ou só espaço", o mesmo critério do `vazio` de `codigos.ts`:
    // campo gravado com espaço em branco não é cadastro preenchido.
    const vazioNoBanco: Readonly<Record<CampoFiscal, SQL>> = {
      ncm: sql`(${sku.ncm} is null or btrim(${sku.ncm}) = '')`,
      cest: sql`(${sku.cest} is null or btrim(${sku.cest}) = '')`,
      cst: sql`(${sku.cst} is null or btrim(${sku.cst}) = '')`,
      cclasstrib: sql`(${sku.cclasstrib} is null or btrim(${sku.cclasstrib}) = '')`,
    };

    const linhas = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sku)
      .where(
        and(
          eq(sku.perfilId, perfil),
          eq(sku.ativo, true),
          sql.join(
            OBRIGATORIOS_EM_2027.map((campo) => vazioNoBanco[campo]),
            sql` or `,
          ),
        ),
      );

    return linhas[0]?.n ?? 0;
  }

  /**
   * O cadastro fiscal de todos os SKUs ativos, com o que falta em cada um.
   *
   * O estado é recalculado na leitura, não gravado: é afirmação sobre o cadastro de
   * agora, e o critério (o que 2027 exige) pode mudar antes de 2027 — gravar faria o
   * SKU antigo ficar com o veredito velho.
   *
   * Ordem: pendente primeiro, e dentro disso pelo título. Quem abre esta tela vem
   * fazer o que falta.
   */
  async resumo(perfil: PerfilId): Promise<ResumoFiscal> {
    const [perfis, linhas] = await Promise.all([
      this.db
        .select({ regime: perfilVendedor.regime })
        .from(perfilVendedor)
        .where(eq(perfilVendedor.id, perfil))
        .limit(1),
      this.db
        .select({
          id: sku.id,
          tituloInterno: sku.tituloInterno,
          ncm: sku.ncm,
          cest: sku.cest,
          cst: sku.cst,
          cclasstrib: sku.cclasstrib,
          categoriaRegulada: sku.categoriaRegulada,
        })
        .from(sku)
        .where(and(eq(sku.perfilId, perfil), eq(sku.ativo, true))),
    ]);

    const skus = linhas
      .map((l): SkuFiscal => ({
        ...l,
        estado: estadoFiscal(l),
        regulacao: avaliarRegulacao({
          categoriaRegulada: l.categoriaRegulada,
          tituloInterno: l.tituloInterno,
        }),
      }))
      .sort(
        (a, b) =>
          Number(a.estado.prontoPara2027) - Number(b.estado.prontoPara2027) ||
          a.tituloInterno.localeCompare(b.tituloInterno, 'pt-BR'),
      );

    return {
      skus,
      pendentes: skus.filter((s) => !s.estado.prontoPara2027).length,
      regulados: skus.filter((s) => s.regulacao.mensagem !== null).length,
      regime: perfis[0]?.regime ?? 'cpf',
    };
  }

  /**
   * O que o classificador de NCM lê de um SKU.
   *
   * Título, marca e os modelos de aparelho em que a peça serve — o último importa
   * porque é o que distingue "purificador de água" de "peça de purificador de água",
   * e são NCMs diferentes.
   */
  async paraClassificar(perfil: PerfilId, skuId: string): Promise<ProdutoParaClassificar | null> {
    const [linha] = await this.db
      .select({ tituloInterno: sku.tituloInterno, marca: sku.marca })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, skuId)))
      .limit(1);

    if (linha === undefined) return null;

    const modelos = await this.db
      .select({ marca: aparelho.marca, modelo: aparelho.modelo })
      .from(compatibilidade)
      .innerJoin(aparelho, eq(aparelho.id, compatibilidade.aparelhoId))
      .where(eq(compatibilidade.skuId, skuId));

    return {
      tituloInterno: linha.tituloInterno,
      marca: linha.marca,
      modelosCompativeis: modelos.map((m) => `${m.marca} ${m.modelo}`),
    };
  }

  /**
   * Grava os códigos fiscais de um SKU.
   *
   * Só o que veio: campo ausente do objeto fica como está. Enviar `null` para
   * apagar é diferente de não enviar, e a tela usa os dois — apagar um código errado
   * é uma operação legítima.
   */
  async gravarCodigos(
    perfil: PerfilId,
    skuId: string,
    codigos: CodigosParaGravar,
  ): Promise<boolean> {
    // Montado campo a campo, com o tipo do schema, e não num `Record<string, …>`
    // solto. O `Record` solto esconderia exatamente o erro que ele já esconde uma
    // vez: escrever `categoria_regulada` — o nome da coluna — onde o Drizzle espera
    // `categoriaRegulada`, o nome da propriedade. Ele aceitaria em silêncio, e a
    // gravação sumiria sem erro nenhum.
    const valores: Partial<typeof sku.$inferInsert> = { atualizadoEm: new Date() };
    if (codigos.ncm !== undefined) valores.ncm = codigos.ncm;
    if (codigos.cest !== undefined) valores.cest = codigos.cest;
    if (codigos.cst !== undefined) valores.cst = codigos.cst;
    if (codigos.cclasstrib !== undefined) valores.cclasstrib = codigos.cclasstrib;
    if (codigos.categoriaRegulada !== undefined) {
      valores.categoriaRegulada = codigos.categoriaRegulada;
    }

    const alterados = await this.db
      .update(sku)
      .set(valores)
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, skuId)))
      .returning({ id: sku.id });

    return alterados.length > 0;
  }

  /**
   * Recalcula a receita das plataformas no ano e grava na linha do acumulado.
   *
   * Some `preco_bruto × qtd` dos pedidos do ano. **Preço bruto, não repasse:** o teto
   * do MEI olha receita bruta, e usar o repasse líquido diria um número menor —
   * folga que não existe, que é o erro caro aqui.
   *
   * A receita externa não é tocada: ela é informada à mão e não se deduz de nada.
   */
  async atualizarReceitaDoAno(perfil: PerfilId, ano: number): Promise<Centavos> {
    const [soma] = await this.db
      .select({
        bruta: sql<number>`coalesce(sum(${pedido.precoBruto} * ${pedido.qtd}), 0)::bigint`,
      })
      .from(pedido)
      .where(and(eq(pedido.perfilId, perfil), sql`extract(year from ${pedido.data}) = ${ano}`));

    const receitaBruta = centavos(Number(soma?.bruta ?? 0));

    await this.db
      .insert(acumuladoAnual)
      .values({ perfilId: perfil, ano, receitaBruta })
      .onConflictDoUpdate({
        target: [acumuladoAnual.perfilId, acumuladoAnual.ano],
        set: { receitaBruta, atualizadoEm: new Date() },
      });

    return receitaBruta;
  }

  /** Receita informada à mão, que é a parte que não se deduz de pedido nenhum. */
  async informarReceitaExterna(
    perfil: PerfilId,
    ano: number,
    receitaExterna: Centavos,
  ): Promise<void> {
    await this.db
      .insert(acumuladoAnual)
      .values({ perfilId: perfil, ano, receitaExterna })
      .onConflictDoUpdate({
        target: [acumuladoAnual.perfilId, acumuladoAnual.ano],
        set: { receitaExterna, atualizadoEm: new Date() },
      });
  }

  /**
   * O teto do ano, avaliado.
   *
   * Recalcula a receita das plataformas antes de avaliar: o número tem de refletir a
   * última importação de pedido, e não a última vez que alguém abriu esta tela.
   */
  async teto(perfil: PerfilId, ano: number, agora?: Date): Promise<AvaliacaoDoTeto> {
    await this.atualizarReceitaDoAno(perfil, ano);

    const [linha] = await this.db
      .select({
        receitaBruta: acumuladoAnual.receitaBruta,
        receitaExterna: acumuladoAnual.receitaExterna,
      })
      .from(acumuladoAnual)
      .where(and(eq(acumuladoAnual.perfilId, perfil), eq(acumuladoAnual.ano, ano)))
      .limit(1);

    const [perfis] = await this.db
      .select({ tetoAnual: perfilVendedor.tetoAnual })
      .from(perfilVendedor)
      .where(eq(perfilVendedor.id, perfil))
      .limit(1);

    return avaliarTeto(
      {
        receitaBruta: centavos(linha?.receitaBruta ?? 0),
        receitaExterna: centavos(linha?.receitaExterna ?? 0),
        tetoAnual: perfis?.tetoAnual === null ? null : centavos(perfis?.tetoAnual ?? 0),
      },
      agora === undefined ? {} : { agora },
    );
  }
}
