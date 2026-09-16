ALTER TABLE "dossie" ADD COLUMN "investigados" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dossie" ADD COLUMN "passos_sem_achado" integer DEFAULT 0 NOT NULL;