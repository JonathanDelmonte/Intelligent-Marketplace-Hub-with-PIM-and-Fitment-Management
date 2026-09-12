# Bancada

Hub de operação e inteligência para venda em marketplaces — Mercado Livre, Shopee
e Amazon. Catálogo, fornecedores, compatibilidade, precificação e garimpo de
oportunidade num painel único.

Construído pela **Zirtuno**.

> **Sobre o nome.** "Bancada" é codinome de projeto, não marca. Nenhuma string de
> marca entra no código: nome do sistema, logo, cores, nome do vendedor, CNPJ,
> regime fiscal e credenciais vêm de configuração e de banco. Trocar o nome é
> editar `.env`. Ver [ADR 0003](./docs/adr/0003-multi-perfil-nao-multi-tenant.md).

---

## O que o sistema é

Duas metades, com valores bem diferentes:

- **Metade operacional** — o que eu tenho, por quanto vendo, quanto sobra, o que
  saiu, o que falta. Dados da própria conta. É higiene.
- **Metade de inteligência** — o que eu deveria vender, de quem eu compro, em que
  serve, e a que preço. Dados do mundo. É a que tem valor defensável.

Pela categoria de software, é quatro coisas ao mesmo tempo: hub de integração de
marketplace, ferramenta de inteligência de mercado, **PIM com _fitment
management_**, e repricer. As três primeiras têm concorrente maduro no Brasil; o
_fitment_ não tem ninguém fazendo bem — e é por isso que vale construir em vez de
assinar.

**O que não é:** ERP, loja virtual, gerador de conteúdo. Função que já existe bem
feita e barata em ferramenta de prateleira (emissão de NF-e, por exemplo) é
integrada, não reescrita.

## O ativo

Dois grafos que nenhum dinheiro compra e que crescem a cada link colado:

1. **Grafo de identidade** — o mesmo produto em todos os lugares onde ele aparece,
   com o preço de cada um. Dá margem.
2. **Grafo de compatibilidade** — em que aparelho cada peça serve, com evidência.
   Tira da guerra de preço.

## Como a arquitetura se defende

O sistema é organizado por **capacidade**, não por plataforma, e **toda fonte de
dados é opcional**. Funciona inteiro com zero credencial: colando link e
importando planilha. Conexão por API é atalho, nunca requisito.

Isso não é conveniência. O endpoint `GET /sites/MLB/search` do Mercado Livre
retorna **403 Forbidden** para desenvolvedores com token válido desde dezembro de
2025, sem critério de liberação publicado. Um sistema que dependesse dele já
estaria morto. Ver [ADR 0001](./docs/adr/0001-capacidades-nao-plataformas.md),
[ADR 0002](./docs/adr/0002-toda-fonte-e-opcional.md) e a
[matriz de capacidades](./docs/matriz-capacidades.md).

## Documentação

| Documento                                             | O que tem                                            |
| ----------------------------------------------------- | ---------------------------------------------------- |
| [Especificação](./docs/especificacao.md)              | escopo completo, 16 módulos, modelo de dados, riscos |
| [Roadmap](./docs/roadmap.md)                          | fases por utilidade, com estado de cada entrega      |
| [ADRs](./docs/adr/)                                   | as decisões de arquitetura e o porquê de cada uma    |
| [Diário de bordo](./docs/diario-de-bordo.md)          | bugs, armadilhas e decisões pequenas, em ordem       |
| [Matriz de capacidades](./docs/matriz-capacidades.md) | o que cada plataforma responde de verdade            |
| [CLAUDE.md](./CLAUDE.md)                              | convenções obrigatórias para quem mexe no código     |

## Stack

Next.js (App Router) · TypeScript strict · Postgres com `pgvector` · Drizzle ·
Zod · Vitest · Playwright para extração · fila em tabela.

Nada exótico, e a razão está no [ADR 0006](./docs/adr/0006-stack.md): tempo gasto
aprendendo ferramenta é tempo não gasto construindo o fosso de compatibilidade,
que é a única parte insubstituível do sistema.

## Começar

Requisitos: Node 22+, Postgres 16+ com `pgvector`.

```sh
npm install
cp .env.example .env

# Gerar a chave mestra de cifragem de credencial (ADR 0007)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# → colar em CREDENCIAL_CHAVE_MESTRA no .env

npm run db:migrate
npm run db:seed        # cria o primeiro perfil de vendedor
npm run dev            # a tela de jobs fica em /jobs
```

O sistema roda sozinho quando há um processo consumindo a fila:

```sh
npm run poller           # laço contínuo, até Ctrl-C
npm run poller:uma-vez   # drena a fila e sai — serve para cron
npm run poller -- --ajuda
```

A tela de `/jobs` funciona **sem** poller: tem um botão que processa alguns jobs
na hora, e uma tela de detalhe por job com cada linha de planilha recusada e o
motivo.

Para rodar como **serviço** (contêiner, systemd), chamar node direto:

```sh
node --import tsx scripts/poller.ts
```

Não é preciosismo: `npm run` não repassa `SIGTERM` ao processo filho, então um
supervisor que sinaliza o pid do npm deixa o poller órfão e o encerramento limpo
nunca acontece. `Ctrl-C` no terminal funciona normalmente com `npm run`, porque
aí o sinal vai para o grupo de processos inteiro. Medições no diário de bordo.

Verificar tudo antes de commitar:

```sh
npm run check          # fontes + typecheck + lint + formatação + testes
```

## Ordem de construção

A ordem é por **utilidade, não por arquitetura** — cada fase serve sozinha no dia
em que fica pronta:

1. **Calculadora de margem** — nunca mais publicar anúncio com margem negativa
2. **Teste de capacidades + perfil** — saber o que é possível em vez de supor
3. **Ingestão universal + catálogo** — o sistema começa a acumular base
4. **Leitor de código de barras** — a primeira função que gera dinheiro
5. **Resolução de identidade** — o grafo começa a existir
6. **Compatibilidade** — o fosso
7. …

A armadilha que essa ordem evita: construir o prospector e o painel bonito
primeiro, e a venda depois. O risco real do projeto não é o sistema ficar ruim; é
ficar pronto sem nada vendido. Estado de cada fase no
[roadmap](./docs/roadmap.md).

## Fora de escopo, permanentemente

Extensão de navegador sob login (risco de suspensão da conta, que é o ativo — ver
[ADR 0008](./docs/adr/0008-modo-m4-fora-de-escopo.md)) · multi-tenant · API
pública · app mobile nativo · tema customizável · emissor de NF-e próprio.

---

© 2026 Zirtuno
