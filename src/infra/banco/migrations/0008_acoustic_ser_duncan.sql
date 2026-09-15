DROP INDEX "idx_dossie_alvo";--> statement-breakpoint
-- Coluna acrescentada em três passos, e não em um `ADD COLUMN ... NOT NULL`: com
-- linha na tabela, o passo único falha por não haver valor para as existentes.
--
-- Backfill trivial de propósito: o que estava em `alvo` **era** a chave — o
-- repositório gravava o alvo normalizado ali, e foi o que a tela do garimpo mostrou
-- escrito "correia de maquina de lavar". Para as linhas que já existem, a grafia
-- original não é recuperável, e `alvo` continua com a versão sem acento. Vale para as
-- novas, que é onde a tela olha daqui para frente.
ALTER TABLE "dossie" ADD COLUMN "alvo_chave" text;--> statement-breakpoint
UPDATE "dossie" SET "alvo_chave" = "alvo" WHERE "alvo_chave" IS NULL;--> statement-breakpoint
ALTER TABLE "dossie" ALTER COLUMN "alvo_chave" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dossie" ADD CONSTRAINT "uq_dossie_alvo_chave" UNIQUE("alvo_chave");
