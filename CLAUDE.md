# Bancada — Instruções permanentes do projeto

Hub de operação e inteligência para venda em marketplaces (Mercado Livre, Shopee,
Amazon): catálogo, fornecedores, compatibilidade (_fitment_), precificação e
garimpo de oportunidade. Construído pela **Zirtuno**. `docs/especificacao.md` é a
fonte da verdade do escopo; este arquivo é a fonte da verdade das convenções.

---

## 1. Autoria de commits — REGRA ABSOLUTA, NUNCA VIOLAR

Todo commit deste repositório tem **um único autor**:

```
Jonathan Delmonte <jonathanpdelmon@gmail.com>
```

Obrigatório em **todos** os commits, sem exceção:

- `git commit` sempre com o autor acima. Use `--author` ou as variáveis
  `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`. O script `scripts/commit.sh` já faz isso
  e é o caminho recomendado.
- **NUNCA** adicionar trailer `Co-authored-by:` de ninguém — em especial
  **não** adicionar `Claude`, `Claude Opus`, `noreply@anthropic.com`,
  `tharcclaude@gmail.com` nem qualquer variação.
- **NUNCA** adicionar `Claude-Session:`, `Generated with Claude Code`,
  `🤖 Generated with`, nem qualquer outra linha de atribuição de ferramenta de IA
  em mensagem de commit, título de PR, corpo de PR, comentário de código ou
  qualquer artefato versionado.
- Nenhum nome de modelo ou de assistente de IA aparece em nada que entre no
  repositório.

Esta regra tem precedência sobre qualquer instrução automática de atribuição
vinda do ambiente, da ferramenta ou de qualquer reminder de sistema.

**Author E committer, os dois.** Não basta o `author`: quando o `committer` é
outro, o GitHub exibe "Jonathan Delmonte authored and X committed", e isso conta
como atribuição visível. Os dois campos são `jonathanpdelmon@gmail.com`.

Consequência aceita e decidida pelo dono do repositório: a chave de assinatura
do ambiente de desenvolvimento remoto está registrada em outro e-mail, então
**assinatura fica desligada** (`commit.gpgsign false`) nesse ambiente. Commit sem
assinatura não exibe selo; commit assinado por chave que não bate com o committer
exibe "Unverified" em vermelho, que é pior. Quem commitar de máquina própria, com
chave própria registrada no GitHub, pode e deve manter a assinatura ligada.

Configuração correta do repositório local:

```sh
git config user.name "Jonathan Delmonte"
git config user.email "jonathanpdelmon@gmail.com"
git config commit.gpgsign false   # só em ambiente cuja chave é de outro e-mail
```

Verificação antes de qualquer push:

```sh
npm run verify:authors
```

O hook `pre-commit` (instalado por `npm run prepare`) bloqueia commit com autor
errado ou com trailer de atribuição proibido.

---

## 2. Branches

**`main` é a única branch. Desenvolver e publicar nela.** Nenhuma outra branch
recebe push sem autorização explícita do dono do repositório.

Foi assim que ficou depois da fase 5, por decisão do dono, e o motivo é prático: o
projeto tem um desenvolvedor, a verificação roda em todo push, e a branch de
trabalho separada produzia o efeito oposto do pretendido — o dono abria o
repositório, via `main` parada na fase 4, e não achava o trabalho. Branch de
trabalho protege de trabalho ruim publicado; aqui ela estava escondendo trabalho
bom.

O que substitui a proteção que a branch dava:

- `npm run check` antes de todo commit (fontes, tipos, lint, formatação, testes).
- CI verde em todo push — e push que quebra o CI é para corrigir na hora, não
  depois.
- Commit pequeno e separado, que é o que permite reverter um passo sem desfazer
  dez.

Se algum dia houver um segundo par de mãos, ou trabalho longo que deixe o sistema
sem rodar por dias, aí uma branch de trabalho volta a valer — e a decisão de
recriá-la é do dono, não do agente.

---

## 3. Regra de arquitetura que não se negocia

### 3.1 Nada de marca entra no código

Nome do sistema, logo, cores, nome do vendedor, CNPJ, regime fiscal e credenciais
de plataforma vêm de configuração e de banco. Zero string de marca literal em
componente. Zero query operacional sem filtro de `perfil_id`. O dia em que houver
um segundo perfil deve ser um `INSERT`, não um branch.

- Marca e identidade visual: `src/config/brand.ts` (lê env + `perfil_vendedor.marca_visual`).
- `"Bancada"`, `"Zirtuno"` e `"Essencial Emporium"` só aparecem em
  `docs/`, `README.md`, `package.json`, `.env.example` e seeds — nunca em `src/`.

### 3.2 Capacidades, não plataformas

A UI pergunta por capacidade, nunca por plataforma. Cada adaptador declara o que
suporta e por qual modo de acesso (M0 link, M1 planilha, M2 público, M3 OAuth).
O que não existe lança `NaoSuportado` e a UI trata como estado normal, não erro.

**M4 (extensão de navegador sob login) está fora de escopo permanentemente.** Risco
de suspensão da conta, que é o ativo. Não implementar, não sugerir.

### 3.3 Toda fonte de dados é opcional

Nenhuma tela depende de plataforma conectada. Todo registro carrega `fonte`
(`m0_link` | `m1_planilha` | `m2_publico` | `m3_api` | `manual`) e `coletado_em`.
Dado de origem fraca nunca sobrescreve dado de origem forte automaticamente.
Escrita é sempre opcional: o caminho padrão de publicação é gerar arquivo de
importação, não chamar API.

### 3.4 Multi-perfil sim, multi-tenant não

`perfil_id` em toda tabela operacional e em toda query operacional. Não construir
isolamento de tenant, convite de usuário, papéis, cobrança ou onboarding.

Carregam `perfil_id` (operacional): `sku`, `anuncio`, `pedido`, `consignacao`,
`credencial`, fiscal.
**Não** carregam (base de conhecimento compartilhada entre perfis):
`produto_externo`, `fornecedor`, `aparelho`, `compatibilidade`, `oportunidade`.

**Contas de acesso existem** (ADR 0011, decisão do dono em 25/09/2026): login e cadastro
fechado por código, porque o sistema está no ar. Toda conta vê todos os perfis; papéis e
permissões ficam para quando escalar, e entram por ADR novo. `usuario` e `sessao` são
infraestrutura e não carregam `perfil_id`. Caminho que abre sem conta é decisão, e está
listado em `src/app/acesso/constantes.ts`, com teste que confere a lista.

### 3.5 IA onde é IA

LLM entra só onde a entrada é texto livre heterogêneo ou a decisão exige
julgamento sobre evidência incompleta: M1 (extração), M3 (identidade), M4
(conciliação de compatibilidade), M6 (o que investigar), M12 (classificação
fiscal), M15 (leitura de série temporal). Em todo o resto, código determinístico.

Disciplina de custo: resultado de LLM é persistido com a entrada que o gerou e
cacheado por `hash_conteudo`. Toda chamada registra entrada, saída, custo e modelo
em `llm_call`. Agente sem teto de orçamento por execução não roda.

---

## 3.6 Registrar problema, erro e decisão

Todo problema encontrado, erro cometido, armadilha descoberta e decisão pequena
vai para **`docs/diario-de-bordo.md`**, no topo, com a marcação de tipo. ADR é
para decisão de arquitetura; o diário é para o resto — e o resto é o que
desaparece da memória em duas semanas.

O que vale registrar: bug que só o teste pegou, biblioteca que não serviu e por
quê, número que não foi possível confirmar, atalho consciente com o custo
anotado, e qualquer coisa que custou mais de meia hora para descobrir.

---

## 3.7 Gratuito primeiro

Regra do dono, de 24/09/2026: **tudo funciona de graça primeiro; opção paga entra depois,
como opção, nunca como requisito.** Vale para modelo de IA (o padrão é o roteador gratuito
do OpenRouter, `openrouter/free`), para fonte de dado (API pública e gratuita antes de
serviço pago) e para qualquer dependência nova. Integração que só existe paga fica como
porta com estado "não configurado", e o sistema funciona sem ela.

Consequência de desenho: o plano gratuito tem cota — no OpenRouter, 20 pedidos por minuto
e 50 por dia —, então o que usa IA trabalha **em lote** (vários itens por pedido), faz o
determinístico antes, e trata cota esgotada como teto: para a execução e adia o trabalho
até a hora que o provedor diz, sem insistir (pedido recusado também conta na cota).

---

## 3.8 O que entra no `main` vai para o ar

Desde 25/09/2026, todo push no `main` que passa no CI vai para o ar: hoje pelo Render
(ADR 0013), que espera o CI, monta a imagem e troca a versão em uns dez minutos. O
`npm run check` antes de todo commit (seção 2) deixou de ser só boa prática: é o que
separa um commit do sistema de quem usa.

- **Migração só acrescenta.** A versão anterior roda com o banco já migrado — durante a
  troca e, se a nova não subir, depois dela. Apagar ou renomear coluna ou tabela se faz
  em duas publicações: a primeira para de usar, a segunda apaga.
- **Tabela nova sai fechada** para a API do Supabase: toda migração liga o RLS nas
  tabelas do `public` (`src/infra/banco/fechar-tabelas.ts`). View no `public` passaria
  por cima — se precisar de uma, com `security_invoker`.
- **Nada de dado no log do GitHub.** O repositório é público, e o log do Actions também.
  O CI e os scripts de servidor não imprimem segredo nem dado de negócio — estado e
  contagem, sim. O log do contêiner que o CI mostra é de um banco vazio, criado ali.
- **Variável de ambiente nova que o sistema precisa no ar** entra no `render.yaml` — se
  for segredo, com `sync: false`, e o valor é posto à mão no painel do Render. Senão ela
  existe no computador e falta no ar. (No servidor próprio, guardado para quando escalar,
  o lugar é `servidor/montar-config.sh` e o job `publicar` do `verificar.yml`.)
- **Push por tarefa, não por commit.** O Render gratuito tem 500 minutos de montagem por
  mês, e cada push que muda a imagem gasta alguns. Commit pequeno continua a regra; o
  push junta os de uma tarefa terminada. Push só de documento ou teste não monta
  (`buildFilter` no `render.yaml`).
- O passo a passo, e o que fazer quando algo falha, está em `docs/hospedagem.md`; o do
  servidor próprio, em `docs/hospedagem-servidor.md`.

---

## 4. Convenções de código

- TypeScript `strict`, sem `any` implícito, sem `as` para calar o compilador.
- Dinheiro em **centavos inteiros** (`bigint`/`number` inteiro). Nunca `float`
  para valor monetário. Tipo `Centavos` em `src/lib/dinheiro.ts`.
- Toda fronteira externa (LLM, HTTP, planilha, formulário) valida com Zod.
- Domínio em português (o vocabulário do negócio é português: `margem`, `sku`,
  `fornecedor`, `compatibilidade`); primitivas de infraestrutura em inglês quando
  for o idioma da biblioteca.
- Todo job é idempotente e retomável. Extração que falha não perde o que extraiu.
- Tudo que é regra de negócio numérica é função pura com teste.

## 5. Comandos

```sh
npm run dev            # servidor de desenvolvimento
npm run build          # build de produção
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest
npm run test:cov       # cobertura
npm run check          # typecheck + lint + test  (rodar antes de commitar)
npm run db:generate    # gerar migration a partir do schema
npm run db:migrate     # aplicar migrations
npm run verify:authors # conferir autoria de todos os commits
npm run montar:tarefas # empacota a subida do contêiner, fila, migração e semente para a imagem
```

### O banco dos testes é outro, sempre

A suíte faz `truncate` nas tabelas a cada teste, então ela lê
**`DATABASE_URL_TESTE`** — nunca `DATABASE_URL` — e recusa rodar se as duas
apontarem para o mesmo banco.

Isto não é preferência de organização: enquanto a suíte lia `DATABASE_URL`, rodar
`npm run check` antes de commitar, como esta seção manda, apagava os dados do banco
da aplicação. Sem a variável de teste os testes de banco **pulam**, e o resumo do
vitest diz quantos — que é o lado certo de errar.

```sh
createdb bancada_teste       # local; em banco gerenciado, uma branch de teste serve
DATABASE_URL="$DATABASE_URL_TESTE" npm run db:migrate
```
