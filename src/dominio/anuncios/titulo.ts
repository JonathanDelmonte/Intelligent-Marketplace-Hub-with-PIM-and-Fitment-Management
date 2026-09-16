/**
 * Gerador de título de anúncio (M9).
 *
 * A especificação é precisa sobre o que faz um título bom em peça de reposição:
 * "montando com os termos que as pessoas realmente buscam, dentro do limite de
 * caracteres, sem adjetivo inútil. **Em peça de reposição, o título precisa conter
 * os códigos de modelo — é por eles que o comprador busca.**"
 *
 * ## A ordem dos termos é a decisão que mais importa
 *
 * O código do **aparelho** vem antes do código da peça, e isso não é detalhe: o
 * comprador sabe o modelo do purificador dele — está na etiqueta —, e quase nunca
 * sabe o código do refil. Ele busca "refil PA21G", não "refil EF-ELX-21". Então a
 * ordem é tipo → marca → modelos compatíveis → código da peça → quantidade, e o
 * que é cortado por falta de espaço é cortado do fim.
 *
 * ## O que é cortado é relatado
 *
 * Cada modelo que não cabe é uma busca em que o anúncio não aparece. O gerador
 * devolve a lista de cortados, porque isso muda uma decisão: dois anúncios com
 * três modelos cada encontram mais gente que um anúncio com três de seis.
 *
 * ## Limite de caracteres por plataforma
 *
 * Os números de `LIMITE_DE_TITULO` são **levantamento, não fato conferido** — não
 * há conta conectada nem documentação acessível de forma automatizada daqui. O
 * gerador recebe o limite por parâmetro justamente para o ajuste ser em um lugar.
 */
import { normalizarCodigoDeModelo, normalizarTexto } from '@/dominio/identidade/canonico';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { contagem } from '@/lib/texto';

/**
 * Limite de caracteres do título, por plataforma. Levantamento de 13/09/2026.
 *
 * O do Mercado Livre é o mais restritivo e o mais citado (60), e é o que manda no
 * desenho: um título que cabe no ML cabe nas outras duas.
 */
export const LIMITE_DE_TITULO: Readonly<Record<Plataforma, number>> = {
  ml: 60,
  shopee: 120,
  amazon: 200,
};

/**
 * Palavras que não entram no título.
 *
 * Duas famílias, e as duas custam posição de busca: **promoção** ("frete grátis",
 * "imperdível") porque ocupa caracteres que um código de modelo usaria melhor, e
 * porque as plataformas penalizam texto promocional em título; e **enfeite**
 * ("lindo", "super") porque ninguém busca por isso.
 *
 * `original` fica de fora da lista de propósito: em peça de reposição, "original"
 * distingue produto e é termo de busca real.
 */
export const PALAVRAS_QUE_NAO_ENTRAM: readonly string[] = [
  'promocao',
  'promocional',
  'oferta',
  'imperdivel',
  'barato',
  'melhor',
  'super',
  'mega',
  'top',
  'lindo',
  'incrivel',
  'frete',
  'gratis',
  'desconto',
  'liquidacao',
  'novo',
  'lancamento',
  'garantia',
  'qualidade',
  'envio',
  'rapido',
];

export interface DadosDoTitulo {
  /** `refil de purificador de água`. O que o produto é. */
  readonly tipoProduto: string;
  readonly marca: string | null;
  /** Código da peça no fabricante, quando se sabe. */
  readonly modeloPeca: string | null;
  /** Modelos de aparelho em que serve. Vêm da ficha publicável de M4. */
  readonly modelosCompativeis: readonly string[];
  /** Quantidade na embalagem, quando é mais de uma. */
  readonly quantidadeEmbalagem: number | null;
}

export interface TituloGerado {
  readonly titulo: string;
  readonly tamanho: number;
  readonly limite: number;
  readonly modelosIncluidos: readonly string[];
  /** Cada um é uma busca em que o anúncio não vai aparecer. */
  readonly modelosCortados: readonly string[];
  readonly avisos: readonly string[];
}

/** Primeira letra maiúscula, resto como está. Não é title case: ML não gosta. */
function capitalizar(texto: string): string {
  return texto.length === 0 ? texto : texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Limpa o texto do tipo de produto.
 *
 * Tira palavra de promoção e de enfeite, sem tirar palavra que identifica: a
 * comparação é sobre a forma normalizada (sem acento e em minúsculas), então
 * "Promoção" e "promocao" caem os dois, e "purificador" fica.
 */
export function limparTermos(texto: string): {
  readonly limpo: string;
  readonly tiradas: readonly string[];
} {
  const tiradas: string[] = [];
  const mantidas = texto
    .split(/\s+/)
    .filter((palavra) => palavra !== '')
    .filter((palavra) => {
      const nu = normalizarTexto(palavra);
      if (nu !== '' && PALAVRAS_QUE_NAO_ENTRAM.includes(nu)) {
        tiradas.push(palavra);
        return false;
      }
      return true;
    });
  return { limpo: mantidas.join(' '), tiradas };
}

/** Normaliza um código para o título: maiúsculas, sem pontuação. */
function codigoParaTitulo(bruto: string): string | null {
  return normalizarCodigoDeModelo(bruto);
}

/**
 * Conectores que não podem sobrar no fim de um título encurtado.
 *
 * Encurtar "refil de purificador de água" palavra por palavra passa por "refil de
 * purificador de", que lê como frase interrompida.
 */
const CONECTORES: readonly string[] = ['de', 'do', 'da', 'dos', 'das', 'para', 'p', 'e', 'com'];

function semConectorNoFim(palavras: readonly string[]): readonly string[] {
  const copia = [...palavras];
  while (copia.length > 1) {
    const ultima = normalizarTexto(copia[copia.length - 1] ?? '');
    if (!CONECTORES.includes(ultima)) break;
    copia.pop();
  }
  return copia;
}

/**
 * Monta a base — tipo e marca — garantindo que ela caiba.
 *
 * A ordem em que se abre mão é ordem de valor de busca, e foi o teste que forçou a
 * pensar nela: a primeira versão montava a base sem conferir o limite, e um tipo
 * de produto longo devolvia título maior que o permitido — que a plataforma
 * recusaria na importação.
 *
 * Cede primeiro o **fim do tipo** ("de água"), que é o que menos identifica.
 * Depois a **marca**, que já é termo de busca forte. E, se nem a primeira palavra
 * couber, corta essa palavra e avisa — porque devolver título acima do limite é
 * devolver arquivo que vai ser recusado.
 */
function montarBase(
  tipo: string,
  marca: string | null,
  limite: number,
  avisos: string[],
): readonly string[] {
  const daMarca = marca !== null && marca.trim() !== '' ? capitalizar(marca.trim()) : null;
  let palavrasDoTipo = tipo.split(/\s+/).filter((p) => p !== '');

  const cabe = (partes: readonly string[]) => partes.join(' ').length <= limite;

  const comMarca = () => (daMarca === null ? palavrasDoTipo : [...palavrasDoTipo, daMarca]);
  while (palavrasDoTipo.length > 1 && !cabe(comMarca())) {
    palavrasDoTipo = [...semConectorNoFim(palavrasDoTipo.slice(0, -1))];
  }

  if (cabe(comMarca())) {
    if (daMarca !== null) return comMarca();
    return palavrasDoTipo;
  }

  // Sem a marca, então.
  if (daMarca !== null) {
    avisos.push('A marca não caberia no título junto com o tipo do produto.');
    palavrasDoTipo = tipo.split(/\s+/).filter((p) => p !== '');
    while (palavrasDoTipo.length > 1 && !cabe(palavrasDoTipo)) {
      palavrasDoTipo = [...semConectorNoFim(palavrasDoTipo.slice(0, -1))];
    }
    if (cabe(palavrasDoTipo)) return palavrasDoTipo;
  }

  const primeira = palavrasDoTipo[0] ?? '';
  avisos.push(
    `O limite de ${String(limite)} caracteres não cabe nem o tipo do produto. O título saiu cortado e precisa ser revisto à mão.`,
  );
  return [primeira.slice(0, limite)];
}

/**
 * Monta o título dentro do limite.
 *
 * Os termos entram em ordem de valor de busca e param quando o próximo não cabe —
 * **não há truncamento no meio de palavra nem de código**. Meio código de modelo é
 * pior que código nenhum: não casa com a busca e ainda ocupa espaço.
 */
export function gerarTitulo(dados: DadosDoTitulo, limite: number): TituloGerado {
  const avisos: string[] = [];

  const { limpo, tiradas } = limparTermos(dados.tipoProduto);
  if (tiradas.length > 0) {
    avisos.push(
      `Tirei do título: ${tiradas.join(', ')}. Palavra de promoção ocupa espaço que um código de modelo usa melhor.`,
    );
  }

  const tipo = capitalizar(limpo.trim());
  if (tipo === '') {
    return {
      titulo: '',
      tamanho: 0,
      limite,
      modelosIncluidos: [],
      modelosCortados: [],
      avisos: ['Sem tipo de produto não há título: é a única parte obrigatória.'],
    };
  }

  const codigoDaPeca = dados.modeloPeca === null ? null : codigoParaTitulo(dados.modeloPeca);

  // Os modelos entram normalizados e sem repetição, e o código da peça sai da
  // lista se aparecer nela: repetir o mesmo código duas vezes gasta caracteres e
  // não melhora busca nenhuma.
  const modelos: string[] = [];
  for (const bruto of dados.modelosCompativeis) {
    const codigo = codigoParaTitulo(bruto);
    if (codigo === null) continue;
    if (codigo === codigoDaPeca) continue;
    if (!modelos.includes(codigo)) modelos.push(codigo);
  }

  const partes: string[] = [...montarBase(tipo, dados.marca, limite, avisos)];

  const incluidos: string[] = [];
  const cortados: string[] = [];
  const tamanhoAtual = () => partes.join(' ').length;

  for (const modelo of modelos) {
    if (tamanhoAtual() + 1 + modelo.length <= limite) {
      partes.push(modelo);
      incluidos.push(modelo);
    } else {
      cortados.push(modelo);
    }
  }

  if (codigoDaPeca !== null && tamanhoAtual() + 1 + codigoDaPeca.length <= limite) {
    partes.push(codigoDaPeca);
  }

  const quantidade = dados.quantidadeEmbalagem;
  if (quantidade !== null && quantidade > 1) {
    const sufixo = `Kit ${String(quantidade)}`;
    if (tamanhoAtual() + 1 + sufixo.length <= limite) partes.push(sufixo);
    else avisos.push(`A quantidade da embalagem (${String(quantidade)}) não caberia no título.`);
  }

  const titulo = partes.join(' ');

  if (incluidos.length === 0 && codigoDaPeca === null) {
    avisos.push(
      'O título não tem nenhum código de modelo, e é por código que o comprador de peça busca. Cadastre a compatibilidade antes de publicar.',
    );
  }
  if (cortados.length > 0) {
    avisos.push(
      `${contagem(cortados.length, 'modelo', 'modelos')} ${cortados.length === 1 ? 'não coube' : 'não couberam'}: ${cortados.join(', ')}. Cada um é uma busca em que o anúncio não aparece — vale considerar um segundo anúncio.`,
    );
  }
  const sobra = limite - titulo.length;
  if (sobra >= 15 && cortados.length === 0) {
    avisos.push(
      `Sobraram ${String(sobra)} caracteres. Espaço em título é grátis: mais um modelo compatível cabe.`,
    );
  }

  return {
    titulo,
    tamanho: titulo.length,
    limite,
    modelosIncluidos: incluidos,
    modelosCortados: cortados,
    avisos,
  };
}

/** Conveniência: gera com o limite da plataforma. */
export function gerarTituloPara(dados: DadosDoTitulo, plataforma: Plataforma): TituloGerado {
  return gerarTitulo(dados, LIMITE_DE_TITULO[plataforma]);
}
