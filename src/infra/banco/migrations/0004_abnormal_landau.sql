ALTER TABLE "produto_externo" ADD COLUMN "chave_agrupamento" text;--> statement-breakpoint
CREATE INDEX "idx_produto_externo_chave_agrupamento" ON "produto_externo" USING btree ("chave_agrupamento");