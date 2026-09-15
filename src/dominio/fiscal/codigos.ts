/**
 * Vocabulário fiscal do SKU: NCM, CST e `cClassTrib` (M12 — 9.2).
 *
 * A obrigação concreta: a partir de **04/01/2027** a NF-e de MEI e Simples sem os
 * grupos de IBS/CBS é rejeitada, e esses grupos exigem CST e `cClassTrib` por item.
 * Nota rejeitada é venda que não pode ser enviada.
 *
 * ## O que este módulo é, e o que ele não é
 *
 * É **validação de forma** e um vocabulário pequeno de valores conhecidos, para o
 * cadastro recusar erro de digitação na hora em vez de na emissão. Não é tabela
 * fiscal completa, e não decide qual código usar — isso é 9.1, depende de
 * julgamento sobre texto livre, e exige confirmação humana (ADR 0005).
 *
 * ## Por que a validação de forma já paga
 *
 * NCM tem oito dígitos, CST tem dois, `cClassTrib` tem seis. A maior parte do erro
 * de cadastro é dígito a menos, letra no meio e ponto colado — e cada um desses vira
 * nota rejeitada em janeiro, descoberta com o pedido esperando postagem. Validar a
 * forma pega isso hoje, sem depender de tabela nenhuma.
 *
 * ## Os valores conhecidos são levantamento, e a lista é aberta
 *
 * Nenhum deles foi conferido contra a tabela oficial daqui — não há acesso. Então o
 * cadastro **aceita** valor fora da lista, com aviso, em vez de recusar: recusar um
 * código correto que não está na minha lista pararia a operação por causa da minha
 * ignorância, e é o erro mais caro que este arquivo poderia cometer.
 */
import type { RegimeFiscal } from '@/dominio/precificacao/tipos';

export const CAMPOS_FISCAIS = ['ncm', 'cest', 'cst', 'cclasstrib'] as const;
export type CampoFiscal = (typeof CAMPOS_FISCAIS)[number];

/**
 * O que a NF-e passa a exigir em 04/01/2027.
 *
 * `cest` fica fora: só se aplica a mercadoria sujeita a substituição tributária, e
 * exigir de todo mundo criaria uma pendência falsa na maior parte do catálogo.
 */
export const OBRIGATORIOS_EM_2027: readonly CampoFiscal[] = ['ncm', 'cst', 'cclasstrib'];

/** Formato de cada campo, e o que dizer quando não bate. */
const FORMATO: Readonly<Record<CampoFiscal, { readonly padrao: RegExp; readonly comoE: string }>> =
  {
    ncm: { padrao: /^\d{8}$/, comoE: 'oito dígitos, sem ponto' },
    cest: { padrao: /^\d{7}$/, comoE: 'sete dígitos, sem ponto' },
    cst: { padrao: /^\d{2,3}$/, comoE: 'dois ou três dígitos' },
    cclasstrib: { padrao: /^\d{6}$/, comoE: 'seis dígitos' },
  };

export const ROTULO_DO_CAMPO: Readonly<Record<CampoFiscal, string>> = {
  ncm: 'NCM',
  cest: 'CEST',
  cst: 'CST',
  cclasstrib: 'cClassTrib',
};

/**
 * Para que serve cada campo, na linguagem de quem vai preencher.
 *
 * Existe porque "preencha o cClassTrib" não diz nada a quem nunca emitiu nota, e
 * essa pessoa é justamente quem precisa preencher antes de janeiro.
 */
export const PARA_QUE_SERVE: Readonly<Record<CampoFiscal, string>> = {
  ncm: 'Diz o que o produto é, na classificação usada por toda a cadeia. É o código que decide alíquota e regra de substituição tributária.',
  cest: 'Só vale para mercadoria sujeita a substituição tributária. Fora desse caso, fica vazio — e vazio não é pendência.',
  cst: 'Diz como o item é tributado nesta operação. Entra nos grupos de IBS/CBS que a NF-e passa a exigir.',
  cclasstrib:
    'Classificação tributária do item na reforma. É o campo novo, e o que mais falta nos cadastros antigos.',
};

/**
 * Alguns valores comuns, por regime, para a tela poder sugerir.
 *
 * **Levantamento, não tabela oficial.** Sugerir é diferente de decidir: a lista
 * encurta a busca de quem não sabe por onde começar, e o valor fora dela continua
 * aceito.
 */
export const VALORES_COMUNS: Readonly<
  Record<RegimeFiscal, Readonly<Partial<Record<CampoFiscal, readonly string[]>>>>
> = {
  // Pessoa física não emite NF-e de mercadoria; o prazo dela é abrir CNPJ.
  cpf: {},
  mei: { cst: ['000', '400'], cclasstrib: ['000001'] },
  simples: { cst: ['000', '101', '102'], cclasstrib: ['000001'] },
};

export type ProblemaNoCodigo =
  | { readonly tipo: 'formato'; readonly campo: CampoFiscal; readonly comoE: string }
  | {
      readonly tipo: 'fora_da_lista';
      readonly campo: CampoFiscal;
      readonly conhecidos: readonly string[];
    };

export interface LeituraDeCodigo {
  /** O valor limpo: só dígitos, sem ponto nem espaço. `null` quando vazio. */
  readonly valor: string | null;
  /** Vazio quando o valor serve. Formato é erro; fora da lista é aviso. */
  readonly problemas: readonly ProblemaNoCodigo[];
  readonly aceito: boolean;
}

/**
 * Lê um código fiscal.
 *
 * Tira ponto, barra e espaço antes de validar: a tabela oficial escreve NCM como
 * `8421.21.00`, e recusar o que a pessoa copiou de lá seria recusar o valor certo.
 *
 * Problema de **formato** recusa (`aceito: false`), porque dígito a menos é erro de
 * digitação e não divergência de opinião. Valor **fora da lista** só avisa: a lista
 * é o que eu conheço, não o que existe.
 */
export function lerCodigoFiscal(
  campo: CampoFiscal,
  bruto: string | null | undefined,
  regime?: RegimeFiscal,
): LeituraDeCodigo {
  const limpo = (bruto ?? '').replace(/[.\s/-]/g, '').trim();
  if (limpo === '') return { valor: null, problemas: [], aceito: true };

  const formato = FORMATO[campo];
  if (!formato.padrao.test(limpo)) {
    return {
      valor: limpo,
      problemas: [{ tipo: 'formato', campo, comoE: formato.comoE }],
      aceito: false,
    };
  }

  const conhecidos = regime === undefined ? [] : (VALORES_COMUNS[regime][campo] ?? []);
  if (conhecidos.length > 0 && !conhecidos.includes(limpo)) {
    return {
      valor: limpo,
      problemas: [{ tipo: 'fora_da_lista', campo, conhecidos }],
      aceito: true,
    };
  }

  return { valor: limpo, problemas: [], aceito: true };
}

/** O problema em uma frase, para a tela. */
export function textoDoProblema(problema: ProblemaNoCodigo): string {
  const rotulo = ROTULO_DO_CAMPO[problema.campo];
  if (problema.tipo === 'formato') {
    return `${rotulo} não está no formato: é ${problema.comoE}. Ponto e espaço são ignorados, então dá para colar como está na tabela.`;
  }
  return `${rotulo} fora dos valores que eu conheço (${problema.conhecidos.join(', ')}). Gravei do mesmo jeito — a lista é o que eu conheço, não o que existe —, mas vale conferir.`;
}

export interface CadastroFiscalDoSku {
  readonly ncm: string | null;
  readonly cest: string | null;
  readonly cst: string | null;
  readonly cclasstrib: string | null;
}

export interface EstadoFiscal {
  readonly faltando: readonly CampoFiscal[];
  /** Pronto para a NF-e de 2027: nenhum obrigatório em falta. */
  readonly prontoPara2027: boolean;
  readonly mensagem: string;
}

/**
 * O que falta neste SKU para a nota de 2027 sair.
 *
 * Só os obrigatórios entram na conta. `cest` ausente não é pendência — é o caso
 * comum.
 */
export function estadoFiscal(cadastro: CadastroFiscalDoSku): EstadoFiscal {
  const vazio = (v: string | null): boolean => v === null || v.trim() === '';
  const faltando = OBRIGATORIOS_EM_2027.filter((campo) => vazio(cadastro[campo]));

  if (faltando.length === 0) {
    return {
      faltando,
      prontoPara2027: true,
      mensagem: 'Cadastro fiscal completo para a nota de 2027.',
    };
  }

  const nomes = faltando.map((c) => ROTULO_DO_CAMPO[c]).join(', ');
  return {
    faltando,
    prontoPara2027: false,
    mensagem: `Falta ${nomes}. A partir de 04/01/2027 a nota sai rejeitada sem isso, e nota rejeitada é venda que não pode ser enviada.`,
  };
}
