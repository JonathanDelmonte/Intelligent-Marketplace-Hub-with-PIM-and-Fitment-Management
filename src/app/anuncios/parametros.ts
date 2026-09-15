/**
 * Os parâmetros da montagem, lidos da URL.
 *
 * A tela é **montada a partir da URL**, não de estado de sessão, e isso resolve
 * três coisas de uma vez: a montagem é reproduzível, o link é compartilhável, e a
 * rota que devolve o arquivo de importação monta exatamente o mesmo anúncio que a
 * tela mostrou — porque recebe os mesmos parâmetros.
 *
 * Se a montagem vivesse em ação de servidor com estado, o botão de baixar teria de
 * refazer as escolhas de memória, e "o arquivo saiu diferente do que a tela
 * mostrou" é o tipo de bug que só aparece em produção.
 *
 * Fronteira externa, então **Zod** (convenções, seção 4). Query string é entrada de
 * usuário como qualquer formulário: vem de link colado, de histórico do navegador e
 * de pessoa editando a barra de endereço.
 */
import { z } from 'zod';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { reaisParaCentavos, type Centavos } from '@/lib/dinheiro';
import { QUANTIDADE_PADRAO } from './constantes';

/**
 * Preço como a pessoa digita: `89`, `89,90` ou `89.90`.
 *
 * Validado por regex e entregue como **texto** a `reaisParaCentavos`, que faz a
 * conta em string. Passar por `Number` no meio seria uma volta pelo ponto flutuante
 * — e é justamente o caminho que aquela função existe para evitar.
 */
const PRECO = /^\d+(?:[.,]\d{1,2})?$/;

const esquema = z.object({
  sku: z.string().trim().uuid(),
  plataforma: z.enum(PLATAFORMAS),
  preco: z.string().trim().regex(PRECO),
  qtd: z.coerce.number().int().positive().max(100_000).default(QUANTIDADE_PADRAO),
  /**
   * Tipo do produto, editável na tela.
   *
   * Existe porque `sku` não tem coluna para isso: o valor vem do registro extraído
   * das ocorrências e às vezes está errado ou ausente. Quem monta o anúncio precisa
   * poder corrigir sem mexer no catálogo, e o que ele corrigiu precisa sobreviver ao
   * botão de baixar — daí estar na URL, como o resto.
   */
  tipo: z.string().trim().max(200).optional(),
});

export interface ParametrosDaMontagem {
  readonly skuId: string;
  readonly plataforma: Plataforma;
  readonly preco: Centavos;
  readonly precoComoTexto: string;
  readonly quantidade: number;
  readonly tipoProduto: string | null;
}

export type LeituraDosParametros =
  | { readonly tipo: 'ok'; readonly parametros: ParametrosDaMontagem }
  | { readonly tipo: 'ausente' }
  | { readonly tipo: 'invalido'; readonly campos: readonly string[] };

/** Um valor da query string, que pode chegar repetido. O primeiro vale. */
function primeiro(valor: string | readonly string[] | undefined): string | undefined {
  // `Array.isArray` não estreita `readonly string[]`, então o teste é pelo tipo.
  return typeof valor === 'string' || valor === undefined ? valor : valor[0];
}

/**
 * Lê os parâmetros.
 *
 * Três resultados, e a distinção entre os dois primeiros é o que faz a tela abrir
 * limpa em vez de com erro: **`ausente`** é a primeira visita, sem nada escolhido,
 * e não é erro nenhum; **`invalido`** é escolha que não dá para usar, e aí a tela
 * diz qual campo.
 */
export function lerParametros(
  bruto: Readonly<Record<string, string | string[] | undefined>>,
): LeituraDosParametros {
  const sku = primeiro(bruto['sku']);
  if (sku === undefined || sku === '') return { tipo: 'ausente' };

  const analise = esquema.safeParse({
    sku,
    plataforma: primeiro(bruto['plataforma']),
    preco: primeiro(bruto['preco']),
    ...(primeiro(bruto['qtd']) === undefined ? {} : { qtd: primeiro(bruto['qtd']) }),
    ...(primeiro(bruto['tipo']) === undefined ? {} : { tipo: primeiro(bruto['tipo']) }),
  });

  if (!analise.success) {
    const campos = [...new Set(analise.error.issues.map((i) => String(i.path[0] ?? '?')))];
    return { tipo: 'invalido', campos };
  }

  const dados = analise.data;
  return {
    tipo: 'ok',
    parametros: {
      skuId: dados.sku,
      plataforma: dados.plataforma,
      preco: reaisParaCentavos(dados.preco),
      precoComoTexto: dados.preco,
      quantidade: dados.qtd,
      tipoProduto: dados.tipo === undefined || dados.tipo === '' ? null : dados.tipo,
    },
  };
}

/**
 * Remonta a query string a partir dos parâmetros lidos.
 *
 * É como o link de baixar é construído, e existe para ele **não poder divergir** da
 * tela: os dois lados falam a mesma linguagem porque só há uma função que a escreve.
 */
export function comoQueryString(parametros: ParametrosDaMontagem): string {
  const busca = new URLSearchParams({
    sku: parametros.skuId,
    plataforma: parametros.plataforma,
    preco: parametros.precoComoTexto,
    qtd: String(parametros.quantidade),
  });
  if (parametros.tipoProduto !== null) busca.set('tipo', parametros.tipoProduto);
  return busca.toString();
}
