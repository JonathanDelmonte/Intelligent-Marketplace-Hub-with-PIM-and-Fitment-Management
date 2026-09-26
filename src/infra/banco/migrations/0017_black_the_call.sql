-- A fila lembra o arquivo que um job espera, quando ele saiu da nuvem (ADR 0016). Só acrescenta.
ALTER TABLE "job" ADD COLUMN "aguardando_conteudo" text;