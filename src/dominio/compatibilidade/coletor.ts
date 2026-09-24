/**
 * Coleta de evidência a partir do que já está no banco — sem LLM e sem API.
 *
 * A especificação lista cinco fontes de evidência para M4: manual do fabricante,
 * página oficial, descrição de concorrente, fórum e catálogo de distribuidor. Este
 * módulo constrói a terceira, que é a única que já está disponível hoje **de
 * graça**: todo anúncio que a ingestão capturou tem um título, e título de peça de
 * reposição cita os modelos em que a peça serve. É literalmente para isso que o
 * vendedor escreve o título daquele jeito.
 *
 * ## Por que isso é casamento e não extração
 *
 * Extrair "marca + tipo de aparelho" de um título livre exige julgamento e é
 * trabalho de LLM (M1, que depende de chave). Mas o caminho inverso é
 * determinístico: os aparelhos já estão cadastrados, com marca e modelo, e a
 * pergunta "este título cita o código `PA21G`?" é comparação de texto normalizado.
 * O reconhecedor de código de modelo já existe e já tem teste — o de `canonico.ts`,
 * escrito para a resolução de identidade.
 *
 * O ganho é o que a especificação chama de fosso: cada anúncio de concorrente que
 * entra no sistema por qualquer porta vira evidência de compatibilidade, e o grafo
 * cresce sozinho enquanto o catálogo cresce.
 *
 * ## O anúncio que é seu não confirma nada
 *
 * Anúncio vindo da sua própria exportação (M1) entra como `anuncio_proprio`, que
 * vale zero. Deixar o seu próprio título confirmar a sua própria ficha é como erro
 * de cadastro fica permanente: ele passa a ser a evidência de si mesmo. Entra
 * registrado, aparece na fila com o título citado, e uma pessoa confirma em um
 * clique — aí vira `humano`, que vale tudo.
 */
import { lerRegistro } from '@/dominio/identidade/registro';
import type { Fonte } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno } from '@/infra/banco/schema';
import { eq } from 'drizzle-orm';
import { casarAnuncio, indexarPorCodigo } from './casamento';
import { ehInferida, forcaDaEvidencia, type Evidencia, type TipoDeEvidencia } from './evidencia';
import { evidenciaDoAchado, lerFonte, type TipoDeFonte } from './fonte';
import { inferirCompatibilidade, type AfirmacaoConhecida } from './inferencia';
import { resolverCompatibilidade } from './resolucao';
import {
  rotuloDoAparelho,
  type AparelhoGravado,
  type RepositorioDeCompatibilidade,
} from './repositorio';

// O casamento mora em `casamento.ts`, que a leitura de fonte também usa; o coletor o
// reexporta para quem já o importava daqui.
export {
  casarAnuncio,
  indexarPorCodigo,
  type AchadoNoAnuncio,
  type AparelhoIndexado,
  type CasamentoDoAnuncio,
  type EntradaDoCasamento,
  type IndiceDeAparelhos,
} from './casamento';

/**
 * Tipo de evidência que um anúncio capturado produz, pela procedência.
 *
 * `m1_planilha` é, por construção da fase 3, a exportação do painel **do próprio
 * vendedor** — então é `anuncio_proprio`, que vale zero. Se algum dia entrar
 * planilha de distribuidor por essa mesma porta, este mapa precisa de um caminho
 * para `catalogo_distribuidor`; está anotado nas pendências.
 */
export function tipoDaEvidenciaDaFonte(fonte: Fonte): TipoDeEvidencia {
  return fonte === 'm1_planilha' ? 'anuncio_proprio' : 'concorrente';
}

export interface ResultadoDaColeta {
  readonly anuncios: number;
  readonly evidenciasNovas: number;
  readonly evidenciasAtualizadas: number;
  readonly inferencias: number;
  readonly inconsistencias: number;
  readonly ambiguos: readonly string[];
}

const SEM_COLETA: ResultadoDaColeta = {
  anuncios: 0,
  evidenciasNovas: 0,
  evidenciasAtualizadas: 0,
  inferencias: 0,
  inconsistencias: 0,
  ambiguos: [],
};

/** O que uma fonte de fora rendeu: para o aviso dizer exatamente o que aconteceu. */
export interface ResultadoDaFonte {
  /** Aparelhos que entraram com a força do tipo. */
  readonly comForca: number;
  /** Aparelhos que entraram abaixo do corte, para conferir: a fonte não cita o produto. */
  readonly paraConferir: number;
  /** Citados longe do produto no catálogo ou no fórum: ficaram de fora. */
  readonly longeDoProduto: number;
  readonly ambiguos: readonly string[];
  /** O produto tem código próprio no título? Sem ele, a fonte não o reconhece. */
  readonly produtoTemCodigo: boolean;
  readonly inferencias: number;
}

export class ColetorDeCompatibilidade {
  constructor(
    private readonly db: Banco,
    private readonly repo: RepositorioDeCompatibilidade,
  ) {}

  /**
   * Varre os anúncios ligados ao SKU, grava evidência e depois infere por família.
   *
   * A ordem é obrigatória: inferir antes de coletar usaria uma base incompleta e
   * proporia irmão a partir de nada. Inferir depois é idempotente — a evidência de
   * inferência não duplica, e a segunda passada só atualiza a data.
   */
  async coletarDoSku(skuId: string): Promise<ResultadoDaColeta> {
    const anuncios = await this.db
      .select({
        titulo: produtoExterno.tituloBruto,
        url: produtoExterno.url,
        fonte: produtoExterno.fonte,
        coletadoEm: produtoExterno.coletadoEm,
        atributos: produtoExterno.atributosExtraidos,
      })
      .from(produtoExterno)
      .where(eq(produtoExterno.skuId, skuId));

    if (anuncios.length === 0) return SEM_COLETA;

    const todos = await this.repo.aparelhos();
    const indice = indexarPorCodigo(todos);

    let novas = 0;
    let atualizadas = 0;
    const ambiguos = new Set<string>();

    for (const anuncio of anuncios) {
      // Registro ilegível não interrompe a coleta: o título continua valendo, e é
      // dele que vem a maior parte da evidência hoje. A extração é opcional aqui.
      const leitura = lerRegistro(anuncio.atributos);
      const casamento = casarAnuncio({
        titulo: anuncio.titulo,
        ...(leitura.tipo === 'ok'
          ? { modelosCompativeis: leitura.registro.modelosCompativeis }
          : {}),
        indice,
      });
      for (const c of casamento.ambiguos) ambiguos.add(c);

      for (const achado of casamento.achados) {
        const evidencia: Evidencia = {
          tipo: tipoDaEvidenciaDaFonte(anuncio.fonte),
          url: anuncio.url,
          trecho: anuncio.titulo,
          em: anuncio.coletadoEm.toISOString(),
          negativa: false,
          forcaBp: null,
        };
        const { nova } = await this.repo.registrarEvidencia({
          skuId,
          aparelhoId: achado.aparelhoId,
          evidencia,
        });
        if (nova) novas += 1;
        else atualizadas += 1;
      }
    }

    const propagado = await this.propagarPorFamilia(skuId, todos);

    return {
      anuncios: anuncios.length,
      evidenciasNovas: novas,
      evidenciasAtualizadas: atualizadas,
      inferencias: propagado.inferencias,
      inconsistencias: propagado.inconsistencias,
      ambiguos: [...ambiguos].sort(),
    };
  }

  /**
   * Lê uma fonte de fora — manual, página oficial, catálogo, fórum — para um produto, e
   * grava o que ela diz. As regras de força estão em `fonte.ts`; aqui é só gravar e
   * propagar por família, como a coleta dos anúncios faz.
   */
  async coletarDaFonte(params: {
    readonly skuId: string;
    readonly tituloDoProduto: string;
    readonly tipo: TipoDeFonte;
    readonly texto: string;
    readonly url: string | null;
    /** Nome do arquivo enviado, quando não há endereço. */
    readonly origem: string | null;
    readonly agora: Date;
  }): Promise<ResultadoDaFonte> {
    const todos = await this.repo.aparelhos();
    const leitura = lerFonte({
      texto: params.texto,
      tipo: params.tipo,
      tituloDoProduto: params.tituloDoProduto,
      indice: indexarPorCodigo(todos),
    });

    for (const achado of leitura.achados) {
      await this.repo.registrarEvidencia({
        skuId: params.skuId,
        aparelhoId: achado.aparelhoId,
        evidencia: evidenciaDoAchado({
          achado,
          tipo: params.tipo,
          url: params.url,
          origem: params.origem,
          em: params.agora,
        }),
      });
    }
    const propagado =
      leitura.achados.length === 0
        ? { inferencias: 0 }
        : await this.propagarPorFamilia(params.skuId, todos);

    return {
      comForca: leitura.achados.filter((a) => a.citaOProduto).length,
      paraConferir: leitura.achados.filter((a) => !a.citaOProduto).length,
      longeDoProduto: leitura.longeDoProduto,
      ambiguos: leitura.ambiguos,
      produtoTemCodigo: leitura.codigosDoProduto.length > 0,
      inferencias: propagado.inferencias,
    };
  }

  /**
   * Propaga por família e grava a inconsistência que a restrição encontrar.
   *
   * A inconsistência de família só é escrita quando a linha **não** tem conflito de
   * evidência: o conflito de evidência é mais específico e mais acionável, e
   * sobrescrever perderia a informação de qual fonte discordou de qual.
   */
  async propagarPorFamilia(
    skuId: string,
    todosOsAparelhos?: readonly AparelhoGravado[],
  ): Promise<{ readonly inferencias: number; readonly inconsistencias: number }> {
    const linhas = await this.repo.doSku(skuId);
    if (linhas.length === 0) return { inferencias: 0, inconsistencias: 0 };

    const grupos = new Set<string>();
    for (const l of linhas) {
      if (l.aparelho.familia !== null) grupos.add(l.aparelho.familia);
      if (l.aparelho.linhagem !== null) grupos.add(l.aparelho.linhagem);
    }

    const universo = todosOsAparelhos ?? (await this.repo.aparelhos());
    const aparelhos = universo
      .filter(
        (a) =>
          (a.familia !== null && grupos.has(a.familia)) ||
          (a.linhagem !== null && grupos.has(a.linhagem)),
      )
      .map((a) => ({
        id: a.id,
        familia: a.familia,
        linhagem: a.linhagem,
        rotulo: rotuloDoAparelho(a),
      }));

    const afirmacoes: readonly AfirmacaoConhecida[] = linhas.map((l) => ({
      aparelhoId: l.aparelhoId,
      decisao: l.decisao,
      confiancaBp: l.confiancaBp,
      // Só conta como evidência de verdade o que não é inferido **e** tem força.
      // Anúncio próprio vale zero, então não serve de origem — se servisse, o seu
      // próprio título viraria a semente de uma família inteira inferida.
      inferida: !l.evidencias.some((e) => !ehInferida(e.tipo) && forcaDaEvidencia(e) > 0),
    }));

    const resultado = inferirCompatibilidade({ aparelhos, afirmacoes, agora: new Date() });

    for (const inferencia of resultado.inferencias) {
      await this.repo.registrarEvidencia({
        skuId,
        aparelhoId: inferencia.aparelhoId,
        evidencia: inferencia.evidencia,
      });
    }

    const porAparelho = new Map(linhas.map((l) => [l.aparelhoId, l]));
    for (const inconsistencia of resultado.inconsistencias) {
      for (const id of [...inconsistencia.serveEm, ...inconsistencia.naoServeEm]) {
        const linha = porAparelho.get(id);
        if (linha === undefined) continue;
        const resolucao = resolverCompatibilidade(linha.evidencias);
        if (resolucao.conflito !== null) continue;
        await this.repo.gravarResolucao({
          skuId,
          aparelhoId: id,
          evidencias: linha.evidencias,
          resolucao: { ...resolucao, conflito: inconsistencia.descricao, publicavel: false },
        });
      }
    }

    return {
      inferencias: resultado.inferencias.length,
      inconsistencias: resultado.inconsistencias.length,
    };
  }
}
