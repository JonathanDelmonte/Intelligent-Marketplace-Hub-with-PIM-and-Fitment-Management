/**
 * Evidência de compatibilidade e a força de cada tipo de fonte.
 *
 * O campo que faz a compatibilidade valer é a evidência. Sem saber **de onde**
 * veio cada afirmação não há como auditar um erro — e erro de compatibilidade em
 * peça de reposição gera devolução e reclamação, que é pior que não vender.
 *
 * ## A escala vem da especificação, e as lacunas são escolha registrada
 *
 * A especificação fixa três âncoras: afirmação do fabricante = 1,0; três
 * concorrentes concordando = 0,8; um fórum = 0,4. Os outros dois tipos —
 * catálogo de distribuidor e decisão humana — ela não numera, e os valores abaixo
 * são decisão deste projeto, com o motivo escrito ao lado de cada um.
 *
 * Tudo em **pontos-base inteiros** (0 a 10 000), nunca float. Comparar `0.7` com
 * `0.7` em IEEE-754 é convite a bug num corte de publicação, e este corte decide
 * se uma compatibilidade vai para o anúncio ou para a fila.
 */
import { z } from 'zod';

export const TIPOS_DE_EVIDENCIA = [
  'manual_fabricante',
  'pagina_oficial',
  'concorrente',
  'forum',
  'catalogo_distribuidor',
  'humano',
  'anuncio_proprio',
  'inferencia_familia',
  'inferencia_linhagem',
] as const;

export type TipoDeEvidencia = (typeof TIPOS_DE_EVIDENCIA)[number];

/**
 * Quem chancelou a compatibilidade gravada.
 *
 * `fabricante` não é "fonte forte qualquer": é o fabricante tendo afirmado, o que
 * na ficha do anúncio vale como garantia. `ia` é o sistema tendo concluído de
 * fontes secundárias, e `humano` é alguém tendo olhado e decidido.
 */
export const VERIFICADORES = ['ia', 'humano', 'fabricante'] as const;
export type VerificadoPor = (typeof VERIFICADORES)[number];

/** Uma afirmação sobre "esta peça serve (ou não serve) neste aparelho". */
export interface Evidencia {
  readonly tipo: TipoDeEvidencia;
  readonly url: string | null;
  /** Trecho citado, para conferir sem reabrir a fonte. */
  readonly trecho: string | null;
  /** Quando foi coletada. ISO 8601 — texto, porque atravessa `jsonb`. */
  readonly em: string;
  /** `true` quando a evidência afirma que a peça **não** serve. */
  readonly negativa: boolean;
  /**
   * Força própria, quando o tipo não a determina. `null` usa a força do tipo.
   *
   * Existe por causa da inferência: "o fabricante confirmou no modelo irmão" é
   * mais forte quando o irmão foi confirmado pelo manual do que quando foi por um
   * fórum, e essa diferença não cabe numa constante por tipo. É sempre limitada
   * pelo teto do tipo, então uma inferência não pode se declarar mais forte do que
   * inferência pode ser.
   */
  readonly forcaBp: number | null;
}

/**
 * Leitura tolerante de evidência gravada.
 *
 * Isto lê `jsonb` escrito pelo próprio sistema, e o formato pode ter mudado entre
 * a gravação e a leitura. Recusar a linha inteira por um campo novo deixaria a
 * fila de revisão inacessível, então campo faltando vira padrão e tipo
 * desconhecido é recusado — só ele.
 */
export const esquemaEvidencia = z.object({
  tipo: z.enum(TIPOS_DE_EVIDENCIA),
  url: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v === undefined || v === '' ? null : v)),
  trecho: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v === undefined || v === '' ? null : v)),
  em: z.string().default(() => new Date().toISOString()),
  negativa: z.boolean().default(false),
  forcaBp: z.union([z.number().int().min(0), z.null(), z.undefined()]).transform((v) => v ?? null),
});

/** Lê uma lista gravada, descartando o que não se entende em vez de falhar. */
export function lerEvidencias(bruto: unknown): readonly Evidencia[] {
  if (!Array.isArray(bruto)) return [];
  const lidas: Evidencia[] = [];
  for (const item of bruto) {
    const r = esquemaEvidencia.safeParse(item);
    if (r.success) lidas.push(r.data);
  }
  return lidas;
}

/**
 * Força de uma evidência isolada, em pontos-base.
 *
 * - `manual_fabricante` (10 000): é a âncora 1,0 da especificação. O manual é o
 *   documento, não a página de marketing.
 * - `pagina_oficial` (9 000): também é o fabricante falando, mas página de
 *   produto envelhece e às vezes descreve a linha, não o item. Publica sozinha, e
 *   é a intenção.
 * - `catalogo_distribuidor` (6 000): deriva do fabricante, e o erro que aparece é
 *   de transcrição e de catálogo velho. Sozinha **não** publica; duas concordando
 *   publicam.
 * - `concorrente` (4 152): calibrado para que **três** concorrentes concordando
 *   cheguem a 0,80, que é a âncora da especificação. O valor não é redondo porque
 *   a âncora é sobre o trio, não sobre o indivíduo.
 * - `forum` (4 000): a âncora 0,4. É relato de quem usou, que é informação real e
 *   fonte fraca.
 * - `humano` (10 000): uma pessoa afirmando depois de olhar. Mesma precedência
 *   que `manual` tem em `FORCA_DA_FONTE`, e pelo mesmo motivo: nenhuma automação
 *   sobrescreve decisão humana sem revisão.
 */
export const FORCA_DA_EVIDENCIA: Readonly<Record<TipoDeEvidencia, number>> = {
  manual_fabricante: 10_000,
  pagina_oficial: 9_000,
  catalogo_distribuidor: 6_000,
  concorrente: 4_152,
  forum: 4_000,
  humano: 10_000,
  // Anúncio seu citando o modelo. Vale **zero** de propósito: é você confirmando
  // a si mesmo, e catálogo que se confirma sozinho é como o erro de cadastro fica
  // permanente. Entra registrado, aparece na fila com o título citado, e viraria
  // evidência de verdade só quando uma pessoa confirma — aí já é `humano`.
  anuncio_proprio: 0,
  // Inferência: a gramática diz que o modelo é irmão de um confirmado. Os valores
  // são o padrão quando a inferência não declara a própria força, e os dois ficam
  // abaixo do corte de publicação de propósito — inferência **propõe**, nunca
  // publica sozinha. Ver `inferencia.ts`.
  inferencia_familia: 6_000,
  inferencia_linhagem: 2_500,
};

/**
 * Teto de confiança que cada tipo alcança **sozinho**, por acumulação.
 *
 * Existe porque a combinação de fontes independentes satura em 1 e isso, sem
 * teto, deixaria dez posts de fórum valerem mais que o manual do fabricante.
 * Dez posts de fórum não são dez observações independentes: um cita o outro.
 *
 * O teto de `forum` é 6 900 **de propósito**, cem pontos abaixo do corte de
 * publicação: fórum sozinho nunca publica, por quantidade nenhuma. É a mesma
 * regra de `ADR 0002` — dado de origem fraca não decide sozinho.
 */
export const TETO_DA_EVIDENCIA: Readonly<Record<TipoDeEvidencia, number>> = {
  manual_fabricante: 10_000,
  pagina_oficial: 10_000,
  catalogo_distribuidor: 9_500,
  concorrente: 9_000,
  forum: 6_900,
  humano: 10_000,
  anuncio_proprio: 0,
  inferencia_familia: 6_900,
  inferencia_linhagem: 4_000,
};

/**
 * Força efetiva de uma evidência: a própria, se declarada, limitada pelo teto do
 * tipo. Sem o limite, uma inferência poderia se declarar mais forte que o manual.
 */
export function forcaDaEvidencia(e: Evidencia): number {
  const base = e.forcaBp ?? FORCA_DA_EVIDENCIA[e.tipo];
  return Math.max(0, Math.min(TETO_DA_EVIDENCIA[e.tipo], Math.trunc(base)));
}

/** A afirmação veio de inferência de gramática, não de fonte do mundo? */
export function ehInferida(tipo: TipoDeEvidencia): boolean {
  return tipo === 'inferencia_familia' || tipo === 'inferencia_linhagem';
}

/** Etiqueta legível, para a tela não ter texto de fonte espalhado. */
export const ETIQUETA_DA_EVIDENCIA: Readonly<Record<TipoDeEvidencia, string>> = {
  manual_fabricante: 'manual do fabricante',
  pagina_oficial: 'página oficial',
  concorrente: 'anúncio de concorrente',
  forum: 'fórum ou grupo de assistência',
  catalogo_distribuidor: 'catálogo de distribuidor',
  humano: 'conferido por pessoa',
  anuncio_proprio: 'anúncio seu, a confirmar',
  inferencia_familia: 'inferido de modelo irmão',
  inferencia_linhagem: 'inferido da mesma linha de modelo',
};

/** O fabricante afirmou, de qualquer uma das duas formas? */
export function ehDoFabricante(tipo: TipoDeEvidencia): boolean {
  return tipo === 'manual_fabricante' || tipo === 'pagina_oficial';
}
