/**
 * A pergunta do assistente, em forma fechada (ADR 0009).
 *
 * O assistente não conversa com os dados. Ele traduz a pergunta para uma consulta desta
 * lista — uma métrica, as lojas, um período —, e quem responde é o código, com as mesmas
 * somas da área da loja e da visão geral. É a regra do ADR: **número nunca sai do
 * modelo de linguagem.** Um "R$ 4.321" inventado com cara de certo é o pior erro que
 * uma tela de dinheiro pode cometer, e uma consulta fechada não tem como inventá-lo.
 *
 * O preço é a pergunta que não cabe na lista. Ela recebe "ainda não sei responder
 * isso", com a lista do que se sabe — e a lista cresce por entrega, uma métrica por vez.
 */
import { z } from 'zod';
import { janelaAte, somarDias, type Janela } from '@/dominio/lojas/painel';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';

export const METRICAS = [
  'resumo',
  'faturamento',
  'pedidos',
  'ticket_medio',
  'margem',
  'mais_vendidos',
  'postar_hoje',
  'repasse_divergente',
] as const;
export type Metrica = (typeof METRICAS)[number];

export const PERIODOS = [
  'hoje',
  'ontem',
  'ultimos_7',
  'ultimos_30',
  'ultimos_90',
  'mes_atual',
  'mes_passado',
] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Pergunta sem período é sobre os últimos 30 dias: a mesma janela do painel. */
export const PERIODO_PADRAO: Periodo = 'ultimos_30';

export interface Consulta {
  readonly metrica: Metrica;
  /** As lojas da pergunta. Vazio é todas. */
  readonly lojas: readonly Plataforma[];
  readonly periodo: Periodo;
  /** A resposta separa por loja ("cada loja", "qual loja"), em vez de só somar. */
  readonly porLoja: boolean;
}

export const esquemaDaConsulta = z.object({
  metrica: z.enum(METRICAS),
  lojas: z.array(z.enum(PLATAFORMAS)),
  periodo: z.enum(PERIODOS),
  porLoja: z.boolean(),
});

/**
 * A métrica olha uma janela de dias? A fila de postagem e o repasse aberto são de
 * agora: "o que postar no mês passado" não é pergunta que se responda.
 */
export function olhaJanela(metrica: Metrica): boolean {
  return metrica !== 'postar_hoje' && metrica !== 'repasse_divergente';
}

/**
 * As lojas que a resposta cobre: as citadas, ou todas.
 *
 * Sem repetição e na ordem do domínio — "shopee e shopee" é uma loja, e a ordem da
 * resposta não pode depender da ordem em que a pessoa escreveu.
 */
export function lojasDaConsulta(consulta: Consulta): readonly Plataforma[] {
  if (consulta.lojas.length === 0) return PLATAFORMAS;
  return PLATAFORMAS.filter((p) => consulta.lojas.includes(p));
}

/**
 * Aplica a loja de onde a pergunta veio.
 *
 * Quem pergunta "quanto vendi este mês?" dentro da área da Shopee pergunta da Shopee.
 * Vale só quando a pergunta não cita loja e não pede comparação: "qual loja dá mais
 * margem?" continua sendo sobre todas, de onde quer que venha.
 */
export function comLojaDoContexto(consulta: Consulta, loja: Plataforma | undefined): Consulta {
  if (loja === undefined || consulta.porLoja || consulta.lojas.length > 0) return consulta;
  return { ...consulta, lojas: [loja] };
}

/** A janela da pergunta e a de antes, do mesmo tamanho, para comparar. */
export interface JanelasDoPeriodo {
  readonly atual: Janela;
  readonly anterior: Janela;
}

/** `2026-09-24` → `2026-09-01`. */
function primeiroDoMes(dia: string): string {
  return `${dia.slice(0, 8)}01`;
}

/** Quantos dias do mês até este dia, contando ele: `2026-09-24` → 24. */
function diaDoMes(dia: string): number {
  return Number(dia.slice(8, 10));
}

/** O mês inteiro que termina no dia anterior a `primeiro`. */
function mesAntes(primeiro: string, fuso: string): Janela {
  const ultimo = somarDias(primeiro, -1);
  return janelaAte(ultimo, diaDoMes(ultimo), fuso);
}

/**
 * As janelas de um período, no fuso do vendedor.
 *
 * A comparação é com o período de antes, do mesmo jeito que se fala: hoje contra ontem,
 * os últimos 30 dias contra os 30 anteriores, o mês passado contra o mês antes dele. O
 * mês corrente, que ainda está pela metade, compara com **o mesmo trecho** do mês
 * anterior — do dia 1 até o mesmo dia —, e não com o mês inteiro: 24 dias contra 31
 * pareceria queda todo mês até o dia 31.
 */
export function janelasDoPeriodo(
  periodo: Periodo,
  agora: Date,
  fuso: string = FUSO_PADRAO,
): JanelasDoPeriodo {
  const hoje = diaNoFuso(agora, fuso);

  const ultimos = (dias: number): JanelasDoPeriodo => ({
    atual: janelaAte(hoje, dias, fuso),
    anterior: janelaAte(somarDias(hoje, -dias), dias, fuso),
  });

  switch (periodo) {
    case 'hoje':
      return ultimos(1);
    case 'ontem': {
      const ontem = somarDias(hoje, -1);
      return {
        atual: janelaAte(ontem, 1, fuso),
        anterior: janelaAte(somarDias(ontem, -1), 1, fuso),
      };
    }
    case 'ultimos_7':
      return ultimos(7);
    case 'ultimos_30':
      return ultimos(30);
    case 'ultimos_90':
      return ultimos(90);
    case 'mes_atual': {
      const dias = diaDoMes(hoje);
      const antes = mesAntes(primeiroDoMes(hoje), fuso);
      // O mês anterior pode ser mais curto: 31 de março compara com fevereiro inteiro.
      const trecho = Math.min(dias, antes.dias.length);
      const ultimoDoTrecho = antes.dias[trecho - 1] ?? hoje;
      return {
        atual: janelaAte(hoje, dias, fuso),
        anterior: janelaAte(ultimoDoTrecho, trecho, fuso),
      };
    }
    case 'mes_passado': {
      const passado = mesAntes(primeiroDoMes(hoje), fuso);
      const primeiroDoPassado = passado.dias[0] ?? primeiroDoMes(hoje);
      return { atual: passado, anterior: mesAntes(primeiroDoPassado, fuso) };
    }
  }
}
