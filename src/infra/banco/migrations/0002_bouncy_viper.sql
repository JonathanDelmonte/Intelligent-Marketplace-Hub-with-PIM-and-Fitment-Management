CREATE TABLE "leitura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"perfil_id" uuid NOT NULL,
	"id_local" text NOT NULL,
	"gtin" text NOT NULL,
	"gtin_canonico" text,
	"custo_unitario" bigint,
	"unidades_no_lote" integer,
	"veredito" text NOT NULL,
	"preco_de_referencia" bigint,
	"margem_bp" integer,
	"confianca_bp" integer,
	"motivos" jsonb,
	"decisao" text,
	"local" text,
	"lido_em" timestamp with time zone NOT NULL,
	"sincronizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_leitura_perfil_local" UNIQUE("perfil_id","id_local")
);
--> statement-breakpoint
ALTER TABLE "leitura" ADD CONSTRAINT "leitura_perfil_id_perfil_vendedor_id_fk" FOREIGN KEY ("perfil_id") REFERENCES "public"."perfil_vendedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_leitura_perfil_data" ON "leitura" USING btree ("perfil_id","lido_em");--> statement-breakpoint
CREATE INDEX "idx_leitura_gtin" ON "leitura" USING btree ("perfil_id","gtin_canonico");