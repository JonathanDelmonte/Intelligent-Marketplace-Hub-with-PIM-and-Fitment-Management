/**
 * GTIN — o número que identifica um item comercial.
 *
 * É a chave que liga um código de barras lido na loja ao que o sistema já sabe.
 * Existe como módulo próprio porque duas pontas distantes dependem dele: a
 * ingestão de planilha, que recebe EAN em célula digitada à mão, e o leitor de
 * código de barras (M14), que recebe o resultado de uma câmera.
 *
 * ## Por que o dígito verificador não é detalhe
 *
 * A validação anterior conferia só a **quantidade de dígitos**. Num campo de
 * planilha isso já é pouco; num leitor de código de barras é a diferença entre
 * comprar a peça certa e a errada. Código lido com um dígito trocado passaria
 * pela validação, não acharia nada na base, e o veredito diria "sem dado" — que
 * é a resposta certa para a pergunta errada. Pior: se por azar o código errado
 * **existir** na base, o veredito sai confiante sobre outro produto.
 *
 * O dígito verificador do GS1 pega exatamente isso: troca de um dígito é sempre
 * detectada, e transposição de dígitos adjacentes é detectada quando a diferença
 * entre eles não é 5.
 *
 * ## Por que o nível de embalagem importa em dinheiro
 *
 * GTIN-14 com dígito indicador de 1 a 8 **não é a unidade**: é a caixa, o fardo,
 * o pallet. Na liquidação, o código de barras grande na lateral da caixa é um
 * desses. Tratar aquilo como unidade compara o custo de uma caixa de doze com o
 * preço praticado de uma peça — e o veredito sai doze vezes otimista.
 *
 * Por isso `nivelDeEmbalagem` é campo de primeira classe, e a forma canônica de
 * 13 dígitos é `null` para agrupamento: não existe conversão honesta de caixa
 * para unidade sem saber quantas unidades tem a caixa, e isso o código de barras
 * não diz.
 */

export const TIPOS_DE_GTIN = ['gtin8', 'upc_a', 'gtin13', 'gtin14'] as const;
export type TipoDeGtin = (typeof TIPOS_DE_GTIN)[number];

/** Quantidade de dígitos aceita por tipo. */
const DIGITOS_POR_TIPO: Readonly<Record<TipoDeGtin, number>> = {
  gtin8: 8,
  upc_a: 12,
  gtin13: 13,
  gtin14: 14,
};

export const NIVEIS_DE_EMBALAGEM = ['unidade', 'agrupamento'] as const;
export type NivelDeEmbalagem = (typeof NIVEIS_DE_EMBALAGEM)[number];

export interface Gtin {
  /** Os dígitos como estão, sem separador. */
  readonly digitos: string;
  readonly tipo: TipoDeGtin;
  /**
   * Forma canônica de 13 dígitos, para comparar e para usar como chave.
   *
   * `null` quando o código identifica um **agrupamento** e não a unidade: não há
   * conversão honesta de caixa para peça sem saber o conteúdo da caixa.
   */
  readonly ean13: string | null;
  readonly nivelDeEmbalagem: NivelDeEmbalagem;
  /**
   * Dígito indicador do GTIN-14, quando houver. `1` a `8` marcam agrupamento;
   * `9` é quantidade variável, que também não é unidade comparável.
   */
  readonly digitoIndicador: number | null;
}

export const ROTULO_DO_TIPO: Readonly<Record<TipoDeGtin, string>> = {
  gtin8: 'EAN-8',
  upc_a: 'UPC-A',
  gtin13: 'EAN-13',
  gtin14: 'GTIN-14',
};

/**
 * Dígito verificador de um corpo de GTIN (o número **sem** o último dígito).
 *
 * Mod 10 do GS1: da direita para a esquerda do corpo, pesos alternados 3 e 1,
 * começando por 3. Vale para todos os tamanhos, e é por isso que uma função só
 * atende EAN-8, UPC-A, EAN-13 e GTIN-14.
 */
export function digitoVerificadorDeGtin(corpo: string): number {
  if (!/^\d+$/.test(corpo)) {
    throw new GtinInvalido(
      `corpo de GTIN precisa ser só dígitos, recebeu ${JSON.stringify(corpo)}`,
    );
  }

  let soma = 0;
  for (let i = 0; i < corpo.length; i += 1) {
    // A posição conta da direita: a última do corpo tem peso 3.
    const daDireita = corpo.length - 1 - i;
    const peso = daDireita % 2 === 0 ? 3 : 1;
    soma += Number(corpo[i]) * peso;
  }

  return (10 - (soma % 10)) % 10;
}

export class GtinInvalido extends Error {
  override readonly name = 'GtinInvalido';
}

function tipoPorTamanho(tamanho: number): TipoDeGtin | null {
  for (const tipo of TIPOS_DE_GTIN) {
    if (DIGITOS_POR_TIPO[tipo] === tamanho) return tipo;
  }
  return null;
}

/** O último dígito confere com o calculado a partir dos anteriores? */
export function ehGtinValido(digitos: string): boolean {
  if (!/^\d+$/.test(digitos)) return false;
  if (tipoPorTamanho(digitos.length) === null) return false;

  const corpo = digitos.slice(0, -1);
  const verificador = Number(digitos.slice(-1));
  return digitoVerificadorDeGtin(corpo) === verificador;
}

/**
 * Interpreta o que veio de uma célula de planilha ou de uma câmera.
 *
 * Devolve `null` para qualquer coisa que não seja um GTIN válido — inclusive
 * para número com a quantidade certa de dígitos e verificador errado. Recusar é
 * o objetivo: o chamador precisa saber que não pode confiar no número, e o custo
 * de guardar um GTIN errado é alto e silencioso.
 *
 * Separador é tolerado (espaço, ponto, hífen), porque planilha e etiqueta os
 * usam. Notação científica **não**: uma célula que o Excel converteu para
 * `7,89654E+12` perdeu dígitos, e adivinhar quais seria inventar.
 */
export function normalizarGtin(bruto: string | null | undefined): Gtin | null {
  if (bruto === null || bruto === undefined) return null;

  const texto = bruto.trim();
  if (texto === '') return null;
  // `E+` denuncia célula que o Excel destruiu. Recusar é melhor que chutar.
  if (/e\+?\d/i.test(texto)) return null;

  const digitos = texto.replace(/[\s.\-_]/g, '');
  if (!/^\d+$/.test(digitos)) return null;

  const tipo = tipoPorTamanho(digitos.length);
  if (tipo === null) return null;
  if (!ehGtinValido(digitos)) return null;

  return montar(digitos, tipo);
}

function montar(digitos: string, tipo: TipoDeGtin): Gtin {
  if (tipo === 'gtin14') {
    const indicador = Number(digitos[0]);
    if (indicador === 0) {
      // Indicador zero é a própria unidade. O dígito verificador é o mesmo do
      // GTIN-13 correspondente, porque um zero à esquerda não muda a soma
      // ponderada — o que permite tratar os dois como o mesmo item.
      return {
        digitos,
        tipo,
        ean13: digitos.slice(1),
        nivelDeEmbalagem: 'unidade',
        digitoIndicador: indicador,
      };
    }
    return {
      digitos,
      tipo,
      ean13: null,
      nivelDeEmbalagem: 'agrupamento',
      digitoIndicador: indicador,
    };
  }

  return {
    digitos,
    tipo,
    ean13: paraEan13(digitos),
    nivelDeEmbalagem: 'unidade',
    digitoIndicador: null,
  };
}

/**
 * Forma de 13 dígitos por preenchimento com zero à esquerda.
 *
 * É o que o GS1 define, e funciona porque zero à esquerda não altera a soma
 * ponderada: o dígito verificador continua válido. Então `0` + UPC-A de 12 é um
 * GTIN-13 legítimo, e o mesmo item em duas planilhas — uma com UPC e outra com
 * EAN — colapsa numa chave só.
 */
function paraEan13(digitos: string): string {
  return digitos.padStart(13, '0');
}

/** Agrupa para leitura humana: `789 6541 20012 3`. Só para exibir. */
export function formatarGtin(gtin: Gtin): string {
  const d = gtin.digitos;
  if (d.length === 13) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 12)} ${d.slice(12)}`;
  if (d.length === 12) return `${d.slice(0, 1)} ${d.slice(1, 6)} ${d.slice(6, 11)} ${d.slice(11)}`;
  if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4, 8)} ${d.slice(8, 13)} ${d.slice(13)}`;
}

/**
 * Prefixo de país ou de uso especial, quando reconhecível.
 *
 * Serve para a tela dizer "código interno de loja" em vez de deixar a pessoa
 * esperando um resultado que não vai existir: a faixa 200-299 é **reservada para
 * uso interno**, então aquele código só significa algo dentro da loja que o
 * imprimiu, e não há base pública que o resolva.
 */
export function prefixoGs1(
  gtin: Gtin,
): { readonly codigo: string; readonly rotulo: string } | null {
  const ean13 = gtin.ean13;
  if (ean13 === null) return null;

  const tres = ean13.slice(0, 3);
  const numero = Number(tres);

  if (numero >= 200 && numero <= 299) {
    return { codigo: tres, rotulo: 'uso interno de loja — nenhuma base pública resolve' };
  }
  if (numero >= 789 && numero <= 790) return { codigo: tres, rotulo: 'Brasil' };
  if (numero >= 0 && numero <= 139) return { codigo: tres, rotulo: 'Estados Unidos e Canadá' };
  if (numero >= 690 && numero <= 699) return { codigo: tres, rotulo: 'China' };
  if (numero >= 400 && numero <= 440) return { codigo: tres, rotulo: 'Alemanha' };
  if (numero >= 977 && numero <= 979) return { codigo: tres, rotulo: 'publicação (ISSN/ISBN)' };
  if (numero >= 980 && numero <= 999) return { codigo: tres, rotulo: 'cupom ou uso restrito' };

  return null;
}
