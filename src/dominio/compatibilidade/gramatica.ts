/**
 * Gramática de nomenclatura de modelo — parser determinístico e auditável.
 *
 * Código de modelo de fabricante não é string opaca: `PA21G`, `PA26G`, `PE11B`
 * seguem gramática. A especificação diz o que cada parte significa nessa marca —
 * `PA` é o tipo de aparelho, o número é a linha, a letra final é variação de cor
 * ou voltagem — e a consequência prática é grande: dá para **inferir família** em
 * vez de cadastrar compatibilidade item por item.
 *
 * ## Por que aqui não entra LLM
 *
 * ADR 0005 usa justamente este caso como exemplo do que **não** é trabalho de
 * LLM: a gramática é determinística, o resultado é auditável célula por célula, e
 * um parser errado se conserta acrescentando uma regra — enquanto um LLM errado se
 * "conserta" mudando o prompt e rezando. Além disso, uma compatibilidade errada em
 * peça de reposição custa devolução e reclamação, e é por isso que cada análise
 * devolve **qual regra casou**, não só o resultado.
 *
 * ## O que este módulo não faz
 *
 * Não afirma nada sobre o mundo que a especificação não afirme. A gramática é
 * dado (ver `gramaticas.ts`); aqui só existe o parser. Sufixo cujo significado
 * ninguém confirmou vem como `null`, não como palpite — a mesma disciplina de
 * `canonico.ts`: conhecimento sobre o mundo entra por decisão registrada, não por
 * lista escrita de memória dentro de uma função pura.
 */
import { normalizarCodigoDeModelo, normalizarMarca } from '@/dominio/identidade/canonico';

/** Papel de cada segmento do código. */
export const PAPEIS = ['prefixo', 'linha', 'sufixo'] as const;
export type Papel = (typeof PAPEIS)[number];

/** Um segmento reconhecido, com o que a gramática diz que ele é. */
export interface Segmento {
  readonly papel: Papel;
  readonly valor: string;
  /** `null` quando a gramática não afirma significado. Não se inventa. */
  readonly significado: string | null;
}

/** O que um prefixo identifica nessa marca. */
export interface RegraDePrefixo {
  /** Já em maiúsculas, sem pontuação. */
  readonly prefixo: string;
  /** Tipo de aparelho, no vocabulário de `aparelho.tipo`. */
  readonly tipo: string;
  readonly significado: string;
}

export interface GramaticaDeMarca {
  /** Marca normalizada por `normalizarMarca`. */
  readonly marca: string;
  readonly prefixos: readonly RegraDePrefixo[];
  /**
   * Significado de cada sufixo conhecido. `null` é "existe e ninguém confirmou
   * o que é" — diferente de ausente, que é "nunca foi visto".
   */
  readonly sufixos: Readonly<Record<string, string | null>>;
  /**
   * O sufixo muda a peça?
   *
   * Quando `false`, `PA21G` e `PA21X` são a mesma família e a compatibilidade de
   * um vale como hipótese para o outro. Quando `true`, cada sufixo é família
   * própria e nada propaga por cima dele.
   */
  readonly sufixoMudaAPeca: boolean;
  /** De onde a gramática veio. Auditoria: sem isto não se acha a regra errada. */
  readonly origem: string;
}

/** Índice de gramáticas por marca normalizada. */
export type RegistroDeGramaticas = Readonly<Record<string, GramaticaDeMarca>>;

export const MOTIVOS_DE_RECUSA = [
  'sem_marca',
  'sem_modelo',
  'nao_e_codigo',
  'forma_desconhecida',
] as const;
export type MotivoDeRecusa = (typeof MOTIVOS_DE_RECUSA)[number];

const TEXTO_DA_RECUSA: Readonly<Record<MotivoDeRecusa, string>> = {
  sem_marca: 'sem marca — código de modelo sozinho não identifica fabricante',
  sem_modelo: 'sem modelo',
  nao_e_codigo: 'o modelo não tem forma de código de fabricante',
  forma_desconhecida: 'código reconhecido, mas fora da forma letras+dígitos+letras',
};

export function descreverRecusa(motivo: MotivoDeRecusa): string {
  return TEXTO_DA_RECUSA[motivo];
}

export interface ModeloAnalisado {
  /** O texto como a fonte escreveu. */
  readonly original: string;
  /** Normalizado para comparação: `pa-21-g` e `PA 21 G` viram `PA21G`. */
  readonly codigo: string;
  readonly marca: string;
  readonly prefixo: string;
  readonly linha: string;
  readonly sufixo: string | null;
  /** Tipo de aparelho, quando a gramática da marca conhece o prefixo. */
  readonly tipo: string | null;
  /**
   * Grupo em que a compatibilidade propaga como hipótese.
   *
   * Inclui o sufixo quando a gramática diz que o sufixo muda a peça — e para
   * marca sem gramática o padrão é incluir, porque não saber é razão para não
   * propagar, não para propagar.
   */
  readonly familia: string;
  /**
   * Grupo largo: marca + prefixo, todas as linhas juntas.
   *
   * `PA21` e `PA26` são a mesma linhagem e aparelhos diferentes. Serve para
   * **sugerir** revisão, nunca para publicar.
   */
  readonly linhagem: string;
  /** Cada parte do código com o que a gramática diz dela. */
  readonly segmentos: readonly Segmento[];
  /** Qual regra casou. `forma-generica` = estrutura reconhecida, marca sem gramática. */
  readonly regra: string;
}

export type AnaliseDeModelo =
  | { readonly ok: true; readonly analise: ModeloAnalisado }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa };

/**
 * A única forma que o parser reconhece: letras, dígitos, letras opcionais.
 *
 * Cobre `PA21G`, `PE11B`, `W10295370` e `EF21`. **Não** cobre código com dois
 * blocos de dígito nem com dígito no começo, e isso é deliberado: forma que não
 * se reconhece devolve recusa com motivo, que é honesto, em vez de um palpite de
 * onde cortar, que viraria família errada e compatibilidade errada.
 */
const FORMA = /^([A-Z]{1,5})(\d{1,8})([A-Z]{1,3})?$/;

/** Junta marca e chave num identificador estável de grupo. */
function chave(marca: string, resto: string): string {
  return `${marca}:${resto.toLowerCase()}`;
}

/**
 * Analisa um código de modelo sob a gramática da marca.
 *
 * As gramáticas entram por parâmetro, e não por import de uma constante, para que
 * o teste do parser não dependa do conteúdo da semente — e para que acrescentar
 * marca não possa quebrar o parser.
 */
export function analisarModelo(
  marcaBruta: string,
  modeloBruto: string,
  gramaticas: RegistroDeGramaticas = {},
): AnaliseDeModelo {
  const marca = normalizarMarca(marcaBruta);
  if (marca === '') return { ok: false, motivo: 'sem_marca' };
  if (modeloBruto.trim() === '') return { ok: false, motivo: 'sem_modelo' };

  const codigo = normalizarCodigoDeModelo(modeloBruto);
  if (codigo === null) return { ok: false, motivo: 'nao_e_codigo' };

  const casado = FORMA.exec(codigo);
  if (casado === null) return { ok: false, motivo: 'forma_desconhecida' };

  const prefixo = casado[1] ?? '';
  const linha = casado[2] ?? '';
  const sufixo = casado[3] ?? null;

  const gramatica = gramaticas[marca];
  const regraDoPrefixo = gramatica?.prefixos.find((r) => r.prefixo === prefixo) ?? null;
  // Não saber é razão para não propagar: sem gramática, o sufixo entra na família.
  const sufixoMudaAPeca = gramatica?.sufixoMudaAPeca ?? true;
  const significadoDoSufixo =
    sufixo !== null && gramatica !== undefined ? (gramatica.sufixos[sufixo] ?? null) : null;

  const segmentos: Segmento[] = [
    { papel: 'prefixo', valor: prefixo, significado: regraDoPrefixo?.significado ?? null },
    { papel: 'linha', valor: linha, significado: gramatica === undefined ? null : 'linha' },
  ];
  if (sufixo !== null) {
    segmentos.push({ papel: 'sufixo', valor: sufixo, significado: significadoDoSufixo });
  }

  const partesDaFamilia =
    sufixoMudaAPeca && sufixo !== null ? prefixo + linha + sufixo : prefixo + linha;

  return {
    ok: true,
    analise: {
      original: modeloBruto,
      codigo,
      marca,
      prefixo,
      linha,
      sufixo,
      tipo: regraDoPrefixo?.tipo ?? null,
      familia: chave(marca, partesDaFamilia),
      linhagem: chave(marca, prefixo),
      segmentos,
      regra:
        regraDoPrefixo === null
          ? 'forma-generica'
          : `gramatica:${gramatica?.origem ?? marca}/${prefixo}`,
    },
  };
}

/** A família, ou `null` quando o código não se analisa. Conveniência de chamador. */
export function familiaDe(
  marca: string,
  modelo: string,
  gramaticas: RegistroDeGramaticas = {},
): string | null {
  const r = analisarModelo(marca, modelo, gramaticas);
  return r.ok ? r.analise.familia : null;
}

/**
 * Frase que explica a análise em português, para a tela e para o log.
 *
 * Fica no domínio porque é derivada só da gramática: o mesmo texto tem que
 * aparecer na tela de revisão e no registro de auditoria, e duas versões da mesma
 * explicação divergem na primeira mudança de regra.
 */
export function descreverAnalise(analise: ModeloAnalisado): string {
  const partes = analise.segmentos.map((s) =>
    s.significado === null ? `${s.valor} (não identificado)` : `${s.valor} = ${s.significado}`,
  );
  return `${analise.codigo}: ${partes.join(' · ')}`;
}
