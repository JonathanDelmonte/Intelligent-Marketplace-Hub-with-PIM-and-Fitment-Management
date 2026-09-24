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
import { ChamadorOpenRouter } from './openrouter';

/**
 * O modelo de cada finalidade quando o `.env` não diz.
 *
 * Mora aqui, e não só no `.env.example`, por causa de quem já tem `.env`: ele foi criado
 * antes de estas linhas terem valor, e traz `LLM_MODELO_FISCAL=` vazio. Sem padrão no
 * código, colar a chave não bastaria — seria preciso também descobrir e escrever o nome
 * de três modelos.
 *
 * Julgamento e fiscal no modelo forte, porque são decisão sobre evidência incompleta;
 * extração no rápido e barato, porque é volume. Nomes do catálogo do OpenRouter,
 * conferidos em 24/09/2026, com o preço por milhão de tokens de entrada e de saída:
 * Sonnet 5 a US$ 2 e US$ 10, Haiku 4.5 a US$ 1 e US$ 5. O embedding tem 1536
 * dimensões, que é o tamanho da coluna (`DIMENSAO_EMBEDDING`).
 */
export const MODELOS_PADRAO = {
  extracao: 'anthropic/claude-haiku-4.5',
  julgamento: 'anthropic/claude-sonnet-5',
  fiscal: 'anthropic/claude-sonnet-5',
  embedding: 'openai/text-embedding-3-small',
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

  const temChave = preenchido(ambiente.LLM_API_KEY) !== undefined;
  const modelos = modelosDoAmbiente(ambiente);

  return {
    servico: new ServicoDeLlm(db, chamadorDoAmbiente(ambiente), new Orcamento(centavos, chamadas)),
    temChave,
    modelos,
    modeloFiscal: temChave ? modelos.fiscal : undefined,
  };
}
