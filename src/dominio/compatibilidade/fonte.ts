/**
 * Compatibilidade tirada de uma fonte de fora (M4, etapas 6.10 e 6.11): manual do
 * fabricante, página oficial, catálogo de distribuidor e fórum.
 *
 * As quatro são texto — o manual em PDF, a página, a tabela do distribuidor, o post do
 * grupo de assistência —, e o que se procura nelas é o mesmo que no título de anúncio: o
 * código de modelo de um aparelho cadastrado. Casamento, e não extração: sem IA, pelo
 * mesmo reconhecedor de código (CLAUDE.md, 3.5).
 *
 * ## A fonte precisa falar deste produto
 *
 * O manual do purificador cita o purificador; o catálogo do distribuidor cita cem
 * aparelhos e trinta refis. O código do aparelho sozinho não diz que **esta** peça serve
 * nele, então a regra olha também o código do produto — o código de peça do título do
 * SKU que não é código de aparelho:
 *
 * - Manual e página oficial falam de uma coisa só. Se citam o código do produto, cada
 *   aparelho citado entra com a força do tipo — e manual publica sozinho. Se não citam,
 *   entra com força abaixo do corte, e vai para a fila: uma pessoa confere.
 * - Catálogo e fórum falam de muitas. Só conta o aparelho que está na **seção** do
 *   produto: na mesma linha que ele, ou abaixo dele antes de outra peça ser citada —
 *   `EF-ELX-21:` e a lista de aparelhos embaixo, a pergunta do fórum e a resposta. O
 *   aparelho numa linha que cita outra peça é daquela peça, e fica de fora.
 *
 * Produto sem código próprio no título não tem como ser reconhecido na fonte: o que se
 * acha vai todo para a fila, ou, no catálogo e no fórum, não entra.
 */
import { codigosDeModelo, normalizarCodigoDeModelo } from '@/dominio/identidade/canonico';
import { casarAnuncio, type IndiceDeAparelhos } from './casamento';
import type { Evidencia, TipoDeEvidencia } from './evidencia';

export const TIPOS_DE_FONTE = [
  'manual_fabricante',
  'pagina_oficial',
  'catalogo_distribuidor',
  'forum',
] as const satisfies readonly TipoDeEvidencia[];
export type TipoDeFonte = (typeof TIPOS_DE_FONTE)[number];

/**
 * Força da evidência de manual ou página oficial que não cita o produto: abaixo do corte
 * de publicação (7 000), então vai para a fila em vez de para o anúncio.
 */
export const FORCA_SEM_O_PRODUTO_BP = 5_000;

/**
 * Quantas linhas para cima a seção de uma peça alcança. Lista de aparelhos embaixo de um
 * refil raramente passa disso; mais longe, é outra parte do documento.
 */
export const ALCANCE_DA_SECAO = 30;

/** Trecho citado na evidência: o bastante para conferir sem abrir a fonte. */
const TAMANHO_DO_TRECHO = 240;

/** O catálogo e o fórum falam de muitas peças; o manual e a página, de uma. */
function falaDeMuitas(tipo: TipoDeFonte): boolean {
  return tipo === 'catalogo_distribuidor' || tipo === 'forum';
}

/** Os códigos de peça do título do produto: os que não são de aparelho cadastrado. */
export function codigosDoProduto(titulo: string, indice: IndiceDeAparelhos): readonly string[] {
  return codigosDeModelo(titulo).filter((c) => !indice.has(c));
}

/**
 * O código como está escrito no título — `EF-ELX-21`, e não `EFELX21`. A comparação é
 * pela forma normalizada, mas a pessoa procura no manual a grafia que ela conhece.
 */
export function comoEstaNoTitulo(titulo: string, codigo: string): string {
  const token = titulo
    .split(/[^a-z0-9\-._]+/i)
    .find((t) => t !== '' && normalizarCodigoDeModelo(t) === codigo);
  return token ?? codigo;
}

export interface AchadoNaFonte {
  readonly aparelhoId: string;
  readonly codigo: string;
  /** A linha onde o aparelho aparece, para a evidência citar. */
  readonly trecho: string | null;
  /** A fonte cita o produto — no todo, ou perto do aparelho. Vale a força do tipo. */
  readonly citaOProduto: boolean;
}

export interface LeituraDaFonte {
  readonly achados: readonly AchadoNaFonte[];
  /** Aparelhos citados longe do produto, no catálogo e no fórum: ficaram de fora. */
  readonly longeDoProduto: number;
  /** Códigos que existem em mais de uma marca, e a fonte não disse qual. */
  readonly ambiguos: readonly string[];
  readonly codigosDoProduto: readonly string[];
  /** A fonte cita o código do produto em algum lugar. */
  readonly citaOProduto: boolean;
}

function trechoDaLinha(linha: string): string {
  return linha.length <= TAMANHO_DO_TRECHO ? linha : `${linha.slice(0, TAMANHO_DO_TRECHO - 1)}…`;
}

/**
 * A linha `i` está na seção do produto? A própria linha decide quando cita uma peça;
 * senão, a última linha acima que cita uma, dentro do alcance; e, sem nenhuma acima, a
 * de baixo — a resposta do fórum que diz a peça depois do aparelho.
 */
function naSecaoDoProduto(
  parteDaLinha: readonly ('produto' | 'outra' | null)[],
  i: number,
): boolean {
  for (let j = i; j >= 0 && j >= i - ALCANCE_DA_SECAO; j -= 1) {
    const parte = parteDaLinha[j];
    if (parte !== null && parte !== undefined) return parte === 'produto';
  }
  return parteDaLinha[i + 1] === 'produto';
}

/** O que a fonte diz sobre este produto: os aparelhos citados, e com que força. */
export function lerFonte(params: {
  readonly texto: string;
  readonly tipo: TipoDeFonte;
  readonly tituloDoProduto: string;
  readonly indice: IndiceDeAparelhos;
}): LeituraDaFonte {
  const linhas = params.texto
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
  const doProduto = codigosDoProduto(params.tituloDoProduto, params.indice);
  const conjuntoDoProduto = new Set(doProduto);
  const codigosDaLinha = linhas.map((l) => new Set(codigosDeModelo(l)));
  // De que peça cada linha fala: deste produto, de outra (código que não é de aparelho
  // nem do produto), ou de nenhuma.
  const parteDaLinha = codigosDaLinha.map((cs): 'produto' | 'outra' | null => {
    const codigos = [...cs];
    if (codigos.some((c) => conjuntoDoProduto.has(c))) return 'produto';
    return codigos.some((c) => !params.indice.has(c)) ? 'outra' : null;
  });
  const linhaCitaOProduto = parteDaLinha.map((p) => p === 'produto');
  const citaOProduto = linhaCitaOProduto.some(Boolean);

  // A marca decide o código que duas marcas usam, e ela costuma estar no cabeçalho e não
  // na linha: o casamento olha a fonte inteira.
  const casamento = casarAnuncio({ titulo: linhas.join('\n'), indice: params.indice });

  const achados: AchadoNaFonte[] = [];
  let longeDoProduto = 0;
  for (const achado of casamento.achados) {
    const ocorrencias = codigosDaLinha.flatMap((cs, i) => (cs.has(achado.codigo) ? [i] : []));
    const perto = ocorrencias.some((i) => naSecaoDoProduto(parteDaLinha, i));

    if (falaDeMuitas(params.tipo) && !perto) {
      longeDoProduto += 1;
      continue;
    }

    // A linha que cita o produto junto é a que melhor prova; senão, a primeira.
    const melhor = ocorrencias.find((i) => linhaCitaOProduto[i] === true) ?? ocorrencias[0] ?? null;
    achados.push({
      aparelhoId: achado.aparelhoId,
      codigo: achado.codigo,
      trecho: melhor === null ? null : trechoDaLinha(linhas[melhor] ?? ''),
      citaOProduto: falaDeMuitas(params.tipo) ? perto : citaOProduto,
    });
  }

  return {
    achados,
    longeDoProduto,
    ambiguos: casamento.ambiguos,
    codigosDoProduto: doProduto,
    citaOProduto,
  };
}

/** A evidência de um achado. Quem não cita o produto entra abaixo do corte. */
export function evidenciaDoAchado(params: {
  readonly achado: AchadoNaFonte;
  readonly tipo: TipoDeFonte;
  readonly url: string | null;
  /** Nome do arquivo enviado, quando a fonte não tem endereço: vai na frente do trecho. */
  readonly origem: string | null;
  readonly em: Date;
}): Evidencia {
  const { achado } = params;
  const trecho =
    params.origem === null
      ? achado.trecho
      : `${params.origem}${achado.trecho === null ? '' : `: ${achado.trecho}`}`;
  return {
    tipo: params.tipo,
    url: params.url,
    trecho,
    em: params.em.toISOString(),
    negativa: false,
    forcaBp: achado.citaOProduto ? null : FORCA_SEM_O_PRODUTO_BP,
  };
}
