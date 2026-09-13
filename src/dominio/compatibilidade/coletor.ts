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
import {
  codigosDeModelo,
  normalizarCodigoDeModelo,
  normalizarMarca,
  normalizarTexto,
} from '@/dominio/identidade/canonico';
import { lerRegistro } from '@/dominio/identidade/registro';
import type { Fonte } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno } from '@/infra/banco/schema';
import { eq } from 'drizzle-orm';
import { ehInferida, forcaDaEvidencia, type Evidencia, type TipoDeEvidencia } from './evidencia';
import { inferirCompatibilidade, type AfirmacaoConhecida } from './inferencia';
import { resolverCompatibilidade } from './resolucao';
import {
  rotuloDoAparelho,
  type AparelhoGravado,
  type RepositorioDeCompatibilidade,
} from './repositorio';

/** Aparelho reduzido ao que o casamento precisa. */
export interface AparelhoIndexado {
  readonly id: string;
  readonly codigo: string;
  readonly marca: string;
}

export type IndiceDeAparelhos = ReadonlyMap<string, readonly AparelhoIndexado[]>;

/**
 * Indexa aparelhos pelo código de modelo normalizado.
 *
 * Aparelho cujo modelo não tem forma de código fica fora: casar `Purificador
 * Master` por texto livre casaria com qualquer anúncio que tivesse a palavra, e
 * compatibilidade errada aqui custa devolução.
 */
export function indexarPorCodigo(
  aparelhos: readonly Pick<AparelhoGravado, 'id' | 'marca' | 'modelo'>[],
): IndiceDeAparelhos {
  const indice = new Map<string, AparelhoIndexado[]>();
  for (const a of aparelhos) {
    const codigo = normalizarCodigoDeModelo(a.modelo);
    if (codigo === null) continue;
    const entrada: AparelhoIndexado = { id: a.id, codigo, marca: normalizarMarca(a.marca) };
    const atual = indice.get(codigo);
    if (atual === undefined) indice.set(codigo, [entrada]);
    else atual.push(entrada);
  }
  return indice;
}

export interface AchadoNoAnuncio {
  readonly aparelhoId: string;
  readonly codigo: string;
  /** `true` quando veio do registro extraído, não do título. */
  readonly doRegistro: boolean;
}

export interface CasamentoDoAnuncio {
  readonly achados: readonly AchadoNoAnuncio[];
  /** Códigos que existem em mais de uma marca e o anúncio não desambiguou. */
  readonly ambiguos: readonly string[];
  /** Todos os códigos que o anúncio cita, casados ou não. Para a tela explicar. */
  readonly codigos: readonly string[];
}

export interface EntradaDoCasamento {
  readonly titulo: string;
  /** `modelosCompativeis` do registro extraído, quando a extração já rodou. */
  readonly modelosCompativeis?: readonly string[];
  readonly indice: IndiceDeAparelhos;
}

/**
 * Casa os códigos citados por um anúncio contra os aparelhos cadastrados.
 *
 * Quando o mesmo código existe em duas marcas, exige que o anúncio nomeie a marca.
 * Duas marcas podem usar `XP21A` para aparelhos diferentes, e escolher uma no
 * escuro seria inventar compatibilidade — então fica registrado como ambíguo e
 * ninguém decide por palpite.
 */
export function casarAnuncio(entrada: EntradaDoCasamento): CasamentoDoAnuncio {
  const doTitulo = new Set(codigosDeModelo(entrada.titulo));
  const doRegistro = new Set<string>();
  for (const m of entrada.modelosCompativeis ?? []) {
    const c = normalizarCodigoDeModelo(m);
    if (c !== null) doRegistro.add(c);
  }

  const tituloNormalizado = normalizarTexto(entrada.titulo);
  const achados: AchadoNoAnuncio[] = [];
  const ambiguos: string[] = [];
  const codigos = [...new Set([...doTitulo, ...doRegistro])].sort();

  for (const codigo of codigos) {
    const candidatos = entrada.indice.get(codigo);
    if (candidatos === undefined || candidatos.length === 0) continue;

    const marcas = new Set(candidatos.map((c) => c.marca));
    let escolhidos = candidatos;
    if (marcas.size > 1) {
      escolhidos = candidatos.filter((c) => tituloNormalizado.includes(c.marca));
      if (new Set(escolhidos.map((c) => c.marca)).size !== 1) {
        ambiguos.push(codigo);
        continue;
      }
    }

    for (const c of escolhidos) {
      achados.push({ aparelhoId: c.id, codigo, doRegistro: !doTitulo.has(codigo) });
    }
  }

  return { achados, ambiguos, codigos };
}

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
