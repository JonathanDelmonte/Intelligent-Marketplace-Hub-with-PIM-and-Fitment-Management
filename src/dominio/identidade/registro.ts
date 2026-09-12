/**
 * O registro estruturado de um produto (M3, etapa 5.1).
 *
 * É o contrato de saída da extração: `{tipo, marca, modelo da peça, modelos
 * compatíveis, dimensões, material, unidade, quantidade de embalagem}`. Quem
 * preenche pode ser um LLM lendo um anúncio, o importador de planilha, ou uma
 * pessoa digitando — e é justamente por isso que o schema mora aqui e não dentro
 * do extrator.
 *
 * **A regra que este arquivo aplica: atributo que não aparece é `null`, nunca
 * invenção.** E a forma mais comum de invenção não é o modelo mentir um valor
 * plausível — é ele escrever `"N/A"`, `"não informado"` ou `"-"` no lugar de
 * `null`. A diferença parece cosmética e não é: `"N/A"` vira marca, entra na forma
 * canônica, e a partir daí todo produto de marca desconhecida é semelhante a todo
 * outro produto de marca desconhecida. O grafo de identidade colapsa em um nó.
 */
import { z } from 'zod';

/**
 * Textos que significam ausência e chegam como se fossem valor.
 *
 * Comparados **depois** de normalizar caixa, acento e pontuação de borda, então
 * `"N/A"`, `"n.a."` e `" N/A "` caem no mesmo caso.
 *
 * `"sem marca"` **não** está nesta lista de propósito: produto genérico sem marca
 * é uma afirmação verdadeira sobre o produto, e apagá-la perderia informação.
 */
const MARCAS_DE_AUSENCIA: ReadonlySet<string> = new Set([
  '',
  '-',
  '--',
  '---',
  '?',
  '??',
  'n a',
  'na',
  'nd',
  'null',
  'nil',
  'none',
  'nenhum',
  'nenhuma',
  'undefined',
  'unknown',
  'desconhecido',
  'desconhecida',
  'indefinido',
  'indefinida',
  'indisponivel',
  'nao informado',
  'nao informada',
  'nao especificado',
  'nao especificada',
  'nao se aplica',
  'nao consta',
  'nao disponivel',
  'sem informacao',
  'vazio',
]);

/** Normaliza só para comparar com `MARCAS_DE_AUSENCIA`. Não é a forma canônica. */
function chaveDeAusencia(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O texto informado significa "não sei"? */
export function ehAusencia(bruto: string): boolean {
  return MARCAS_DE_AUSENCIA.has(chaveDeAusencia(bruto));
}

/**
 * Campo de texto opcional que transforma marca de ausência em `null`.
 *
 * Aceita `null` e `undefined` de entrada porque as três origens divergem: LLM
 * costuma emitir `null`, planilha emite célula vazia, e formulário emite campo
 * ausente.
 */
const textoOuNulo = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const limpo = v.trim().replace(/\s+/g, ' ');
    return limpo === '' || ehAusencia(limpo) ? null : limpo;
  })
  .default(null);

/**
 * Quantidade que pode chegar como número ou como texto.
 *
 * `"3"` é aceito porque LLM emite JSON com número em texto com frequência. `"três"`
 * não é: virar `NaN` silenciosamente seria pior que recusar, e recusar manda o
 * registro para revisão com o bruto preservado.
 */
const inteiroPositivoOuNulo = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const limpo = v.trim();
      if (limpo === '' || ehAusencia(limpo)) return null;
      if (!/^\d+$/.test(limpo)) {
        ctx.addIssue({ code: 'custom', message: `quantidade não numérica: ${JSON.stringify(v)}` });
        return null;
      }
      return Number.parseInt(limpo, 10);
    }
    if (!Number.isInteger(v) || v <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: `quantidade precisa ser inteiro positivo, veio ${String(v)}`,
      });
      return null;
    }
    return v;
  })
  .default(null);

/** Dimensões em milímetros. Unidade fixa no tipo, para não haver polegada disfarçada. */
export const esquemaDimensoes = z.object({
  comprimentoMm: z.number().positive().nullable().default(null),
  larguraMm: z.number().positive().nullable().default(null),
  alturaMm: z.number().positive().nullable().default(null),
});

/**
 * Lista de textos que descarta ausência em vez de guardar `["N/A"]`.
 *
 * Uma lista com um item que significa nada é pior que a lista vazia: a lista vazia
 * diz "não achei nenhum", e `["N/A"]` diz "achei um, chamado N/A".
 */
const listaDeTextos = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return [];
    const itens = typeof v === 'string' ? v.split(/[;,|]/) : v;
    const vistos = new Set<string>();
    const saida: string[] = [];
    for (const item of itens) {
      const limpo = item.trim().replace(/\s+/g, ' ');
      if (limpo === '' || ehAusencia(limpo)) continue;
      // Chave sem separador: `PA21G`, `pa21g` e `PA 21 G` são o mesmo modelo
      // escrito por três fontes, e guardar os três infla a lista com repetição
      // que o casamento teria de desfazer depois.
      const chave = chaveDeAusencia(limpo).replace(/[^a-z0-9]/g, '');
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(limpo);
    }
    return saida;
  })
  .default([]);

/**
 * Registro estruturado de um produto.
 *
 * **Nenhum campo é obrigatório**, e isso é deliberado: exigir marca faria o
 * distribuidor que só publica `EF-ELX-21` ser recusado na porta, e é exatamente
 * esse registro pobre que o M3 existe para ligar aos ricos.
 */
export const esquemaRegistroDeProduto = z.object({
  tipoProduto: textoOuNulo,
  marca: textoOuNulo,
  /** Modelo **da peça**, não do aparelho em que ela serve. */
  modeloPeca: textoOuNulo,
  /** Modelos de aparelho em que a peça serve, como vieram. M4 é quem concilia. */
  modelosCompativeis: listaDeTextos,
  dimensoes: esquemaDimensoes.nullable().default(null),
  material: textoOuNulo,
  /** `un`, `par`, `kit`, `metro`… como o texto disse. */
  unidade: textoOuNulo,
  quantidadeEmbalagem: inteiroPositivoOuNulo,
});

export type RegistroDeProduto = z.infer<typeof esquemaRegistroDeProduto>;

/** Registro vazio. Existe para o caso "nada foi extraído ainda", sem `undefined`. */
export const REGISTRO_VAZIO: RegistroDeProduto = esquemaRegistroDeProduto.parse({});

/**
 * Quantos campos de identidade o registro realmente tem.
 *
 * Serve para uma decisão concreta: registro com zero sinal não vai para
 * julgamento de LLM, porque não há o que julgar e a chamada custaria sem chance de
 * acertar.
 */
export function riquezaDoRegistro(registro: RegistroDeProduto): number {
  let n = 0;
  if (registro.tipoProduto !== null) n += 1;
  if (registro.marca !== null) n += 1;
  if (registro.modeloPeca !== null) n += 1;
  if (registro.material !== null) n += 1;
  if (registro.quantidadeEmbalagem !== null) n += 1;
  if (registro.modelosCompativeis.length > 0) n += 1;
  if (registro.dimensoes !== null) n += 1;
  return n;
}

export type LeituraDeRegistro =
  | { readonly tipo: 'ok'; readonly registro: RegistroDeProduto }
  | { readonly tipo: 'invalido'; readonly problemas: readonly string[]; readonly bruto: unknown };

/**
 * Lê um registro de uma origem externa sem lançar.
 *
 * Nunca lança por dado ruim porque as duas origens erram de formas diferentes e
 * ambas precisam virar `pendente_revisao`: LLM erra tipo, e `jsonb` do próprio
 * banco pode ter sido gravado por uma versão anterior do schema.
 */
export function lerRegistro(bruto: unknown): LeituraDeRegistro {
  const analise = esquemaRegistroDeProduto.safeParse(bruto ?? {});
  if (!analise.success) {
    return {
      tipo: 'invalido',
      problemas: analise.error.issues.map((i) => {
        const campo = i.path.join('.');
        return campo === '' ? i.message : `${campo}: ${i.message}`;
      }),
      bruto,
    };
  }
  return { tipo: 'ok', registro: analise.data };
}
