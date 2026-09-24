/**
 * Leitura e validação do ambiente.
 *
 * Único ponto do sistema que toca `process.env`. Tudo o mais recebe o objeto
 * validado, o que torna o ambiente substituível em teste sem `vi.stubEnv`
 * espalhado.
 *
 * O que este arquivo **não** guarda: credencial de plataforma. Token de Mercado
 * Livre, Shopee e Amazon mora cifrado na tabela `credencial` (ADR 0007). A única
 * chave que vive em ambiente é a chave mestra de cifragem.
 */
import { z } from 'zod';

/** Papel que o construtor tem nesta instalação. Decide onde o nome aparece. */
export const PAPEIS = ['interno', 'cliente', 'produto'] as const;
export type Papel = (typeof PAPEIS)[number];

const esquemaAmbiente = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

  /**
   * 32 bytes em base64. Validado no formato aqui, e no tamanho ao decodificar,
   * porque uma chave de tamanho errado só falharia na primeira cifragem — que
   * acontece no meio de um fluxo de OAuth, no pior momento possível.
   */
  CREDENCIAL_CHAVE_MESTRA: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'CREDENCIAL_CHAVE_MESTRA precisa ser base64')
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'CREDENCIAL_CHAVE_MESTRA precisa decodificar para exatamente 32 bytes',
    ),

  // Marca — nada disso é literal em componente. Ver ADR 0003.
  BANCADA_NOME_SISTEMA: z.string().min(1).default('Bancada'),
  BANCADA_CONSTRUTOR: z.string().min(1).default('Zirtuno'),
  BANCADA_ANO_COPYRIGHT: z.coerce.number().int().min(2000).max(2200).default(2026),
  BANCADA_PAPEL: z.enum(PAPEIS).default('interno'),
  BANCADA_PERFIL_PADRAO: z.string().min(1),

  // LLM — ver ADR 0005. A chave é do OpenRouter; modelo vazio usa o padrão de
  // `infra/llm/ambiente.ts`.
  LLM_API_KEY: z.string().optional(),
  LLM_MODELO_EXTRACAO: z.string().optional(),
  LLM_MODELO_JULGAMENTO: z.string().optional(),
  LLM_MODELO_EMBEDDING: z.string().optional(),
  /** Modelo da classificação fiscal (M12 — 9.1). Sem ele, a tela não sugere. */
  LLM_MODELO_FISCAL: z.string().optional(),

  /**
   * Tag de afiliado por plataforma.
   *
   * Opcional, e ausente é estado normal: sem tag, a tela de afiliados diz qual
   * variável falta e não gera link — link de afiliado sem tag é link comum, e
   * publicar um deles é trabalho que não paga comissão.
   *
   * Vive em ambiente, e não na tabela `credencial`, porque não é segredo: a tag
   * aparece na própria URL publicada. O que é segredo (token de API) continua
   * cifrado no banco (ADR 0007).
   */
  AFILIADO_TAG_ML: z.string().optional(),
  AFILIADO_TAG_SHOPEE: z.string().optional(),
  AFILIADO_TAG_AMAZON: z.string().optional(),
  LLM_ORCAMENTO_PADRAO_CENTAVOS: z.coerce.number().int().positive().default(500),

  /**
   * Quantos centavos de real vale um dólar, para converter o custo que o OpenRouter
   * informa (em dólar) e compará-lo com o teto de orçamento (em real).
   *
   * Cotação configurada, e não consultada: o teto precisa funcionar sem rede de
   * terceiro. O padrão fica acima da cotação corrente de propósito — o erro de uma
   * cotação velha deve ser gastar menos do que o teto, e não mais.
   */
  LLM_COTACAO_DOLAR_CENTAVOS: z.coerce.number().int().positive().default(600),

  /**
   * Onde o armazenamento de conteúdo guarda o original de cada entrada.
   *
   * Precisa ser configuração e não literal porque **duas** peças apontam para o
   * mesmo lugar: o orquestrador grava (pela tela) e o executor lê (pelo poller).
   * Dois literais divergiriam, e o sintoma seria job em revisão dizendo que o
   * arquivo não chegou ao armazenamento — quando chegou, em outra pasta.
   */
  ARMAZENAMENTO_DIR: z.string().min(1).default('.dados/conteudo'),

  // Extração — respeitar robots.txt e limite de requisição não é opcional.
  EXTRACAO_USER_AGENT: z.string().min(1).default('BancadaBot/0.1'),
  EXTRACAO_RPS_MAX: z.coerce.number().positive().max(10).default(1),
  EXTRACAO_CACHE_DIR: z.string().min(1).default('.cache/extracao'),
});

export type Ambiente = z.infer<typeof esquemaAmbiente>;

export class AmbienteInvalido extends Error {
  override readonly name = 'AmbienteInvalido';
  constructor(
    mensagem: string,
    readonly problemas: readonly string[],
  ) {
    super(mensagem);
  }
}

/**
 * Valida um mapa de variáveis. Exportado separado de `lerAmbiente` para o teste
 * poder passar um objeto em vez de mexer em `process.env`.
 */
export function validarAmbiente(bruto: Record<string, string | undefined>): Ambiente {
  const resultado = esquemaAmbiente.safeParse(bruto);

  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => {
      const campo = i.path.join('.');
      return campo === '' ? i.message : `${campo}: ${i.message}`;
    });
    throw new AmbienteInvalido(
      `Ambiente inválido:\n  ${problemas.join('\n  ')}\n\nVer .env.example para a lista completa.`,
      problemas,
    );
  }

  return resultado.data;
}

let cache: Ambiente | null = null;

/**
 * Lê e valida o ambiente do processo, uma vez.
 *
 * Falha ruidosamente na primeira chamada em vez de propagar `undefined` para
 * dentro do domínio, que é como configuração errada se transforma em bug
 * silencioso três camadas abaixo.
 */
export function lerAmbiente(): Ambiente {
  cache ??= validarAmbiente(process.env);
  return cache;
}

/** Só para teste: descarta o cache do módulo. */
export function _limparCacheAmbiente(): void {
  cache = null;
}
