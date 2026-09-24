/**
 * Entender a pergunta com IA, quando a regra não entendeu (ADR 0009). 🧠
 *
 * A IA aqui **traduz, não responde**: recebe a pergunta e devolve uma consulta da lista
 * fechada de `consulta.ts`, ou diz que a pergunta não cabe nela. Ela nunca vê número de
 * venda, e por isso não tem como inventar um — quem soma é o código, com as mesmas
 * consultas da área da loja.
 *
 * ## Disciplina de custo (CLAUDE.md, 3.5 e 3.7)
 *
 * - Só roda depois da regra (`entender.ts`), que resolve as perguntas comuns de graça.
 * - A pergunta vai normalizada para o cache: "Quanto vendi?" e "quanto vendi" custam
 *   uma chamada só, e a mesma pergunta amanhã não custa nenhuma — a consulta é relativa
 *   ("hoje", "mês passado"), e a data entra depois, no código.
 * - A loja de onde se pergunta fica **fora** do hash: é aplicada depois, por
 *   `comLojaDoContexto`, do mesmo jeito que na regra.
 * - Cota esgotada e teto de gasto sobem como `ExecucaoInterrompida`, e a tela diz quando
 *   a cota volta. As perguntas prontas continuam respondendo, porque não passam por aqui.
 */
import { z } from 'zod';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import { ExecucaoInterrompida, type Proposito, type ServicoDeLlm } from '@/infra/llm';
import { METRICAS, PERIODO_PADRAO, PERIODOS, type Consulta } from './consulta';
import { LOJAS_NA_PERGUNTA, normalizarPergunta } from './entender';

export const PROPOSITO_ASSISTENTE: Proposito = 'assistente';

/** Pergunta maior que isto não é pergunta de painel, e não vale uma chamada. */
export const TAMANHO_MAXIMO_DA_PERGUNTA = 300;

/** Menos que isto não tem sinal para a IA: "oi" não vira consulta. */
const TAMANHO_MINIMO_DA_PERGUNTA = 4;

const lojasNasInstrucoes = PLATAFORMAS.map((p) => `"${p}" (${LOJAS_NA_PERGUNTA[p].nome})`).join(
  ', ',
);

/**
 * O que o modelo deve fazer.
 *
 * As métricas são descritas como o vendedor fala delas, e não pelo nome da coluna —
 * modelo gratuito acerta mais quando a descrição é a pergunta. E a instrução de não
 * responder vem primeiro: modelo que recebe "quanto vendi" tende a responder um valor.
 */
export const INSTRUCOES_DO_ASSISTENTE = `Você traduz a pergunta de um vendedor de marketplace para uma consulta de uma lista fechada. Não responda a pergunta e não escreva nenhum número de venda: só diga qual consulta ela pede.

Métricas (campo "metrica"):
- "resumo": como uma loja, ou o negócio, está no geral.
- "faturamento": quanto vendeu, em reais.
- "pedidos": quantos pedidos ou vendas.
- "ticket_medio": valor médio por pedido.
- "margem": margem ou lucro.
- "mais_vendidos": os produtos que mais venderam.
- "postar_hoje": pedidos para postar, enviar ou que estão atrasados.
- "repasse_divergente": repasse da loja que veio diferente do esperado.
Se a pergunta não for sobre nenhuma dessas, metrica = null.

Lojas (campo "lojas"): ${lojasNasInstrucoes}. Lista vazia quando a pergunta não cita loja ou fala de todas.

Período (campo "periodo"): "hoje", "ontem", "ultimos_7", "ultimos_30", "ultimos_90", "mes_atual" ou "mes_passado". Sem período na pergunta, null.

porLoja: true quando a pergunta compara lojas ou pede a resposta separada por loja ("cada loja", "qual loja").`;

/**
 * O que o modelo devolve. Mais frouxo que a consulta, de propósito: modelo gratuito
 * esquece campo, e campo esquecido tem padrão — só a métrica é obrigatória, e nula quer
 * dizer "fora do que eu sei responder".
 */
export const esquemaDaTraducao = z.object({
  metrica: z.enum(METRICAS).nullable(),
  lojas: z.array(z.enum(PLATAFORMAS)).default([]),
  periodo: z.enum(PERIODOS).nullable().default(null),
  porLoja: z.boolean().default(false),
});

export type TraducaoPorIa =
  | { readonly tipo: 'entendida'; readonly consulta: Consulta; readonly deCache: boolean }
  | { readonly tipo: 'fora_do_alcance' }
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'falhou'; readonly motivo: string };

export interface OpcoesDaTraducao {
  readonly llm: ServicoDeLlm;
  readonly modelo: string;
}

/**
 * Pede à IA a consulta da pergunta.
 *
 * Nunca lança, exceto `ExecucaoInterrompida` — cota do provedor ou teto de gasto —,
 * que a tela trata dizendo quando volta.
 */
export async function traduzirComIa(
  pergunta: string,
  opcoes: OpcoesDaTraducao,
): Promise<TraducaoPorIa> {
  const normalizada = normalizarPergunta(pergunta);
  if (normalizada.length < TAMANHO_MINIMO_DA_PERGUNTA) return { tipo: 'fora_do_alcance' };

  let resultado;
  try {
    resultado = await opcoes.llm.pedir({
      proposito: PROPOSITO_ASSISTENTE,
      modelo: opcoes.modelo,
      instrucoes: INSTRUCOES_DO_ASSISTENTE,
      entrada: { pergunta: normalizada.slice(0, TAMANHO_MAXIMO_DA_PERGUNTA) },
      esquema: esquemaDaTraducao,
    });
  } catch (erro) {
    if (erro instanceof ExecucaoInterrompida) throw erro;
    return { tipo: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) };
  }

  switch (resultado.tipo) {
    case 'sem_chave':
      return { tipo: 'sem_chave' };
    case 'erro':
      return { tipo: 'falhou', motivo: resultado.mensagem };
    case 'pendente_revisao':
      return {
        tipo: 'falhou',
        motivo: `resposta fora do formato esperado: ${resultado.problemas.join('; ')}`,
      };
    case 'ok': {
      const t = resultado.valor;
      if (t.metrica === null) return { tipo: 'fora_do_alcance' };
      const lojas = PLATAFORMAS.filter((p) => t.lojas.includes(p));
      return {
        tipo: 'entendida',
        consulta: {
          metrica: t.metrica,
          lojas,
          periodo: t.periodo ?? PERIODO_PADRAO,
          porLoja: t.porLoja || lojas.length > 1,
        },
        deCache: resultado.deCache,
      };
    }
  }
}
