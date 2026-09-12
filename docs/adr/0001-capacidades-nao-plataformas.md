# ADR 0001 — Modelar por capacidade, não por plataforma

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seção 2

## Contexto

O desenho intuitivo é `MercadoLivreService`, `ShopeeService`, `AmazonService`,
com a UI perguntando "qual plataforma?". Funciona enquanto as três têm API.

As três não têm API equivalente. Shopee exige aprovação de partner na Open
Platform. Amazon SP-API exige plano profissional e registro de developer. E o
`GET /sites/MLB/search` do Mercado Livre retorna **403 Forbidden** com token
válido, escopo correto e `site_id` correto, para um volume grande de
desenvolvedores, desde dezembro de 2025 — sem critério de liberação publicado.

Num desenho orientado a plataforma, cada ausência dessas é um `if` na UI, e a
soma dos `if` é uma UI que ninguém entende e que quebra quando uma plataforma
muda de política.

## Decisão

A unidade de modelagem é a **capacidade**, não a plataforma.

1. Existe um conjunto fechado de capacidades (`ler_anuncios`, `ler_pedidos`,
   `ler_taxas`, `publicar_anuncio`, `gerar_etiqueta`, `buscar_terceiros`,
   `ler_item_terceiro`, `responder_pergunta`, `exportar_para_importacao`).
2. Cada plataforma tem um **adaptador** que declara, por capacidade, se suporta e
   por qual **modo de acesso** (M0 link · M1 planilha · M2 público · M3 OAuth).
3. `capacidades()` é descoberto em runtime e cacheado por 24 h. Não é constante
   compilada: política de plataforma muda sem aviso, e a verdade é o que a API
   respondeu hoje.
4. Toda chamada que pode não existir lança `NaoSuportado`. A UI trata
   `NaoSuportado` como **estado normal**, com rótulo honesto — nunca como erro.
5. `exportarParaImportacao()` é a única capacidade sempre suportada, em todo
   adaptador, para toda plataforma. É o piso que garante a regra do ADR 0002.

## Consequências

**A favor.** Plataforma nova é um adaptador, não uma refatoração. Capacidade que
fecha degrada uma coluna da tela, não a tela. A matriz da seção 2.2 deixa de ser
documentação e passa a ser configuração executável, preenchida por sonda.

**Contra.** Uma camada de indireção que não paga nada enquanto só existe uma
plataforma conectada. Aceito: o custo é uma interface e um erro tipado; o custo
de não ter é reescrever a UI no dia em que o ML muda de política — o que já
aconteceu uma vez, e é a razão deste ADR.

**Consequência não obvia.** A UI não pode ter texto do tipo "conecte sua conta do
Mercado Livre para continuar". Nenhuma tela tem gate de conexão. Isso é testável:
a suíte roda com zero credencial e toda tela responde.
