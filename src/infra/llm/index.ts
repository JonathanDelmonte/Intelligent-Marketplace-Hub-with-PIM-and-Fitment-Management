/**
 * O assento onde o LLM senta, com orçamento, cache e registro de custo.
 *
 * Seis módulos usam LLM (M1, M3, M4, M6, M12, M15) e **nenhum deles fala com um
 * provedor direto**. Todos passam por aqui, e a razão é a disciplina de custo do
 * ADR 0005, que não é um detalhe de implementação — é parte da decisão:
 *
 * 1. Toda chamada registra entrada, saída, custo, modelo e latência em `llm_call`.
 *    Sem isso não se sabe onde o dinheiro foi, e o teto de R$ 100/mês deixa de ser
 *    verificável.
 * 2. Todo resultado é cacheado pela entrada que o gerou. Resolver a identidade de
 *    um produto é caro e se faz **uma vez**.
 * 3. Toda saída é validada por Zod. Schema que falha vira `pendente_revisao`,
 *    nunca descarte e nunca gravação de lixo.
 * 4. **Agente sem teto de orçamento por execução não roda**, e isso é verificado
 *    no construtor, não por convenção.
 *
 * A outra metade do desenho é que **não haver chave é estado normal**, não erro de
 * configuração: sem chave, o sistema inteiro precisa continuar rodando — o que não
 * pode é fingir que rodou. `ChamadorAusente` é a implementação honesta disso, e quem
 * chama trata `sem_chave` como caminho previsto. Com chave, o provedor é o OpenRouter
 * (`openrouter.ts`), escolhido em `ambiente.ts` e em nenhum outro lugar.
 */
import { createHash } from 'node:crypto';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { llmCall } from '@/infra/banco/schema';

/**
 * Para que a chamada serve.
 *
 * É a primeira coluna do índice de cache e a chave do relatório de custo por
 * finalidade — que é como se responde "por que a conta subiu" com um `SELECT`.
 */
export const PROPOSITOS = [
  'extracao',
  'julgamento_identidade',
  'embedding',
  'compatibilidade',
  'fiscal',
  'prospeccao',
  'leitura_serie',
  // O assistente (ADR 0009) só traduz a pergunta livre em consulta fechada, e só quando a
  // regra não entendeu. A conta é sempre do código.
  'assistente',
] as const;
export type Proposito = (typeof PROPOSITOS)[number];

/**
 * Uma imagem mandada junto da pergunta — o print da tabela do fornecedor (3.6).
 *
 * Em base64, porque é assim que o provedor a recebe (`data:` URL). O serviço não a grava
 * em `llm_call`: grava o tipo, o tamanho e o hash, que é o que entra no cache.
 */
export interface ImagemDoPedido {
  /** Tipo MIME: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. */
  readonly tipo: string;
  readonly base64: string;
}

export interface PedidoAoModelo {
  readonly proposito: Proposito;
  readonly modelo: string;
  /** O que o modelo deve fazer, em texto. Vem do módulo de domínio, junto do schema. */
  readonly instrucoes: string;
  /**
   * O formato da resposta, em JSON Schema, derivado do schema Zod que a valida.
   *
   * Vai ao provedor como parte das instruções, e não como parâmetro de "saída
   * estruturada": esse parâmetro tem suporte diferente em cada modelo e recusa parte
   * das restrições que os schemas daqui usam. A validação de verdade continua sendo o
   * Zod, na volta.
   */
  readonly formato: unknown;
  /** A pergunta: o que determina a resposta e define o cache. */
  readonly entrada: unknown;
  /** Contexto enviado junto, fora do hash. Exemplo few-shot mora aqui. */
  readonly contexto?: unknown;
  /** Imagens que o modelo precisa ver. Só modelo com visão as lê. */
  readonly imagens?: readonly ImagemDoPedido[] | undefined;
}

export interface RespostaDoModelo {
  readonly saida: unknown;
  readonly tokensEntrada?: number | undefined;
  readonly tokensSaida?: number | undefined;
  /** Centavos inteiros. `undefined` quando o provedor não informa. */
  readonly custoCentavos?: number | undefined;
  /**
   * O modelo que de fato respondeu, quando o provedor diz.
   *
   * Difere do pedido quando o pedido é a um roteador: `openrouter/free` escolhe um modelo
   * gratuito a cada chamada, e a auditoria precisa saber qual foi.
   */
  readonly modeloServido?: string | undefined;
}

/** Textos para virar vetor, num pedido só. */
export interface PedidoDeEmbedding {
  readonly modelo: string;
  readonly textos: readonly string[];
}

export interface RespostaDeEmbedding {
  /** Um vetor por texto, na ordem dos textos. */
  readonly vetores: readonly (readonly number[])[];
  readonly tokensEntrada?: number | undefined;
  readonly custoCentavos?: number | undefined;
  readonly modeloServido?: string | undefined;
}

/**
 * A porta para um provedor.
 *
 * Deliberadamente pequena: um método, e um segundo opcional. Trocar de provedor, ou pôr
 * um dublê em teste, é implementar isto — e é assim que a suíte exercita cache,
 * orçamento e validação sem gastar um centavo nem depender de rede.
 */
export interface Chamador {
  readonly nome: string;
  chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
  /** Embedding em lote. Opcional: provedor que não tem, não declara, e o serviço diz. */
  embeddings?(pedido: PedidoDeEmbedding): Promise<RespostaDeEmbedding>;
}

export class SemChaveDeLlm extends Error {
  override readonly name = 'SemChaveDeLlm';
  constructor() {
    super(
      'não há chave de LLM configurada (LLM_API_KEY). O caminho determinístico continua funcionando; ' +
        'o que depende de julgamento fica pendente até haver chave.',
    );
  }
}

/** O chamador que existe quando não há chave. Falha explicitamente, não em silêncio. */
export class ChamadorAusente implements Chamador {
  readonly nome = 'ausente';
  chamar(): Promise<RespostaDoModelo> {
    return Promise.reject(new SemChaveDeLlm());
  }
  embeddings(): Promise<RespostaDeEmbedding> {
    return Promise.reject(new SemChaveDeLlm());
  }
}

export class OrcamentoInvalido extends Error {
  override readonly name = 'OrcamentoInvalido';
}

/**
 * Continuar é sempre errado: a execução para aqui, e o que falta é retomável.
 *
 * Duas causas, e quem trata uma trata as duas pela base: o teto de gasto desta execução
 * (`OrcamentoEstourado`) e a cota do provedor (`LimiteDoProvedor`). Um laço que tratasse
 * qualquer uma delas como "esse item falhou" seguiria para o próximo e bateria no mesmo
 * teto, uma vez por item — e, na cota do provedor, cada batida ainda conta como pedido.
 */
export class ExecucaoInterrompida extends Error {
  override readonly name: string = 'ExecucaoInterrompida';
}

export class OrcamentoEstourado extends ExecucaoInterrompida {
  override readonly name = 'OrcamentoEstourado';
  constructor(
    readonly limite: { readonly centavos: number; readonly chamadas: number },
    readonly gasto: { readonly centavos: number; readonly chamadas: number },
  ) {
    super(
      `orçamento estourado: ${String(gasto.chamadas)}/${String(limite.chamadas)} chamadas, ` +
        `${String(gasto.centavos)}/${String(limite.centavos)} centavos`,
    );
  }
}

/**
 * A cota do provedor acabou: pedidos por minuto, ou por dia no plano gratuito.
 *
 * `ate` é quando vale tentar de novo — o provedor diz, e quem adia um job usa esta data
 * em vez de um intervalo fixo. `houveChamada` separa a recusa que veio do provedor (conta
 * como pedido, e vai para `llm_call`) da que foi decidida aqui, sem sair da máquina,
 * porque a cota já era sabida esgotada.
 */
export class LimiteDoProvedor extends ExecucaoInterrompida {
  override readonly name = 'LimiteDoProvedor';
  constructor(
    mensagem: string,
    readonly ate: Date,
    readonly houveChamada: boolean,
  ) {
    super(mensagem);
  }
}

/**
 * O modelo respondeu, e a resposta não serve: veio cortada no teto de tokens, ou não é
 * JSON.
 *
 * É diferente de falha do provedor — chave recusada, conta sem crédito, rede fora —, e a
 * diferença decide o que fazer: pedir de novo o mesmo não adianta, mas pedir **menos**
 * costuma adiantar. Quem trabalha em lote usa isso para partir o lote; quem não trabalha,
 * trata como qualquer erro.
 */
export class RespostaInutilizavel extends Error {
  override readonly name: string = 'RespostaInutilizavel';
}

/**
 * Teto de gasto de uma execução.
 *
 * **Dois tetos, e os dois são obrigatórios.** Centavos é o teto que interessa ao
 * bolso, e chamadas é o que continua valendo quando o provedor não informa custo —
 * sem ele, um provedor calado transformaria o teto em nada e um laço com defeito
 * rodaria até a conta chegar.
 */
export class Orcamento {
  private centavosGastos = 0;
  private chamadasFeitas = 0;

  constructor(
    readonly limiteCentavos: number,
    readonly limiteChamadas: number,
  ) {
    if (!Number.isInteger(limiteCentavos) || limiteCentavos <= 0) {
      throw new OrcamentoInvalido(
        `teto em centavos precisa ser inteiro positivo, recebeu ${String(limiteCentavos)}`,
      );
    }
    if (!Number.isInteger(limiteChamadas) || limiteChamadas <= 0) {
      throw new OrcamentoInvalido(
        `teto de chamadas precisa ser inteiro positivo, recebeu ${String(limiteChamadas)}`,
      );
    }
  }

  get gasto(): { readonly centavos: number; readonly chamadas: number } {
    return { centavos: this.centavosGastos, chamadas: this.chamadasFeitas };
  }

  get esgotado(): boolean {
    return this.chamadasFeitas >= this.limiteChamadas || this.centavosGastos >= this.limiteCentavos;
  }

  /** Lança antes de gastar, que é o único momento em que o teto serve para algo. */
  exigirFolga(): void {
    if (this.esgotado) {
      throw new OrcamentoEstourado(
        { centavos: this.limiteCentavos, chamadas: this.limiteChamadas },
        this.gasto,
      );
    }
  }

  /** Registra o consumo. Chamada sem custo informado ainda consome uma chamada. */
  registrar(custoCentavos: number | undefined): void {
    this.chamadasFeitas += 1;
    this.centavosGastos += custoCentavos ?? 0;
  }
}

/**
 * Serialização estável de qualquer entrada, para o hash de cache.
 *
 * Chave de objeto é ordenada, porque a ordem de escrita de um literal não deveria
 * mudar o hash — e mudaria, silenciosamente, transformando o cache em decoração.
 * `undefined` some (não existe em JSON), `Date` vira ISO, e `NaN`/`Infinity` viram
 * `null` como o `JSON.stringify` faria.
 */
export function serializarEstavel(valor: unknown): string {
  if (valor === null) return 'null';
  if (valor === undefined) return 'null';
  if (typeof valor === 'number') return Number.isFinite(valor) ? JSON.stringify(valor) : 'null';
  if (typeof valor === 'boolean' || typeof valor === 'string') return JSON.stringify(valor);
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (Array.isArray(valor)) return `[${valor.map(serializarEstavel).join(',')}]`;
  if (typeof valor === 'object') {
    const registro = valor as Record<string, unknown>;
    const chaves = Object.keys(registro)
      .filter((k) => registro[k] !== undefined)
      .sort();
    const partes = chaves.map((k) => `${JSON.stringify(k)}:${serializarEstavel(registro[k])}`);
    return `{${partes.join(',')}}`;
  }
  // Função ou símbolo em entrada de LLM é erro de quem chamou, não dado.
  return 'null';
}

export function hashDeEntrada(entrada: unknown): string {
  return createHash('sha256').update(serializarEstavel(entrada), 'utf8').digest('hex');
}

/**
 * O JSON Schema que diz ao modelo o formato da resposta.
 *
 * Do lado da **entrada** do schema (`io: 'input'`), porque é o que o modelo escreve e
 * o Zod lê: campo com valor padrão é opcional para quem escreve. O que o JSON Schema
 * não representa vira "qualquer coisa" em vez de derrubar a chamada — a validação que
 * decide continua sendo o Zod.
 */
export function formatoDaResposta(esquema: z.ZodType): unknown {
  return z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' });
}

export type ResultadoDoPedido<T> =
  | { readonly tipo: 'ok'; readonly valor: T; readonly deCache: boolean }
  | {
      readonly tipo: 'pendente_revisao';
      readonly problemas: readonly string[];
      readonly saidaBruta: unknown;
      readonly deCache: boolean;
    }
  | { readonly tipo: 'sem_chave' }
  | {
      readonly tipo: 'erro';
      readonly mensagem: string;
      /** `resposta`: o modelo respondeu algo inutilizável. `provedor`: nem isso. */
      readonly natureza: 'provedor' | 'resposta';
    };

export type ResultadoDeEmbedding =
  | { readonly tipo: 'ok'; readonly vetores: readonly (readonly number[])[] }
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'nao_suportado' }
  | { readonly tipo: 'erro'; readonly mensagem: string };

export interface ParametrosDoPedido<T> {
  readonly proposito: Proposito;
  readonly modelo: string;
  /**
   * O que o modelo deve fazer, em texto — mora no módulo de domínio, ao lado do schema.
   *
   * **Fora do hash**, como o contexto, e pelo mesmo motivo: é a forma de perguntar, e
   * não a pergunta. Melhorar o texto das instruções não pode custar perguntar de novo
   * tudo o que já foi perguntado — resolver identidade é caro e se faz uma vez. Vai
   * gravado em `llm_call.entrada`, para a chamada continuar reproduzível.
   */
  readonly instrucoes: string;
  /** A pergunta. **É isto que vai para o hash de cache.** */
  readonly entrada: unknown;
  /**
   * O que mais foi enviado ao modelo e **não** entra no hash.
   *
   * Existe por uma tensão real entre duas regras do ADR 0005. "Todo resultado é
   * cacheado pela entrada que o gerou" e "toda decisão humana vira exemplo para os
   * prompts seguintes" se contradizem quando os exemplos entram no hash: cada
   * decisão nova invalidaria o cache de **todos** os pares, e o sistema passaria a
   * re-resolver a base inteira justamente por estar aprendendo.
   *
   * A resolução é separar pergunta de contexto. O par de produtos é a pergunta e
   * define o cache; os exemplos são contexto, ficam gravados junto para a chamada
   * ser reproduzível, e não invalidam nada.
   */
  readonly contexto?: unknown;
  /**
   * Imagens da pergunta. **Entram no hash** — pelo hash de cada uma, e não pelo conteúdo,
   * que é grande demais para o registro de custo.
   */
  readonly imagens?: readonly ImagemDoPedido[] | undefined;
  readonly esquema: z.ZodType<T>;
  readonly jobId?: string | undefined;
}

/**
 * O serviço que todo módulo de IA usa.
 *
 * **Só lança `ExecucaoInterrompida`** — orçamento estourado ou cota do provedor. Todo o
 * resto — falha de rede, schema
 * inválido, ausência de chave — volta como valor no tipo de retorno, porque são
 * situações previstas que o chamador trata de formas diferentes. Orçamento e cota são a
 * exceção porque são as únicas em que continuar é sempre errado: um laço que trata
 * "estourei o teto" como "esse par falhou" segue para o par seguinte e estoura de
 * novo, uma vez por par.
 */
export class ServicoDeLlm {
  constructor(
    private readonly db: Banco,
    private readonly chamador: Chamador,
    private readonly orcamento: Orcamento,
  ) {}

  get gasto(): { readonly centavos: number; readonly chamadas: number } {
    return this.orcamento.gasto;
  }

  async pedir<T>(params: ParametrosDoPedido<T>): Promise<ResultadoDoPedido<T>> {
    // Imagem entra no hash pelo próprio hash: a mesma foto da tabela não é perguntada duas
    // vezes, e o registro de custo não guarda megabytes de base64. Sem imagem, o hash é o
    // de sempre — o cache que já existe continua valendo.
    const imagens = params.imagens?.map((i) => ({
      tipo: i.tipo,
      bytes: Math.floor((i.base64.length * 3) / 4),
      sha256: createHash('sha256').update(i.base64, 'utf8').digest('hex'),
    }));
    const hashEntrada =
      imagens === undefined || imagens.length === 0
        ? hashDeEntrada(params.entrada)
        : hashDeEntrada({ pergunta: params.entrada, imagens });

    const cacheado = await this.lerCache(params.proposito, params.modelo, hashEntrada);
    if (cacheado !== null) {
      return this.validar(cacheado, params.esquema, true);
    }

    // O teto é verificado **depois** do cache e **antes** da chamada: resposta que
    // já foi paga não deve ser recusada por falta de orçamento.
    this.orcamento.exigirFolga();

    // Forma uniforme do que vai para `llm_call.entrada`: `pergunta` é o que foi
    // hasheado, `contexto` e `instrucoes` são o resto do que o modelo viu. Quem audita a
    // conta consegue reproduzir a chamada.
    const entradaGravada = {
      pergunta: params.entrada,
      contexto: params.contexto ?? null,
      instrucoes: params.instrucoes,
      ...(imagens === undefined || imagens.length === 0 ? {} : { imagens }),
    };

    const comecou = Date.now();
    let resposta: RespostaDoModelo;
    try {
      resposta = await this.chamador.chamar({
        proposito: params.proposito,
        modelo: params.modelo,
        instrucoes: params.instrucoes,
        formato: formatoDaResposta(params.esquema),
        entrada: params.entrada,
        ...(params.contexto === undefined ? {} : { contexto: params.contexto }),
        ...(params.imagens === undefined || params.imagens.length === 0
          ? {}
          : { imagens: params.imagens }),
      });
    } catch (erro) {
      const semChave = erro instanceof SemChaveDeLlm;
      // Ausência de chave não é falha da chamada e não consome orçamento: nada foi
      // enviado. Também não vai para `llm_call`, senão o registro de custo ficaria
      // cheio de linhas de uma chamada que não aconteceu.
      if (semChave) return { tipo: 'sem_chave' };

      // Cota do provedor: interrompe, como o orçamento. Se a recusa veio de lá, foi
      // um pedido, e fica registrado; se foi decidida aqui, nada saiu da máquina.
      if (erro instanceof LimiteDoProvedor) {
        if (erro.houveChamada) {
          this.orcamento.registrar(undefined);
          await this.registrarChamada({
            proposito: params.proposito,
            modelo: params.modelo,
            hashEntrada,
            entrada: entradaGravada,
            saida: null,
            erro: erro.message,
            latenciaMs: Date.now() - comecou,
            jobId: params.jobId,
          });
        }
        throw erro;
      }

      const mensagem = erro instanceof Error ? erro.message : String(erro);
      this.orcamento.registrar(undefined);
      await this.registrarChamada({
        proposito: params.proposito,
        modelo: params.modelo,
        hashEntrada,
        entrada: entradaGravada,
        saida: null,
        erro: mensagem,
        latenciaMs: Date.now() - comecou,
        jobId: params.jobId,
      });
      return {
        tipo: 'erro',
        mensagem,
        natureza: erro instanceof RespostaInutilizavel ? 'resposta' : 'provedor',
      };
    }

    this.orcamento.registrar(resposta.custoCentavos);

    await this.registrarChamada({
      proposito: params.proposito,
      modelo: params.modelo,
      hashEntrada,
      entrada: entradaGravada,
      saida: resposta.saida,
      erro: null,
      latenciaMs: Date.now() - comecou,
      jobId: params.jobId,
      tokensEntrada: resposta.tokensEntrada,
      tokensSaida: resposta.tokensSaida,
      custoCentavos: resposta.custoCentavos,
      modeloServido: resposta.modeloServido,
    });

    return this.validar(resposta.saida, params.esquema, false);
  }

  /**
   * Vetores para uma lista de textos, num pedido só.
   *
   * Mesma disciplina do `pedir`: teto verificado antes, cota do provedor interrompe, e
   * toda chamada fica em `llm_call` — com um resumo na saída, e não os vetores: mil e
   * poucos números por texto encheriam a tabela de custo com o que já mora na tabela de
   * embedding. O cache aqui não é o `llm_call`: é a própria tabela de embedding, que o
   * chamador consulta por texto antes de pedir.
   */
  async gerarEmbeddings(params: {
    readonly modelo: string;
    readonly textos: readonly string[];
    readonly jobId?: string | undefined;
  }): Promise<ResultadoDeEmbedding> {
    if (this.chamador.embeddings === undefined) return { tipo: 'nao_suportado' };
    if (params.textos.length === 0) return { tipo: 'ok', vetores: [] };

    this.orcamento.exigirFolga();

    const hashEntrada = hashDeEntrada({ textos: params.textos });
    const entradaGravada = { pergunta: { textos: params.textos }, contexto: null, instrucoes: '' };
    const comecou = Date.now();

    let resposta: RespostaDeEmbedding;
    try {
      resposta = await this.chamador.embeddings({ modelo: params.modelo, textos: params.textos });
    } catch (erro) {
      if (erro instanceof SemChaveDeLlm) return { tipo: 'sem_chave' };
      const houveChamada = !(erro instanceof LimiteDoProvedor) || erro.houveChamada;
      if (houveChamada) {
        this.orcamento.registrar(undefined);
        await this.registrarChamada({
          proposito: 'embedding',
          modelo: params.modelo,
          hashEntrada,
          entrada: entradaGravada,
          saida: null,
          erro: erro instanceof Error ? erro.message : String(erro),
          latenciaMs: Date.now() - comecou,
          jobId: params.jobId,
        });
      }
      if (erro instanceof LimiteDoProvedor) throw erro;
      return { tipo: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) };
    }

    this.orcamento.registrar(resposta.custoCentavos);
    const quantosBatem = resposta.vetores.length === params.textos.length;
    const mensagem = quantosBatem
      ? null
      : `o provedor devolveu ${String(resposta.vetores.length)} vetores para ${String(params.textos.length)} textos.`;

    await this.registrarChamada({
      proposito: 'embedding',
      modelo: params.modelo,
      hashEntrada,
      entrada: entradaGravada,
      saida: quantosBatem
        ? { vetores: resposta.vetores.length, dimensoes: resposta.vetores[0]?.length ?? 0 }
        : null,
      erro: mensagem,
      latenciaMs: Date.now() - comecou,
      jobId: params.jobId,
      tokensEntrada: resposta.tokensEntrada,
      custoCentavos: resposta.custoCentavos,
      modeloServido: resposta.modeloServido,
    });

    return mensagem === null
      ? { tipo: 'ok', vetores: resposta.vetores }
      : { tipo: 'erro', mensagem };
  }

  private validar<T>(
    saidaBruta: unknown,
    esquema: z.ZodType<T>,
    deCache: boolean,
  ): ResultadoDoPedido<T> {
    const analise = esquema.safeParse(saidaBruta);
    if (!analise.success) {
      return {
        tipo: 'pendente_revisao',
        problemas: analise.error.issues.map((i) => {
          const campo = i.path.join('.');
          return campo === '' ? i.message : `${campo}: ${i.message}`;
        }),
        saidaBruta,
        deCache,
      };
    }
    return { tipo: 'ok', valor: analise.data, deCache };
  }

  /**
   * Lê o cache.
   *
   * A cláusula que importa é `saida is not null and erro is null`. Sem ela, uma
   * chamada que falhou uma vez ficaria em cache como falha **para sempre** — a
   * chave única é `(proposito, modelo, hash_entrada)`, então a linha de erro ocupa
   * exatamente o lugar da resposta boa. Foi o que o teste pegou.
   */
  private async lerCache(
    proposito: Proposito,
    modelo: string,
    hashEntrada: string,
  ): Promise<unknown> {
    const linhas = await this.db
      .select({ saida: llmCall.saida })
      .from(llmCall)
      .where(
        and(
          eq(llmCall.proposito, proposito),
          eq(llmCall.modelo, modelo),
          eq(llmCall.hashEntrada, hashEntrada),
          isNotNull(llmCall.saida),
          isNull(llmCall.erro),
        ),
      )
      .limit(1);

    const linha = linhas[0];
    return linha === undefined ? null : linha.saida;
  }

  /**
   * Grava a chamada.
   *
   * `onConflictDoUpdate` e não `insert` simples: a chave única é a chave de cache,
   * então a segunda tentativa de uma chamada que falhou colide com o próprio
   * registro de falha. Atualizar é o comportamento certo — a linha passa a ser a
   * resposta boa, e o erro anterior deixa de bloquear.
   */
  private async registrarChamada(dados: {
    proposito: Proposito;
    modelo: string;
    hashEntrada: string;
    entrada: unknown;
    saida: unknown;
    erro: string | null;
    latenciaMs: number;
    jobId?: string | undefined;
    tokensEntrada?: number | undefined;
    tokensSaida?: number | undefined;
    custoCentavos?: number | undefined;
    modeloServido?: string | undefined;
  }): Promise<void> {
    const valores = {
      proposito: dados.proposito,
      modelo: dados.modelo,
      hashEntrada: dados.hashEntrada,
      entrada: dados.entrada,
      saida: dados.saida,
      erro: dados.erro,
      latenciaMs: dados.latenciaMs,
      jobId: dados.jobId ?? null,
      tokensEntrada: dados.tokensEntrada ?? null,
      tokensSaida: dados.tokensSaida ?? null,
      custoCentavos: dados.custoCentavos ?? null,
      modeloServido: dados.modeloServido ?? null,
    };

    await this.db
      .insert(llmCall)
      .values(valores)
      .onConflictDoUpdate({
        target: [llmCall.proposito, llmCall.modelo, llmCall.hashEntrada],
        set: {
          saida: valores.saida,
          erro: valores.erro,
          latenciaMs: valores.latenciaMs,
          tokensEntrada: valores.tokensEntrada,
          tokensSaida: valores.tokensSaida,
          custoCentavos: valores.custoCentavos,
          modeloServido: valores.modeloServido,
          criadoEm: new Date(),
        },
      });
  }
}

/** Gasto por finalidade em um período. É o relatório que o ADR 0005 promete. */
export async function gastoPorProposito(
  db: Banco,
  desde: Date,
): Promise<
  readonly { readonly proposito: string; readonly chamadas: number; readonly centavos: number }[]
> {
  const linhas = await db
    .select({
      proposito: llmCall.proposito,
      chamadas: sql<number>`count(*)::int`,
      centavos: sql<number>`coalesce(sum(${llmCall.custoCentavos}), 0)::int`,
    })
    .from(llmCall)
    // `gte` da coluna e não `sql` cru: o template cru manda a `Date` ao driver sem
    // o tipo da coluna, e o `postgres` recusa com "must be of type string".
    .where(gte(llmCall.criadoEm, desde))
    .groupBy(llmCall.proposito)
    .orderBy(llmCall.proposito);

  return linhas;
}
