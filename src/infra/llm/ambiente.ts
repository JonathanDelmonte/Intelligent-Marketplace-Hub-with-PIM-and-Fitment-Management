/**
 * O ponto onde o serviço de LLM é montado a partir de ambiente.
 *
 * Existe para que **só um arquivo** saiba como ligar a chave. Hoje não há provedor
 * implementado, então o que sai daqui usa `ChamadorAusente` e todo chamador recebe
 * `sem_chave` — que é estado previsto, não erro (ver o cabeçalho de `index.ts`).
 *
 * Quando houver provedor, o conserto é uma linha aqui: implementar `Chamador` e
 * devolvê-lo em vez do ausente. Nenhuma tela e nenhum módulo de domínio muda, porque
 * nenhum deles conhece provedor — todos recebem `ServicoDeLlm` por parâmetro.
 */
import { lerAmbiente } from '@/config/ambiente';
import type { Banco } from '@/infra/banco/cliente';
import { ChamadorAusente, Orcamento, ServicoDeLlm, type Chamador } from './index';

/**
 * O chamador configurado, ou o ausente.
 *
 * Separado do resto para o dia em que houver provedor: é esta função que passa a
 * olhar `LLM_API_KEY` e devolver um cliente de verdade.
 */
export function chamadorDoAmbiente(): Chamador {
  // `LLM_API_KEY` é lida aqui de propósito, mesmo sem uso hoje: é o que deixa claro
  // que a decisão de "tem provedor?" mora neste arquivo e em nenhum outro.
  const { LLM_API_KEY } = lerAmbiente();
  if (LLM_API_KEY === undefined || LLM_API_KEY.trim() === '') return new ChamadorAusente();

  // Há chave e ainda não há cliente. Devolver o ausente é o comportamento honesto:
  // a tela diz "ninguém sugeriu", em vez de a chamada falhar como erro de rede.
  return new ChamadorAusente();
}

export interface LlmDoAmbiente {
  readonly servico: ServicoDeLlm;
  /** Modelo de classificação fiscal. `undefined` desliga a sugestão. */
  readonly modeloFiscal: string | undefined;
}

/**
 * Monta o serviço com o orçamento do ambiente.
 *
 * O teto por execução é obrigatório (ADR 0005) e vem de
 * `LLM_ORCAMENTO_PADRAO_CENTAVOS`. O teto de chamadas é derivado dele, com um piso:
 * um teto em centavos não protege sozinho quando o provedor não informa custo.
 */
export function llmDoAmbiente(db: Banco): LlmDoAmbiente {
  const ambiente = lerAmbiente();
  const centavos = ambiente.LLM_ORCAMENTO_PADRAO_CENTAVOS;

  // Uma chamada por real de teto, com piso de dez: números escolhidos, não medidos,
  // e num lugar só para serem ajustados quando houver custo real medido.
  const chamadas = Math.max(10, Math.trunc(centavos / 100));

  return {
    servico: new ServicoDeLlm(db, chamadorDoAmbiente(), new Orcamento(centavos, chamadas)),
    modeloFiscal: ambiente.LLM_MODELO_FISCAL,
  };
}
