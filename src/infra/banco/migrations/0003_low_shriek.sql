CREATE TABLE "par_identidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produto_a_id" uuid NOT NULL,
	"produto_b_id" uuid NOT NULL,
	"decisao" text NOT NULL,
	"origem" text NOT NULL,
	"nivel" text NOT NULL,
	"confianca_bp" integer DEFAULT 0 NOT NULL,
	"distancia_bp" integer,
	"justificativa" text,
	"inconsistencias" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"llm_call_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unq_par_identidade" UNIQUE("produto_a_id","produto_b_id"),
	CONSTRAINT "chk_par_identidade_ordenado" CHECK ("par_identidade"."produto_a_id" < "par_identidade"."produto_b_id")
);
--> statement-breakpoint
ALTER TABLE "par_identidade" ADD CONSTRAINT "par_identidade_produto_a_id_produto_externo_id_fk" FOREIGN KEY ("produto_a_id") REFERENCES "public"."produto_externo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "par_identidade" ADD CONSTRAINT "par_identidade_produto_b_id_produto_externo_id_fk" FOREIGN KEY ("produto_b_id") REFERENCES "public"."produto_externo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "par_identidade" ADD CONSTRAINT "par_identidade_llm_call_id_llm_call_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_par_identidade_fila" ON "par_identidade" USING btree ("status","confianca_bp");--> statement-breakpoint
CREATE INDEX "idx_par_identidade_a" ON "par_identidade" USING btree ("produto_a_id");--> statement-breakpoint
CREATE INDEX "idx_par_identidade_b" ON "par_identidade" USING btree ("produto_b_id");