/**
 * Inteligência: oportunidade, oferta de afiliado e monitor.
 * **Base compartilhada: sem `perfil_id`.**
 *
 * É a metade do sistema que tem valor defensável. A operacional é higiene.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditoria, centavos, id, plataformaEnum, procedencia, severidadeEnum } from './comum';
import type { Achado, Hipotese, MotivoDeParada } from '@/dominio/prospector/fronteira';
import type { FamiliaDeHipotese } from '@/dominio/prospector/hipoteses';

/**
 * Um item de fronteira **como fica gravado**: só o que interessa a quem lê o dossiê.
 *
 * Peso e custo são da máquina de busca e não ajudam a ler o resultado, então não
 * entram — ver `paraGravar` em `dominio/prospector/dossie.ts`.
 */
export interface ItemDeFronteiraGravado {
  readonly alvo: string;
  readonly familia: FamiliaDeHipotese;
}

/**
 * Resultado de uma avaliação de nicho (M7).
 *
 * Os cortes são aplicados em **subcategoria**, nunca em categoria:
 * "eletrodomésticos" não diz nada, "correia de secadora Brastemp" diz tudo.
 */
export const oportunidade = pgTable(
  'oportunidade',
  {
    id: id(),
    termoOuNicho: text('termo_ou_nicho').notNull(),
    demandaMes: integer('demanda_mes'),
    /** Share dos três maiores, em pontos-base. Acima de 40–50% é sinal de fugir. */
    shareTop3Bp: integer('share_top3_bp'),
    dispersaoPrecoBp: integer('dispersao_preco_bp'),
    /** Fração em catálogo no ML. Alto é ruim para conta sem reputação verde. */
    pctCatalogoBp: integer('pct_catalogo_bp'),
    ticketMedio: centavos('ticket_medio'),
    /** Markup estimado em pontos-base. Corte em 3x = 30 000 bp. */
    markupEstimadoBp: integer('markup_estimado_bp'),
    veredito: text('veredito'),
    /** Quais fontes alimentaram o cálculo, para o veredito ser auditável. */
    fontesUsadas: jsonb('fontes_usadas'),
    rodadoEm: timestamp('rodado_em', { withTimezone: true }).notNull().defaultNow(),
    ...auditoria,
  },
  (t) => [index('idx_oportunidade_termo').on(t.termoOuNicho, t.rodadoEm)],
);

/**
 * Dossiê do prospector (M6).
 *
 * Guarda as três listas vivas do agente — hipóteses, fronteira e achados — para
 * que uma execução interrompida seja **retomável**, e para que um agente que
 * estoura o orçamento salve o dossiê parcial em vez de perder o trabalho.
 */
export const dossie = pgTable(
  'dossie',
  {
    id: id(),
    /** O alvo: um produto, um aparelho, uma marca, um nicho ou um link. */
    alvo: text('alvo').notNull(),
    /**
     * O mesmo alvo, normalizado: chave de identidade, e não texto de tela.
     *
     * Existia só a coluna `alvo`, e o repositório gravava nela a **chave** — sem
     * acento e em minúsculas — para o upsert por alvo funcionar. O efeito apareceu
     * quando a tela mostrou o dossiê: "correia de máquina de lavar" virava "correia de
     * maquina de lavar" na cara do dono. Chave e texto de tela são coisas diferentes,
     * e agora são colunas diferentes.
     *
     * Única, e é a garantia que a verificação de leitura do repositório não dá: dois
     * dossiês do mesmo alvo é a pior forma de perder investigação paga — nenhum dos
     * dois estaria errado e nenhum dos dois estaria completo.
     */
    alvoChave: text('alvo_chave').notNull(),
    /**
     * As três listas vivas, tipadas pelo domínio.
     *
     * `$type` em vez de `jsonb` cru pelo mesmo motivo de `compatibilidade.evidencias`:
     * sem ele, cada leitura precisaria de um `as` para virar o tipo do domínio — e as
     * convenções proíbem `as` justamente porque ele cala o compilador no lugar onde
     * ele ajudaria. O tipo mora no schema, e quem lê recebe pronto.
     */
    hipoteses: jsonb('hipoteses').$type<Hipotese[]>().notNull().default([]),
    fronteira: jsonb('fronteira').$type<ItemDeFronteiraGravado[]>().notNull().default([]),
    achados: jsonb('achados').$type<Achado[]>().notNull().default([]),
    /** Orçamento por execução, obrigatório. Agente sem teto não roda (ADR 0005). */
    orcamentoCentavos: centavos('orcamento_centavos').notNull(),
    gastoCentavos: centavos('gasto_centavos').notNull().default(0),
    orcamentoPassos: integer('orcamento_passos').notNull(),
    passosGastos: integer('passos_gastos').notNull().default(0),
    /** Por que parou, ou nulo se em andamento. Ver `MOTIVOS_DE_PARADA` no domínio. */
    motivoParada: text('motivo_parada').$type<MotivoDeParada>(),
    recomendacao: text('recomendacao'),
    ...auditoria,
  },
  (t) => [unique('uq_dossie_alvo_chave').on(t.alvoChave)],
);

/**
 * Oferta para o grupo de promoções (M13).
 *
 * O `score_desconto` compara com a **mediana dos últimos 90 dias**, não com o
 * "preço de" anunciado — que é o truque de subir o preço para depois "baixar".
 */
export const afiliadoOferta = pgTable(
  'afiliado_oferta',
  {
    id: id(),
    plataforma: plataformaEnum('plataforma').notNull(),
    urlAfiliado: text('url_afiliado').notNull(),
    skuExterno: text('sku_externo'),
    preco: centavos('preco').notNull(),
    precoAnterior: centavos('preco_anterior'),
    /** Mediana dos últimos 90 dias, que é a referência honesta. */
    medianaNoventaDias: centavos('mediana_noventa_dias'),
    comissaoBp: integer('comissao_bp'),
    /** Desconto real contra a mediana, em pontos-base. */
    scoreDescontoBp: integer('score_desconto_bp'),
    publicadoEmGrupo: timestamp('publicado_em_grupo', { withTimezone: true }),
    cliques: integer('cliques').notNull().default(0),
    conversoes: integer('conversoes').notNull().default(0),
    ...procedencia,
    ...auditoria,
  },
  (t) => [
    index('idx_afiliado_score').on(t.scoreDescontoBp),
    // A fila de publicação: o que ainda não foi para o grupo, por score.
    index('idx_afiliado_fila').on(t.publicadoEmGrupo, t.scoreDescontoBp),
  ],
);

/**
 * Evento do monitor (M15) — com **julgamento**, não só alerta.
 *
 * A diferença que a tabela precisa suportar:
 *
 * - Automação: "o preço do concorrente caiu 8%".
 * - Inteligência: "caiu 8% e aumentou o estoque anunciado ao mesmo tempo, três
 *   semanas depois de um fornecedor novo aparecer 20% mais barato. Provável troca
 *   de fornecedor, não queima de estoque — o piso do nicho baixou de forma
 *   permanente."
 *
 * Daí `leitura_ia` e `grupo_id`: dez alertas soltos são ruído, um evento explicado
 * é informação, e o sistema agrupa eventos relacionados **antes** de avisar.
 */
export const monitorEvento = pgTable(
  'monitor_evento',
  {
    id: id(),
    entidadeTipo: text('entidade_tipo').notNull(),
    entidadeId: uuid('entidade_id'),
    tipoMudanca: text('tipo_mudanca').notNull(),
    valorAntes: text('valor_antes'),
    valorDepois: text('valor_depois'),
    /** Hipótese e recomendação em linguagem natural, gerada por LLM. */
    leituraIa: text('leitura_ia'),
    severidade: severidadeEnum('severidade').notNull(),
    /** Agrupa eventos relacionados, para avisar uma vez em vez de dez. */
    grupoId: uuid('grupo_id'),
    detectadoEm: timestamp('detectado_em', { withTimezone: true }).notNull().defaultNow(),
    lido: boolean('lido').notNull().default(false),
    ...auditoria,
  },
  (t) => [
    index('idx_monitor_nao_lido').on(t.lido, t.severidade, t.detectadoEm),
    index('idx_monitor_entidade').on(t.entidadeTipo, t.entidadeId),
    index('idx_monitor_grupo').on(t.grupoId),
  ],
);
