# Roadmap de implementação

Derivado da seção 8 da [especificação](./especificacao.md). O princípio de
ordenação é **utilidade, não arquitetura**: cada fase entrega algo que serve
sozinho no dia em que fica pronta, e o projeto pode parar em qualquer fase sem
deixar um esqueleto inútil.

A armadilha explicitada na especificação e que este roadmap existe para evitar:
construir o prospector e o painel bonito primeiro, e a venda depois. As fases 1
a 4 existem para que cada noite de código tenha contrapartida em venda possível.

Legenda de estado: ✅ pronto · 🚧 em andamento · ⬜ não começou · 🔒 bloqueado por
dependência externa.

---

## Fase 0 — Fundação (não está na especificação; é pré-requisito de tudo)

| #   | Entrega                                                                    | Estado |
| --- | -------------------------------------------------------------------------- | ------ |
| 0.1 | Regra de autoria de commits + hooks de verificação                         | ✅     |
| 0.2 | Toolchain: Next.js App Router, TS strict, ESLint, Prettier, Vitest         | ✅     |
| 0.3 | `src/config` — marca, perfil e credenciais fora do código (seção 1.2)      | ✅     |
| 0.4 | `src/lib/dinheiro.ts` — aritmética monetária em centavos inteiros          | ✅     |
| 0.5 | Schema de banco completo da seção 3 + migrations + pgvector                | ✅     |
| 0.6 | Procedência: tipo `Fonte`, `coletado_em`, regra de precedência (seção 2.3) | ✅     |

**Entrega:** nenhuma refatoração de marca depois, e nenhuma decisão de modelagem
adiada para o momento em que doer.

---

## Fase 1 — Calculadora de margem (M8)

> Especificação: “Função pura + testes. Sem interface. Uma noite.”

| #   | Entrega                                                              | Estado |
| --- | -------------------------------------------------------------------- | ------ |
| 1.1 | Tabelas de taxa versionadas por plataforma e vigência                | ✅     |
| 1.2 | `calcularMargem()` — função pura, ML/Shopee/Amazon                   | ✅     |
| 1.3 | Regime fiscal: CPF, MEI (DAS rateado), Simples                       | ✅     |
| 1.4 | Provisão de devolução como custo, por categoria                      | ✅     |
| 1.5 | Aviso de zona morta do ML (R$ 79 – ~R$ 120)                          | ✅     |
| 1.6 | `simularFaixa()` — curva de margem por preço com os degraus marcados | ✅     |
| 1.7 | `precoParaMargem()` — inverso: preço mínimo para margem alvo         | ✅     |
| 1.8 | Suíte de testes cobrindo cada degrau e cada aviso                    | ✅     |

**Entrega:** nunca mais publicar anúncio com margem negativa.

**Por que primeiro:** é a única função do sistema que muda uma decisão de
dinheiro no mesmo dia em que existe, e não depende de nada.

---

## Fase 2 — Teste de capacidades + perfil

> Especificação: “Criar o app no ML, gerar token, testar endpoint por endpoint e
> escrever a matriz da seção 2.2 com dados reais. Meia noite.”

| #   | Entrega                                                                     | Estado |
| --- | --------------------------------------------------------------------------- | ------ |
| 2.1 | Contrato `Adaptador` + erro `NaoSuportado` (seção 2.4)                      | ✅     |
| 2.2 | Registro de capacidades com descoberta em runtime e cache de 24 h           | ✅     |
| 2.3 | Adaptadores ML / Shopee / Amazon declarando modo por capacidade             | ✅     |
| 2.4 | `matriz-capacidades.md` — arquivo de configuração, não surpresa em produção | ✅     |
| 2.5 | Sonda de capacidades — roda sem credencial, ainda não bate em endpoint | 🚧     |
| 2.6 | Seed de `perfil_vendedor` (primeira linha, regime CPF)                 | ✅     |
| 2.6b | Fluxo de OAuth que grava `credencial` cifrada                         | ⬜     |
| 2.7 | Cifragem de credencial em repouso (AES-256-GCM), nunca em `.env`            | ✅     |

**Entrega:** saber o que é possível em vez de supor, e nunca precisar refatorar
marca para fora do código.

**Nota sobre o 403:** `GET /sites/MLB/search` está registrado como
`BLOQUEADO` na matriz, com a data e a evidência.

**O que falta na 2.5, e por que está 🚧:** a sonda roda, roda sem credencial, e
relata o estado honesto de cada capacidade — mas **ainda não bate em endpoint
nenhum**, porque o app em `developers.mercadolivre.com.br` não existe. Ela
reporta o que a matriz declara e diz explicitamente o que falta confirmar.
Cadastrar um endpoint e sair chamando antes de haver app seria inventar
resultado, e a matriz existe justamente para não confundir expectativa com fato:
toda capacidade não confirmada aparece como `presumido`, não como disponível.

Para fechar a 2.5, nesta ordem: criar o app no ML, passar pelo OAuth (2.6b), e
rodar a sonda de novo — que então promove `presumido` a `disponivel` ou rebaixa
a `bloqueado`, com o status HTTP na mão.

---

## Fase 3 — Ingestão universal (M1) + catálogo (M2)

> Especificação: “Colar link e importar planilha. Duas a três noites. Tudo
> depois depende disto.”

| #    | Entrega                                                               | Estado |
| ---- | --------------------------------------------------------------------- | ------ |
| 3.1  | Classificador de entrada (URL, xlsx, csv, pdf, imagem, texto)         | ⬜     |
| 3.2  | Extrator de HTML de anúncio — seletores por plataforma + fallback LLM | ⬜     |
| 3.3  | Extrator de listagem/categoria com paginação                          | ⬜     |
| 3.4  | Extrator de catálogo de distribuidor (LLM obrigatório)                | ⬜     |
| 3.5  | Extrator de PDF de tabela de preços                                   | ⬜     |
| 3.6  | Extrator de imagem de tabela (print de WhatsApp) — visão              | ⬜     |
| 3.7  | Importadores de planilha de exportação das três plataformas           | ⬜     |
| 3.8  | Fila `job` idempotente e retomável + tela dos últimos 100 jobs        | ⬜     |
| 3.9  | `pendente_revisao` em vez de descarte quando o schema falha           | ⬜     |
| 3.10 | M2: CRUD de `sku`, custo, peso, dimensão, fiscal, tipo                | ⬜     |

**Entrega:** o sistema começa a acumular base.

**Invariante:** tudo que entra vira `produto_externo`, nunca `sku` direto.

---

## Fase 4 — Leitor de código de barras (M14)

> Especificação: “Uma noite sobre M8. É a primeira função que gera dinheiro.”

| #   | Entrega                                                  | Estado |
| --- | -------------------------------------------------------- | ------ |
| 4.1 | PWA com `BarcodeDetector`, fallback `zxing-wasm`         | ⬜     |
| 4.2 | Veredito compra / não compra em dois segundos, usando M8 | ⬜     |
| 4.3 | Fila de sincronização offline (loja tem sinal ruim)      | ⬜     |
| 4.4 | Fallback de base pública de GTIN para descrição e NCM    | ⬜     |

**Entrega:** sair de casa e comprar com dado. Arbitragem e avaliação de estoque
de parceiro no balcão.

---

## Fase 5 — Resolução de identidade (M3) 🧠

> Especificação: “Duas a três noites. Daqui em diante o sistema fica mais
> inteligente a cada link colado.”

| #   | Entrega                                                                  | Estado |
| --- | ------------------------------------------------------------------------ | ------ |
| 5.1 | Extração de registro estruturado por LLM, com `null` em vez de invenção  | ⬜     |
| 5.2 | Forma canônica + embedding (`tipo + marca + modelo normalizado`)         | ⬜     |
| 5.3 | Busca de vizinhos por `pgvector`                                         | ⬜     |
| 5.4 | Julgamento binário por LLM com justificativa                             | ⬜     |
| 5.5 | Agrupamento automático acima do limiar; fila de revisão na zona cinzenta | ⬜     |
| 5.6 | Decisão humana vira exemplo few-shot para as chamadas seguintes          | ⬜     |
| 5.7 | Cache por `hash_conteudo` — resolver o mesmo produto uma única vez       | ⬜     |

**Entrega:** o grafo de identidade começa a existir. Qual fornecedor é mais
barato, a que preço o mercado vende, e qual é a margem real.

---

## Fase 6 — Compatibilidade (M4) 🧠 ← o fosso

> Especificação: “Uma semana, e continua evoluindo sempre. É a funcionalidade de
> maior retorno do sistema inteiro.”

| #   | Entrega                                                                    | Estado |
| --- | -------------------------------------------------------------------------- | ------ |
| 6.1 | Coleta de evidência (manual, página oficial, concorrente, fórum, catálogo) | ⬜     |
| 6.2 | Gramáticas de nomenclatura por marca — parser determinístico e auditável   | ⬜     |
| 6.3 | Inferência de família a partir da gramática                                | ⬜     |
| 6.4 | Resolução de conflito por restrição, com inconsistência sinalizada         | ⬜     |
| 6.5 | Confiança graduada (fabricante 1.0 · 3 concorrentes 0.8 · fórum 0.4)       | ⬜     |
| 6.6 | Corte de publicação em 0.7; resto vai para fila                            | ⬜     |
| 6.7 | Saída dupla: ficha do ML e base para M16                                   | ⬜     |

**Entrega:** vender sem disputar centavo. É o que ninguém no mercado brasileiro
faz bem, e é a razão de construir em vez de assinar.

---

## Fase 7 — Fornecedores (M5) + scanner (M7)

| #   | Entrega                                                           | Estado |
| --- | ----------------------------------------------------------------- | ------ |
| 7.1 | CRM das cinco perguntas que eliminam 90% dos candidatos           | ⬜     |
| 7.2 | `vende_direto_marketplace = true` → descarte automático com aviso | ⬜     |
| 7.3 | Verificação automática desse campo por nome e CNPJ (M0)           | ⬜     |
| 7.4 | Histórico de preço por SKU e fornecedor (aumento silencioso)      | ⬜     |
| 7.5 | Score de confiabilidade alimentado por atraso real                | ⬜     |
| 7.6 | Gerador do primeiro contato com as cinco perguntas preenchidas    | ⬜     |
| 7.7 | M7: cortes numéricos configuráveis, aplicados em subcategoria     | ⬜     |

---

## Fase 8 — Anúncios (M9) + pedidos (M10) + consignação (M11)

| #    | Entrega                                                                 | Estado |
| ---- | ----------------------------------------------------------------------- | ------ |
| 8.1  | Gerador de título com códigos de modelo e termos de busca reais         | ⬜     |
| 8.2  | Descrição com tabela de compatibilidade gerada de M4                    | ⬜     |
| 8.3  | Checklist de atributos obrigatórios por categoria                       | ⬜     |
| 8.4  | Gerador de arquivo de importação em massa (caminho padrão)              | ⬜     |
| 8.5  | Alerta de catálogo do ML para conta sem reputação verde                 | ⬜     |
| 8.6  | Importação de pedidos, casamento com SKU, margem realizada              | ⬜     |
| 8.7  | Fila de postagem do dia — a tela mais usada do sistema                  | ⬜     |
| 8.8  | Etiqueta e envio ao fornecedor no dropship, com cobrança de confirmação | 🔒     |
| 8.9  | Conferência de repasse: previsto contra o que caiu                      | ⬜     |
| 8.10 | M11: consignação, alerta de conferência, fechamento por período         | ⬜     |

---

## Fase 9 — Fiscal (M12) 🧠 — **tem prazo: antes de dezembro**

| #   | Entrega                                                               | Estado |
| --- | --------------------------------------------------------------------- | ------ |
| 9.1 | Classificador de NCM/CEST com alternativas justificadas e confirmação | ⬜     |
| 9.2 | CST e cClassTrib por SKU (rejeição de NF-e em 04/01/2027)             | ⬜     |
| 9.3 | Controle de teto do MEI com projeção; avisos em 70% e 85%             | ⬜     |
| 9.4 | Painel de prazos (01/01/2027, 04/01/2027)                             | ⬜     |
| 9.5 | Integração com emissor de NF-e existente — não reescrever             | ⬜     |
| 9.6 | Alerta de categoria regulada (ANVISA em suplemento)                   | ⬜     |

**Por que tem prazo:** esse cadastro com 20 SKUs é uma tarde; com 200 no meio da
operação é uma semana perdida em janeiro.

---

## Fase 10 — Prospector de mercado (M6) 🧠

> Especificação: “Uma a duas semanas. O módulo mais ambicioso e o mais divertido
> — e por isso mesmo vem depois.”

| #    | Entrega                                                                    | Estado |
| ---- | -------------------------------------------------------------------------- | ------ |
| 10.1 | Loop de fronteira: hipóteses, fronteira, achados                           | ⬜     |
| 10.2 | Seleção por valor esperado por custo                                       | ⬜     |
| 10.3 | Famílias de hipótese (fabricante, distribuidor, custo, compatibilidade, …) | ⬜     |
| 10.4 | Sensor de demanda pública via PNCP                                         | ⬜     |
| 10.5 | **Orçamento obrigatório por execução** (passos e reais)                    | ⬜     |
| 10.6 | Critério de parada por saturação                                           | ⬜     |
| 10.7 | Dossiê auditável, com URL de origem em cada item                           | ⬜     |
| 10.8 | Dossiê parcial salvo quando o orçamento estoura                            | ⬜     |

---

## Fase 11 — Monitor (M15) + pós-venda (M16) + afiliados (M13)

| #    | Entrega                                                             | Estado |
| ---- | ------------------------------------------------------------------- | ------ |
| 11.1 | Monitor com leitura, hipótese, recomendação e severidade            | ⬜     |
| 11.2 | Agrupamento de eventos relacionados antes de avisar                 | ⬜     |
| 11.3 | M16: resposta a pergunta de comprador a partir de M4, como rascunho | ⬜     |
| 11.4 | M16: detector de pergunta recorrente                                | ⬜     |
| 11.5 | M13: detector de queda real de preço contra mediana de 90 dias      | ⬜     |
| 11.6 | M13: link de afiliado, fila de publicação espaçada, rastreio        | ⬜     |

---

## Fase 12 — Adaptadores de Shopee e Amazon por API

Só quando o volume em cada uma justificar a burocracia de aprovação. Até lá, M0
e M1 cobrem, e isso é suficiente para o painel ser útil.

---

## Fora de escopo, permanentemente

Da seção 10 da especificação, e não se reabre sem decisão explícita:

- **M4 como modo de acesso** (extensão de navegador sob login). Ganho marginal
  sobre exportação de planilha; risco é suspensão da conta, que é o ativo.
- **Multi-tenant.** Isolamento de dados, convite, papéis, cobrança, onboarding.
  Multi-perfil sim (uma coluna e um filtro); multi-tenant não (semanas, e não
  vende nada hoje).
- **API pública.**
- **App mobile nativo** (o PWA da fase 4 resolve).
- **Tema claro/escuro customizável.**
- **Emissor de NF-e próprio.** Integrar.
- **ERP, loja virtual, gerador de conteúdo.**
