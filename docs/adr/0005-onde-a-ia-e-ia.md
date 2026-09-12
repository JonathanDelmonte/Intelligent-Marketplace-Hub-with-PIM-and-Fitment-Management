# ADR 0005 — Fronteira entre LLM e código determinístico

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seção 5

## Contexto

O pedido central do projeto é um sistema que "realmente atue como inteligência
artificial e não como automatização". O risco simétrico é gastar token em
problema que um `if` resolve — o que não é só desperdício, é **uma fonte de erro
onde não precisaria haver nenhuma**, e um resultado não auditável onde havia um
determinístico.

Ser explícito sobre essa fronteira é mais útil que ser generoso com ela.

## Decisão

**Regra de ouro.** LLM entra onde a entrada é texto livre heterogêneo, ou onde a
decisão exige julgamento sobre evidência incompleta. Onde a entrada é estruturada
e a regra é conhecida, LLM é desperdício.

**É IA — não tem solução determinística:**

| Onde                                                              | Por que                                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| M1 — extração de página e PDF de layout imprevisível              | catálogo de distribuidor não tem estrutura; print de planilha no WhatsApp menos ainda                      |
| M3 — resolução de identidade entre fontes                         | não há identificador comum; metade não tem EAN; título é poluído com SEO; código de distribuidor é interno |
| M4 — conciliação de compatibilidade entre fontes que discordam    | exige pesar evidência, não comparar strings                                                                |
| M6 — decidir o que investigar a seguir e quando parar             | valor esperado sobre informação incompleta                                                                 |
| M12 — classificação fiscal a partir de descrição livre            | NCM a partir de texto livre                                                                                |
| M15 — ler padrão em série temporal e dizer o que está acontecendo | a leitura é hipótese causal, não variação percentual                                                       |

**É automação — código determinístico, barato e auditável:**

cálculo de taxa e margem · cortes numéricos do M7 · parsing de nomenclatura de
modelo por gramática de fabricante · importação de planilha com mapeamento fixo ·
série histórica e detecção de variação · geração de arquivo de importação · fila
de postagem.

O caso do **parsing de nomenclatura** merece nota: `PA21G`, `PA26G`, `PE11B`
seguem gramática de fabricante. É tentador jogar num LLM. Não: gramática por
marca é determinística, auditável, e permite **inferir famílias** em vez de
cadastrar item por item. LLM aqui seria pior e mais caro.

**Disciplina de custo, que é parte da decisão e não um detalhe:**

1. Toda chamada de LLM registra entrada, saída, custo, modelo e latência em
   `llm_call`. Sem isso não se sabe onde o dinheiro foi.
2. Todo resultado é persistido **com a entrada que o gerou**, e cacheado por
   `hash_conteudo`. Resolver a identidade de um produto é caro e se faz **uma
   vez**. Re-resolver o mesmo produto a cada varredura é o jeito mais rápido de
   transformar um projeto barato em conta alta.
3. Toda saída é validada por schema Zod. Schema que falha vira
   `pendente_revisao`, nunca descarte e nunca gravação de lixo.
4. Agente de M6 **não roda sem orçamento por execução** (passos e reais). Isso é
   verificado no construtor, não por convenção.
5. Onde o erro é caro — classificação fiscal, compatibilidade, preço — LLM
   **sugere** e humano **confirma**. Sempre, até haver histórico que justifique
   liberar, e a liberação é por faixa de confiança, não por cansaço.

## Consequências

**A favor.** O gasto de LLM fica proporcional ao conhecimento novo adquirido, não
ao número de execuções. O teto saudável de R$ 100/mês é alcançável e verificável:
se estourar, ou a operação está pagando, ou algo está rodando sem cache — e o
`llm_call` diz qual dos dois.

**Contra.** Duas implementações para manter em M1 (seletor por plataforma e
fallback de LLM). Aceito: o seletor é barato e exato quando funciona, e o LLM é a
rede de segurança quando a plataforma muda o HTML.
