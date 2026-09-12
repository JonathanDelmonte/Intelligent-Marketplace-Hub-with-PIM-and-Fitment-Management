/**
 * Evidência de preço para um GTIN.
 *
 * A ponte entre o código de barras lido e o que o sistema já sabe. Dá de comer ao
 * veredito, que é função pura e não sabe consultar nada.
 *
 * ## O que conta como evidência
 *
 * Três origens, em ordem de força:
 *
 * 1. **O SKU do próprio perfil**, quando existe. Custo e preço próprios são
 *    `manual`: foram digitados por quem opera, e é o dado mais forte que existe
 *    (ver `procedencia`). Também é a informação mais importante da tela — se o
 *    produto já é seu, a pergunta deixa de ser "vale comprar?" e passa a ser
 *    "vale comprar *mais*?".
 * 2. **Preço histórico** das ocorrências externas, que é a série temporal.
 * 3. **O preço corrente** da ocorrência externa, quando ela não tem histórico.
 *
 * ## Por que o histórico entra e não só o preço atual
 *
 * `produto_externo.preco` é o último valor visto. `preco_historico` guarda cada
 * leitura com data. Para decidir compra, várias leituras recentes valem mais que
 * uma: é o que permite ao veredito calcular mediana e dispersão em vez de
 * confiar num número só.
 *
 * ## Perfil
 *
 * `produto_externo` é base de conhecimento compartilhada e **não** carrega
 * `perfil_id` (ADR 0003). O SKU carrega, e por isso a consulta exige `PerfilId`
 * no tipo: sem ele o compilador recusa a chamada, e não existe caminho para
 * vazar catálogo de um perfil para outro.
 */
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { precoHistorico, produtoExterno, sku } from '@/infra/banco/schema';
import type { Gtin } from '@/dominio/gtin';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { centavos, type Centavos } from '@/lib/dinheiro';
import type { Fonte } from '@/dominio/procedencia';
import type { EvidenciaDePreco } from './veredito';

/** Quantas observações a consulta traz. Mais que isso não muda a mediana. */
export const MAX_OBSERVACOES = 50;

/** Janela de busca no histórico. Folgada de propósito: quem filtra é o veredito. */
export const JANELA_DE_BUSCA_DIAS = 365;

export interface SkuDoPerfil {
  readonly id: string;
  readonly tituloInterno: string;
  readonly custoAtual: Centavos | null;
  readonly ativo: boolean;
}

export interface OcorrenciaExterna {
  readonly id: string;
  readonly tituloBruto: string;
  readonly plataformaOuSite: string | null;
  readonly url: string | null;
  readonly vendedor: string | null;
  readonly preco: Centavos | null;
  readonly fonte: Fonte;
  readonly coletadoEm: Date;
}

export interface EvidenciaDoGtin {
  readonly gtin: Gtin;
  /** O produto já é seu? Muda a pergunta que a tela faz. */
  readonly skuProprio: SkuDoPerfil | null;
  readonly ocorrencias: readonly OcorrenciaExterna[];
  /** Pronta para o veredito consumir. */
  readonly evidencias: readonly EvidenciaDePreco[];
}

export class ConsultaDeGtin {
  constructor(private readonly db: Banco) {}

  /**
   * Junta tudo que se sabe sobre um GTIN.
   *
   * Uma chamada, três consultas em paralelo. O leitor tem dois segundos de
   * orçamento e a pessoa está de pé numa loja: encadear ida e volta é o que gasta
   * esse orçamento sem precisar.
   */
  async buscar(params: {
    readonly perfil: PerfilId;
    readonly gtin: Gtin;
    readonly em?: Date;
  }): Promise<EvidenciaDoGtin> {
    const agora = params.em ?? new Date();
    const desdeQuando = new Date(agora.getTime() - JANELA_DE_BUSCA_DIAS * 86_400_000);

    // A chave de consulta é a forma canônica quando existe. Para agrupamento
    // (caixa) não existe, e aí o que resta é o próprio código de 14 dígitos: a
    // caixa é um item comercial, só não é a unidade.
    const chave = params.gtin.ean13 ?? params.gtin.digitos;

    const [skus, ocorrencias, historico] = await Promise.all([
      this.db
        .select({
          id: sku.id,
          tituloInterno: sku.tituloInterno,
          custoAtual: sku.custoAtual,
          ativo: sku.ativo,
        })
        .from(sku)
        .where(and(eq(sku.perfilId, params.perfil), eq(sku.ean, chave)))
        .limit(1),

      this.db
        .select({
          id: produtoExterno.id,
          tituloBruto: produtoExterno.tituloBruto,
          plataformaOuSite: produtoExterno.plataformaOuSite,
          url: produtoExterno.url,
          vendedor: produtoExterno.vendedor,
          preco: produtoExterno.preco,
          fonte: produtoExterno.fonte,
          coletadoEm: produtoExterno.coletadoEm,
        })
        .from(produtoExterno)
        .where(eq(produtoExterno.ean, chave))
        .orderBy(desc(produtoExterno.coletadoEm))
        .limit(MAX_OBSERVACOES),

      this.db
        .select({
          produtoExternoId: precoHistorico.produtoExternoId,
          preco: precoHistorico.preco,
          fonte: precoHistorico.fonte,
          coletadoEm: precoHistorico.coletadoEm,
          origemUrl: precoHistorico.origemUrl,
        })
        .from(precoHistorico)
        .innerJoin(produtoExterno, eq(precoHistorico.produtoExternoId, produtoExterno.id))
        .where(and(eq(produtoExterno.ean, chave), gte(precoHistorico.coletadoEm, desdeQuando)))
        .orderBy(desc(precoHistorico.coletadoEm))
        .limit(MAX_OBSERVACOES),
    ]);

    const linhaDoSku = skus[0];
    const skuProprio: SkuDoPerfil | null =
      linhaDoSku === undefined
        ? null
        : {
            id: linhaDoSku.id,
            tituloInterno: linhaDoSku.tituloInterno,
            custoAtual: linhaDoSku.custoAtual === null ? null : centavos(linhaDoSku.custoAtual),
            ativo: linhaDoSku.ativo,
          };

    const evidencias: EvidenciaDePreco[] = [];

    for (const h of historico) {
      evidencias.push({
        preco: centavos(h.preco),
        procedencia: {
          fonte: h.fonte,
          coletadoEm: h.coletadoEm,
          ...(h.origemUrl === null ? {} : { origem: h.origemUrl }),
        },
      });
    }

    // O preço corrente da ocorrência entra só quando ela não rendeu histórico:
    // do contrário a mesma leitura contaria duas vezes e inflaria a amostra, que
    // é justamente o que a contagem de observações usa para medir confiança.
    //
    // O conjunto sai das linhas já carregadas, e não de uma consulta a mais: são
    // dois segundos de orçamento com a pessoa de pé numa loja.
    const comHistorico = new Set(historico.map((h) => h.produtoExternoId));

    for (const o of ocorrencias) {
      if (o.preco === null || comHistorico.has(o.id)) continue;
      evidencias.push({
        preco: centavos(o.preco),
        procedencia: {
          fonte: o.fonte,
          coletadoEm: o.coletadoEm,
          ...(o.url === null ? {} : { origem: o.url }),
        },
        ...(o.vendedor === null ? {} : { rotulo: `anúncio de ${o.vendedor}` }),
      });
    }

    return {
      gtin: params.gtin,
      skuProprio,
      ocorrencias: ocorrencias.map((o) => ({
        ...o,
        preco: o.preco === null ? null : centavos(o.preco),
      })),
      evidencias,
    };
  }

  /**
   * Quantos GTINs distintos a base conhece.
   *
   * Serve para a tela dizer o tamanho da base em vez de deixar a pessoa
   * descobrir, leitura por leitura, que ela está vazia.
   */
  async quantidadeDeGtinsConhecidos(): Promise<number> {
    const linhas = await this.db
      .select({ n: sql<number>`count(distinct ${produtoExterno.ean})::int` })
      .from(produtoExterno)
      .where(isNotNull(produtoExterno.ean));
    return linhas[0]?.n ?? 0;
  }
}
