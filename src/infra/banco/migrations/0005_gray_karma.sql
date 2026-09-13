CREATE TYPE "public"."decisao_compatibilidade" AS ENUM('serve', 'nao_serve', 'indefinido');--> statement-breakpoint
DROP INDEX "idx_compat_sku_confianca";--> statement-breakpoint
ALTER TABLE "aparelho" ADD COLUMN "linhagem" text;--> statement-breakpoint
ALTER TABLE "compatibilidade" ADD COLUMN "decisao" "decisao_compatibilidade" DEFAULT 'indefinido' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_aparelho_linhagem" ON "aparelho" USING btree ("linhagem");--> statement-breakpoint
CREATE INDEX "idx_compat_sku_confianca" ON "compatibilidade" USING btree ("sku_id","decisao","confianca_bp");