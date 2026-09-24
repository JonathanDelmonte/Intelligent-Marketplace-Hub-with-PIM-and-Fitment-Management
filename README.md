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
| [Pendências](./docs/pendencias.md)                    | tudo que falta, agrupado por quem destrava           |
| [Matriz de capacidades](./docs/matriz-capacidades.md) | o que cada plataforma responde de verdade            |
| [CLAUDE.md](./CLAUDE.md)                              | convenções obrigatórias para quem mexe no código     |

## Stack

Next.js (App Router) · TypeScript strict · Postgres com `pgvector` · Drizzle ·
Zod · Vitest · Playwright para extração · fila em tabela.

Nada exótico, e a razão está no [ADR 0006](./docs/adr/0006-stack.md): tempo gasto
aprendendo ferramenta é tempo não gasto construindo o fosso de compatibilidade,
que é a única parte insubstituível do sistema.

## Começar

### No Windows, com um clique

Clique duas vezes em **`Atalhos/Iniciar.bat`**. Ele confere o Node, cria o `.env` se não
existir, sobe o banco do Docker se o `.env` apontar para o banco local, instala as
dependências quando elas mudaram, aplica as migrações, monta a versão de uso quando o
código mudou, sobe o servidor e a fila, e abre `http://localhost:3000` quando o servidor
responde.

- **Antes do primeiro clique:** o [Node.js](https://nodejs.org) (versão LTS). E um banco:
  o Docker Desktop instalado **ou** a URL do banco na nuvem (Neon). Sem Docker, deixe o
  primeiro clique criar o `.env`, troque nele a linha `DATABASE_URL` pela URL do Neon e
  clique de novo — o `.env` não vem no clone, porque guarda senha.
- **IA, opcional:** a chave do OpenRouter vai na linha `LLM_API_KEY` do `.env`. O sistema lê
  o `.env` ao subir, então feche a janela e clique de novo depois de colar. Sem chave nada
  quebra: o que depende de IA diz "ninguém sugeriu".
- **Primeira vez:** alguns minutos. **Depois:** cerca de três segundos.
- **Clicar de novo com tudo rodando** só abre o navegador.
- **Fechar a janela preta** desliga o servidor e a fila juntos.
- **A janela sempre espera uma tecla no fim**, e nunca fecha sozinha. Se algo der errado,
  a mensagem fica na tela — e tudo o que apareceu nela fica também em
  `Atalhos/iniciar.log`, refeito a cada clique. É o arquivo para mandar a quem mantém o
  sistema. A URL do banco nunca entra nele, só host e porta.
- **Só neste computador:** o servidor escuta em `127.0.0.1`. Celular e outros aparelhos
  da rede não alcançam o sistema, de propósito, porque ainda não há login (pendência 3.3).
- **Porta ocupada:** se outro programa estiver na 3000, o sistema sobe na próxima livre
  (3001, 3002…) e a janela diz qual. Quem roda vários projetos pode fixar uma porta só
  deste com `PORT=3100` no `.env`: o navegador guarda dados por endereço, e porta fixa é
  endereço fixo.
- **Depois de um `git pull`:** só clicar. Migração, dependência e montagem se resolvem
  sozinhas — não é mais preciso lembrar do `db:migrate`.

Para ter na área de trabalho: botão direito no `Iniciar.bat` → *Enviar para* → *Área de
trabalho (criar atalho)*. Copiar o próprio `.bat` para a área de trabalho não funciona: ele
acha o projeto pela pasta onde está. Fora do Windows, o mesmo lançador é
`node scripts/iniciar.mjs`.

A lógica mora em `scripts/iniciar.mjs`, e o porquê de cada decisão está no cabeçalho dele.

### Passo a passo, sem o atalho

Requisitos: Node 22.9+ e Postgres 16+ **com `pgvector`** (o projeto roda em 18).

A extensão é o único requisito que dá trabalho — no Windows ela não vem no
instalador oficial do Postgres. Por isso há um `compose.yaml` com a **mesma imagem
e as mesmas credenciais do CI**, que é a forma de o banco local não divergir do
banco onde os testes rodam:

```sh
docker compose up -d           # Postgres 18 + pgvector, na porta 5432
```

Se você já tem um Postgres ocupando a 5432, troque para `5433:5432` no
`compose.yaml` e ajuste a porta no `.env`.

```sh
npm install

# Cria o `.env` com a chave mestra já gerada. Passe a URL do banco se já tiver.
npm run preparar:env -- --database-url="postgresql://usuario:senha@host/banco?sslmode=require"

npm run db:migrate             # cria as extensões e aplica as migrations
npm run db:seed                # cria o primeiro perfil de vendedor
npm run dev                    # http://localhost:3000
```

O `preparar:env` existe porque a sequência manual tinha quatro passos e três formas de
errar — e a que mais acontece é **editar o `.env.example` em vez do `.env`**. É fácil:
o `.env` não existe até alguém criá-lo (é ignorado pelo git, então não vem no clone),
e o editor mostra o exemplo primeiro. O sintoma é `.env not found. Continuing without
it.` seguido de `DATABASE_URL: received undefined`, com a URL certa salva no arquivo
errado.

O script gera a chave mestra (32 bytes em base64), remove `channel_binding` da URL se
vier, e **nunca sobrescreve um `.env` existente**.

### Banco gerenciado, e uma armadilha da string de conexão

O projeto não tem SDK de provedor — só `postgres.js` e Drizzle —, então qualquer
Postgres com `pgvector` serve, e trocar de provedor é **uma linha no `.env`**.

Se a string vier de um painel de banco gerenciado, duas coisas:

- **Remova `channel_binding=require`**, se houver. O `postgres.js` repassa
  parâmetro desconhecido da URL ao servidor como parâmetro de conexão, e o
  Postgres derruba com `unrecognized configuration parameter "channel_binding"`.
  Medido, não suposto. Mantenha só `?sslmode=require`.
- **Use a URL direta, não a de pool.** O `postgres.js` já mantém pool próprio com
  *prepared statements*, e o endpoint de pool desses provedores é PgBouncer em modo
  transação, onde *prepared statement* não sobrevive. A URL "pooled" serve para
  serverless, que não é o caso aqui.

E **substitua** a linha `DATABASE_URL` que já existe no `.env` — não acrescente uma
segunda no fim. Duas linhas com a mesma chave funcionam (a última vence), mas deixam
uma configuração morta no arquivo, que é exatamente o tipo de coisa que engana na
hora de depurar.

### Ver o sistema funcionando em dois minutos

Há uma exportação de exemplo em
[`docs/exemplos/`](./docs/exemplos/anuncios-mercadolivre-exemplo.csv), no formato
de um relatório do Mercado Livre — com linha de título, separador `;` e preço em
vírgula, como vem de verdade.

1. Abra **`/importar`** e suba esse arquivo no campo único.
2. Clique em **"Processar agora"** (ou deixe `npm run poller` rodando em outro
   terminal). São **3 anúncios**, nenhuma linha recusada.
3. Abra **`/juntar-iguais`**. Duas das três ocorrências compartilham o mesmo EAN, e o
   sistema **já as ligou sozinho** — aparecem como "decidido pelo sistema", com
   evidência `código de barras` e 100% de confiança. Ninguém clicou em nada.
4. Na mesma tela, em **"Juntados pelo sistema, esperando um nome"**, clique em
   **"Criar produto com as duas"** — o nome vem preenchido e é editável. Essa é a
   única parte manual da cadeia, e é onde deve ser: um produto existe por decisão
   sua.
5. Abra **`/compatibilidade`** e cadastre dois aparelhos, tipo
   `purificador de água`, marca `Electrolux`, modelos `PA21G` e `PA21X`. Clique em
   **"Procurar nos anúncios já capturados"**.

   O que aparece é a regra do sistema funcionando, e vale ler com atenção: a
   linha do PA21G fica em **0%, "ninguém confirmou"**, com a evidência
   `anúncio seu, a confirmar`. A planilha de exemplo é a **sua própria**
   exportação, e o sistema não deixa o seu anúncio confirmar a sua própria ficha —
   é assim que erro de cadastro ficaria permanente, virando evidência de si mesmo.

   Clique em **"Serve"** nessa linha. Ela vai a 100% e entra na ficha; e o
   `PA21X` aparece na hora **deduzido como modelo irmão, a 60%** — abaixo do corte
   de 70%, esperando a sua confirmação, porque hipótese não publica.
6. Abra **`/leitor`**, informe um custo (por exemplo `30`) e digite o código
   `7896541200909`. O veredito sai com o preço praticado que a planilha trouxe,
   margem, markup e até quanto dá para pagar.
7. Abra **`/anuncios`**, escolha o produto, preço `89,90`, quantidade `10`, e
   descreva o tipo como o comprador diria — `refil de purificador de água`. Clique
   em **"Montar"**.

   Sai o título com o código do aparelho na frente (`Refil de purificador de água
   PA21G`), a descrição com a tabela de onde serve montada da ficha da etapa 5, e o
   checklist dizendo o que falta **com o custo de cada falta**. O download fica
   bloqueado enquanto faltar categoria, porque a importação recusaria a linha —
   preencha `MLB1234` no campo que aparece ao lado do item e o link surge, junto com
   a instrução de onde subir o arquivo naquela plataforma.

Os passos 3 e 5 são as fases 5 e 6 em duas telas: a ingestão enfileirou a
resolução, o poller consumiu, o grafo de identidade cresceu sem ninguém pedir, e a
ficha de compatibilidade se montou a partir dos títulos que já estavam no banco —
com o corte de publicação e a regra de autoconfirmação à vista, em vez de
escondidos.

O passo 7 é onde isso paga: o mesmo `PA21G` que você confirmou na etapa 5 vira termo
de busca no título e linha na tabela de compatibilidade da descrição, e o `PA21X`,
que ficou abaixo do corte, **não entra em nenhum dos dois**. Nada disso exigiu
plataforma conectada — o arquivo de importação é o caminho padrão, não o plano B.

### Testes: o banco da suíte é outro, e isso não é preferência

A suíte faz `truncate` nas tabelas a cada teste. Então ela lê **`DATABASE_URL_TESTE`**,
nunca `DATABASE_URL` — e recusa rodar se as duas apontarem para o mesmo banco.

Sem a variável, os testes de banco são **pulados, não falsificados**, e o resumo diz
quantos:

```sh
npm run check                  # sem DATABASE_URL_TESTE: 888 passam, 222 pulam
```

Para rodá-los, aponte para um banco descartável:

```sh
createdb bancada_teste                      # Postgres local
# ou, em banco gerenciado, uma branch do projeto:
#   neon branches create teste

# Se você já tem `.env`, isto acrescenta SÓ essa linha e não toca em mais nada:
npm run preparar:env -- --database-url-teste="postgres://.../bancada_teste"

DATABASE_URL="$DATABASE_URL_TESTE" npm run db:migrate   # o banco novo precisa do schema
```

O sistema roda sozinho quando há um processo consumindo a fila:

```sh
npm run poller           # laço contínuo, até Ctrl-C
npm run poller:uma-vez   # drena a fila e sai — serve para cron
npm run poller -- --ajuda
```

A tela de `/importar` funciona **sem** poller: tem um botão que processa alguns jobs
na hora, e uma tela de detalhe por job com cada linha de planilha recusada e o
motivo.

O poller consome **três** filas, nesta ordem de prioridade: ingestão, resolução de
identidade e coleta de compatibilidade. Então importar uma planilha faz o grafo de
identidade crescer sozinho — ocorrências do mesmo GTIN entram ligadas — e, depois que
um SKU existe, cada ocorrência nova ligada a ele também vira linha de ficha de
compatibilidade, sem ninguém abrir tela.

O leitor de código de barras fica em `/leitor` e dá para instalar na tela inicial
do celular. Informe o custo, leia o código, e o veredito sai com preço praticado,
margem, markup e até quanto dá para pagar. Funciona sem rede: a leitura fica no
aparelho e sobe quando a conexão volta.

A revisão de identidade fica em `/juntar-iguais`. O sistema liga sozinho as ocorrências
que consegue provar que são o mesmo produto — mesmo GTIN, ou mesma marca com o mesmo
código de peça — e manda para essa fila o que exige julgamento, com os dois lados no
mesmo formato e a evidência à vista. Dois cliques por par, e cada decisão vira exemplo
para os julgamentos seguintes. Quando um dos lados já é um SKU, dizer "é o mesmo" junta
os preços de todas as fontes ali na hora.

A compatibilidade fica em `/compatibilidade` — "em que aparelhos a peça serve". Cada
afirmação vem com a fonte, e só entra na ficha do anúncio o que tem 70% ou mais de
evidência e nenhuma fonte discordando: afirmação do fabricante vale 1,0, três
concorrentes concordando 0,8, um fórum 0,4. O sistema lê o título dos anúncios que
você já importou, casa com os aparelhos cadastrados, e deduz os modelos irmãos pela
gramática de nomenclatura da marca — `PA21G` e `PA21X` são o mesmo aparelho em outra
cor. Dedução nunca publica sozinha: ela enche a fila de conferência, e um clique seu
resolve cada linha.

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
6. **Compatibilidade** — o fosso: responder "serve no meu modelo?" com prova
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
