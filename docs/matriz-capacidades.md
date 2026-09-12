# Matriz de capacidades

Estado real de acesso a cada plataforma, por capacidade. Este arquivo é o
resultado de **teste**, não de expectativa — a especificação é explícita: "o
resultado desse teste é um arquivo de configuração, não uma surpresa em produção".

A fonte executável é [`src/plataformas/matriz.ts`](../src/plataformas/matriz.ts).
Este documento é a leitura humana dela, e as duas não podem divergir: existe teste
que falha se divergirem.

## Como atualizar

```sh
npm run sondar:capacidades          # todas as plataformas
npm run sondar:capacidades -- --plataforma=ml
```

A sonda usa as credenciais ativas em `credencial` (ADR 0007), bate em cada
endpoint, registra status HTTP e latência, e escreve o resultado. Sem credencial
ela ainda roda: testa o que é público (M2) e marca o resto como
`SEM_CREDENCIAL`, que é diferente de `BLOQUEADO`.

## Modos de acesso

| Modo              | Nome                                 | Credencial     | Risco                                   |
| ----------------- | ------------------------------------ | -------------- | --------------------------------------- |
| `m0_link`         | Colar link — extração de 1 página    | nenhuma        | nenhum                                  |
| `m1_planilha`     | Importar arquivo exportado do painel | nenhuma        | nenhum                                  |
| `m2_publico`      | Endpoint que responde sem token      | nenhuma        | nenhum                                  |
| `m3_api`          | API oficial OAuth                    | token da conta | nenhum                                  |
| ~~`m4_extensao`~~ | Extensão sob login                   | sessão         | **alto — fora de escopo, ver ADR 0008** |

## Estado por capacidade

Última sondagem: **nunca executada** — os valores abaixo são a expectativa
documentada na seção 2.2 da especificação, marcados como `PRESUMIDO`. Nenhum
deles foi confirmado contra a plataforma.

| Capacidade                      | Mercado Livre                                    | Shopee                    | Amazon                    |
| ------------------------------- | ------------------------------------------------ | ------------------------- | ------------------------- |
| Ler meus anúncios               | `m3_api` / `m1_planilha` · PRESUMIDO             | `m1_planilha` · PRESUMIDO | `m1_planilha` · PRESUMIDO |
| Ler meus pedidos                | `m3_api` / `m1_planilha` · PRESUMIDO             | `m1_planilha` · PRESUMIDO | `m1_planilha` · PRESUMIDO |
| Ler taxas reais por preço       | `m3_api` (`listing_prices`) · PRESUMIDO          | `m0_link` + tabela manual | tabela manual             |
| Publicar / editar anúncio       | `m3_api` · PRESUMIDO                             | — (manual)                | — (manual)                |
| Gerar etiqueta de envio         | `m3_api` · PRESUMIDO                             | — (manual)                | — (manual)                |
| Buscar anúncios de terceiros    | **BLOQUEADO** — ver abaixo                       | `m0_link`                 | `m0_link`                 |
| Ler item de terceiro por ID/URL | `m0_link` / `m3_api` (`/items/{id}`) · PRESUMIDO | `m0_link`                 | `m0_link`                 |
| Responder pergunta de comprador | `m3_api` · PRESUMIDO                             | —                         | —                         |
| Exportar arquivo de importação  | `m1_planilha` — **sempre suportado**             | `m1_planilha`             | `m1_planilha`             |

A última linha não é sondada: `exportarParaImportacao` é suportada por contrato em
todo adaptador (ADR 0001), e é o piso que garante a regra de degradação.

## `GET /sites/MLB/search` — bloqueado

**Estado: `BLOQUEADO`. Não usar como dependência de nenhum módulo.**

|                       |                                                                        |
| --------------------- | ---------------------------------------------------------------------- |
| Sintoma               | `403 Forbidden` com token válido, escopo correto e `site_id` correto   |
| Desde                 | dezembro de 2025                                                       |
| Evidência             | volume grande de reclamações formais de desenvolvedores, sem resolução |
| Critério de liberação | não publicado pelo Mercado Livre                                       |

**Inferência, marcada como inferência:** o endpoint foi movido para lista de acesso
restrito, liberada caso a caso para aplicações aprovadas. Não validado em fonte
oficial — a documentação do ML bloqueia acesso automatizado e o próprio endpoint é
proibido por `robots.txt`.

**Hipótese de como destravar, não confirmada:** o ML mantém um _Developer Partner
Program_ com níveis de aplicação, e a Nubimetrics — que tem acesso a dados de
busca — aparece na Central de Parceiros oficial. É plausível que o acesso passe a
depender de aprovação nesse programa. Vale investigar o processo de inscrição
cedo, porque é caminho de meses e não de dias.

**E é irrelevante para o cronograma.** Nenhum módulo depende desse endpoint. A
medição de concorrência do M6 usa página pública e comparador; o volume do M7 vem
de M0/M2. Se um dia o acesso for liberado, entra como fonte adicional atrás da
mesma interface — não como habilitador de funcionalidade que estava esperando.

## Aprovações pendentes de terceiros

| Plataforma    | O que exige                                         | Estado         |
| ------------- | --------------------------------------------------- | -------------- |
| Shopee        | aprovação de partner na Open Platform               | não solicitado |
| Amazon        | plano profissional + registro de developer (SP-API) | não solicitado |
| Mercado Livre | app em `developers.mercadolivre.com.br`             | não criado     |

Até que qualquer uma saia, Shopee e Amazon entram só por `m0_link` e
`m1_planilha` — e isso é suficiente para o painel ser útil.
