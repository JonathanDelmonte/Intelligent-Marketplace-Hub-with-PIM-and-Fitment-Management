ALTER TABLE "fornecedor" ADD COLUMN "vende_direto_fonte" "fonte";--> statement-breakpoint
ALTER TABLE "fornecedor" ADD COLUMN "conferencia" jsonb;--> statement-breakpoint
-- Até aqui, toda resposta de "vende direto" foi dada à mão: não havia conferência automática.
UPDATE "fornecedor" SET "vende_direto_fonte" = 'manual' WHERE "vende_direto_marketplace" IS NOT NULL;
