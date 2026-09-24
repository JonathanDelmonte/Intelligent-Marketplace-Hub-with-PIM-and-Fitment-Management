-- Perguntas coladas antes das áreas por loja ficam sem loja e seguem na lista geral (ADR 0009).
ALTER TABLE "pergunta_recebida" ADD COLUMN "plataforma" "plataforma";
