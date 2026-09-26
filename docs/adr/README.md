# Registros de decisão de arquitetura (ADR)

Uma decisão por arquivo, numerada e imutável. Decisão que muda não é editada:
entra um ADR novo que a substitui, e o antigo passa a `Substituído por`. O
histórico da decisão vale mais que a limpeza do diretório.

| #                                               | Decisão                                                     | Estado                                           |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| [0001](./0001-capacidades-nao-plataformas.md)   | Modelar por capacidade, não por plataforma                  | Aceito                                           |
| [0002](./0002-toda-fonte-e-opcional.md)         | Toda fonte de dados é opcional e substituível               | Aceito                                           |
| [0003](./0003-multi-perfil-nao-multi-tenant.md) | Multi-perfil sim, multi-tenant não                          | Aceito                                           |
| [0004](./0004-dinheiro-em-centavos-inteiros.md) | Dinheiro em centavos inteiros                               | Aceito                                           |
| [0005](./0005-onde-a-ia-e-ia.md)                | Fronteira entre LLM e código determinístico                 | Aceito                                           |
| [0006](./0006-stack.md)                         | Next.js, Postgres com pgvector, Drizzle, fila em tabela     | Aceito                                           |
| [0007](./0007-credenciais-em-tabela-cifrada.md) | Credenciais em tabela cifrada, não em `.env`                | Aceito                                           |
| [0008](./0008-modo-m4-fora-de-escopo.md)        | Extensão de navegador sob login fora de escopo              | Aceito                                           |
| [0009](./0009-navegacao-por-loja.md)            | Navegação por loja; o que serve a todas aparece uma vez     | Aceito                                           |
| [0010](./0010-hospedagem-gratuita.md)           | Um servidor gratuito; cada push no ar                       | Substituído pelo 0013, menos a regra de migração |
| [0011](./0011-contas-de-acesso.md)              | Conta com senha; cadastro fechado por código                | Aceito; em parte substituído pelo 0015           |
| [0012](./0012-conta-oracle-sem-upgrade.md)      | Conta da Oracle gratuita; servidor que não parece ocioso    | Substituído pelo 0013                            |
| [0013](./0013-hospedagem-gratuita-em-pecas.md)  | Hospedagem gratuita em peças: Render, Supabase, UptimeRobot | Aceito                                           |
| [0014](./0014-primeira-conta-sem-codigo.md)     | Sem código de cadastro, a primeira conta entra direto       | Em parte substituído pelo 0015                   |
| [0015](./0015-cadastro-aberto-sem-codigo.md)    | Sem código de cadastro, o cadastro fica aberto              | Aceito                                           |
