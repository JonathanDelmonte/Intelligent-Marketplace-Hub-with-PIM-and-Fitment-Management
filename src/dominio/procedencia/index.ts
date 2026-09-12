/**
 * Procedência de dado.
 *
 * Todo registro do sistema carrega de onde veio e quando. A regra que isso
 * sustenta: **dado de origem fraca nunca sobrescreve dado de origem forte
 * automaticamente** — a tentativa vira conflito para revisão, não uma escrita
 * silenciosa. Ver ADR 0002, regra 2.
 *
 * A razão de existir é auditoria. Erro de compatibilidade em peça de reposição
 * gera devolução e reclamação, e sem saber de onde veio a afirmação não há como
 * achar a fonte errada.
 */

/** De onde um dado veio. Ordenado por força em `FORCA_DA_FONTE`. */
export const FONTES = ['m0_link', 'm1_planilha', 'm2_publico', 'm3_api', 'manual'] as const;

export type Fonte = (typeof FONTES)[number];

/**
 * Força relativa de cada origem. Número maior vence.
 *
 * O raciocínio por trás da ordem:
 *
 * - `manual` (100) é o mais forte porque é uma pessoa afirmando depois de olhar.
 *   Nenhuma automação sobrescreve decisão humana sem revisão.
 * - `m3_api` (80) é a plataforma falando de si mesma, autoritativo por
 *   construção.
 * - `m1_planilha` (60) é o mesmo dado do `m3_api`, exportado pelo painel oficial.
 *   Um pouco mais fraco só porque pode estar velho — a planilha é de um momento.
 * - `m2_publico` (40) é endpoint sem token: correto, mas geralmente parcial.
 * - `m0_link` (20) é extração de página, sujeita a mudança de HTML e a
 *   interpretação de LLM. É a mais frágil, e por isso a que nunca sobrescreve.
 */
export const FORCA_DA_FONTE: Readonly<Record<Fonte, number>> = {
  manual: 100,
  m3_api: 80,
  m1_planilha: 60,
  m2_publico: 40,
  m0_link: 20,
};

/** Etiqueta legível, para a UI não ter string de plataforma espalhada. */
export const ETIQUETA_DA_FONTE: Readonly<Record<Fonte, string>> = {
  m0_link: 'link colado',
  m1_planilha: 'planilha importada',
  m2_publico: 'endpoint público',
  m3_api: 'API oficial',
  manual: 'informado à mão',
};

/** Marca de procedência que acompanha todo registro. */
export interface Procedencia {
  readonly fonte: Fonte;
  readonly coletadoEm: Date;
  /** URL, caminho do arquivo ou identificador do endpoint. Para auditoria. */
  readonly origem?: string;
}

/** O que fazer com um dado que chega para um campo que já tem valor. */
export type DecisaoDeEscrita =
  | { readonly tipo: 'escrever'; readonly motivo: string }
  | { readonly tipo: 'ignorar'; readonly motivo: string }
  | { readonly tipo: 'conflito'; readonly motivo: string };

export function forcaDe(fonte: Fonte): number {
  return FORCA_DA_FONTE[fonte];
}

/** `a` é estritamente mais forte que `b`? */
export function maisForteQue(a: Fonte, b: Fonte): boolean {
  return forcaDe(a) > forcaDe(b);
}

/**
 * Decide se um valor que chega pode sobrescrever o valor existente.
 *
 * As quatro situações, e por que cada uma resolve assim:
 *
 * 1. **Não havia valor.** Escreve. Não há nada a proteger.
 * 2. **Origem mais forte.** Escreve. É para isso que a ordem existe.
 * 3. **Origem mais fraca.** Ignora. É a regra central do ADR 0002: página
 *    extraída não apaga o que a API oficial disse.
 * 4. **Mesma origem.** Aqui está a decisão que não é óbvia. Se o valor é igual,
 *    é só uma recoleta: ignora, sem ruído. Se é **diferente**, é conflito, não
 *    atualização — porque duas leituras da mesma força discordando significa
 *    que uma delas está errada, ou que o dado mudou de verdade. Nos dois casos
 *    a decisão é de quem opera, não do importador. A exceção é dado mais novo
 *    da mesma origem quando a origem é volátil por natureza (preço), e isso é
 *    decidido pelo chamador via `volatil`.
 */
export function decidirEscrita<T>(params: {
  readonly existente: { readonly valor: T; readonly procedencia: Procedencia } | null;
  readonly novo: { readonly valor: T; readonly procedencia: Procedencia };
  /**
   * Campo cujo valor muda legitimamente com o tempo (preço, estoque). Para
   * esses, dado mais novo da mesma origem é atualização, não conflito.
   */
  readonly volatil?: boolean;
  /** Comparação de igualdade. O padrão é `Object.is`. */
  readonly iguais?: (a: T, b: T) => boolean;
}): DecisaoDeEscrita {
  const { existente, novo, volatil = false } = params;
  const iguais = params.iguais ?? ((a: T, b: T) => Object.is(a, b));

  if (existente === null) {
    return { tipo: 'escrever', motivo: 'campo vazio' };
  }

  const forcaExistente = forcaDe(existente.procedencia.fonte);
  const forcaNova = forcaDe(novo.procedencia.fonte);
  const nomeExistente = ETIQUETA_DA_FONTE[existente.procedencia.fonte];
  const nomeNovo = ETIQUETA_DA_FONTE[novo.procedencia.fonte];

  if (iguais(existente.valor, novo.valor)) {
    return { tipo: 'ignorar', motivo: 'valor idêntico ao que já está gravado' };
  }

  if (forcaNova > forcaExistente) {
    return {
      tipo: 'escrever',
      motivo: `origem mais forte: ${nomeNovo} sobre ${nomeExistente}`,
    };
  }

  if (forcaNova < forcaExistente) {
    return {
      tipo: 'ignorar',
      motivo: `origem mais fraca: ${nomeNovo} não sobrescreve ${nomeExistente}`,
    };
  }

  if (volatil) {
    return novo.procedencia.coletadoEm > existente.procedencia.coletadoEm
      ? { tipo: 'escrever', motivo: `campo volátil, leitura mais recente de ${nomeNovo}` }
      : { tipo: 'ignorar', motivo: 'campo volátil, leitura mais antiga que a gravada' };
  }

  return {
    tipo: 'conflito',
    motivo: `duas leituras de ${nomeNovo} discordam — precisa de decisão`,
  };
}

/**
 * Escolhe a leitura mais confiável de uma lista.
 *
 * Critério: maior força primeiro; em empate, a mais recente. Devolve `null` para
 * lista vazia em vez de lançar — lista vazia é o caso normal de um SKU que
 * ninguém coletou ainda.
 */
export function leituraMaisConfiavel<T extends { readonly procedencia: Procedencia }>(
  leituras: readonly T[],
): T | null {
  let melhor: T | null = null;

  for (const leitura of leituras) {
    if (melhor === null) {
      melhor = leitura;
      continue;
    }
    const forcaCandidata = forcaDe(leitura.procedencia.fonte);
    const forcaMelhor = forcaDe(melhor.procedencia.fonte);

    if (forcaCandidata > forcaMelhor) {
      melhor = leitura;
    } else if (
      forcaCandidata === forcaMelhor &&
      leitura.procedencia.coletadoEm > melhor.procedencia.coletadoEm
    ) {
      melhor = leitura;
    }
  }

  return melhor;
}

/** Uma fonte exige credencial de conta? Só `m3_api` exige (ADR 0002). */
export function exigeCredencial(fonte: Fonte): boolean {
  return fonte === 'm3_api';
}
