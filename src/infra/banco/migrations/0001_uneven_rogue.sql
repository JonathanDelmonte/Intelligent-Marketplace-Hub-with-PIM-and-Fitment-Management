ALTER TABLE "produto_externo" ADD COLUMN "ean" text;--> statement-breakpoint
CREATE INDEX "idx_produto_externo_ean" ON "produto_externo" USING btree ("ean");--> statement-breakpoint
-- Backfill: o GTIN já coletado mora dentro de `atributos_extraidos`, onde o
-- importador o guardava antes desta coluna existir. Migrar é o que faz o leitor
-- de código de barras achar o que já está na base.
--
-- Só o que passa no dígito verificador entra na coluna: a coluna existe para ser
-- chave de consulta, e chave errada é pior que chave ausente. O valor recusado
-- continua em `atributos_extraidos` para auditoria — a tela de detalhe do job
-- mostra o payload como está.
CREATE FUNCTION bancada_gtin_valido_migracao_0001(codigo text) RETURNS boolean AS $$
DECLARE
  corpo text;
  soma int := 0;
  i int;
  peso int;
BEGIN
  IF codigo IS NULL OR codigo !~ '^[0-9]+$' THEN RETURN false; END IF;
  IF length(codigo) NOT IN (8, 12, 13, 14) THEN RETURN false; END IF;

  corpo := left(codigo, length(codigo) - 1);
  FOR i IN 1..length(corpo) LOOP
    -- Da direita para a esquerda do corpo, pesos alternados 3 e 1.
    peso := CASE WHEN (length(corpo) - i) % 2 = 0 THEN 3 ELSE 1 END;
    soma := soma + substr(corpo, i, 1)::int * peso;
  END LOOP;

  RETURN ((10 - (soma % 10)) % 10) = right(codigo, 1)::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint
UPDATE "produto_externo" AS pe
SET "ean" = CASE
    -- GTIN-14 com indicador zero é a unidade: vale o GTIN-13 equivalente.
    WHEN length(b.bruto) = 14 AND left(b.bruto, 1) = '0' THEN right(b.bruto, 13)
    -- Indicador de 1 a 9 é caixa ou quantidade variável: não é a unidade, e
    -- fica com os 14 dígitos para não ser confundido com ela.
    WHEN length(b.bruto) = 14 THEN b.bruto
    -- EAN-8 e UPC-A viram 13 por zero à esquerda, que preserva o verificador.
    ELSE lpad(b.bruto, 13, '0')
  END
FROM (
  SELECT
    id,
    regexp_replace("atributos_extraidos" ->> 'ean', '[^0-9]', '', 'g') AS bruto
  FROM "produto_externo"
  WHERE "atributos_extraidos" ? 'ean'
) AS b
WHERE pe.id = b.id
  AND bancada_gtin_valido_migracao_0001(b.bruto);
--> statement-breakpoint
DROP FUNCTION bancada_gtin_valido_migracao_0001(text);
