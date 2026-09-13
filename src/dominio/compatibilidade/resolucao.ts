/**
 * Resolução de compatibilidade — confiança graduada e conflito sinalizado.
 *
 * Recebe todas as evidências sobre um par (peça, aparelho) e devolve uma decisão
 * com confiança em pontos-base, o corte de publicação aplicado, e — o ponto que a
 * especificação faz questão — **inconsistência sinalizada para revisão em vez de
 * um lado escolhido em silêncio**.
 *
 * ## Por que combinar por complemento e não somar
 *
 * Somar força de evidência passa de 10 000 no terceiro item e não significa nada.
 * A combinação usada é o complemento do produto — `1 − Π(1 − fᵢ)` — que é
 * monótona (mais fonte nunca reduz), saturante (nunca passa de 1) e tem leitura
 * direta: "a chance de *todas* as fontes estarem erradas ao mesmo tempo". É a
 * regra que faz três concorrentes chegarem a 0,80 partindo de 0,4152 cada, que é
 * a âncora da especificação.
 *
 * Toda a aritmética é inteira, em pontos-base, com divisão truncada — o
 * arredondamento sempre **para baixo**, que é o lado seguro num corte que decide
 * publicar ou não.
 *
 * ## Por que objeção desconta em vez de vencer
 *
 * Fonte que diz "não serve" não zera a que diz "serve": desconta. `apoio × (1 −
 * objeção)` é a confiança no apoio descontada da chance de a objeção estar certa.
 * O efeito prático foi medido em teste: **qualquer** objeção, mesmo a mais fraca,
 * derruba o par abaixo do corte de publicação — o que é o comportamento desejado,
 * porque discordância em compatibilidade de peça é exatamente o caso que merece
 * olho humano antes de virar anúncio.
 */
import {
  ehDoFabricante,
  ETIQUETA_DA_EVIDENCIA,
  forcaDaEvidencia,
  TETO_DA_EVIDENCIA,
  type Evidencia,
  type TipoDeEvidencia,
  type VerificadoPor,
} from './evidencia';

/** Confiança mínima para uma compatibilidade entrar na ficha do anúncio. */
export const LIMIAR_PUBLICACAO_BP = 7_000;

/** Escala inteira de confiança: 0 a 10 000 pontos-base. */
export const TOTAL_BP = 10_000;

export const DECISOES = ['serve', 'nao_serve', 'indefinido'] as const;
export type Decisao = (typeof DECISOES)[number];

/** Uma evidência e o peso que ela teve na conta. Auditoria linha por linha. */
export interface Contribuicao {
  readonly tipo: TipoDeEvidencia;
  readonly forcaBp: number;
  readonly negativa: boolean;
  readonly url: string | null;
  /** `false` quando não entrou na conta por não ser fonte independente. */
  readonly contada: boolean;
}

export interface Resolucao {
  readonly decisao: Decisao;
  /** Confiança na decisão, já descontada a objeção. */
  readonly confiancaBp: number;
  /** Confiança combinada de quem afirma que serve. */
  readonly apoioBp: number;
  /** Confiança combinada de quem afirma que não serve. */
  readonly objecaoBp: number;
  readonly publicavel: boolean;
  /** Texto do conflito, ou `null`. Quando presente, a linha vai para revisão. */
  readonly conflito: string | null;
  readonly motivo: string;
  readonly verificadoPor: VerificadoPor;
  readonly contribuicoes: readonly Contribuicao[];
}

/**
 * Combina forças independentes: `1 − Π(1 − fᵢ)`, em pontos-base inteiros.
 *
 * Ordena decrescente antes de multiplicar porque o truncamento a cada passo faz o
 * resultado depender da ordem em um ponto-base, e resultado que muda com a ordem
 * de leitura do banco é a classe de bug que ninguém acha depois.
 */
export function combinar(forcas: readonly number[]): number {
  let restante = TOTAL_BP;
  for (const forca of [...forcas].sort((a, b) => b - a)) {
    const limpa = Math.max(0, Math.min(TOTAL_BP, Math.trunc(forca)));
    restante = Math.trunc((restante * (TOTAL_BP - limpa)) / TOTAL_BP);
    if (restante === 0) break;
  }
  return TOTAL_BP - restante;
}

/** Desconta `b` de `a`: `a × (1 − b)`, truncado. */
function descontar(a: number, b: number): number {
  return Math.trunc((a * (TOTAL_BP - b)) / TOTAL_BP);
}

/**
 * Fica só com as evidências que contam como fontes **independentes**.
 *
 * Duas evidências do mesmo tipo e da mesma URL são a mesma fonte lida duas vezes,
 * e contar as duas infla a confiança sem informação nova. Evidência **sem URL** é
 * o caso que importa: não há como distinguir duas fontes anônimas de uma
 * registrada duas vezes, então conta uma só por tipo e lado. Sem esta regra,
 * colar o mesmo anúncio de concorrente três vezes publicaria a compatibilidade —
 * que é a forma mais fácil de transformar descuido em devolução.
 */
function independentes(evidencias: readonly Evidencia[]): ReadonlySet<Evidencia> {
  const vistas = new Set<string>();
  const contadas = new Set<Evidencia>();
  for (const e of evidencias) {
    const chave = `${e.tipo}|${e.negativa ? 'n' : 'p'}|${e.url ?? '(sem url)'}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    contadas.add(e);
  }
  return contadas;
}

/** Momento da evidência, em milissegundos. Data ilegível vira o começo do tempo. */
function momento(e: Evidencia): number {
  const t = Date.parse(e.em);
  return Number.isNaN(t) ? 0 : t;
}

/** Confiança combinada de um lado, limitada pelo teto do tipo mais forte presente. */
function confiancaDoLado(lado: readonly Evidencia[]): number {
  if (lado.length === 0) return 0;
  const combinada = combinar(lado.map(forcaDaEvidencia));
  const teto = Math.max(...lado.map((e) => TETO_DA_EVIDENCIA[e.tipo]));
  return Math.min(combinada, teto);
}

/** O tipo mais forte de um lado, para nomear o conflito com a fonte que pesa. */
function maisForte(lado: readonly Evidencia[]): TipoDeEvidencia | null {
  let escolhido: TipoDeEvidencia | null = null;
  let melhor = -1;
  for (const e of lado) {
    const f = forcaDaEvidencia(e);
    if (f > melhor) {
      melhor = f;
      escolhido = e.tipo;
    }
  }
  return escolhido;
}

function textoDoConflito(pro: readonly Evidencia[], contra: readonly Evidencia[]): string | null {
  const a = maisForte(pro);
  const b = maisForte(contra);
  if (a === null || b === null) return null;
  return `${ETIQUETA_DA_EVIDENCIA[a]} afirma que serve e ${ETIQUETA_DA_EVIDENCIA[b]} afirma que não serve`;
}

function contribuicoes(
  evidencias: readonly Evidencia[],
  contadas: ReadonlySet<Evidencia>,
): readonly Contribuicao[] {
  return evidencias.map((e) => ({
    tipo: e.tipo,
    forcaBp: forcaDaEvidencia(e),
    negativa: e.negativa,
    url: e.url,
    contada: contadas.has(e),
  }));
}

const SEM_EVIDENCIA: Resolucao = {
  decisao: 'indefinido',
  confiancaBp: 0,
  apoioBp: 0,
  objecaoBp: 0,
  publicavel: false,
  conflito: null,
  motivo: 'nenhuma evidência registrada',
  verificadoPor: 'ia',
  contribuicoes: [],
};

/**
 * Resolve o par a partir de todas as evidências conhecidas.
 *
 * A ordem das regras é o desenho:
 *
 * 1. **Sem evidência** é `indefinido`, não `não serve`. Ausência de prova não é
 *    prova de ausência, e publicar "não serve" por falta de dado perderia venda.
 * 2. **Decisão humana vence**, com uma exceção temporal: evidência do fabricante
 *    que apareceu **depois** da revisão humana reabre o caso. Uma pessoa que
 *    revisou já decidiu; informação nova depois da decisão é motivo para olhar de
 *    novo. Fonte fraca que chega depois não reabre nada — é a regra do ADR 0002.
 * 3. **Contradição desconta e sinaliza.** Nunca escolhe um lado calado.
 */
export function resolverCompatibilidade(evidencias: readonly Evidencia[]): Resolucao {
  if (evidencias.length === 0) return SEM_EVIDENCIA;

  const contadas = independentes(evidencias);
  const uteis = evidencias.filter((e) => contadas.has(e));
  const detalhe = contribuicoes(evidencias, contadas);

  const positivas = uteis.filter((e) => !e.negativa);
  const negativas = uteis.filter((e) => e.negativa);
  const apoioBp = confiancaDoLado(positivas);
  const objecaoBp = confiancaDoLado(negativas);

  const humanas = [...uteis.filter((e) => e.tipo === 'humano')].sort(
    (a, b) => momento(a) - momento(b),
  );
  const humana = humanas.at(-1);

  if (humana !== undefined) {
    const contradizem = uteis.filter(
      (e) =>
        ehDoFabricante(e.tipo) && e.negativa !== humana.negativa && momento(e) > momento(humana),
    );
    if (contradizem.length > 0) {
      const tipo = maisForte(contradizem);
      return {
        decisao: 'indefinido',
        confiancaBp: 0,
        apoioBp,
        objecaoBp,
        publicavel: false,
        conflito: `revisão humana disse que ${humana.negativa ? 'não serve' : 'serve'} e depois ${ETIQUETA_DA_EVIDENCIA[tipo ?? 'manual_fabricante']} disse o contrário`,
        motivo: 'evidência do fabricante chegou depois da revisão; precisa de nova conferência',
        verificadoPor: 'humano',
        contribuicoes: detalhe,
      };
    }
    const serve = !humana.negativa;
    return {
      decisao: serve ? 'serve' : 'nao_serve',
      confiancaBp: TOTAL_BP,
      apoioBp,
      objecaoBp,
      publicavel: serve,
      conflito: null,
      motivo: 'conferido por pessoa',
      verificadoPor: 'humano',
      contribuicoes: detalhe,
    };
  }

  const temFabricante = uteis.some((e) => ehDoFabricante(e.tipo));
  const verificadoPor: VerificadoPor = temFabricante ? 'fabricante' : 'ia';
  const conflito = textoDoConflito(positivas, negativas);

  if (apoioBp === objecaoBp) {
    return {
      decisao: 'indefinido',
      confiancaBp: 0,
      apoioBp,
      objecaoBp,
      publicavel: false,
      conflito,
      motivo: 'fontes de mesma força discordam',
      verificadoPor,
      contribuicoes: detalhe,
    };
  }

  const serve = apoioBp > objecaoBp;
  const confiancaBp = serve ? descontar(apoioBp, objecaoBp) : descontar(objecaoBp, apoioBp);
  const publicavel = serve && confiancaBp >= LIMIAR_PUBLICACAO_BP && conflito === null;

  return {
    decisao: serve ? 'serve' : 'nao_serve',
    confiancaBp,
    apoioBp,
    objecaoBp,
    publicavel,
    conflito,
    motivo: motivoDe(serve, confiancaBp, conflito, uteis),
    verificadoPor,
    contribuicoes: detalhe,
  };
}

function motivoDe(
  serve: boolean,
  confiancaBp: number,
  conflito: string | null,
  uteis: readonly Evidencia[],
): string {
  const lado = uteis.filter((e) => e.negativa !== serve);
  const tipo = maisForte(lado);
  const fonte = tipo === null ? 'evidência' : ETIQUETA_DA_EVIDENCIA[tipo];
  const quantas = lado.length === 1 ? '' : ` e ${lado.length - 1} outra(s)`;
  const base = `${serve ? 'serve' : 'não serve'} segundo ${fonte}${quantas}`;
  if (conflito !== null) return `${base}, com fonte discordando`;
  if (serve && confiancaBp < LIMIAR_PUBLICACAO_BP) return `${base}, abaixo do corte de publicação`;
  return base;
}
