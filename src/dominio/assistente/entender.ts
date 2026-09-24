/**
 * Entender a pergunta por regra, antes de qualquer IA (CLAUDE.md, 3.5 e 3.7).
 *
 * A maioria das perguntas ao assistente é de um punhado de formas — "quanto vendi na
 * Shopee", "o que postar hoje", "qual loja dá mais margem" —, e para essas uma lista de
 * palavras basta e não gasta nada. A IA gratuita entra só quando a regra não entendeu,
 * e a cota dela (50 pedidos por dia) fica para as perguntas que precisam.
 *
 * ## A regra erra para o lado de não entender
 *
 * Métrica que não se reconhece devolve `nao_entendida`, e não um palpite: palpite errado
 * daqui vira resposta certa para a pergunta errada, com número verdadeiro — o erro que
 * ninguém percebe. Quem não entendeu passa a vez para a IA, e a tela mostra, com a
 * resposta, como a pergunta foi entendida.
 */
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { PERIODO_PADRAO, type Consulta, type Metrica, type Periodo } from './consulta';

/**
 * Como cada loja aparece escrita numa pergunta.
 *
 * `Record` de propósito: loja nova no domínio não compila sem dizer como se escreve o
 * nome dela, e o nome entra também nas instruções da IA (`ia.ts`).
 */
export const LOJAS_NA_PERGUNTA: Readonly<
  Record<Plataforma, { readonly nome: string; readonly termos: readonly RegExp[] }>
> = {
  ml: { nome: 'Mercado Livre', termos: [/\bmercado ?livre\b/, /\bml\b/, /\bmeli\b/] },
  shopee: { nome: 'Shopee', termos: [/\bshopp?ee?\b/] },
  amazon: { nome: 'Amazon', termos: [/\bamazo[nm]\b/] },
};

/**
 * A métrica pelas palavras, **em ordem**: a primeira que casa vence.
 *
 * A ordem é a do mais específico para o mais geral. "Quantos pedidos atrasados" é fila,
 * não contagem de pedidos; "faturamento dos pedidos" é faturamento; "como está a margem"
 * é margem, e "como estão as vendas" é o resumo; e "pedido", sozinho, só vira contagem
 * depois que nada mais casou.
 */
const TERMOS_DA_METRICA: readonly (readonly [Metrica, readonly RegExp[]])[] = [
  ['postar_hoje', [/\bpost(ar|o|agem)\b/, /\bdespach/, /\benviar\b/, /\bembalar\b/, /\batrasad/]],
  ['repasse_divergente', [/\brepass/, /\bdivergen/, /\b(pagou|pagaram|recebi) menos\b/]],
  ['margem', [/\bmarge(m|ns)\b/, /\blucr/, /\brentab/]],
  ['ticket_medio', [/\bti(ck|qu)ete?\b/, /\bvalor medio\b/, /\bmedia por (pedido|venda)\b/]],
  // "Qual loja vendeu mais" é faturamento por loja, e não produto campeão: a loja é o
  // sujeito. Vem antes dos mais vendidos, que casariam o "vendeu mais".
  ['faturamento', [/\bloja (que )?(mais )?vend/]],
  [
    'mais_vendidos',
    [
      /\bmais vend/,
      /\bvende(u|m)? mais\b/,
      /\bsai(u|ram)? mais\b/,
      /\bcampe(ao|oes)\b/,
      /\bo que (eu )?vend(i|eu)\b/,
      /\bmelhores produtos\b/,
    ],
  ],
  [
    'pedidos',
    [
      /\bquant[oa]s (pedidos|vendas)\b/,
      /\bnumero de (pedidos|vendas)\b/,
      /\bquantidade de (pedidos|vendas)\b/,
    ],
  ],
  // "Como estão as vendas" pede o quadro, não um número: vem antes do faturamento, que
  // casaria o "vendas". A margem e os mais vendidos, mais específicos, vêm antes dele.
  [
    'resumo',
    [/\bcomo (esta|estao|vai|vao|foi|foram|anda|andam)\b/, /\bresumo\b/, /\bdesempenho\b/],
  ],
  ['faturamento', [/\bfatur/, /\bvend(i|eu|emos|as)\b/, /\breceita\b/, /\bganhei\b/, /\bentrou\b/]],
  ['pedidos', [/\bpedidos?\b/]],
];

/** "cada loja", "qual loja", "Shopee ou Mercado Livre": a resposta separa por loja. */
const TERMOS_POR_LOJA: readonly RegExp[] = [
  /\bcada loja\b/,
  /\bpor loja\b/,
  /\b(qual|quais|que) (das )?lojas?\b/,
  /\bem que loja\b/,
  /\bentre as lojas\b/,
  /\bcompar/,
];

/** O período pelas palavras, também em ordem: "mês passado" antes de "mês". */
const TERMOS_DO_PERIODO: readonly (readonly [Periodo, readonly RegExp[]])[] = [
  ['hoje', [/\bhoje\b/]],
  ['ontem', [/\bontem\b/]],
  ['mes_passado', [/\bmes (passado|anterior)\b/]],
  ['mes_atual', [/\b(n?est|n?ess|dest|dess)e mes\b/, /\bmes atual\b/]],
  ['ultimos_7', [/\bsemana\b/, /\b(7|sete) dias\b/]],
  ['ultimos_90', [/\b(90|noventa) dias\b/, /\b(3|tres) meses\b/, /\btrimestre\b/]],
  ['ultimos_30', [/\b(30|trinta) dias\b/, /\bultimo mes\b/]],
];

/**
 * A pergunta como a regra a lê: sem acento, minúscula, pontuação virando espaço.
 *
 * É também o que vai para o cache da IA (`ia.ts`): "Quanto vendi?" e "quanto vendi"
 * são a mesma pergunta, e não podem custar duas chamadas.
 */
export function normalizarPergunta(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function casa(texto: string, termos: readonly RegExp[]): boolean {
  return termos.some((t) => t.test(texto));
}

/** As lojas citadas, na ordem do domínio. */
export function lojasCitadas(normalizada: string): readonly Plataforma[] {
  return PLATAFORMAS.filter((p) => casa(normalizada, LOJAS_NA_PERGUNTA[p].termos));
}

export type Entendimento =
  { readonly tipo: 'entendida'; readonly consulta: Consulta } | { readonly tipo: 'nao_entendida' };

/**
 * Traduz a pergunta em consulta, ou diz que não entendeu.
 *
 * Loja citada sem métrica é pergunta de resumo ("e a Shopee?"). Sem métrica e sem loja,
 * a regra não entendeu, e a vez é da IA.
 */
export function entenderPorRegra(texto: string): Entendimento {
  const normalizada = normalizarPergunta(texto);
  if (normalizada === '') return { tipo: 'nao_entendida' };

  const lojas = lojasCitadas(normalizada);
  const metrica =
    TERMOS_DA_METRICA.find(([, termos]) => casa(normalizada, termos))?.[0] ??
    (lojas.length > 0 ? 'resumo' : undefined);
  if (metrica === undefined) return { tipo: 'nao_entendida' };

  const periodo =
    TERMOS_DO_PERIODO.find(([, termos]) => casa(normalizada, termos))?.[0] ?? PERIODO_PADRAO;

  return {
    tipo: 'entendida',
    consulta: {
      metrica,
      lojas,
      periodo,
      // Duas lojas citadas é comparação, mesmo sem a palavra: "Shopee ou Mercado Livre?"
      porLoja: lojas.length > 1 || casa(normalizada, TERMOS_POR_LOJA),
    },
  };
}
