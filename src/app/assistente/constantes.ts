/**
 * Constantes do assistente, fora da página e das ações.
 *
 * A visão geral também mostra as perguntas prontas, então elas moram aqui, e as duas
 * telas leem o mesmo.
 */
import type { Consulta } from '@/dominio/assistente/consulta';
import type { Plataforma } from '@/dominio/precificacao/tipos';

export const CAMINHO = '/assistente';

export interface PerguntaPronta {
  /** O que viaja na URL: `?pronta=postar_hoje`. */
  readonly id: string;
  readonly rotulo: string;
  /** A pergunta por extenso, que a tela mostra como se tivesse sido digitada. */
  readonly pergunta: string;
  /**
   * A consulta já montada. Pergunta pronta não passa pela regra nem pela IA — por isso
   * nenhuma gasta cota (CLAUDE.md, 3.7). O teste confere que a regra, lendo a pergunta
   * por extenso, chegaria na mesma consulta.
   */
  readonly consulta: Consulta;
}

/** As prontas. As quatro primeiras aparecem também na visão geral. */
export const PERGUNTAS_PRONTAS = [
  {
    id: 'faturamento_por_loja',
    rotulo: 'Faturamento de cada loja',
    pergunta: 'Qual foi o faturamento de cada loja nos últimos 30 dias?',
    consulta: { metrica: 'faturamento', lojas: [], periodo: 'ultimos_30', porLoja: true },
  },
  {
    id: 'postar_hoje',
    rotulo: 'O que postar hoje?',
    pergunta: 'O que eu preciso postar hoje?',
    consulta: { metrica: 'postar_hoje', lojas: [], periodo: 'hoje', porLoja: false },
  },
  {
    id: 'margem_por_loja',
    rotulo: 'Qual loja dá mais margem?',
    pergunta: 'Qual loja me dá mais margem nos últimos 30 dias?',
    consulta: { metrica: 'margem', lojas: [], periodo: 'ultimos_30', porLoja: true },
  },
  {
    id: 'mais_vendidos',
    rotulo: 'O que mais vendeu',
    pergunta: 'O que mais vendeu nos últimos 30 dias?',
    consulta: { metrica: 'mais_vendidos', lojas: [], periodo: 'ultimos_30', porLoja: false },
  },
  {
    id: 'vendas_hoje',
    rotulo: 'Quanto vendi hoje?',
    pergunta: 'Quanto eu vendi hoje?',
    consulta: { metrica: 'faturamento', lojas: [], periodo: 'hoje', porLoja: false },
  },
  {
    id: 'resumo_do_mes',
    rotulo: 'Resumo deste mês',
    pergunta: 'Como estão as vendas neste mês?',
    consulta: { metrica: 'resumo', lojas: [], periodo: 'mes_atual', porLoja: false },
  },
  {
    id: 'repasse',
    rotulo: 'Repasse diferente do esperado',
    pergunta: 'Algum repasse veio diferente do esperado?',
    consulta: { metrica: 'repasse_divergente', lojas: [], periodo: 'ultimos_30', porLoja: false },
  },
] as const satisfies readonly PerguntaPronta[];

export type IdDaPergunta = (typeof PERGUNTAS_PRONTAS)[number]['id'];

/** Quantas prontas a visão geral mostra: as primeiras, que são as mais perguntadas. */
export const PRONTAS_NA_VISAO_GERAL = 4;

/** A pronta de um id da URL. Id que não existe não é pronta. */
export function lerPronta(valor: string | string[] | undefined): PerguntaPronta | null {
  const id = Array.isArray(valor) ? valor[0] : valor;
  return PERGUNTAS_PRONTAS.find((p) => p.id === id) ?? null;
}

/** O endereço de uma pronta, levando a loja da área, quando há. */
export function caminhoDaPronta(id: string, loja: Plataforma | undefined): string {
  const busca = new URLSearchParams({ pronta: id });
  if (loja !== undefined) busca.set('loja', loja);
  return `${CAMINHO}?${busca.toString()}`;
}
