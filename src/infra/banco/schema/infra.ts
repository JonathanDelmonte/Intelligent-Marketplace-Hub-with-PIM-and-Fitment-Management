/**
 * Infraestrutura: fila de jobs, registro de chamadas de LLM e embeddings.
 *
 * Nenhuma destas três tabelas está na seção 3 da especificação, e todas as três
 * são consequência direta de decisões que estão:
 *
 * - `job` é a fila em tabela do ADR 0006, e a tela dos últimos 100 jobs sai dela.
 *   Sistema de ingestão sem isso é inauditável em uma semana.
 * - `llm_call` é a disciplina de custo do ADR 0005. Sem ela não se sabe onde o
 *   dinheiro foi, e o teto de R$ 100/mês deixa de ser verificável.
 * - `embedding` é o `pgvector` que decide Postgres em vez de SQLite, e é o que
 *   torna M3 possível.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditoria, centavos, id, statusJobEnum } from './comum';
import { produtoExterno } from './catalogo';

/** Dimensão do vetor de embedding. Fixa por índice: mudar exige nova migração. */
export const DIMENSAO_EMBEDDING = 1536;

/**
 * Tipo `vector` do pgvector.
 *
 * O Drizzle tem suporte nativo, mas declarar explicitamente deixa a dimensão
 * visível no schema — e a dimensão é o que amarra o índice HNSW.
 */
const vetor = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${String(DIMENSAO_EMBEDDING)})`;
  },
  toDriver(valor: number[]): string {
    return `[${valor.join(',')}]`;
  },
  fromDriver(valor: string): number[] {
    return JSON.parse(valor) as number[];
  },
});

/**
 * Fila de trabalho.
 *
 * Todo job é **idempotente e retomável**: extração que falha não perde o que já
 * extraiu, e reexecutar é seguro. `chave_idempotencia` é o que garante isso — dois
 * enfileiramentos da mesma unidade de trabalho colapsam em um.
 *
 * `pendente_revisao` é um status de primeira classe, não um erro: quando o schema
 * de saída falha, o registro **entra para revisão** em vez de ser descartado.
 */
export const job = pgTable(
  'job',
  {
    id: id(),
    tipo: text('tipo').notNull(),
    /** Payload do job. Validado por Zod antes de rodar. */
    entrada: jsonb('entrada').notNull(),
    status: statusJobEnum('status').notNull().default('pendente'),
    /**
     * Chave que identifica a unidade de trabalho.
     *
     * Em extração é o hash da URL; em resolução de identidade é o
     * `hash_conteudo`. Dois enfileiramentos da mesma chave não viram dois jobs.
     */
    chaveIdempotencia: text('chave_idempotencia').notNull(),
    /** Progresso parcial, para retomar de onde parou em vez de recomeçar. */
    progresso: jsonb('progresso'),
    resultado: jsonb('resultado'),
    erro: text('erro'),
    tentativas: smallint('tentativas').notNull().default(0),
    maxTentativas: smallint('max_tentativas').notNull().default(3),
    /** Quando rodar. Permite backoff sem travar o poller. */
    agendadoPara: timestamp('agendado_para', { withTimezone: true }).notNull().defaultNow(),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    terminadoEm: timestamp('terminado_em', { withTimezone: true }),
    ...auditoria,
  },
  (t) => [
    unique('unq_job_idempotencia').on(t.tipo, t.chaveIdempotencia),
    // O índice que o poller usa: o que está pronto para rodar, em ordem.
    index('idx_job_proximo').on(t.status, t.agendadoPara),
    // A tela dos últimos 100 jobs com erro visível.
    index('idx_job_recentes').on(t.criadoEm),
  ],
);

/**
 * Registro de toda chamada de LLM, com custo.
 *
 * A regra do ADR 0005: todo resultado é persistido **com a entrada que o gerou**,
 * e cacheado por `hash_entrada`. É o que permite responder "por que a conta subiu"
 * com um `SELECT` em vez de com um palpite — e se o teto de R$ 100/mês estourar,
 * esta tabela diz se a operação está pagando ou se algo está rodando sem cache.
 */
export const llmCall = pgTable(
  'llm_call',
  {
    id: id(),
    /** `extracao` | `julgamento_identidade` | `compatibilidade` | `fiscal` | … */
    proposito: text('proposito').notNull(),
    modelo: text('modelo').notNull(),
    /** Hash da entrada. Chave de cache: a mesma entrada não paga duas vezes. */
    hashEntrada: text('hash_entrada').notNull(),
    entrada: jsonb('entrada').notNull(),
    saida: jsonb('saida'),
    /** Custo em centavos. Inteiro, como todo dinheiro do sistema. */
    custoCentavos: centavos('custo_centavos'),
    tokensEntrada: integer('tokens_entrada'),
    tokensSaida: integer('tokens_saida'),
    latenciaMs: integer('latencia_ms'),
    /**
     * O modelo que de fato respondeu, quando o provedor informa. Difere de `modelo`
     * quando o pedido vai a um roteador — `openrouter/free` escolhe a cada chamada.
     */
    modeloServido: text('modelo_servido'),
    /** Job que originou a chamada, quando houver. */
    jobId: uuid('job_id').references(() => job.id, { onDelete: 'set null' }),
    /** Dossiê que originou a chamada, para o orçamento do agente ser rastreável. */
    dossieId: uuid('dossie_id'),
    erro: text('erro'),
    criadoEm: auditoria.criadoEm,
  },
  (t) => [
    // A consulta de cache, que é a mais frequente da tabela.
    unique('unq_llm_call_cache').on(t.proposito, t.modelo, t.hashEntrada),
    index('idx_llm_call_custo').on(t.criadoEm, t.proposito),
    index('idx_llm_call_job').on(t.jobId),
  ],
);

/**
 * Embedding da forma canônica de um `produto_externo`, para M3.
 *
 * O vetor é gerado da **forma canônica** (`tipo + marca + modelo normalizado`), não
 * do título bruto — que vem poluído com palavra-chave de SEO e faria a
 * similaridade medir ruído.
 *
 * Fica em tabela separada por dois motivos: o índice HNSW é grande e não deve
 * pesar em toda leitura de `produto_externo`, e trocar de modelo de embedding
 * significa reindexar esta tabela sem tocar na base de produtos.
 */
export const embedding = pgTable(
  'embedding',
  {
    id: id(),
    produtoExternoId: uuid('produto_externo_id')
      .notNull()
      .references(() => produtoExterno.id, { onDelete: 'cascade' }),
    /** Texto exato que gerou o vetor, para poder reproduzir. */
    textoCanonico: text('texto_canonico').notNull(),
    modelo: text('modelo').notNull(),
    vetor: vetor('vetor').notNull(),
    criadoEm: auditoria.criadoEm,
  },
  (t) => [
    // Um embedding por produto e modelo: trocar de modelo acrescenta linha em vez
    // de sobrescrever, então a comparação entre modelos fica possível.
    unique('unq_embedding_produto_modelo').on(t.produtoExternoId, t.modelo),
    index('idx_embedding_hnsw').using('hnsw', sql`${t.vetor} vector_cosine_ops`),
  ],
);

/**
 * Par de produtos avaliado pela resolução de identidade (M3).
 *
 * Guarda **toda** decisão de identidade, veio de onde tiver vindo: do casamento
 * determinístico, do julgamento por LLM ou de uma pessoa. Existe por três razões, e
 * nenhuma delas é conveniência:
 *
 * - **A fila de revisão precisa de um lugar.** A zona cinzenta da especificação —
 *   nem agrupa automático, nem descarta — é uma lista de pares esperando dois
 *   cliques, e lista que não é persistida é recalculada a cada tela.
 * - **Reexecutar precisa ser idempotente.** A chave única do par é o que faz
 *   resolver o mesmo produto duas vezes não gerar dois registros de decisão.
 * - **A decisão automática precisa ser auditável.** Quando um SKU juntar duas
 *   ocorrências que não deveriam estar juntas, a pergunta vai ser "quem decidiu, com
 *   que evidência e com qual confiança" — e a resposta precisa estar gravada.
 *
 * Fica ao lado de `exemplo_identidade` porque são as duas faces do mesmo assunto: o
 * par é o que o sistema decidiu, o exemplo é o que a pessoa ensinou.
 *
 * **Sem `perfil_id`:** é conhecimento do mundo, como `produto_externo`. O grafo de
 * identidade que um perfil constrói serve ao seguinte no dia zero.
 */
export const parIdentidade = pgTable(
  'par_identidade',
  {
    id: id(),
    produtoAId: uuid('produto_a_id')
      .notNull()
      .references(() => produtoExterno.id, { onDelete: 'cascade' }),
    produtoBId: uuid('produto_b_id')
      .notNull()
      .references(() => produtoExterno.id, { onDelete: 'cascade' }),
    /** `mesmo` | `diferente` | `indeciso`. */
    decisao: text('decisao').notNull(),
    /** `deterministico` | `llm` | `humano`. Quem decidiu, que é metade da auditoria. */
    origem: text('origem').notNull(),
    /** Nível de evidência: `gtin` | `marca_modelo` | `marca` | `embedding` | `nenhum`. */
    nivel: text('nivel').notNull(),
    /** Confiança em pontos-base, como todo percentual do sistema. */
    confiancaBp: integer('confianca_bp').notNull().default(0),
    /**
     * Distância de cosseno que gerou o candidato, em pontos-base de 1.0.
     *
     * Em pontos-base e não em `float` pela mesma razão de sempre, e guardada porque
     * é o único jeito de calibrar o corte depois: com algumas centenas de pares
     * decididos por pessoas, o corte sai de palpite para medida.
     */
    distanciaBp: integer('distancia_bp'),
    justificativa: text('justificativa'),
    /** Contradições entre as fontes que não mudaram a decisão. Sinalizar, não escolher. */
    inconsistencias: jsonb('inconsistencias').notNull().default([]),
    /** `automatico` | `pendente` | `resolvido` | `descartado`. */
    status: text('status').notNull().default('pendente'),
    /** A chamada que julgou, quando houve uma. Liga a decisão ao seu custo. */
    llmCallId: uuid('llm_call_id').references(() => llmCall.id, { onDelete: 'set null' }),
    ...auditoria,
  },
  (t) => [
    unique('unq_par_identidade').on(t.produtoAId, t.produtoBId),
    /**
     * O par é **ordenado**, e o banco é quem garante.
     *
     * Sem isto, (A,B) e (B,A) são duas linhas para a mesma decisão, e nada impede
     * que elas se contradigam. A ordenação também elimina o par de um produto com
     * ele mesmo, que é o que um candidato mal filtrado produz.
     */
    check('chk_par_identidade_ordenado', sql`${t.produtoAId} < ${t.produtoBId}`),
    // A fila de revisão: o que está pendente, mais confiante primeiro.
    index('idx_par_identidade_fila').on(t.status, t.confiancaBp),
    index('idx_par_identidade_a').on(t.produtoAId),
    index('idx_par_identidade_b').on(t.produtoBId),
  ],
);

/**
 * Decisão humana de identidade, guardada como exemplo.
 *
 * "Cada decisão humana vira exemplo para os prompts seguintes." É o que faz o
 * sistema ficar mais inteligente com uso em vez de só maior.
 */
export const exemploIdentidade = pgTable(
  'exemplo_identidade',
  {
    id: id(),
    canonicoA: text('canonico_a').notNull(),
    canonicoB: text('canonico_b').notNull(),
    /** A decisão: são o mesmo produto físico? */
    mesmoProduto: text('mesmo_produto').notNull(),
    justificativa: text('justificativa'),
    ...auditoria,
  },
  (t) => [unique('unq_exemplo_par').on(t.canonicoA, t.canonicoB)],
);
