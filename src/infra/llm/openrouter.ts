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
 *
 * ## Modelos gratuitos: a cota é o teto que manda
 *
 * Regra do dono: tudo funciona de graça primeiro. Modelo gratuito (`:free`, ou o
 * roteador `openrouter/free`) não custa nada e tem cota — 20 pedidos por minuto, e 50
 * por dia na conta que nunca comprou crédito (1.000 depois de uma compra única de US$ 10),
 * contados no OpenRouter em 24/09/2026. E **pedido recusado por cota também conta**.
 * Daí as duas defesas de `CotaGratuita`: espaçar os pedidos para não passar de 20 por
 * minuto, e, depois de uma recusa, não perguntar de novo antes da hora que o provedor
 * disse — recusar aqui, sem sair da máquina.
 */
import { z } from 'zod';
import {
  LimiteDoProvedor,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from './index';

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

/** Intervalo entre pedidos gratuitos: 20 por minuto dá 3 s, e a folga cobre relógio torto. */
export const ESPACO_ENTRE_PEDIDOS_GRATUITOS_MS = 3_100;

/** Pausa depois de uma recusa por minuto, quando o provedor não diz quanto esperar. */
const PAUSA_POR_MINUTO_MS = 60_000;

/** O roteador do OpenRouter que escolhe um modelo gratuito disponível a cada chamada. */
export const ROTEADOR_GRATUITO = 'openrouter/free';

/** Modelo que não custa nada — e que, por isso, tem cota. */
export function ehModeloGratuito(modelo: string): boolean {
  return modelo === ROTEADOR_GRATUITO || modelo.endsWith(':free');
}

/**
 * A cota dos modelos gratuitos, do ponto de vista deste processo.
 *
 * Uma por processo (`COTA_GRATUITA_DO_PROCESSO`): o servidor e a fila são processos
 * separados, e cada um espaça os próprios pedidos. Juntos podem passar de 20 por minuto
 * num pico, e aí a recusa do provedor vira bloqueio aqui — que é a segunda defesa.
 */
export class CotaGratuita {
  private proximoLivre = 0;
  private bloqueio: { readonly ate: number; readonly mensagem: string } | null = null;

  constructor(
    private readonly espacoMs: number = ESPACO_ENTRE_PEDIDOS_GRATUITOS_MS,
    private readonly agora: () => number = Date.now,
    private readonly dormir: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolver) => setTimeout(resolver, ms)),
  ) {}

  /** A recusa em vigor, ou `null` quando já passou da hora. */
  vigente(): { readonly ate: Date; readonly mensagem: string } | null {
    if (this.bloqueio === null) return null;
    if (this.agora() >= this.bloqueio.ate) {
      this.bloqueio = null;
      return null;
    }
    return { ate: new Date(this.bloqueio.ate), mensagem: this.bloqueio.mensagem };
  }

  bloquear(ate: Date, mensagem: string): void {
    this.bloqueio = { ate: ate.getTime(), mensagem };
  }

  /** Espera a vez do próximo pedido. A vez é reservada antes de esperar, então dois
   * pedidos simultâneos saem em fila, e não juntos. */
  async aguardarVez(): Promise<void> {
    const agora = this.agora();
    const vez = Math.max(agora, this.proximoLivre);
    this.proximoLivre = vez + this.espacoMs;
    if (vez > agora) await this.dormir(vez - agora);
  }
}

export const COTA_GRATUITA_DO_PROCESSO = new CotaGratuita();

export interface OpcoesDoOpenRouter {
  readonly chave: string;
  /** Quantos centavos de real vale um dólar, para converter o custo informado. */
  readonly centavosPorDolar: number;
  readonly endereco?: string | undefined;
  /** Para teste: o `fetch` a usar no lugar do global. */
  readonly buscar?: typeof fetch | undefined;
  readonly tempoLimiteMs?: number | undefined;
  /** Para teste: a cota a usar no lugar da do processo. */
  readonly cota?: CotaGratuita | undefined;
}

/** A resposta do OpenRouter, só no que este arquivo lê. Fronteira HTTP valida com Zod. */
const esquemaDaResposta = z.object({
  /** O modelo que respondeu — o que importa quando o pedido foi ao roteador. */
  model: z.string().optional(),
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
  error: z.object({
    message: z.string().optional(),
    metadata: z
      .object({
        headers: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      })
      .optional(),
  }),
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
  const detalhe = lerMensagemDoProvedor(corpo);
  switch (status) {
    case 401:
      return 'o OpenRouter recusou a chave (401). Confira a linha LLM_API_KEY do .env.';
    case 402:
      return 'a conta do OpenRouter está sem crédito (402). Adicione crédito no painel do OpenRouter e tente de novo.';
    default: {
      // A armadilha dos modelos gratuitos: eles só respondem à conta que permitiu o uso
      // dos dados pelo provedor. Sem isso, o OpenRouter diz que não há modelo que
      // atenda à "política de dados" — frase que não diz a ninguém onde clicar.
      if (detalhe !== undefined && /data policy/i.test(detalhe)) {
        return 'o OpenRouter não liberou os modelos gratuitos para esta conta: eles exigem permitir que o provedor use os dados. Em openrouter.ai/settings/privacy, ative a opção dos modelos gratuitos ("free endpoints" / "free model publication") e tente de novo.';
      }
      return detalhe === undefined
        ? `o OpenRouter respondeu ${String(status)}.`
        : `o OpenRouter respondeu ${String(status)}: ${detalhe}`;
    }
  }
}

/** A meia-noite UTC seguinte, que é quando a cota diária do OpenRouter vira. */
function proximaMeiaNoiteUtc(agora: number): number {
  const data = new Date(agora);
  return Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate() + 1);
}

function quandoLegivel(data: Date): string {
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A recusa por cota (429): até quando, e o que dizer.
 *
 * O OpenRouter manda, dentro do erro, o cabeçalho `X-RateLimit-Reset` com o instante
 * em que a cota volta (em milissegundos), e diz na mensagem se a cota é a do dia
 * (`free-models-per-day`). Sem esses dados, a do dia vira na meia-noite UTC e a do
 * minuto em um minuto.
 */
export function lerLimite(
  corpo: string,
  agora: number,
): { readonly ate: Date; readonly mensagem: string } {
  let texto = '';
  let reset: number | undefined;
  let limite: string | undefined;
  try {
    const lido = esquemaDoErro.safeParse(JSON.parse(corpo));
    if (lido.success) {
      texto = lido.data.error.message ?? '';
      const cabecalhos = lido.data.error.metadata?.headers ?? {};
      const bruto = Number(cabecalhos['X-RateLimit-Reset']);
      // Segundos, e não milissegundos, se o número for pequeno demais para ser data em ms.
      const emMs = bruto < 1e12 ? bruto * 1000 : bruto;
      if (Number.isFinite(emMs) && emMs > agora) reset = emMs;
      const teto = cabecalhos['X-RateLimit-Limit'];
      if (teto !== undefined) limite = String(teto);
    }
  } catch {
    // Corpo que não é JSON: fica o padrão de um minuto.
  }

  if (/per-day/i.test(texto)) {
    const ate = new Date(reset ?? proximaMeiaNoiteUtc(agora));
    const quantos = limite === undefined ? '' : ` (${limite} pedidos por dia)`;
    return {
      ate,
      mensagem: `acabou a cota diária dos modelos gratuitos do OpenRouter${quantos}. Ela volta em ${quandoLegivel(ate)}. Uma compra única de US$ 10 em créditos sobe a cota para 1.000 pedidos por dia, e os modelos continuam gratuitos.`,
    };
  }

  // Cota do minuto, ou o modelo gratuito congestionado na origem: pausa curta.
  const ate =
    reset !== undefined && reset - agora <= 10 * PAUSA_POR_MINUTO_MS
      ? reset
      : agora + PAUSA_POR_MINUTO_MS;
  return {
    ate: new Date(ate),
    mensagem:
      'os modelos gratuitos do OpenRouter pediram uma pausa: pedidos demais em pouco tempo. Tente de novo em cerca de um minuto.',
  };
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
  private readonly cota: CotaGratuita;

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
    this.cota = opcoes.cota ?? COTA_GRATUITA_DO_PROCESSO;
  }

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    const gratuito = ehModeloGratuito(pedido.modelo);
    if (gratuito) {
      // Cota sabida esgotada: recusa aqui, sem pedido — pedido recusado também conta.
      const bloqueio = this.cota.vigente();
      if (bloqueio !== null) throw new LimiteDoProvedor(bloqueio.mensagem, bloqueio.ate, false);
      await this.cota.aguardarVez();
    }

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
    if (resposta.status === 429) {
      const limite = lerLimite(corpo, Date.now());
      if (gratuito) this.cota.bloquear(limite.ate, limite.mensagem);
      throw new LimiteDoProvedor(limite.mensagem, limite.ate, true);
    }
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
      modeloServido: lido.data.model,
    };
  }
}
