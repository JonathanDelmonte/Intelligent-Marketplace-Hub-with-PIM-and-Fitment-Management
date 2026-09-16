/**
 * Leitura do que a montagem de anúncio precisa (M9 — 8.11).
 *
 * **Operacional: `perfil_id` em toda query de SKU** (ADR 0003). A compatibilidade e
 * as ocorrências são base compartilhada e não carregam perfil — o filtro delas é o
 * `sku_id`, que já foi autorizado pela leitura do SKU.
 *
 * ## Só lê. A montagem é função pura, e continua sendo
 *
 * `montarAnuncio` não sabe o que é banco, e é isso que permite testá-la com
 * dezenas de combinações em milissegundos. Este módulo existe para juntar o que
 * está em três tabelas e entregar o objeto que ela recebe — nada mais. Nenhuma
 * regra de anúncio mora aqui.
 */
import { and, eq } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { montarFicha, type Ficha } from '@/dominio/compatibilidade/ficha';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import {
  REGISTRO_VAZIO,
  lerRegistro,
  riquezaDoRegistro,
  type RegistroDeProduto,
} from '@/dominio/identidade/registro';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno, sku } from '@/infra/banco/schema';
import { centavos, type Centavos } from '@/lib/dinheiro';
import type { OcorrenciaParaCatalogo } from './catalogo';

/** Um SKU na lista de escolha, com o que decide se vale montar agora. */
export interface CandidatoAAnuncio {
  readonly id: string;
  readonly titulo: string;
  readonly temEan: boolean;
  readonly temCusto: boolean;
  /** Quantos modelos de aparelho já são publicáveis. Zero vira aviso na montagem. */
  readonly compatibilidadesPublicaveis: number;
}

/** Tudo o que `montarAnuncio` e o alerta de catálogo leem do banco. */
export interface DadosParaMontagem {
  readonly skuId: string;
  readonly tituloInterno: string;
  /**
   * Tipo do produto — "refil de purificador de água".
   *
   * **Não existe coluna para isso em `sku`**, e por isso vem do registro extraído
   * das ocorrências, que é onde o dado mora de verdade (`atributos_extraidos`). Na
   * falta de registro, cai no título interno, que é o melhor palpite disponível: o
   * título interno é montado como "tipo marca modelo" pela propagação de identidade.
   *
   * A tela mostra este valor em campo editável em vez de usá-lo em silêncio — ver a
   * dívida anotada em pendências.
   */
  readonly tipoProduto: string;
  readonly modeloPeca: string | null;
  /**
   * Quantas peças vêm na embalagem.
   *
   * **O cadastro vence a extração**, como em `marca`: o número do `sku` é decisão de
   * quem tem a caixa na mão, e o do registro é o que um LLM leu de um anúncio de
   * terceiro. Só cai no extraído quando a coluna está vazia.
   */
  readonly quantidadeEmbalagem: number | null;
  readonly marca: string | null;
  readonly ean: string | null;
  readonly categoria: string | null;
  readonly pesoGramas: number | null;
  readonly dimensoesMm: {
    readonly comprimento: number;
    readonly largura: number;
    readonly altura: number;
  } | null;
  /**
   * Voltagem e medida funcional, do cadastro.
   *
   * Entram porque o checklist de atributos cobra as duas no nível `devolucao` e lia
   * `null` sempre: ninguém passava o valor, porque ele não existia no schema. Ganharam
   * coluna na migração 0010, e é daqui que saem para a conferência.
   */
  readonly voltagem: string | null;
  readonly medida: string | null;
  /**
   * Categoria com regra de órgão regulador, para o alerta de M12 (9.6).
   *
   * Mesma história das duas de cima em outro ponto: a coluna existe e a tela fiscal a
   * preenche, mas a montagem nunca a recebia — então `avaliarRegulacao` decidia sempre
   * sobre `null`, e o alerta que existe para evitar anúncio **cancelado** não tinha como
   * disparar.
   */
  readonly categoriaRegulada: string | null;
  readonly custoAtual: Centavos | null;
  readonly ficha: Ficha;
  readonly ocorrencias: readonly OcorrenciaParaCatalogo[];
}

export class RepositorioDeAnuncios {
  constructor(private readonly db: Banco) {}

  /**
   * SKUs que podem virar anúncio.
   *
   * Todos os ativos, inclusive os incompletos: esconder o SKU sem EAN esconderia
   * justamente o que o checklist de atributos existe para mostrar. A lista diz o que
   * falta em cada um, e a pessoa escolhe.
   */
  async candidatos(perfil: PerfilId, limite = 200): Promise<readonly CandidatoAAnuncio[]> {
    const linhas = await this.db
      .select({
        id: sku.id,
        titulo: sku.tituloInterno,
        ean: sku.ean,
        custoAtual: sku.custoAtual,
      })
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.ativo, true)))
      .limit(limite);

    const repoDeCompat = new RepositorioDeCompatibilidade(this.db);

    return Promise.all(
      linhas.map(async (l) => {
        const ficha = montarFicha(await repoDeCompat.doSku(l.id));
        return {
          id: l.id,
          titulo: l.titulo,
          temEan: l.ean !== null && l.ean !== '',
          temCusto: l.custoAtual !== null,
          compatibilidadesPublicaveis: ficha.publicaveis.length,
        };
      }),
    );
  }

  /**
   * Grava a categoria da plataforma no SKU.
   *
   * Existe porque `categoria` é o único atributo de nível `bloqueia` que ninguém
   * tinha onde preencher: sem ela o arquivo de importação não sai, e nenhuma tela
   * do sistema escrevia `categoria_ml`. O checklist apontava um problema sem
   * caminho de conserto, que é meio checklist.
   *
   * Hoje só o ML tem coluna de categoria no schema. Quando Shopee e Amazon
   * tiverem, isto passa a receber a plataforma — e por isso já devolve `false`
   * em vez de lançar quando o SKU não é do perfil: a tela trata como aviso.
   */
  async definirCategoriaMl(perfil: PerfilId, skuId: string, categoria: string): Promise<boolean> {
    const alterados = await this.db
      .update(sku)
      .set({ categoriaMl: categoria, atualizadoEm: new Date() })
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, skuId)))
      .returning({ id: sku.id });

    return alterados.length > 0;
  }

  /** Os dados de um SKU. `null` quando não é deste perfil — nunca lança por isso. */
  async dadosDoSku(perfil: PerfilId, skuId: string): Promise<DadosParaMontagem | null> {
    const linhas = await this.db
      .select()
      .from(sku)
      .where(and(eq(sku.perfilId, perfil), eq(sku.id, skuId)))
      .limit(1);

    const l = linhas[0];
    if (l === undefined) return null;

    const [compatibilidades, ocorrencias] = await Promise.all([
      new RepositorioDeCompatibilidade(this.db).doSku(skuId),
      this.db
        .select({
          plataformaOuSite: produtoExterno.plataformaOuSite,
          url: produtoExterno.url,
          vendedor: produtoExterno.vendedor,
          ean: produtoExterno.ean,
          atributos: produtoExterno.atributosExtraidos,
        })
        .from(produtoExterno)
        .where(eq(produtoExterno.skuId, skuId)),
    ]);

    const registro = registroMaisRico(ocorrencias.map((o) => o.atributos));

    return {
      skuId: l.id,
      tituloInterno: l.tituloInterno,
      tipoProduto: registro.tipoProduto ?? l.tituloInterno,
      modeloPeca: registro.modeloPeca,
      quantidadeEmbalagem: l.quantidadeEmbalagem ?? registro.quantidadeEmbalagem,
      marca: l.marca ?? registro.marca,
      ean: l.ean,
      // A categoria do ML é a que manda no arquivo de importação dele; a tela é por
      // plataforma, e hoje só o ML tem categoria cadastrada no schema.
      categoria: l.categoriaMl,
      pesoGramas: l.pesoG,
      dimensoesMm: l.dimMm,
      voltagem: l.voltagem,
      medida: l.medida,
      categoriaRegulada: l.categoriaRegulada,
      custoAtual: l.custoAtual === null ? null : centavos(l.custoAtual),
      ficha: montarFicha(compatibilidades),
      ocorrencias,
    };
  }
}

/**
 * O registro mais completo entre as ocorrências do SKU.
 *
 * Mais completo e não o mais recente: uma ocorrência nova de distribuidor que só
 * publica o código da peça é mais recente e sabe menos que a antiga de um anúncio
 * com a ficha inteira. `riquezaDoRegistro` já existe para essa comparação — foi
 * escrita para decidir se vale gastar LLM, e serve igual aqui.
 *
 * Registro ilegível é ignorado em silêncio de propósito: um `jsonb` gravado por
 * versão anterior do schema não deve impedir a montagem de um anúncio.
 */
function registroMaisRico(brutos: readonly unknown[]): RegistroDeProduto {
  let melhor = REGISTRO_VAZIO;
  let melhorRiqueza = 0;

  for (const bruto of brutos) {
    const leitura = lerRegistro(bruto);
    if (leitura.tipo !== 'ok') continue;
    const riqueza = riquezaDoRegistro(leitura.registro);
    if (riqueza > melhorRiqueza) {
      melhor = leitura.registro;
      melhorRiqueza = riqueza;
    }
  }

  return melhor;
}
