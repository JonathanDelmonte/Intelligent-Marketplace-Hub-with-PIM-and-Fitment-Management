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

const esquemaAmbiente = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

    /**
     * 32 bytes em base64. Validado no formato aqui, e no tamanho ao decodificar,
     * porque uma chave de tamanho errado só falharia na primeira cifragem — que
     * acontece no meio de um fluxo de OAuth, no pior momento possível.
     */
    CREDENCIAL_CHAVE_MESTRA: z
      .string()
      // Base64 comum ou a variante de URL (`-` e `_`): o gerador de segredo do Render e o
      // `openssl rand -base64` podem dar uma ou outra, e o Node decodifica as duas.
      .regex(/^[A-Za-z0-9+/_-]+={0,2}$/, 'CREDENCIAL_CHAVE_MESTRA precisa ser base64')
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
    /**
     * O código que a tela de cadastro pede (ADR 0011).
     *
     * Sem permissões, toda conta vê os mesmos dados; então criar conta num endereço
     * público não pode ser aberto a quem achar a tela. Quem tem o código cria conta, e
     * recupera a senha. Vazio fecha o cadastro — que é o estado certo de um servidor que
     * ainda não recebeu o código.
     */
    CADASTRO_CODIGO: z
      .string()
      .trim()
      .min(8, 'CADASTRO_CODIGO precisa de 8 caracteres ou mais')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /**
     * A versão no ar: o commit publicado e a hora dele (ADR 0010). Vêm gravados na imagem
     * pela publicação; no computador ficam vazios, e o rodapé não mostra versão.
     */
    VERSAO: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{7,40}$/, 'VERSAO é o hash de um commit')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    VERSAO_EM: z.iso
      .datetime({ offset: true })
      .optional()
      .or(z.literal('').transform(() => undefined)),

    // LLM — ver ADR 0005. A chave é do OpenRouter; modelo vazio usa o padrão de
    // `infra/llm/ambiente.ts`.
    LLM_API_KEY: z.string().optional(),
    LLM_MODELO_EXTRACAO: z.string().optional(),
    LLM_MODELO_JULGAMENTO: z.string().optional(),
    LLM_MODELO_EMBEDDING: z.string().optional(),
    /** Modelo da classificação fiscal (M12 — 9.1). Sem ele, a tela não sugere. */
    LLM_MODELO_FISCAL: z.string().optional(),
    /** Modelo que lê imagem de tabela (M1 — 3.6). Precisa ter visão. */
    LLM_MODELO_VISAO: z.string().optional(),

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

    /**
     * O armazenamento de conteúdo fora do disco, num serviço compatível com S3 — o
     * Supabase Storage, no Render gratuito (ADR 0013), onde o disco some a cada
     * publicação. Com o endereço, os arquivos vão para lá e `ARMAZENAMENTO_DIR` deixa de
     * valer; sem ele, tudo fica em disco, como no computador de quem desenvolve.
     */
    ARMAZENAMENTO_S3_ENDPOINT: z
      .url('ARMAZENAMENTO_S3_ENDPOINT precisa ser um endereço https://…')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    ARMAZENAMENTO_S3_REGIAO: z.string().min(1).default('us-east-1'),
    ARMAZENAMENTO_S3_CHAVE: z.string().optional(),
    ARMAZENAMENTO_S3_SEGREDO: z.string().optional(),
    ARMAZENAMENTO_S3_BALDE: z.string().min(1).default('conteudo'),

    /**
     * Conexões com o banco por processo. O padrão serve a um Postgres próprio; o
     * Supabase gratuito divide umas quinze entre todos os processos, e site e fila
     * juntos no Render passariam disso com dez cada.
     */
    BANCO_CONEXOES: z.coerce.number().int().min(1).max(50).default(10),

    // Extração — respeitar robots.txt e limite de requisição não é opcional.
    EXTRACAO_USER_AGENT: z.string().min(1).default('BancadaBot/0.1'),
    EXTRACAO_RPS_MAX: z.coerce.number().positive().max(10).default(1),
    EXTRACAO_CACHE_DIR: z.string().min(1).default('.cache/extracao'),
  })
  .superRefine((ambiente, contexto) => {
    // Endereço sem chave falharia só no primeiro envio de arquivo, no meio de uma
    // importação. Falhar na subida diz o que falta antes de alguém usar.
    if (ambiente.ARMAZENAMENTO_S3_ENDPOINT === undefined) return;
    for (const campo of ['ARMAZENAMENTO_S3_CHAVE', 'ARMAZENAMENTO_S3_SEGREDO'] as const) {
      if (!ambiente[campo]) {
        contexto.addIssue({
          code: 'custom',
          path: [campo],
          message: `${campo} é obrigatório quando ARMAZENAMENTO_S3_ENDPOINT está definido`,
        });
      }
    }
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
