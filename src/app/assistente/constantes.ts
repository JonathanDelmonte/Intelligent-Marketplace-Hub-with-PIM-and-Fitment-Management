/**
 * Constantes do assistente, fora da página e das ações.
 *
 * Arquivo com `'use server'` só pode exportar função assíncrona, e a visão geral também
 * mostra as perguntas prontas — então elas moram aqui, e as duas telas leem o mesmo.
 */
export const CAMINHO = '/assistente';

/**
 * As perguntas prontas: a pergunta já vem montada, e por isso nenhuma gasta a cota de
 * IA (CLAUDE.md, 3.7). O `id` é o que viaja na URL.
 */
export const PERGUNTAS_PRONTAS = [
  {
    id: 'faturamento_por_loja',
    rotulo: 'Faturamento de cada loja',
    pergunta: 'Qual foi o faturamento de cada loja nos últimos 30 dias?',
  },
  { id: 'postar_hoje', rotulo: 'O que postar hoje?', pergunta: 'O que eu preciso postar hoje?' },
  {
    id: 'margem_por_loja',
    rotulo: 'Qual loja dá mais margem?',
    pergunta: 'Qual loja me dá mais margem nos últimos 30 dias?',
  },
  {
    id: 'mais_vendidos',
    rotulo: 'O que mais vendeu',
    pergunta: 'O que mais vendeu nos últimos 30 dias?',
  },
] as const;

export type IdDaPergunta = (typeof PERGUNTAS_PRONTAS)[number]['id'];
