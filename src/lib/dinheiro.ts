/**
 * Aritmética monetária exata.
 *
 * Todo valor monetário do sistema é **centavo inteiro**, e todo percentual é
 * **ponto-base** (1 bp = 0,01%). Nenhum `float` representa dinheiro em nenhum
 * ponto, incluindo o banco. Ver ADR 0004 para o porquê.
 *
 * Os dois tipos são nominais: um `number` cru não é aceito onde se espera
 * dinheiro, e o compilador pega a confusão entre reais e centavos — que é o
 * erro mais comum desta abordagem.
 */

declare const marcaCentavos: unique symbol;
declare const marcaPontosBase: unique symbol;

/** Valor monetário em centavos inteiros. Pode ser negativo (prejuízo, crédito). */
export type Centavos = number & { readonly [marcaCentavos]: true };

/** Percentual em pontos-base. 1 bp = 0,01%; 10 000 bp = 100%. */
export type PontosBase = number & { readonly [marcaPontosBase]: true };

/**
 * Modo de arredondamento. Nunca há arredondamento implícito no sistema: toda
 * operação que pode produzir fração declara o modo.
 *
 * - `meio-para-cima`: o do senso comum comercial. 0,5 sobe em módulo.
 * - `meio-par`: arredondamento bancário. Empate vai para o par, o que remove o
 *   viés sistemático de alta em somas longas.
 * - `baixo` / `cima`: truncam em direção a −∞ / +∞.
 * - `para-zero`: trunca em direção a zero.
 */
export type ModoArredondamento = 'meio-para-cima' | 'meio-par' | 'baixo' | 'cima' | 'para-zero';

export class ValorMonetarioInvalido extends Error {
  override readonly name = 'ValorMonetarioInvalido';
  constructor(mensagem: string) {
    super(mensagem);
  }
}

// ─── Construtores ────────────────────────────────────────────────────────────

/** Zero. Único valor monetário que pode ser escrito sem construtor. */
export const ZERO = 0 as Centavos;

/**
 * Constrói um valor em centavos. Recusa fração, `NaN`, infinito e valor fora do
 * inteiro seguro — porque um centavo fracionário é sempre um bug de conversão,
 * nunca uma intenção.
 */
export function centavos(valor: number): Centavos {
  if (!Number.isFinite(valor)) {
    throw new ValorMonetarioInvalido(`centavos precisa de número finito, recebeu ${String(valor)}`);
  }
  if (!Number.isInteger(valor)) {
    throw new ValorMonetarioInvalido(
      `centavos precisa de inteiro, recebeu ${valor}. Para converter de reais use reaisParaCentavos.`,
    );
  }
  if (!Number.isSafeInteger(valor)) {
    throw new ValorMonetarioInvalido(`valor fora do inteiro seguro: ${valor}`);
  }
  return valor as Centavos;
}

/**
 * Converte reais para centavos.
 *
 * Multiplica em string, não em ponto flutuante: `19.99 * 100` é
 * `1998.9999999999998` em IEEE-754, e `Math.round` disfarça o problema em vez
 * de resolvê-lo. Recusa mais de duas casas decimais em vez de arredondar em
 * silêncio — na borda de entrada, fração de centavo é erro de digitação ou de
 * parsing, e adivinhar a intenção é pior que reclamar.
 */
export function reaisParaCentavos(reais: number | string): Centavos {
  const texto = typeof reais === 'number' ? numeroParaTextoDecimal(reais) : reais.trim();

  const casado = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/.exec(texto);
  if (casado === null) {
    throw new ValorMonetarioInvalido(
      `valor em reais inválido: ${JSON.stringify(reais)}. Esperado inteiro com até duas casas decimais.`,
    );
  }

  const [, sinal, inteiro = '0', decimal = ''] = casado;
  const centavosTexto = decimal.padEnd(2, '0');
  const total = Number(inteiro) * 100 + Number(centavosTexto);

  return centavos(sinal === '-' ? -total : total);
}

/** Serializa sem notação científica, para o regex de `reaisParaCentavos` valer. */
function numeroParaTextoDecimal(valor: number): string {
  if (!Number.isFinite(valor)) {
    throw new ValorMonetarioInvalido(`valor em reais precisa ser finito, recebeu ${String(valor)}`);
  }
  // `toFixed(2)` truncaria 19.999 para "20.00" em silêncio. Serializar em 10
  // casas preserva a fração para o regex recusá-la.
  return valor.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/** Constrói pontos-base a partir de um inteiro. 1450 bp = 14,50%. */
export function pontosBase(valor: number): PontosBase {
  if (!Number.isInteger(valor)) {
    throw new ValorMonetarioInvalido(
      `pontos-base precisa de inteiro, recebeu ${valor}. Para converter de percentual use percentualParaPontosBase.`,
    );
  }
  return valor as PontosBase;
}

/** Converte percentual para pontos-base. 14,5 → 1450 bp. */
export function percentualParaPontosBase(percentual: number): PontosBase {
  if (!Number.isFinite(percentual)) {
    throw new ValorMonetarioInvalido(
      `percentual precisa ser finito, recebeu ${String(percentual)}`,
    );
  }
  const bp = Math.round(percentual * 100);
  // A comparação em 1e-9 pega `14.567` (que perderia precisão) sem reclamar de
  // `14.56999999999999` vindo de aritmética de ponto flutuante legítima.
  if (Math.abs(percentual * 100 - bp) > 1e-9) {
    throw new ValorMonetarioInvalido(
      `percentual com precisão além de ponto-base: ${percentual}. Máximo duas casas decimais.`,
    );
  }
  return bp as PontosBase;
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

/**
 * Forma de valor em reais que uma pessoa digita num formulário.
 *
 * Tolerante com o que é só apresentação — `R$`, espaço, vírgula ou ponto decimal —
 * e **intolerante com forma ambígua**, que é onde está o valor. `1.2.3` e `12,5,0`
 * não são erro recuperável: são número que ninguém sabe ler, e chutar significa
 * gravar dinheiro inventado.
 *
 * Separador de milhar é recusado de propósito. Num campo de preço de peça, `1.200`
 * é quase sempre `12,00` com o dedo errado, e aceitar como mil e duzentos
 * transforma erro de digitação em número confiante.
 */
const REAIS_DIGITADOS = /^\d+(?:[.,]\d{1,2})?$/;

/**
 * Lê um valor em reais digitado por uma pessoa. `null` quando não dá para ler.
 *
 * Existe porque este regex estava escrito **quatro vezes** em telas diferentes — no
 * leitor, na consignação, na montagem de anúncio e no fiscal —, e regra de dinheiro
 * repetida é regra que vai divergir: basta alguém afrouxar uma cópia para o mesmo
 * formulário aceitar num lugar e recusar no outro.
 *
 * Vazio devolve `null`, não zero: campo não preenchido é diferente de valor zero, e
 * quem chama decide o que fazer com cada um. Zero é valor legítimo aqui — receita
 * externa de zero existe.
 */
export function lerReaisDigitados(texto: string | null | undefined): Centavos | null {
  const limpo = (texto ?? '').replace(/r\$/gi, '').replace(/\s/g, '').trim();
  if (limpo === '' || !REAIS_DIGITADOS.test(limpo)) return null;

  try {
    return reaisParaCentavos(limpo.replace(',', '.'));
  } catch {
    // `reaisParaCentavos` já recusa o que passa do inteiro seguro. Aqui isso é
    // "não dá para ler", como qualquer outra forma inválida.
    return null;
  }
}

/** Converte para reais. Só usar na borda de apresentação. */
export function centavosParaReais(valor: Centavos): number {
  return valor / 100;
}

/** Formata em real brasileiro: `centavos(198790)` → `"R$ 1.987,90"`. */
export function formatarBRL(valor: Centavos): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavosParaReais(valor));
}

/** Formata pontos-base como percentual: `pontosBase(1450)` → `"14,50%"`. */
export function formatarPontosBase(valor: PontosBase, casas = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(valor / 10_000);
}

// ─── Operações ───────────────────────────────────────────────────────────────

export function somar(...valores: readonly Centavos[]): Centavos {
  return centavos(valores.reduce<number>((acc, v) => acc + v, 0));
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

export function negar(valor: Centavos): Centavos {
  // `0 - valor` e não `-valor`: negação unária sobre tipo com marca é recusada
  // pelo lint, e a subtração diz a mesma coisa sem apagar a marca.
  return centavos(0 - valor);
}

export function absoluto(valor: Centavos): Centavos {
  return centavos(Math.abs(valor));
}

export function maior(a: Centavos, b: Centavos): Centavos {
  return a >= b ? a : b;
}

export function menor(a: Centavos, b: Centavos): Centavos {
  return a <= b ? a : b;
}

/** Multiplica por uma quantidade inteira (unidades de um pedido, por exemplo). */
export function multiplicarPorQuantidade(valor: Centavos, quantidade: number): Centavos {
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw new ValorMonetarioInvalido(
      `quantidade precisa ser inteiro não negativo, recebeu ${quantidade}`,
    );
  }
  return centavos(valor * quantidade);
}

/**
 * Multiplica por um fator fracionário, arredondando pelo modo declarado.
 *
 * Usar só onde o fator é genuinamente fracionário e não percentual — para
 * percentual existe `aplicarPontosBase`, que é exato.
 */
export function multiplicarPorFator(
  valor: Centavos,
  fator: number,
  modo: ModoArredondamento,
): Centavos {
  if (!Number.isFinite(fator)) {
    throw new ValorMonetarioInvalido(`fator precisa ser finito, recebeu ${String(fator)}`);
  }
  return centavos(arredondar(valor * fator, modo));
}

/**
 * Aplica um percentual: `aplicarPontosBase(centavos(10_000), pontosBase(1450))`
 * é 14,50% de R$ 100,00 = R$ 14,50.
 *
 * A multiplicação acontece em inteiros antes da divisão, então não há erro de
 * ponto flutuante: `valor * bp` e só depois `/ 10 000`.
 */
export function aplicarPontosBase(
  valor: Centavos,
  bp: PontosBase,
  modo: ModoArredondamento = 'meio-para-cima',
): Centavos {
  return centavos(arredondar((valor * bp) / 10_000, modo));
}

/**
 * Proporção de `parte` sobre `todo`, em pontos-base.
 *
 * `todo` zero devolve 0 bp em vez de lançar: é o caso de margem sobre receita
 * zero, que aparece de verdade num simulador de faixa e não é erro.
 */
export function proporcaoEmPontosBase(
  parte: Centavos,
  todo: Centavos,
  modo: ModoArredondamento = 'meio-para-cima',
): PontosBase {
  if (todo === 0) return pontosBase(0);
  return pontosBase(arredondar((parte * 10_000) / todo, modo));
}

// ─── Rateio ──────────────────────────────────────────────────────────────────

/**
 * Divide um total em `partes` iguais, distribuindo o resto de centavo.
 *
 * A soma das partes é **sempre exatamente** o total — é essa a razão de existir
 * em vez de `total / partes`. O resto vai para as primeiras posições (método do
 * maior resto), o que é determinístico e auditável.
 *
 * É a operação por trás do rateio do DAS do MEI por unidade prevista no mês, o
 * cálculo mais propenso a erro de um centavo do sistema.
 */
export function ratear(total: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes <= 0) {
    throw new ValorMonetarioInvalido(`partes precisa ser inteiro positivo, recebeu ${partes}`);
  }

  const sinal = total < 0 ? -1 : 1;
  const modulo = Math.abs(total);
  const base = Math.floor(modulo / partes);
  const resto = modulo - base * partes;

  return Array.from({ length: partes }, (_, i) => centavos(sinal * (base + (i < resto ? 1 : 0))));
}

/**
 * Divide um total proporcionalmente a pesos, distribuindo o resto de centavo
 * para os maiores restos fracionários. A soma das partes é sempre o total.
 *
 * Empate de resto é desfeito pelo índice, para o resultado ser determinístico.
 */
export function ratearPorPesos(total: Centavos, pesos: readonly number[]): Centavos[] {
  if (pesos.length === 0) {
    throw new ValorMonetarioInvalido('ratearPorPesos precisa de pelo menos um peso');
  }
  if (pesos.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new ValorMonetarioInvalido('todo peso precisa ser número finito não negativo');
  }

  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  if (somaPesos === 0) return ratear(total, pesos.length);

  const sinal = total < 0 ? -1 : 1;
  const modulo = Math.abs(total);

  const exatos = pesos.map((p) => (modulo * p) / somaPesos);
  const pisos = exatos.map((v) => Math.floor(v));
  const alocado = pisos.reduce((a, b) => a + b, 0);
  let sobra = modulo - alocado;

  const ordemPorResto = exatos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  const resultado = [...pisos];
  for (const { i } of ordemPorResto) {
    if (sobra <= 0) break;
    resultado[i] = (resultado[i] ?? 0) + 1;
    sobra -= 1;
  }

  return resultado.map((v) => centavos(sinal * v));
}

// ─── Arredondamento ──────────────────────────────────────────────────────────

/** Arredonda para inteiro pelo modo pedido. Simétrico para valor negativo. */
function arredondar(valor: number, modo: ModoArredondamento): number {
  switch (modo) {
    case 'baixo':
      return Math.floor(valor);
    case 'cima':
      return Math.ceil(valor);
    case 'para-zero':
      return Math.trunc(valor);
    case 'meio-para-cima': {
      // `Math.round(-0.5)` é 0, não −1: o `Math.round` do JS não é simétrico.
      // O sistema precisa de simetria para que negar um valor e arredondar dê o
      // mesmo módulo que arredondar e negar.
      const sinal = valor < 0 ? -1 : 1;
      return sinal * Math.round(Math.abs(valor));
    }
    case 'meio-par': {
      const piso = Math.floor(valor);
      const fracao = valor - piso;
      if (fracao > 0.5) return piso + 1;
      if (fracao < 0.5) return piso;
      return piso % 2 === 0 ? piso : piso + 1;
    }
  }
}

/** Exposto para teste do módulo; não é API de domínio. */
export const _interno = { arredondar, numeroParaTextoDecimal };
