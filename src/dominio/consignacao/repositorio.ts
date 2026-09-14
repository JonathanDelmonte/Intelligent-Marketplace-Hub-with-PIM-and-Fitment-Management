/**
 * Persistência de consignação (M11 — 8.10).
 *
 * **Operacional: `perfil_id` em toda query** (ADR 0003). Estoque de parceiro é do
 * perfil que combinou com o parceiro, e não é conhecimento compartilhado — ao
 * contrário de compatibilidade e fornecedor.
 *
 * ## O estado é recalculado na leitura, não gravado
 *
 * Oposto do pedido, e de propósito. A margem de um pedido é histórico — foi aquela
 * naquele dia, e recalcular reescreveria o passado. O estado da conferência é o
 * contrário: é uma afirmação sobre **agora**, e envelhece sozinho. "Em dia" gravado
 * ontem está errado hoje, e nenhum job precisa passar para corrigir.
 *
 * ## Conferir é registrar a contagem do parceiro, não copiar a nossa
 *
 * `registrarConferencia` recebe a quantidade **contada** e grava as duas coisas
 * juntas: a quantidade e a data. Marcar a data sem a contagem seria o pior dos
 * mundos — o alerta apaga e o número continua errado, que é exatamente o risco que
 * o módulo existe para cobrir.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Banco } from '@/infra/banco/cliente';
import { consignacao, pedido, sku } from '@/infra/banco/schema';
import { centavos, type Centavos } from '@/lib/dinheiro';
import {
  montarQuadroDeConferencia,
  type OpcoesDaConferencia,
  type QuadroDeConferencia,
} from './conferencia';
import { fecharPeriodo, type Fechamento, type VendaConsignada } from './fechamento';

export interface LinhaParaGravar {
  readonly parceiroNome: string;
  readonly parceiroContato?: string | null;
  readonly skuId: string;
  readonly qtdDisponivel: number;
  readonly precoAcordadoRepasse?: Centavos | null;
}

export interface LinhaGravada {
  readonly id: string;
  readonly parceiroNome: string;
  readonly skuId: string;
  readonly qtdDisponivel: number;
  readonly precoAcordadoRepasse: Centavos | null;
  readonly conferidoEm: Date | null;
}

function dinheiro(valor: number | null | undefined): Centavos | null {
  return valor === null || valor === undefined ? null : centavos(valor);
}

export class RepositorioDeConsignacao {
  constructor(private readonly db: Banco) {}

  /**
   * Cria ou atualiza a linha de um SKU num parceiro.
   *
   * A chave natural é (perfil, parceiro, sku): o mesmo SKU pode estar em duas lojas,
   * e é justamente a comparação entre elas que interessa. Não há `unique` no schema
   * para isso, então o upsert é lido-e-escrito — e por isso a leitura filtra pelos
   * três campos, nunca por dois.
   */
  async registrar(perfil: PerfilId, linha: LinhaParaGravar): Promise<LinhaGravada> {
    const existentes = await this.db
      .select({ id: consignacao.id })
      .from(consignacao)
      .where(
        and(
          eq(consignacao.perfilId, perfil),
          eq(consignacao.parceiroNome, linha.parceiroNome),
          eq(consignacao.skuId, linha.skuId),
        ),
      )
      .limit(1);

    const valores = {
      parceiroContato: linha.parceiroContato ?? null,
      qtdDisponivel: linha.qtdDisponivel,
      precoAcordadoRepasse: linha.precoAcordadoRepasse ?? null,
    };

    const existente = existentes[0];
    const [gravada] =
      existente === undefined
        ? await this.db
            .insert(consignacao)
            .values({
              perfilId: perfil,
              parceiroNome: linha.parceiroNome,
              skuId: linha.skuId,
              ...valores,
            })
            .returning()
        : await this.db
            .update(consignacao)
            .set(valores)
            .where(eq(consignacao.id, existente.id))
            .returning();

    if (gravada === undefined) throw new Error('consignação não foi gravada');
    return {
      id: gravada.id,
      parceiroNome: gravada.parceiroNome,
      skuId: gravada.skuId,
      qtdDisponivel: gravada.qtdDisponivel,
      precoAcordadoRepasse: dinheiro(gravada.precoAcordadoRepasse),
      conferidoEm: gravada.conferidoEm,
    };
  }

  /**
   * Registra a conferência: a contagem do parceiro e a data, juntas.
   *
   * Devolve `false` quando a linha não é deste perfil — silenciosamente não fazer
   * nada seria pior, porque a tela diria "conferido" sem ter conferido.
   */
  async registrarConferencia(
    perfil: PerfilId,
    consignacaoId: string,
    qtdContada: number,
    quando: Date,
  ): Promise<boolean> {
    const alteradas = await this.db
      .update(consignacao)
      .set({ qtdDisponivel: qtdContada, conferidoEm: quando })
      .where(and(eq(consignacao.id, consignacaoId), eq(consignacao.perfilId, perfil)))
      .returning({ id: consignacao.id });

    return alteradas.length > 0;
  }

  /** O quadro de conferência, com o estado calculado na hora da leitura. */
  async quadroDeConferencia(
    perfil: PerfilId,
    opcoes: OpcoesDaConferencia = {},
  ): Promise<QuadroDeConferencia> {
    const linhas = await this.db
      .select({
        id: consignacao.id,
        parceiroNome: consignacao.parceiroNome,
        skuId: consignacao.skuId,
        tituloDoProduto: sku.tituloInterno,
        qtdDisponivel: consignacao.qtdDisponivel,
        conferidoEm: consignacao.conferidoEm,
      })
      .from(consignacao)
      .leftJoin(sku, eq(sku.id, consignacao.skuId))
      .where(eq(consignacao.perfilId, perfil));

    return montarQuadroDeConferencia(linhas, opcoes);
  }

  /**
   * Fecha o período por parceiro.
   *
   * O repasse por unidade sai do acordo **atual** da linha de consignação, e isso é
   * um limite conhecido, não um descuido: não há histórico de preço acordado, então
   * mudar o acordo hoje muda o fechamento de um mês já fechado. O conserto é uma
   * tabela de histórico, e está em pendências — até lá o número é conferível, que é
   * o que importa para não pagar errado em silêncio.
   */
  async fechamento(perfil: PerfilId, de: string, ate: string, fuso?: string): Promise<Fechamento> {
    const linhas = await this.db
      .select({
        id: consignacao.id,
        skuId: consignacao.skuId,
        parceiroNome: consignacao.parceiroNome,
        precoAcordadoRepasse: consignacao.precoAcordadoRepasse,
      })
      .from(consignacao)
      .where(eq(consignacao.perfilId, perfil));

    if (linhas.length === 0) return fecharPeriodo([], de, ate, fuso === undefined ? {} : { fuso });

    // Um SKU pode estar em dois parceiros, e daí sai uma ambiguidade real: a venda
    // não diz de qual loja saiu a peça. Enquanto o pedido não guardar isso, a venda
    // de um SKU consignado em dois lugares é atribuída ao primeiro em ordem de nome
    // — decisão anotada em pendências, e visível: o fechamento mostra a peça.
    const porSku = new Map<string, { parceiroNome: string; repasse: Centavos | null }>();
    for (const l of [...linhas].sort((a, b) =>
      a.parceiroNome.localeCompare(b.parceiroNome, 'pt-BR'),
    )) {
      if (!porSku.has(l.skuId)) {
        porSku.set(l.skuId, {
          parceiroNome: l.parceiroNome,
          repasse: dinheiro(l.precoAcordadoRepasse),
        });
      }
    }

    const vendas = await this.db
      .select({
        pedidoId: pedido.id,
        skuId: pedido.skuId,
        tituloDoProduto: sku.tituloInterno,
        data: pedido.data,
        qtd: pedido.qtd,
      })
      .from(pedido)
      .leftJoin(sku, eq(sku.id, pedido.skuId))
      .where(and(eq(pedido.perfilId, perfil), inArray(pedido.skuId, [...porSku.keys()])));

    const consignadas: VendaConsignada[] = vendas.flatMap((v) => {
      if (v.skuId === null) return [];
      const acordo = porSku.get(v.skuId);
      if (acordo === undefined) return [];
      return [
        {
          pedidoId: v.pedidoId,
          skuId: v.skuId,
          parceiroNome: acordo.parceiroNome,
          tituloDoProduto: v.tituloDoProduto,
          data: v.data,
          qtd: v.qtd,
          repassePorUnidade: acordo.repasse,
        },
      ];
    });

    return fecharPeriodo(consignadas, de, ate, fuso === undefined ? {} : { fuso });
  }

  /** Uma linha, para a tela de detalhe e para montar a mensagem ao parceiro. */
  async porId(perfil: PerfilId, consignacaoId: string): Promise<LinhaGravada | null> {
    const linhas = await this.db
      .select()
      .from(consignacao)
      .where(and(eq(consignacao.id, consignacaoId), eq(consignacao.perfilId, perfil)))
      .limit(1);

    const l = linhas[0];
    if (l === undefined) return null;
    return {
      id: l.id,
      parceiroNome: l.parceiroNome,
      skuId: l.skuId,
      qtdDisponivel: l.qtdDisponivel,
      precoAcordadoRepasse: dinheiro(l.precoAcordadoRepasse),
      conferidoEm: l.conferidoEm,
    };
  }
}
