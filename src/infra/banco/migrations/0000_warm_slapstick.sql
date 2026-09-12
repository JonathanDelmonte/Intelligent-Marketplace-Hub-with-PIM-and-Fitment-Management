CREATE TYPE "public"."canal_contato" AS ENUM('whatsapp', 'email', 'telefone');--> statement-breakpoint
CREATE TYPE "public"."fonte" AS ENUM('m0_link', 'm1_planilha', 'm2_publico', 'm3_api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."origem_fornecedor" AS ENUM('nacional', 'importado', 'china');--> statement-breakpoint
CREATE TYPE "public"."plataforma" AS ENUM('ml', 'shopee', 'amazon');--> statement-breakpoint
CREATE TYPE "public"."regime_fiscal" AS ENUM('cpf', 'mei', 'simples');--> statement-breakpoint
CREATE TYPE "public"."severidade" AS ENUM('vermelho', 'amarelo', 'informativo');--> statement-breakpoint
CREATE TYPE "public"."status_job" AS ENUM('pendente', 'rodando', 'concluido', 'falhou', 'pendente_revisao');--> statement-breakpoint
CREATE TYPE "public"."tipo_anuncio" AS ENUM('classico', 'premium', 'catalogo');--> statement-breakpoint
CREATE TYPE "public"."tipo_credencial" AS ENUM('oauth', 'planilha', 'nenhuma');--> statement-breakpoint
CREATE TYPE "public"."tipo_sku" AS ENUM('proprio', 'revenda', 'consignado');--> statement-breakpoint
CREATE TYPE "public"."verificado_por" AS ENUM('ia', 'humano', 'fabricante');--> statement-breakpoint
CREATE TABLE "credencial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"plataforma" "plataforma" NOT NULL,
	"tipo" "tipo_credencial" NOT NULL,
	"token_cifrado" text,
	"refresh_token_cifrado" text,
	"expira_em" timestamp with time zone,
	"escopos" text[],
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_credencial_perfil_plataforma" UNIQUE("perfil_id","plataforma")
);
--> statement-breakpoint
CREATE TABLE "perfil_vendedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"cnpj_ou_cpf" text,
	"regime" "regime_fiscal" NOT NULL,
	"inscricao_estadual" text,
	"teto_anual" bigint,
	"emissor_nf_config" jsonb,
	"marca_visual" jsonb,
	"das_mensal" bigint,
	"aliquota_simples_bp" integer,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfil_vendedor_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "preco_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produto_externo_id" uuid NOT NULL,
	"preco" bigint NOT NULL,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "produto_externo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid,
	"url" text,
	"plataforma_ou_site" text,
	"titulo_bruto" text NOT NULL,
	"preco" bigint,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"vendedor" text,
	"vendas_estimadas" integer,
	"atributos_extraidos" jsonb,
	"hash_conteudo" text NOT NULL,
	"forma_canonica" text,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_produto_externo_hash" UNIQUE("hash_conteudo")
);
--> statement-breakpoint
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"ean" text,
	"titulo_interno" text NOT NULL,
	"marca" text,
	"categoria_ml" text,
	"categoria_shopee" text,
	"peso_g" integer,
	"dim_mm" jsonb,
	"ncm" text,
	"cest" text,
	"cst" text,
	"cclasstrib" text,
	"categoria_regulada" text,
	"custo_atual" bigint,
	"custo_atualizado_em" timestamp with time zone,
	"tipo" "tipo_sku" DEFAULT 'revenda' NOT NULL,
	"fornecedor_principal_id" uuid,
	"taxa_devolucao_esperada_bp" integer,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_sku_perfil_ean" UNIQUE("perfil_id","ean")
);
--> statement-breakpoint
CREATE TABLE "fornecedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"site" text,
	"contato" text,
	"canal" "canal_contato",
	"posta_com_etiqueta" boolean,
	"emite_nf" boolean,
	"prazo_postagem_dias" smallint,
	"pedido_minimo_reais" bigint,
	"pedido_minimo_un" integer,
	"vende_direto_marketplace" boolean,
	"vende_direto_verificado_em" timestamp with time zone,
	"origem" "origem_fornecedor",
	"confiabilidade" smallint,
	"notas" text,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedor_preco_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"preco" bigint NOT NULL,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fornecedor_sku" (
	"fornecedor_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"codigo_no_fornecedor" text,
	"preco" bigint,
	"preco_atualizado_em" timestamp with time zone,
	"estoque_informado" integer,
	"url_origem" text,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fornecedor_sku_fornecedor_id_sku_id_pk" PRIMARY KEY("fornecedor_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "aparelho" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"marca" text NOT NULL,
	"modelo" text NOT NULL,
	"ano_de" smallint,
	"ano_ate" smallint,
	"variante" text,
	"familia" text,
	"atributos" jsonb,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_aparelho_identidade" UNIQUE("tipo","marca","modelo","variante")
);
--> statement-breakpoint
CREATE TABLE "compatibilidade" (
	"sku_id" uuid NOT NULL,
	"aparelho_id" uuid NOT NULL,
	"confianca_bp" integer NOT NULL,
	"evidencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verificado_por" "verificado_por" NOT NULL,
	"verificado_em" timestamp with time zone,
	"conflito" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compatibilidade_sku_id_aparelho_id_pk" PRIMARY KEY("sku_id","aparelho_id")
);
--> statement-breakpoint
CREATE TABLE "acumulado_anual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"ano" smallint NOT NULL,
	"receita_bruta" bigint DEFAULT 0 NOT NULL,
	"receita_externa" bigint DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_acumulado_perfil_ano" UNIQUE("perfil_id","ano")
);
--> statement-breakpoint
CREATE TABLE "anuncio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"plataforma" "plataforma" NOT NULL,
	"id_externo" text,
	"url" text,
	"tipo" "tipo_anuncio",
	"preco" bigint NOT NULL,
	"frete_modo" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"publicado_em" timestamp with time zone,
	"fonte" "fonte" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_anuncio_plataforma_externo" UNIQUE("plataforma","id_externo")
);
--> statement-breakpoint
CREATE TABLE "consignacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"parceiro_nome" text NOT NULL,
	"parceiro_contato" text,
	"sku_id" uuid NOT NULL,
	"qtd_disponivel" integer DEFAULT 0 NOT NULL,
	"preco_acordado_repasse" bigint,
	"conferido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedido" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"anuncio_id" uuid,
	"sku_id" uuid,
	"plataforma" "plataforma" NOT NULL,
	"id_externo" text NOT NULL,
	"data" timestamp with time zone NOT NULL,
	"qtd" integer DEFAULT 1 NOT NULL,
	"preco_bruto" bigint NOT NULL,
	"taxa_comissao" bigint,
	"taxa_fixa" bigint,
	"frete_pago" bigint,
	"repasse_liquido" bigint,
	"custo_na_venda" bigint,
	"margem_realizada" bigint,
	"status_envio" text,
	"rastreio" text,
	"prazo_postagem_ate" timestamp with time zone,
	"postagem_confirmada_em" timestamp with time zone,
	"repasse_conferido_em" timestamp with time zone,
	"fonte" "fonte" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_pedido_plataforma_externo" UNIQUE("plataforma","id_externo")
);
--> statement-breakpoint
CREATE TABLE "afiliado_oferta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plataforma" "plataforma" NOT NULL,
	"url_afiliado" text NOT NULL,
	"sku_externo" text,
	"preco" bigint NOT NULL,
	"preco_anterior" bigint,
	"mediana_noventa_dias" bigint,
	"comissao_bp" integer,
	"score_desconto_bp" integer,
	"publicado_em_grupo" timestamp with time zone,
	"cliques" integer DEFAULT 0 NOT NULL,
	"conversoes" integer DEFAULT 0 NOT NULL,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alvo" text NOT NULL,
	"hipoteses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fronteira" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"achados" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"orcamento_centavos" bigint NOT NULL,
	"gasto_centavos" bigint DEFAULT 0 NOT NULL,
	"orcamento_passos" integer NOT NULL,
	"passos_gastos" integer DEFAULT 0 NOT NULL,
	"motivo_parada" text,
	"recomendacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entidade_tipo" text NOT NULL,
	"entidade_id" uuid,
	"tipo_mudanca" text NOT NULL,
	"valor_antes" text,
	"valor_depois" text,
	"leitura_ia" text,
	"severidade" "severidade" NOT NULL,
	"grupo_id" uuid,
	"detectado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"lido" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oportunidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"termo_ou_nicho" text NOT NULL,
	"demanda_mes" integer,
	"share_top3_bp" integer,
	"dispersao_preco_bp" integer,
	"pct_catalogo_bp" integer,
	"ticket_medio" bigint,
	"markup_estimado_bp" integer,
	"veredito" text,
	"fontes_usadas" jsonb,
	"rodado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produto_externo_id" uuid NOT NULL,
	"texto_canonico" text NOT NULL,
	"modelo" text NOT NULL,
	"vetor" vector(1536) NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_embedding_produto_modelo" UNIQUE("produto_externo_id","modelo")
);
--> statement-breakpoint
CREATE TABLE "exemplo_identidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonico_a" text NOT NULL,
	"canonico_b" text NOT NULL,
	"mesmo_produto" text NOT NULL,
	"justificativa" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_exemplo_par" UNIQUE("canonico_a","canonico_b")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"entrada" jsonb NOT NULL,
	"status" "status_job" DEFAULT 'pendente' NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"progresso" jsonb,
	"resultado" jsonb,
	"erro" text,
	"tentativas" smallint DEFAULT 0 NOT NULL,
	"max_tentativas" smallint DEFAULT 3 NOT NULL,
	"agendado_para" timestamp with time zone DEFAULT now() NOT NULL,
	"iniciado_em" timestamp with time zone,
	"terminado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_job_idempotencia" UNIQUE("tipo","chave_idempotencia")
);
--> statement-breakpoint
CREATE TABLE "llm_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposito" text NOT NULL,
	"modelo" text NOT NULL,
	"hash_entrada" text NOT NULL,
	"entrada" jsonb NOT NULL,
	"saida" jsonb,
	"custo_centavos" bigint,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"latencia_ms" integer,
	"job_id" uuid,
	"dossie_id" uuid,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_llm_call_cache" UNIQUE("proposito","modelo","hash_entrada")
);
--> statement-breakpoint
ALTER TABLE "credencial" ADD CONSTRAINT "credencial_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco_historico" ADD CONSTRAINT "preco_historico_produto_externo_id_produto_externo_id_fk" FOREIGN KEY ("produto_externo_id") REFERENCES "public"."produto_externo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_externo" ADD CONSTRAINT "produto_externo_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "sku_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor_preco_historico" ADD CONSTRAINT "fornecedor_preco_historico_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor_preco_historico" ADD CONSTRAINT "fornecedor_preco_historico_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor_sku" ADD CONSTRAINT "fornecedor_sku_fornecedor_id_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor_sku" ADD CONSTRAINT "fornecedor_sku_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilidade" ADD CONSTRAINT "compatibilidade_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilidade" ADD CONSTRAINT "compatibilidade_aparelho_id_aparelho_id_fk" FOREIGN KEY ("aparelho_id") REFERENCES "public"."aparelho"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acumulado_anual" ADD CONSTRAINT "acumulado_anual_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncio" ADD CONSTRAINT "anuncio_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncio" ADD CONSTRAINT "anuncio_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignacao" ADD CONSTRAINT "consignacao_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consignacao" ADD CONSTRAINT "consignacao_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_anuncio_id_anuncio_id_fk" FOREIGN KEY ("anuncio_id") REFERENCES "public"."anuncio"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_sku_id_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding" ADD CONSTRAINT "embedding_produto_externo_id_produto_externo_id_fk" FOREIGN KEY ("produto_externo_id") REFERENCES "public"."produto_externo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credencial_expira" ON "credencial" USING btree ("expira_em");--> statement-breakpoint
CREATE INDEX "idx_perfil_ativo" ON "perfil_vendedor" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "idx_preco_historico_produto" ON "preco_historico" USING btree ("produto_externo_id","coletado_em");--> statement-breakpoint
CREATE INDEX "idx_produto_externo_sku" ON "produto_externo" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_produto_externo_captura" ON "produto_externo" USING btree ("coletado_em");--> statement-breakpoint
CREATE INDEX "idx_sku_perfil" ON "sku" USING btree ("perfil_id","ativo");--> statement-breakpoint
CREATE INDEX "idx_sku_ean" ON "sku" USING btree ("ean");--> statement-breakpoint
CREATE INDEX "idx_fornecedor_cnpj" ON "fornecedor" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "idx_fornecedor_vende_direto" ON "fornecedor" USING btree ("vende_direto_marketplace");--> statement-breakpoint
CREATE INDEX "idx_fornecedor_preco_hist" ON "fornecedor_preco_historico" USING btree ("fornecedor_id","sku_id","coletado_em");--> statement-breakpoint
CREATE INDEX "idx_fornecedor_sku_sku" ON "fornecedor_sku" USING btree ("sku_id","preco");--> statement-breakpoint
CREATE INDEX "idx_aparelho_marca_modelo" ON "aparelho" USING btree ("marca","modelo");--> statement-breakpoint
CREATE INDEX "idx_aparelho_familia" ON "aparelho" USING btree ("familia");--> statement-breakpoint
CREATE INDEX "idx_compat_sku_confianca" ON "compatibilidade" USING btree ("sku_id","confianca_bp");--> statement-breakpoint
CREATE INDEX "idx_compat_aparelho" ON "compatibilidade" USING btree ("aparelho_id");--> statement-breakpoint
CREATE INDEX "idx_compat_conflito" ON "compatibilidade" USING btree ("conflito");--> statement-breakpoint
CREATE INDEX "idx_anuncio_perfil" ON "anuncio" USING btree ("perfil_id","ativo");--> statement-breakpoint
CREATE INDEX "idx_anuncio_sku" ON "anuncio" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_consignacao_perfil" ON "consignacao" USING btree ("perfil_id");--> statement-breakpoint
CREATE INDEX "idx_consignacao_conferencia" ON "consignacao" USING btree ("perfil_id","conferido_em");--> statement-breakpoint
CREATE INDEX "idx_pedido_perfil_data" ON "pedido" USING btree ("perfil_id","data");--> statement-breakpoint
CREATE INDEX "idx_pedido_fila_postagem" ON "pedido" USING btree ("perfil_id","postagem_confirmada_em","prazo_postagem_ate");--> statement-breakpoint
CREATE INDEX "idx_pedido_sku" ON "pedido" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_afiliado_score" ON "afiliado_oferta" USING btree ("score_desconto_bp");--> statement-breakpoint
CREATE INDEX "idx_afiliado_fila" ON "afiliado_oferta" USING btree ("publicado_em_grupo","score_desconto_bp");--> statement-breakpoint
CREATE INDEX "idx_dossie_alvo" ON "dossie" USING btree ("alvo");--> statement-breakpoint
CREATE INDEX "idx_monitor_nao_lido" ON "monitor_evento" USING btree ("lido","severidade","detectado_em");--> statement-breakpoint
CREATE INDEX "idx_monitor_entidade" ON "monitor_evento" USING btree ("entidade_tipo","entidade_id");--> statement-breakpoint
CREATE INDEX "idx_monitor_grupo" ON "monitor_evento" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX "idx_oportunidade_termo" ON "oportunidade" USING btree ("termo_ou_nicho","rodado_em");--> statement-breakpoint
CREATE INDEX "idx_embedding_hnsw" ON "embedding" USING hnsw ("vetor" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_job_proximo" ON "job" USING btree ("status","agendado_para");--> statement-breakpoint
CREATE INDEX "idx_job_recentes" ON "job" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "idx_llm_call_custo" ON "llm_call" USING btree ("criado_em","proposito");--> statement-breakpoint
CREATE INDEX "idx_llm_call_job" ON "llm_call" USING btree ("job_id");