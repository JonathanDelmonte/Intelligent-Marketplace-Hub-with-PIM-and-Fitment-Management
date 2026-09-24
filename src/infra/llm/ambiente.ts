/**
 * O ponto onde o serviço de LLM é montado a partir de ambiente.
 *
 * Existe para que **só um arquivo** saiba como ligar a chave. Com `LLM_API_KEY`, o
 * chamador é o do OpenRouter; sem ela, é o ausente, e todo chamador recebe `sem_chave`
 * — que é estado previsto, não erro (ver o cabeçalho de `index.ts`). Nenhuma tela e
 * nenhum módulo de domínio conhece provedor: todos recebem `ServicoDeLlm` por
 * parâmetro.
 */
import { lerAmbiente, type Ambiente } from '@/config/ambiente';
import type { Banco } from '@/infra/banco/cliente';
import { ChamadorAusente, Orcamento, ServicoDeLlm, type Chamador } from './index';
import { ChamadorOpenRouter, ROTEADOR_GRATUITO } from './openrouter';

/**
 * O modelo de cada finalidade quando o `.env` não diz — **todos gratuitos**.
 *
 * Regra do dono (CLAUDE.md, 3.7): tudo funciona de graça primeiro, e opção paga entra
 * depois, como opção. Para texto, o padrão é o roteador `openrouter/free`, que escolhe a
 * cada chamada um modelo gratuito disponível — e não um modelo gratuito com nome, porque a
 * lista deles muda sem aviso: os gratuitos de Llama, Qwen e DeepSeek saíram do catálogo em
 * 2026, e um nome fixo aqui seria um sistema que para de funcionar sozinho. Para embedding
 * não há roteador, e o padrão é um modelo gratuito com nome, de 1024 dimensões.
 *
 * Mora aqui, e não só no `.env.example`, por causa de quem já tem `.env`: ele traz as
 * linhas de modelo vazias, e colar a chave tem de bastar. Trocar por um modelo pago, ou
 * por um gratuito escolhido, é uma linha no `.env`.
 */
export const MODELOS_PADRAO = {
  extracao: ROTEADOR_GRATUITO,
  julgamento: ROTEADOR_GRATUITO,
  fiscal: ROTEADOR_GRATUITO,
  embedding: 'liquid/lfm-2.5-embedding-350m:free',
} as const;

export interface ModelosDoAmbiente {
  readonly extracao: string;
  readonly julgamento: string;
  readonly fiscal: string;
  readonly embedding: string;
}

/** Linha vazia no `.env` é linha ausente: `LLM_MODELO_FISCAL=` não é um modelo chamado "". */
function preenchido(valor: string | undefined): string | undefined {
  const limpo = valor?.trim();
  return limpo === undefined || limpo === '' ? undefined : limpo;
}

export function modelosDoAmbiente(ambiente: Ambiente = lerAmbiente()): ModelosDoAmbiente {
  return {
    extracao: preenchido(ambiente.LLM_MODELO_EXTRACAO) ?? MODELOS_PADRAO.extracao,
    julgamento: preenchido(ambiente.LLM_MODELO_JULGAMENTO) ?? MODELOS_PADRAO.julgamento,
    fiscal: preenchido(ambiente.LLM_MODELO_FISCAL) ?? MODELOS_PADRAO.fiscal,
    embedding: preenchido(ambiente.LLM_MODELO_EMBEDDING) ?? MODELOS_PADRAO.embedding,
  };
}

/** O chamador configurado: o do OpenRouter com chave, o ausente sem. */
export function chamadorDoAmbiente(ambiente: Ambiente = lerAmbiente()): Chamador {
  const chave = preenchido(ambiente.LLM_API_KEY);
  if (chave === undefined) return new ChamadorAusente();
  return new ChamadorOpenRouter({
    chave,
    centavosPorDolar: ambiente.LLM_COTACAO_DOLAR_CENTAVOS,
  });
}

/** Há chave de IA no `.env`? A tela usa para dizer por que algo está parado. */
export function temChaveDeLlm(ambiente: Ambiente = lerAmbiente()): boolean {
  return preenchido(ambiente.LLM_API_KEY) !== undefined;
}

export interface LlmDoAmbiente {
  readonly servico: ServicoDeLlm;
  /** Há chave? Sem ela o serviço existe e responde `sem_chave` a tudo. */
  readonly temChave: boolean;
  readonly modelos: ModelosDoAmbiente;
  /** Modelo de classificação fiscal. `undefined` sem chave, o que desliga a sugestão. */
  readonly modeloFiscal: string | undefined;
}

/**
 * Monta o serviço com o orçamento do ambiente.
 *
 * O teto por execução é obrigatório (ADR 0005) e vem de
 * `LLM_ORCAMENTO_PADRAO_CENTAVOS`. O teto de chamadas é derivado dele, com um piso:
 * um teto em centavos não protege sozinho quando o provedor não informa custo.
 *
 * Chamado **por execução** — por job, por clique —, e nunca guardado: cada chamada a
 * esta função é um orçamento novo, que é o que "teto por execução" quer dizer.
 */
export function llmDoAmbiente(db: Banco, ambiente: Ambiente = lerAmbiente()): LlmDoAmbiente {
  const centavos = ambiente.LLM_ORCAMENTO_PADRAO_CENTAVOS;

  // Uma chamada por real de teto, com piso de dez: números escolhidos, não medidos,
  // e num lugar só para serem ajustados quando houver custo real medido.
  const chamadas = Math.max(10, Math.trunc(centavos / 100));

  const temChave = temChaveDeLlm(ambiente);
  const modelos = modelosDoAmbiente(ambiente);

  return {
    servico: new ServicoDeLlm(db, chamadorDoAmbiente(ambiente), new Orcamento(centavos, chamadas)),
    temChave,
    modelos,
    modeloFiscal: temChave ? modelos.fiscal : undefined,
  };
}
