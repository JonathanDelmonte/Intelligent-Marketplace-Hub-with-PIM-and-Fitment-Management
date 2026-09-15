CREATE TABLE "pergunta_recebida" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"anuncio_externo" text NOT NULL,
	"texto" text NOT NULL,
	"recebida_em" timestamp with time zone DEFAULT now() NOT NULL,
	"hash_texto" text NOT NULL,
	"fonte" "fonte" NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"origem_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pergunta_hash" UNIQUE("perfil_id","anuncio_externo","hash_texto")
);
--> statement-breakpoint
ALTER TABLE "pergunta_recebida" ADD CONSTRAINT "pergunta_recebida_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pergunta_perfil" ON "pergunta_recebida" USING btree ("perfil_id","recebida_em");