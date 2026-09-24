/**
 * Persistência de pedido, com casamento de SKU e margem realizada (M10).
 *
 * Três decisões que valem ser lidas antes do código:
 *
 * **A margem realizada é gravada, não recalculada na leitura.** É o oposto do
 * veredito de fornecedor e da ficha de compatibilidade, e o motivo é que aqui o
 * número é histórico: a margem daquela venda foi aquela, com o custo que o item
 * tinha **naquele dia**. Recalcular com o custo de hoje reescreveria o passado, e
 * é justamente o passado que se quer medir.
 *
 * **O custo é capturado no momento da venda.** Vem de `sku.custo_atual` quando a
 * planilha não traz, e fica congelado em `custo_na_venda`. Sem custo, a margem
 * fica nula e o pedido entra na lista do que falta preencher — nunca zero.
 *
 * **Reimportar a mesma planilha não duplica nem regrava margem à toa.** A chave é
 * `(plataforma, id_externo)`, que já é única no schema.
 */
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Fonte } from '@/dominio/procedencia';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Banco } from '@/infra/banco/cliente';
import { pedido, sku } from '@/infra/banco/schema';
import { centavos, type Centavos } from '@/lib/dinheiro';
import {
  calcularMargemRealizada,
  divergenciaRelevante,
  type MargemRealizada,
} from './margem-realizada';
import { montarFilaDoDia, type FilaDoDia } from './fila-do-dia';

export interface PedidoCapturado {
  readonly plataforma: Plataforma;
  readonly idExterno: string;
  readonly data: Date;
  readonly qtd: number;
  readonly precoBruto: Centavos;
  readonly taxaComissao?: Centavos | null;
  readonly taxaFixa?: Centavos | null;
  readonly fretePago?: Centavos | null;
  readonly repasseLiquido?: Centavos | null;
  /** Custo informado pela planilha. Na falta, sai de `sku.custo_atual`. */
  readonly custoNaVenda?: Centavos | null;
  /** EAN da linha, usado para casar com o SKU quando não vem id. */
  readonly ean?: string | null;
  readonly skuId?: string | null;
  readonly statusEnvio?: string | null;
  readonly rastreio?: string | null;
  readonly prazoPostagemAte?: Date | null;
  readonly fonte: Fonte;
}

export interface PedidoGravado {
  readonly id: string;
  readonly idExterno: string;
  readonly plataforma: string;
  readonly data: Date;
  readonly qtd: number;
  readonly precoBruto: Centavos;
  readonly skuId: string | null;
  readonly margemRealizada: Centavos | null;
  readonly repasseLiquido: Centavos | null;
  readonly custoNaVenda: Centavos | null;
}

export interface ResultadoDoRegistro {
  readonly pedido: PedidoGravado;
  readonly margem: MargemRealizada;
  readonly casouComSku: boolean;
  readonly novo: boolean;
}

/** Os pedidos do perfil — e, quando dada, só os de uma loja. */
function daLoja(perfil: PerfilId, plataforma: Plataforma | undefined): SQL | undefined {
  return plataforma === undefined
    ? eq(pedido.perfilId, perfil)
    : and(eq(pedido.perfilId, perfil), eq(pedido.plataforma, plataforma));
}

function dinheiro(valor: number | null | undefined): Centavos | null {
  return valor === null || valor === undefined ? null : centavos(valor);
}

export class RepositorioDePedidos {
  constructor(private readonly db: Banco) {}

  /**
   * Casa o pedido com um SKU do perfil.
   *
   * Hoje só por EAN, que é a única chave que a planilha de venda traz e que o
   * catálogo também tem. Casar por id de anúncio seria melhor e exige `anuncio`
   * povoado, que é entrega separada — está nas pendências. Sem casamento o pedido
   * é gravado com `sku_id` nulo e **aparece na lista de não casados**: pedido sem
   * SKU é venda sem margem, e esconder isso seria esconder o número que importa.
   */
  private async acharSku(perfil: PerfilId, ean: string | null): Promise<string | null> {
    if (ean === null || ean.trim() === '') return null;
    const linhas = await this.db
      .select({ id: sku.id })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.ean, ean.trim())))
      .limit(1);
    return linhas[0]?.id ?? null;
  }

  private async custoDoSku(skuId: string): Promise<Centavos | null> {
    const linhas = await this.db
      .select({ custo: sku.custoAtual })
      .from(sku)
      .where(eq(sku.id, skuId))
      .limit(1);
    return dinheiro(linhas[0]?.custo);
  }

  async registrar(perfil: PerfilId, capturado: PedidoCapturado): Promise<ResultadoDoRegistro> {
    const skuId = capturado.skuId ?? (await this.acharSku(perfil, capturado.ean ?? null));

    // O custo vem da planilha quando ela traz; senão, do SKU **agora**, e fica
    // congelado na linha. É o número que a margem daquela venda usou.
    const custoNaVenda =
      capturado.custoNaVenda ?? (skuId === null ? null : await this.custoDoSku(skuId));

    const margem = calcularMargemRealizada({
      precoBruto: capturado.precoBruto,
      taxaComissao: capturado.taxaComissao ?? null,
      taxaFixa: capturado.taxaFixa ?? null,
      fretePago: capturado.fretePago ?? null,
      repasseLiquido: capturado.repasseLiquido ?? null,
      custoNaVenda,
      qtd: capturado.qtd,
    });

    const valores = {
      perfilId: perfil,
      plataforma: capturado.plataforma,
      idExterno: capturado.idExterno,
      data: capturado.data,
      qtd: capturado.qtd,
      precoBruto: capturado.precoBruto,
      taxaComissao: capturado.taxaComissao ?? null,
      taxaFixa: capturado.taxaFixa ?? null,
      fretePago: capturado.fretePago ?? null,
      repasseLiquido: capturado.repasseLiquido ?? null,
      custoNaVenda,
      margemRealizada: margem.margem,
      statusEnvio: capturado.statusEnvio ?? null,
      rastreio: capturado.rastreio ?? null,
      prazoPostagemAte: capturado.prazoPostagemAte ?? null,
      skuId,
      fonte: capturado.fonte,
    };

    const inseridos = await this.db
      .insert(pedido)
      .values(valores)
      .onConflictDoUpdate({
        target: [pedido.plataforma, pedido.idExterno],
        set: { ...valores, atualizadoEm: new Date() },
      })
      .returning({
        id: pedido.id,
        idExterno: pedido.idExterno,
        plataforma: pedido.plataforma,
        data: pedido.data,
        qtd: pedido.qtd,
        precoBruto: pedido.precoBruto,
        skuId: pedido.skuId,
        margemRealizada: pedido.margemRealizada,
        repasseLiquido: pedido.repasseLiquido,
        custoNaVenda: pedido.custoNaVenda,
        criadoEm: pedido.criadoEm,
        atualizadoEm: pedido.atualizadoEm,
      });

    const linha = inseridos[0];
    if (linha === undefined) {
      throw new Error(`pedido ${capturado.plataforma}/${capturado.idExterno} não gravou`);
    }

    return {
      pedido: {
        id: linha.id,
        idExterno: linha.idExterno,
        plataforma: linha.plataforma,
        data: linha.data,
        qtd: linha.qtd,
        precoBruto: centavos(linha.precoBruto),
        skuId: linha.skuId,
        margemRealizada: dinheiro(linha.margemRealizada),
        repasseLiquido: dinheiro(linha.repasseLiquido),
        custoNaVenda: dinheiro(linha.custoNaVenda),
      },
      margem,
      casouComSku: skuId !== null,
      novo: linha.criadoEm.getTime() === linha.atualizadoEm.getTime(),
    };
  }

  /**
   * A fila de postagem do dia, já ordenada por urgência.
   *
   * `plataforma` restringe à fila de uma loja, para a área dela (ADR 0009). O limite
   * vale depois do filtro: a fila da Shopee não perde pedido porque o Mercado Livre
   * vendeu muito.
   */
  async filaDoDia(
    perfil: PerfilId,
    agora: Date,
    limite = 200,
    plataforma?: Plataforma,
  ): Promise<FilaDoDia> {
    const linhas = await this.db
      .select({
        id: pedido.id,
        idExterno: pedido.idExterno,
        plataforma: pedido.plataforma,
        qtd: pedido.qtd,
        tituloDoProduto: sku.tituloInterno,
        prazoPostagemAte: pedido.prazoPostagemAte,
        postagemConfirmadaEm: pedido.postagemConfirmadaEm,
        rastreio: pedido.rastreio,
      })
      .from(pedido)
      .leftJoin(sku, eq(sku.id, pedido.skuId))
      .where(daLoja(perfil, plataforma))
      .orderBy(desc(pedido.data))
      .limit(limite);

    return montarFilaDoDia(linhas, agora);
  }

  /** Marca a postagem como confirmada. É o que tira o pedido da fila do dia. */
  async confirmarPostagem(
    perfil: PerfilId,
    pedidoId: string,
    quando: Date,
    rastreio?: string | null,
  ): Promise<boolean> {
    const alterados = await this.db
      .update(pedido)
      .set({
        postagemConfirmadaEm: quando,
        ...(rastreio === undefined || rastreio === null ? {} : { rastreio }),
        atualizadoEm: new Date(),
      })
      .where(and(eq(pedido.id, pedidoId), eq(pedido.perfilId, perfil)))
      .returning({ id: pedido.id });
    return alterados.length > 0;
  }

  /**
   * Marca que o repasse deste pedido já foi conferido no extrato.
   *
   * Existe porque `divergenciasDeRepasse` filtra por `repasse_conferido_em is null` e
   * **nada escrevia essa coluna**: a divergência que você investigou no extrato da
   * plataforma voltava na tela para sempre. Lista que só cresce é lista que ninguém
   * lê — e é o mesmo estrago que o piso de 3% do monitor existe para evitar, por
   * outra porta.
   *
   * Não apaga e não corrige nada: a divergência continua sendo verdade sobre o
   * pedido, e recalculável. O que a data diz é que **uma pessoa já olhou**.
   *
   * `null` desfaz, e o parâmetro existe por isso: um clique errado aqui tira um número
   * de dinheiro de vista, e a revisibilidade é a mesma regra de
   * `desligarProdutoExterno` — decisão humana sobre dinheiro se desfaz por construção,
   * não por restauração de backup.
   */
  async marcarRepasseConferido(
    perfil: PerfilId,
    pedidoId: string,
    quando: Date | null,
  ): Promise<boolean> {
    const alterados = await this.db
      .update(pedido)
      .set({ repasseConferidoEm: quando, atualizadoEm: new Date() })
      .where(and(eq(pedido.id, pedidoId), eq(pedido.perfilId, perfil)))
      .returning({ id: pedido.id });
    return alterados.length > 0;
  }

  /**
   * Divergências que alguém já conferiu, da mais recente para a mais antiga.
   *
   * Existe para o conferido poder voltar: sem esta leitura, "conferi" seria botão de
   * mão única sobre dinheiro. Fica em lista separada e recolhida na tela — o que já foi
   * olhado não disputa atenção com o que não foi.
   */
  async repassesConferidos(
    perfil: PerfilId,
    limite = 20,
    plataforma?: Plataforma,
  ): Promise<
    readonly {
      readonly id: string;
      readonly idExterno: string;
      readonly conferidoEm: Date;
      readonly repasseInformado: Centavos;
    }[]
  > {
    const linhas = await this.db
      .select({
        id: pedido.id,
        idExterno: pedido.idExterno,
        conferidoEm: pedido.repasseConferidoEm,
        repasseLiquido: pedido.repasseLiquido,
      })
      .from(pedido)
      .where(and(daLoja(perfil, plataforma), isNotNull(pedido.repasseConferidoEm)))
      .orderBy(desc(pedido.repasseConferidoEm))
      .limit(limite);

    return linhas.flatMap((l) =>
      l.conferidoEm === null
        ? []
        : [
            {
              id: l.id,
              idExterno: l.idExterno,
              conferidoEm: l.conferidoEm,
              repasseInformado: centavos(l.repasseLiquido ?? 0),
            },
          ],
    );
  }

  /**
   * Pedidos cuja conferência de repasse aponta diferença.
   *
   * A conta é reconstruída aqui, e não lida de uma coluna, porque a divergência é
   * derivada: bruto menos as taxas informadas contra o repasse informado. Gravar o
   * resultado seria guardar o que se sabe recalcular — e ficaria velho na primeira
   * correção de taxa.
   *
   * Fora da lista fica o que já foi conferido (`repasse_conferido_em`), e é o que
   * permite a seção ser lida: sem isso ela cresce a cada importação e nunca encolhe.
   */
  async divergenciasDeRepasse(
    perfil: PerfilId,
    limite = 100,
    plataforma?: Plataforma,
  ): Promise<
    readonly {
      readonly id: string;
      readonly idExterno: string;
      readonly data: Date;
      readonly divergencia: Centavos;
      readonly repasseInformado: Centavos;
    }[]
  > {
    const linhas = await this.db
      .select({
        id: pedido.id,
        idExterno: pedido.idExterno,
        data: pedido.data,
        precoBruto: pedido.precoBruto,
        taxaComissao: pedido.taxaComissao,
        taxaFixa: pedido.taxaFixa,
        fretePago: pedido.fretePago,
        repasseLiquido: pedido.repasseLiquido,
      })
      .from(pedido)
      .where(
        and(
          daLoja(perfil, plataforma),
          isNotNull(pedido.repasseLiquido),
          isNull(pedido.repasseConferidoEm),
        ),
      )
      .orderBy(desc(pedido.data))
      .limit(limite);

    const achados: {
      id: string;
      idExterno: string;
      data: Date;
      divergencia: Centavos;
      repasseInformado: Centavos;
    }[] = [];

    for (const l of linhas) {
      const margem = calcularMargemRealizada({
        precoBruto: centavos(l.precoBruto),
        taxaComissao: dinheiro(l.taxaComissao),
        taxaFixa: dinheiro(l.taxaFixa),
        fretePago: dinheiro(l.fretePago),
        repasseLiquido: dinheiro(l.repasseLiquido),
        custoNaVenda: null,
        qtd: 1,
      });
      if (
        divergenciaRelevante(margem.divergenciaDeRepasse) &&
        margem.divergenciaDeRepasse !== null
      ) {
        achados.push({
          id: l.id,
          idExterno: l.idExterno,
          data: l.data,
          divergencia: margem.divergenciaDeRepasse,
          repasseInformado: centavos(l.repasseLiquido ?? 0),
        });
      }
    }

    return achados;
  }

  /** Números do período, para a tela dizer se o mês está pago. */
  async resumo(perfil: PerfilId): Promise<{
    readonly pedidos: number;
    readonly semSku: number;
    readonly semCusto: number;
    readonly margemTotal: Centavos;
  }> {
    const linhas = await this.db
      .select({
        pedidos: sql<number>`count(*)::int`,
        semSku: sql<number>`count(*) filter (where ${pedido.skuId} is null)::int`,
        semCusto: sql<number>`count(*) filter (where ${pedido.custoNaVenda} is null)::int`,
        margemTotal: sql<number>`coalesce(sum(${pedido.margemRealizada}), 0)::bigint`,
      })
      .from(pedido)
      .where(eq(pedido.perfilId, perfil));

    const l = linhas[0];
    return {
      pedidos: Number(l?.pedidos ?? 0),
      semSku: Number(l?.semSku ?? 0),
      semCusto: Number(l?.semCusto ?? 0),
      margemTotal: centavos(Number(l?.margemTotal ?? 0)),
    };
  }
}
