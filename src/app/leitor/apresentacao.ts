/**
 * Lógica da tela do leitor, separada do JSX.
 *
 * Mesma razão da tela de jobs: o que pode estar errado aqui é regra, não layout.
 * E uma regra em especial move dinheiro — interpretar o custo que a pessoa digita.
 * Errar por um fator de cem transforma "não compra" em "compra" e vice-versa.
 */
import { ROTULO_DO_TIPO, formatarGtin, normalizarGtin, prefixoGs1 } from '@/dominio/gtin';
import { formatarBRL, reaisParaCentavos, type Centavos } from '@/lib/dinheiro';
import { ROTULO_DO_VEREDITO, type Veredito } from '@/dominio/leitor/veredito';

export const IDIOMA = 'pt-BR';

/** Cor por veredito. Variável CSS, nunca cor literal (ADR 0003). */
export const COR_DO_VEREDITO: Readonly<Record<Veredito, string>> = {
  compra: 'var(--cor-ok)',
  compra_com_ressalva: 'var(--cor-aviso)',
  nao_compra: 'var(--cor-erro)',
  sem_dado_recente: 'var(--cor-texto-fraco)',
  sem_dado: 'var(--cor-texto-fraco)',
};

/**
 * A frase curta que a pessoa lê de longe, com o celular na mão.
 *
 * Curta de propósito: quem está de pé numa liquidação lê três palavras, não um
 * parágrafo. O detalhe fica abaixo, para quem quiser conferir.
 */
export const CHAMADA_DO_VEREDITO: Readonly<Record<Veredito, string>> = {
  compra: 'Compra',
  compra_com_ressalva: 'Compra, com ressalva',
  nao_compra: 'Não compra',
  sem_dado_recente: 'Dado velho',
  sem_dado: 'Sem dado',
};

export function rotuloDoVeredito(veredito: Veredito): string {
  return ROTULO_DO_VEREDITO[veredito];
}

/**
 * Interpreta o custo digitado no celular.
 *
 * Tolerante com o que uma pessoa digita apressada: com e sem `R$`, com vírgula ou
 * ponto, com espaço. **Intolerante** com forma ambígua, e é aí que está o valor —
 * `1.2.3` e `12,5,0` não são erro de digitação recuperável, são número que
 * ninguém sabe ler, e chutar significa calcular margem sobre um custo inventado.
 *
 * Separador de milhar é recusado de propósito. No balcão o custo é de dois
 * dígitos; `1.200` digitado ali é quase sempre `12,00` com o dedo errado, e
 * aceitar como mil e duzentos seria transformar um erro de digitação em um
 * veredito confiante.
 */
export function interpretarCusto(texto: string): Centavos | null {
  const limpo = texto.replace(/r\$/gi, '').replace(/\s/g, '').trim();
  if (limpo === '') return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(limpo)) return null;

  try {
    const valor = reaisParaCentavos(limpo.replace(',', '.'));
    return valor > 0 ? valor : null;
  } catch {
    return null;
  }
}

export function formatarReais(valor: number | null): string {
  if (valor === null) return '—';
  return formatarBRL(valor as Centavos);
}

export function formatarPercentual(pontosBase: number | null): string {
  if (pontosBase === null) return '—';
  return `${String(Math.round(pontosBase / 100))}%`;
}

export function formatarMarkup(markup: number | null): string {
  if (markup === null) return '—';
  return `${markup.toFixed(1)}x`;
}

/**
 * Confiança em palavra, não em número.
 *
 * "72%" sugere precisão que a medida não tem — é composição de três fatores
 * observáveis, não probabilidade. Três faixas dizem o que a pessoa precisa saber:
 * dá para confiar, dá para desconfiar, ou é chute.
 */
export function descreverConfianca(bp: number): {
  readonly rotulo: string;
  readonly forte: boolean;
} {
  if (bp >= 8000) return { rotulo: 'evidência forte', forte: true };
  if (bp >= 4000) return { rotulo: 'evidência razoável', forte: false };
  if (bp > 0) return { rotulo: 'evidência fraca', forte: false };
  return { rotulo: 'sem evidência', forte: false };
}

/**
 * Identificador local de uma leitura.
 *
 * Gerado no dispositivo, antes de qualquer rede — é a chave de idempotência da
 * sincronização. `crypto.randomUUID` quando existe; a alternativa cobre navegador
 * antigo e contexto não seguro, onde `crypto` pode não estar disponível.
 */
export function novoIdLocal(agora: () => number = Date.now): string {
  const cripto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cripto?.randomUUID !== undefined) return cripto.randomUUID();

  const aleatorio = Math.floor(Math.random() * 1e12).toString(36);
  return `l-${String(agora())}-${aleatorio}`;
}

/** Quanto o lote custa por unidade, quando a pessoa informa quantas vêm. */
export function custoPorUnidade(
  totalCentavos: Centavos,
  unidades: number,
): { readonly unitario: Centavos; readonly dividiu: boolean } {
  if (!Number.isInteger(unidades) || unidades <= 1) {
    return { unitario: totalCentavos, dividiu: false };
  }
  return { unitario: Math.round(totalCentavos / unidades) as Centavos, dividiu: true };
}

/**
 * Texto do estado da fila local.
 *
 * A pessoa precisa saber que a leitura não se perdeu, sem precisar entender o que
 * é uma fila. Três estados, três frases.
 */
export function descreverFila(params: {
  readonly pendentes: number;
  readonly travadas: number;
  readonly online: boolean;
  readonly persistente: boolean;
}): { readonly texto: string; readonly alerta: boolean } {
  if (params.travadas > 0) {
    return {
      texto: `${String(params.travadas)} leitura(s) não subiram depois de várias tentativas.`,
      alerta: true,
    };
  }
  if (params.pendentes === 0) {
    return { texto: 'tudo sincronizado', alerta: false };
  }
  if (!params.online) {
    return {
      texto: `${String(params.pendentes)} leitura(s) guardadas no aparelho, esperando rede.`,
      alerta: false,
    };
  }
  return { texto: `${String(params.pendentes)} leitura(s) subindo...`, alerta: false };
}

/** Aviso de que a fila não sobrevive ao recarregamento. */
export const AVISO_SEM_PERSISTENCIA =
  'este navegador não deixa guardar dado local: se a página recarregar antes de ' +
  'sincronizar, as leituras somem.';

// ─── Avaliação possível sem rede ─────────────────────────────────────────────

/**
 * O que dá para saber sobre um código **sem servidor**.
 *
 * O módulo de GTIN é função pura, então roda no navegador: offline ainda se sabe
 * se o código passa no dígito verificador, de que tipo é, se é caixa e de que
 * país. É pouco e é o que mais importa depois do veredito — código lido errado
 * descoberto na hora vale mais que veredito que não vem.
 *
 * O que não dá é avaliar: preço praticado está no banco, e sem rede não há banco.
 * A tela diz isso em vez de fingir cálculo.
 */
export function avaliarLocalmente(codigo: string): {
  readonly gtinValido: {
    readonly digitos: string;
    readonly tipo: string;
    readonly canonico: string | null;
    readonly nivelDeEmbalagem: string;
    readonly formatado: string;
    readonly prefixo: string | null;
  } | null;
} {
  const gtin = normalizarGtin(codigo);
  if (gtin === null) return { gtinValido: null };

  return {
    gtinValido: {
      digitos: gtin.digitos,
      tipo: ROTULO_DO_TIPO[gtin.tipo],
      canonico: gtin.ean13,
      nivelDeEmbalagem: gtin.nivelDeEmbalagem,
      formatado: formatarGtin(gtin),
      prefixo: prefixoGs1(gtin)?.rotulo ?? null,
    },
  };
}

/** Plural de "código". Um detalhe que a tela mostra em toda leitura. */
export function contarCodigos(quantidade: number): string {
  const formatado = quantidade.toLocaleString(IDIOMA);
  return quantidade === 1 ? `${formatado} código na base` : `${formatado} códigos na base`;
}
