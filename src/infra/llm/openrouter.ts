/**
 * O chamador do OpenRouter.
 *
 * ## Por que o OpenRouter
 *
 * Escolha do dono: uma chave só, e o modelo de cada finalidade vira uma linha no
 * `.env`. Trocar do modelo forte para o barato, ou de provedor, não muda código. A API
 * é a de chat do OpenAI, que o OpenRouter repete para todos os modelos que oferece.
 *
 * ## O que ele faz, e o que deixa para o serviço
 *
 * Monta a conversa — instruções e formato no papel de sistema, contexto e pergunta no
 * de usuário —, manda, e devolve a resposta **já lida como JSON**, com tokens e custo.
 * Cache, orçamento, registro em `llm_call` e validação pelo schema são do
 * `ServicoDeLlm`: este arquivo não sabe que eles existem.
 *
 * ## Resposta que não é JSON é erro, e não "fora do formato"
 *
 * A diferença importa por causa do cache. Resposta fora do schema é gravada como saída
 * e vira cache — perguntar de novo devolve a mesma resposta ruim, e é o certo: o
 * modelo respondeu, e a fila de revisão existe para isso. Texto que nem JSON é (o
 * modelo respondeu em prosa, ou a resposta foi cortada no limite de tokens) é quase
 * sempre acidente, e como erro ele **não** vira cache: a próxima tentativa pergunta de
 * novo.
 *
 * ## Custo em centavos, arredondado para cima
 *
 * O OpenRouter informa o custo de cada chamada em dólar (`usage.cost`). Aqui ele vira
 * centavos de real pela cotação configurada, **arredondado para cima**: o número
 * existe para o teto de orçamento, e contar a menos é o erro que custa dinheiro. A
 * conta fica pessimista em até um centavo por chamada, o que é o lado certo de errar.
 */
import { z } from 'zod';
import type { Chamador, PedidoAoModelo, RespostaDoModelo } from './index';

export const ENDERECO_DO_OPENROUTER = 'https://openrouter.ai/api/v1';

/** Quanto esperar por uma resposta. Julgamento com resposta longa passa de 30 s. */
const TEMPO_LIMITE_PADRAO_MS = 120_000;

/**
 * Teto de tokens da resposta.
 *
 * As respostas daqui são JSON de poucas centenas de tokens; o teto só corta o modelo
 * que desandou, antes de ele gastar o orçamento da execução inteira numa chamada.
 */
const MAX_TOKENS_DA_RESPOSTA = 4_000;

/** Quanto da resposta ruim aparece na mensagem de erro. O bastante para entender. */
const TRECHO_NO_ERRO = 200;

export interface OpcoesDoOpenRouter {
  readonly chave: string;
  /** Quantos centavos de real vale um dólar, para converter o custo informado. */
  readonly centavosPorDolar: number;
  readonly endereco?: string | undefined;
  /** Para teste: o `fetch` a usar no lugar do global. */
  readonly buscar?: typeof fetch | undefined;
  readonly tempoLimiteMs?: number | undefined;
}

/** A resposta do OpenRouter, só no que este arquivo lê. Fronteira HTTP valida com Zod. */
const esquemaDaResposta = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

const esquemaDoErro = z.object({
  error: z.object({ message: z.string().optional() }),
});

export class RespostaSemJson extends Error {
  override readonly name = 'RespostaSemJson';
  constructor(texto: string) {
    const trecho = texto.replace(/\s+/g, ' ').trim().slice(0, TRECHO_NO_ERRO);
    super(`a resposta do modelo não é JSON: "${trecho}"`);
  }
}

/**
 * A conversa que vai ao modelo.
 *
 * O formato vai por extenso nas instruções, e não como parâmetro de saída estruturada:
 * esse parâmetro tem suporte diferente em cada modelo do catálogo e recusa parte das
 * restrições que os schemas daqui usam (tamanho mínimo de texto, quantidade de itens).
 * Pedido por escrito, qualquer modelo entende — e quem garante o formato na volta é o
 * Zod do serviço, de qualquer jeito.
 */
export function mensagensDoPedido(
  pedido: PedidoAoModelo,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  const sistema = [
    pedido.instrucoes.trim(),
    '',
    'Responda somente com um objeto JSON válido, sem texto antes ou depois e sem bloco de ' +
      'código, seguindo este JSON Schema:',
    JSON.stringify(pedido.formato),
  ].join('\n');

  const partes: string[] = [];
  if (pedido.contexto !== undefined) {
    partes.push(`Contexto:\n${JSON.stringify(pedido.contexto, null, 2)}`);
  }
  partes.push(`Pergunta:\n${JSON.stringify(pedido.entrada, null, 2)}`);

  return [
    { role: 'system', content: sistema },
    { role: 'user', content: partes.join('\n\n') },
  ];
}

/**
 * O JSON da resposta, tolerando o que modelo costuma pôr em volta.
 *
 * Bloco de código (três crases e `json`) e uma frase antes ("Segue a resposta:") são
 * os dois desvios comuns mesmo com instrução contrária. Pega do primeiro `{` ao último
 * `}`, porque toda resposta pedida daqui é um objeto.
 */
export function lerJsonDaResposta(texto: string): unknown {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio === -1 || fim <= inicio) throw new RespostaSemJson(texto);
  try {
    return JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    throw new RespostaSemJson(texto);
  }
}

/**
 * Dólar informado pelo provedor para centavos de real, arredondado para cima.
 *
 * O desconto de um bilionésimo antes do teto existe por causa de ponto flutuante:
 * `0.01 * 600` dá `6.000000000000001`, e o teto disso cobraria sete centavos por uma
 * chamada de seis.
 */
export function centavosDoCusto(dolares: number, centavosPorDolar: number): number {
  return Math.max(0, Math.ceil(dolares * centavosPorDolar - 1e-9));
}

function lerMensagemDoProvedor(corpo: string): string | undefined {
  try {
    const lido = esquemaDoErro.safeParse(JSON.parse(corpo));
    const mensagem = lido.success ? lido.data.error.message?.trim() : undefined;
    return mensagem === undefined || mensagem === '' ? undefined : mensagem.slice(0, 300);
  } catch {
    return undefined;
  }
}

/**
 * O que dizer quando o OpenRouter recusa, em frase que diz o que fazer.
 *
 * Nenhuma delas repete a chave: a mensagem vai para a tela, para o log e para
 * `llm_call.erro`.
 */
export function mensagemDeRecusa(status: number, corpo: string): string {
  switch (status) {
    case 401:
      return 'o OpenRouter recusou a chave (401). Confira a linha LLM_API_KEY do .env.';
    case 402:
      return 'a conta do OpenRouter está sem crédito (402). Adicione crédito no painel do OpenRouter e tente de novo.';
    case 429:
      return 'o OpenRouter pediu para esperar: chamadas demais seguidas (429). Tente de novo em instantes.';
    default: {
      const detalhe = lerMensagemDoProvedor(corpo);
      return detalhe === undefined
        ? `o OpenRouter respondeu ${String(status)}.`
        : `o OpenRouter respondeu ${String(status)}: ${detalhe}`;
    }
  }
}

function descreverFalhaDeRede(erro: unknown, tempoLimiteMs: number): string {
  if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
    return `o OpenRouter não respondeu em ${String(Math.round(tempoLimiteMs / 1000))} segundos.`;
  }
  // `fetch` do Node diz só "fetch failed"; o motivo de verdade (sem internet, DNS)
  // mora na causa.
  const causa =
    erro instanceof Error && erro.cause instanceof Error ? erro.cause.message : undefined;
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return `não consegui falar com o OpenRouter: ${causa ?? mensagem}. Confira a internet.`;
}

export class ChamadorOpenRouter implements Chamador {
  readonly nome = 'openrouter';

  private readonly endereco: string;
  private readonly buscar: typeof fetch;
  private readonly tempoLimiteMs: number;

  constructor(private readonly opcoes: OpcoesDoOpenRouter) {
    if (opcoes.chave.trim() === '') throw new Error('ChamadorOpenRouter exige chave');
    if (!Number.isInteger(opcoes.centavosPorDolar) || opcoes.centavosPorDolar <= 0) {
      throw new Error(
        `cotação do dólar precisa ser inteiro positivo em centavos, recebeu ${String(opcoes.centavosPorDolar)}`,
      );
    }
    this.endereco = opcoes.endereco ?? ENDERECO_DO_OPENROUTER;
    this.buscar = opcoes.buscar ?? fetch;
    this.tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
  }

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    let resposta: Response;
    try {
      resposta = await this.buscar(`${this.endereco}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opcoes.chave.trim()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: pedido.modelo,
          messages: mensagensDoPedido(pedido),
          // Classificação e julgamento, não redação: a mesma pergunta deve ter a
          // mesma resposta, que é também o que torna o cache honesto.
          temperature: 0,
          max_tokens: MAX_TOKENS_DA_RESPOSTA,
        }),
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
    } catch (erro) {
      throw new Error(descreverFalhaDeRede(erro, this.tempoLimiteMs));
    }

    const corpo = await resposta.text();
    if (!resposta.ok) throw new Error(mensagemDeRecusa(resposta.status, corpo));

    let bruto: unknown;
    try {
      bruto = JSON.parse(corpo);
    } catch {
      throw new Error('o OpenRouter respondeu algo que não é JSON.');
    }

    const lido = esquemaDaResposta.safeParse(bruto);
    if (!lido.success) {
      // Erro do provedor de origem pode chegar com status 200 e `error` no corpo.
      const detalhe = lerMensagemDoProvedor(corpo);
      throw new Error(
        detalhe === undefined
          ? 'a resposta do OpenRouter veio sem o formato de chat esperado.'
          : `o OpenRouter devolveu erro: ${detalhe}`,
      );
    }

    const [escolha] = lido.data.choices;
    const texto = escolha?.message.content ?? '';
    if (escolha?.finish_reason === 'length') {
      throw new Error(
        `a resposta do modelo foi cortada no limite de ${String(MAX_TOKENS_DA_RESPOSTA)} tokens.`,
      );
    }

    const uso = lido.data.usage;
    return {
      saida: lerJsonDaResposta(texto),
      tokensEntrada: uso?.prompt_tokens,
      tokensSaida: uso?.completion_tokens,
      custoCentavos:
        uso?.cost === undefined
          ? undefined
          : centavosDoCusto(uso.cost, this.opcoes.centavosPorDolar),
    };
  }
}
