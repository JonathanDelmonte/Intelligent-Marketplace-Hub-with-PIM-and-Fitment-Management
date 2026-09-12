# ADR 0006 — Next.js, Postgres com pgvector, Drizzle, fila em tabela

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seção 7

## Contexto

Um desenvolvedor, noites e fins de semana, teto de custo de R$ 100/mês. O critério
de escolha não é "o melhor que existe": é **o que já se domina**, porque tempo
gasto aprendendo ferramenta é tempo não gasto construindo o fosso de
compatibilidade, que é a única parte insubstituível do sistema.

## Decisão

| Camada          | Escolha                                                          | Por quê                                                                                            |
| --------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App             | **Next.js App Router + TypeScript strict**                       | uma aplicação, não microserviços. Server Components deixam a maior parte do domínio fora do bundle |
| Banco           | **Postgres 16 + pgvector**                                       | o `pgvector` é obrigatório para M3 e é o que decide Postgres em vez de SQLite                      |
| ORM             | **Drizzle**                                                      | schema em TypeScript, migrations geradas e versionadas, SQL cru quando precisa. Sem runtime pesado |
| Fila            | **tabela `job` com polling**                                     | um processo, retomável, inspecionável com `SELECT`. BullMQ só se o volume exigir                   |
| Extração        | **Playwright** para página com JS, `fetch` + parser para o resto | cache agressivo de HTML por URL e hash — é performance e é defesa contra bloqueio                  |
| LLM             | saída estruturada validada por **Zod**, registrada em `llm_call` | ver ADR 0005                                                                                       |
| PWA             | `BarcodeDetector` onde existe, **`zxing-wasm`** como fallback    | sem app nativo                                                                                     |
| Auth            | login simples, um usuário                                        | mas **toda query operacional filtra por `perfil_id` desde a primeira linha** (ADR 0003)            |
| Observabilidade | log estruturado + tela dos últimos 100 jobs com erro visível     | sistema de ingestão sem isso é inauditável em uma semana                                           |

**Princípio de robustez, que vale para todo job:** idempotente e retomável.
Extração que falha não perde o que já extraiu. Agente que estoura orçamento salva
o dossiê parcial. Job carrega chave de idempotência e é seguro reexecutar.

## Alternativas descartadas

- **SQLite.** Simples e suficiente para tudo, menos para `pgvector`. Como M3 é o
  primeiro ativo defensável do sistema, o embedding não é opcional.
- **BullMQ desde o início.** Acrescenta Redis para resolver um problema de volume
  que ainda não existe. A tabela `job` é trocável por BullMQ sem tocar no domínio,
  porque o domínio só conhece a interface `Fila`.
- **Microserviços.** Um desenvolvedor, um deploy.
- **Prisma.** Bom, mas o engine binário e o custo de cold start em serverless
  pesam mais que o ganho sobre o Drizzle neste tamanho.

## Consequências

**A favor.** Deploy em plano free de Vercel/Railway, Postgres gerenciado em plano
free no início, e nenhuma peça exótica para operar.

**Contra.** Postgres gerenciado com `pgvector` limita a escolha de provedor no
plano free. Aceito.
