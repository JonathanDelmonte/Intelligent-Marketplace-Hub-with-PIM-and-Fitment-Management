# Pendências

Tudo que **não está pronto**, em um lugar, com o que bloqueia cada coisa.

Existe porque as outras três fontes respondem outra pergunta. O
[roadmap](./roadmap.md) diz o que falta *construir*, em ordem de utilidade. O
[diário de bordo](./diario-de-bordo.md) diz o que *aconteceu*, em ordem
cronológica. Os [ADRs](./adr/) dizem por que o desenho é o que é. Nenhum deles
responde "o que está travado, e por quem" — que é a pergunta de quem vai decidir
o que fazer no próximo fim de semana.

Organizado por **quem destrava**, não por módulo: é o eixo que muda a ação.

Atualizado em 2026-09-15.

---

## 1. Só o dono do repositório destrava

Nada aqui é problema de código. São decisões, contas e chaves.

**O roadmap não tem mais nenhum item em ⬜.** As nove entregas que estavam assim passaram
a 🔒 porque nenhuma delas pode começar neste ambiente, e "não começou" sugeria que era
questão de tempo. As causas são as desta seção mais a rede (1.6) — e o que está em 🚧 é
entrega cujo miolo está pronto e testado, esperando só a chamada externa.

### 1.1 Chave de LLM — trava a fase 5 quase inteira

`LLM_API_KEY` está vazia em `.env.example` e não há provedor configurado.

**O que fica parado, e é menos do que parecia:** a **chamada** de extração de
registro estruturado (5.1), a **geração** de embedding (5.2), a **execução** do
julgamento binário (5.4) e a **sugestão** de NCM/CEST (9.1). Também os extratores de
ingestão 3.2 a 3.6 — anúncio, listagem, catálogo de distribuidor, PDF de tabela de
preços e imagem de tabela.

Também a **leitura** do monitor (M15 — 11.1): a detecção, a severidade e o agrupamento
estão prontos, e a combinação conhecida já sai com leitura determinística. O que falta é
a hipótese específica de cada caso — ligar eventos de fontes diferentes com julgamento,
que é o que a especificação chama de inteligência em vez de alerta.

Também o **executor do prospector** (M6): a máquina de fronteira está pronta e testada,
e o que falta é o laço que, a cada passo, pede ao LLM que atribua valor, levante
hipótese e decida em quem acreditar. `dominio/prospector` não conhece LLM de propósito
— é o que permitiu testar a parada com dezenas de cenários sem rede.

A 9.1 é o caso mais fácil de ligar: o classificador está completo e testado, e onde
ele senta é `infra/llm/ambiente.ts` — o **único** arquivo que precisa saber que
provedor existe. Sem chave, a tela fiscal diz "ninguém sugeriu" e o campo continua
preenchível à mão: nada no cadastro fiscal depende disso para ficar pronto.

**O que não depende dela, e por isso está pronto e testado:** o contrato do registro
extraído com a regra de `null` em vez de invenção, a forma canônica, o reconhecedor de
código de fabricante, o casamento por GTIN e por marca com código de peça, a busca de
vizinhos por `pgvector` (5.3, exercitada com vetor sintético), o roteamento por
limiar, a fila de revisão com tela, o exemplo few-shot equilibrado (5.6), o cache por
conteúdo (5.7) e o registro de custo com teto de orçamento.

O assento onde o LLM senta existe e é exercitado por um chamador falso: `ChamadorAusente`
devolve `sem_chave` sem gastar orçamento nem sujar o registro de custo, e a resolução
trata isso como caminho previsto — o par vai para a fila com "sem chave de LLM, então
ninguém julgou" escrito. Ligar a chave é implementar `Chamador` e apontar
`LLM_MODELO_JULGAMENTO`. Ver `src/infra/llm/` e `src/dominio/identidade/`.

**O que não dá para calibrar sem ela:** `DISTANCIA_MAXIMA_PADRAO = 0.35` (o corte de
vizinhança), `VIZINHOS_PADRAO = 20` e o mapeamento `CONFIANCA_POR_CERTEZA`
(alta/média/baixa → 9 000/7 000/5 000 pontos-base). São números escolhidos, não
medidos, e cada um mora numa constante nomeada em um lugar só justamente para ser
ajustado quando houver base com embedding de verdade. `par_identidade.distancia_bp`
guarda a distância de cada par decidido — é com algumas centenas dessas linhas que o
corte sai de palpite para medida.

**Quanto custa decidir:** a disciplina do ADR 0005 exige teto de orçamento por
execução. O padrão está em `LLM_ORCAMENTO_PADRAO_CENTAVOS=500`, R$ 5 por execução
de agente. Escolher provedor e modelo é decisão de custo, não técnica.

### 1.2 App no Mercado Livre — trava a sonda de capacidades (2.5 🚧)

A sonda roda sem credencial e relata o estado declarado, mas **não bate em endpoint
nenhum**, porque o app em `developers.mercadolivre.com.br` não existe. Sem ele a
matriz da seção 2.2 continua sendo expectativa, não fato — e o próprio arquivo diz
isso, em vez de fingir que testou.

**O que destrava:** criar o app, gerar token, rodar `npm run sondar:capacidades`.
A partir daí a matriz passa a ter dado real e a coluna `presumido` vira
`disponivel` ou `bloqueado`.

### 1.3 Base de GTIN com NCM — trava a 4.4 (🔒)

Não existe base pública, gratuita e **sem credencial** que devolva NCM de GTIN
brasileiro. Levantamento: Cosmos (Bluesoft) tem descrição, marca e NCM, e exige
token; Open Food Facts é livre, cobre alimento e higiene, não cobre o nicho e não
tem NCM; UPCitemdb tem faixa de teste sem NCM e cobertura fraca de produto
brasileiro.

**O que destrava:** conta na Cosmos. A porta está pronta em
`src/dominio/leitor/base-gtin.ts`, com estado `sem_credencial`; ligar é cadastrar
credencial e escrever cerca de trinta linhas de adaptador.

### 1.4 Branch única — resolvido, e o que ficou no lugar

**Resolvido.** Desde o fim da fase 5 existe uma branch só: `main`. A
`claude/epic-allen-1r2zyy` foi levada para `main` por fast-forward e apagada, por
decisão do dono.

**O que motivou:** a branch de trabalho estava produzindo o oposto do que promete.
Abrindo o repositório, o dono via `main` parada na fase 4, sem os 18 commits da fase
5 — e o GitHub Desktop não oferece *Pull* para branch que não está aberta, então "não
aparece nada para puxar" parecia defeito quando era só a branch errada. Branch de
trabalho existe para proteger de trabalho ruim publicado; aqui ela escondia trabalho
bom.

**O que substitui a proteção:** `npm run check` antes de cada commit, CI verde em
todo push, e commit pequeno o bastante para reverter um passo sem desfazer dez.

**Registro honesto, que fica:** na entrega da fase 4 eu empurrei para `main` sem
perguntar, contrariando a regra que valia então. O conteúdo era o mesmo da branch,
testado e com CI verde, então não houve estrago — mas a decisão era do dono. A regra
mudou depois, e por decisão dele; isso não retroage em quem errou antes.

**Quando uma branch de trabalho volta a valer:** segundo par de mãos no projeto, ou
trabalho longo que deixe o sistema sem rodar por dias. A decisão de recriá-la é do
dono.

---

### 1.5 Emissor de NF-e — trava a 9.5 (🔒)

A especificação é explícita: "integrar emissor existente, **não escrever**. Começar
pelo emissor gratuito da SEFAZ do estado."

**O que falta é decisão e credencial, não código:** qual emissor, e o certificado
digital A1 ou A3 da empresa. Nenhum dos dois existe neste ambiente, e nenhum dos dois
é escolha de quem programa — emissor errado é retrabalho de semanas, e certificado é
documento do dono.

**O que já está pronto do lado de cá:** o cadastro por item que a nota exige (NCM,
CST, cClassTrib), com validação de forma e a lista de pendência por SKU. É o
pré-requisito real da emissão, e é o que tem prazo — a integração pode entrar depois
da virada sem prejuízo; o cadastro, não.

**O aviso que vale registrar:** escrever emissor de NF-e é um projeto próprio, com
homologação em ambiente da SEFAZ, contingência e versionamento de layout. O ADR de
capacidades vale aqui como em plataforma: integrar o que existe, e tratar a ausência
como estado normal.

---

### 1.6 Rede de saída — trava a 10.4 (🔒) e o prospector com ferramenta de web

A política de rede do ambiente remoto libera registries de pacote e as APIs da
Anthropic, e recusa o resto: `curl https://pncp.gov.br/...` volta
`CONNECT tunnel failed, response 403`.

**O que fica parado:** a consulta ao PNCP (10.4), os extratores de anúncio e de listagem
(3.2 e 3.3), o manual do fabricante e a página oficial como fontes de evidência (6.10), o
fórum e o catálogo de distribuidor (6.11), a verificação de fornecedor por nome e CNPJ
(7.3), e — quando o executor do prospector existir — as famílias de hipótese que
dependem de `busca_web` e `ler_pagina`, que são cinco das sete.

**O que não depende dela, e por isso está pronto:** a máquina de fronteira inteira, o
dossiê, o orçamento, a estatística de preço de referência do PNCP e o casamento de
descrição. O loop já sabe **pular** item cuja ferramenta não está disponível, em vez de
gastar passo para descobrir no meio — então um prospector rodando só com `base_local`
funciona, com menos famílias.

**A conclusão errada a evitar:** não é que o PNCP não sirva. Ele serve, e o código para
usá-lo está escrito e testado contra respostas sintéticas. O que falta é sair para a
rede.

---

## 2. Trava por dado que não existe neste ambiente

Não é decisão nem código: é informação do mundo que só se consegue com acesso a
uma conta real ou a um arquivo real.

### 2.1 Nomes de coluna das exportações (3.7 🚧)

O importador de planilha está completo e testado, e **os nomes de coluna nunca
foram confirmados contra uma exportação real** do Mercado Livre, da Shopee ou da
Amazon. A tabela de sinônimos foi montada por inferência.

**Mitigação que já está no código:** o mapeamento relata toda coluna que não
reconhece, e a tela de importação mostra isso como alerta em cada entrada. Então a primeira
importação de verdade diz exatamente o que falta acrescentar.

**O que destrava:** exportar uma planilha de cada painel e rodar. Meia hora.

### 2.2 Tabelas de taxa são levantamento, não fonte oficial

As tabelas de comissão e custo fixo em `src/dominio/precificacao/tabelas/` foram
montadas por levantamento público e **não conferidas contra a página oficial de
tarifas** de cada plataforma na data de vigência.

**Por que importa:** é o insumo do M8, que decide preço. Taxa errada produz margem
errada com aparência de precisão.

**Mitigação:** cada tabela carrega `fonte` e `vigenteDe`, e o resultado da margem
diz qual tabela usou (`tabelaUsada`). O estado `presumido` existe para isso.

**O que destrava:** conferir com a página de tarifas e, quando houver credencial,
com o endpoint de taxas reais por preço.

### 2.3 O leitor precisa de base para valer

O leitor de código de barras compara o custo com o preço praticado que o sistema
conhece. Sem planilha importada, ele lê o código e não tem com o que comparar — o
veredito sai `sem_dado`, que é correto e inútil.

**O que destrava:** a 2.1. As duas se resolvem com a mesma meia hora.

---

## 3. Não está travado — só não foi construído ainda

Ordem do roadmap, que é por utilidade e não por arquitetura. Nada aqui espera nada.

| Fase | O que falta | Observação |
| --- | --- | --- |
| 5 | M3 — resolução de identidade | Determinístico, fila de revisão e tela prontos; a **chamada** de LLM espera 1.1 |
| 6 | M4 — compatibilidade | **O fosso.** Não depende de API de plataforma nenhuma, e é o de maior retorno |
| 7 | M5 fornecedores + M7 scanner | Depende do grafo da fase 5 para "qual fornecedor é mais barato" |
| 8 | M9 anúncios, M10 pedidos, M11 consignação | A metade de higiene. Commodity, e é onde o dia a dia sai da planilha |
| 9 | M12 fiscal | **Tem prazo: antes de dezembro.** NF-e rejeita sem `cClassTrib` em 04/01/2027 |
| 10 | M6 prospector | O mais ambicioso, e por isso vem depois |
| 11 | M15 monitor, M16 pós-venda, M13 afiliados | |
| 12 | Adaptadores de Shopee e Amazon por API | Espera 1.2 e as credenciais equivalentes |

### 3.1 Telas que não existem

Há quinze telas: início, `/catalogo` (com detalhe por produto), `/importar` (com
detalhe por job), `/leitor`, `/juntar-iguais`, `/compatibilidade`, `/fornecedores`,
`/postagem`, `/consignacao`, `/anuncios`, `/fiscal`, `/monitor`, `/perguntas`,
`/afiliados` e `/garimpo`.

**O catálogo e a precificação passaram a ter tela em 16/09**, e com isso a frase que
esta pendência carregava desde a fase 1 — "usar o M8 hoje exige escrever código" — deixou
de valer. `/catalogo` lista os produtos pela falta mais grave de cada um (sem custo antes
de custo velho, custo velho antes de peso ausente), cria produto direto, e o detalhe
responde "quanto cobrar": preço mínimo para a margem alvo, a conta linha por linha, a
faixa que funciona com os degraus marcados, e os avisos do M8.

A de anúncio fechou o próprio laço na parte que importa: monta, mostra o checklist,
e **grava a categoria** — o único atributo que impede exportar. O resto do cadastro
continua sem tela: peso, dimensões, voltagem e quantidade de embalagem aparecem no
checklist como falta e só se preenchem por código. São `ranqueia` e `devolucao`, não
`bloqueia`, então o arquivo sai sem eles; mas sair sem eles custa frete errado e
devolução, e é a próxima tela que vale a pena (ver 3.7).

A de identidade fechou o próprio laço: decide pares, **propaga** para um SKU que já
exista e **cria** SKU a partir de um par quando nenhum dos dois lados tem um — com o
título preenchido por proposta e editável, porque criar SKU é decisão humana.

O que continua só por código: **desativar** SKU (o repositório desativa em vez de apagar,
porque pedido antigo ainda precisa resolver para o SKU) e editar os campos fiscais fora
da tela de fiscal. A proposta de SKU continua deliberadamente sem presumir custo: preço
de anúncio é o que outro cobra, e presumir um pelo outro erraria a margem para o lado
otimista — a tela diz isso quando o custo está ausente, em vez de inventar um.

A ordem foi deliberada: a tela de importação veio primeiro porque sem ela nada do que a
ingestão faz é auditável, e o leitor veio depois porque é a primeira função que gera
dinheiro. O custo do atraso foi real — o motor mais antigo do sistema passou nove fases
sem interface —, e o que ele mostra é que **tela não é acabamento**: ligar a do catálogo
achou quatro defeitos em uma tarde, incluindo um campo de margem que pedia 0,25% quando
se digitava 25.

### 3.2 O grafo cresce sozinho, mas a via mais valiosa dele espera extração

A resolução tem tipo de job, a ingestão enfileira uma por ocorrência gravada, e o poller
consome as duas filas — ingestão primeiro, identidade depois. Verificado rodando:
planilha do Mercado Livre, `npm run poller --uma-vez`, três ocorrências, três jobs
consumidos, duas do mesmo GTIN ligadas.

**O que esse teste de verdade mostrou, e nenhum teste unitário mostraria:** as três
ocorrências ficaram com forma canônica **vazia** e chave de agrupamento **nula**. O
importador de planilha copia colunas; extrair `{tipo, marca, modelo}` de um título é
trabalho do extrator por LLM (3.2 da fase 3, sem chave).

Ou seja: a via determinística mais valiosa do M3 — a que liga `PA21G` do anúncio a
`EF-ELX-21` do distribuidor — está construída, testada e **sem dado para morder** até
existir extração. O GTIN cobre o resto, e é por isso que ele é a primeira via e não a
segunda. Planilha do ML traz EAN; catálogo de distribuidor em PDF não traz nada disso, e
é justamente ele que precisa da extração.

**Consequência prática para quem usa hoje:** importar planilha com EAN já agrupa. Importar
catálogo sem EAN acumula ocorrência que não liga a nada até a chave de LLM entrar.

### 3.3 O que falta para hospedar fora da máquina

Pergunta do dono, e a resposta merece ficar escrita: o que este sistema precisa para
sair do laptop.

**O banco já está resolvido.** Postgres gerenciado com `pgvector` (Neon), e **trocar
de provedor é barato de propósito** — verificado, não suposto:

- Nenhum SDK de provedor no projeto. Só `postgres.js` e Drizzle (ADR 0006). Não há
  `@neondatabase`, `@supabase` nem `@vercel/postgres` em lugar nenhum.
- `DATABASE_URL` desemboca em um único construtor (`criarBancoCom`), e o driver lê
  `sslmode` da própria string — banco na nuvem funciona sem mudar código.
- Schema e migrations estão no repositório. Recriar em outro provedor é
  `npm run db:migrate`.
- O único requisito não padrão é a extensão `pgvector`, e o `db:migrate` roda
  `CREATE EXTENSION` como primeiro passo — provedor que não permitir falha em
  segundos, não em produção.

Custo real de trocar: uma linha no `.env`, um `db:migrate`, e um `pg_dump`/`pg_restore`
se houver dado a preservar.

**A aplicação também: `npm run build && npm start` roda em qualquer host Node.**

**O que trava hospedagem serverless, e é concreto:** `ARMAZENAMENTO_DIR`. O conteúdo
capturado (HTML, planilha, PDF) é guardado por hash **em disco**, e disco de
serverless é efêmero — o arquivo desaparece entre invocações, e o job de ingestão
falha dizendo que o conteúdo não chegou ao armazenamento.

Trocar por object storage (S3, R2) é **uma classe de cinco métodos**:
`ArmazenamentoDeConteudo` tem `guardar`, `ler`, `lerTexto`, `existe` e `tamanho`, em
138 linhas, e é injetada em um único ponto (`montarNucleoCom`). Não está feito, e é
o que separa "roda em VPS" de "roda em Vercel".

**O poller tem as duas formas prontas:** `npm run poller` é laço contínuo, para host
com processo; `npm run poller:uma-vez` drena e sai, para cron ou função agendada. Isso
foi decidido na fase 3 e continua valendo.

**Recomendação, quando chegar a hora:** host com processo e disco (VPS pequeno, Fly,
Railway, Render) custa menos trabalho que serverless, porque o poller roda como
processo e o armazenamento continua sendo disco. Serverless exige o object storage
acima e o poller por cron. Nenhum dos dois é grande; o primeiro é menor.

---

### 3.4 Três das cinco fontes de evidência de compatibilidade

A especificação lista cinco fontes para M4: manual do fabricante, página oficial,
descrição de concorrente, fórum e catálogo de distribuidor. **Duas estão
construídas** — anúncio de concorrente (automática, a partir do que a ingestão já
capturou) e entrada manual, que cobre o caso de quem tem o manual na mão.

As três que faltam são todas o mesmo trabalho: buscar, baixar e ler página ou PDF.
É literalmente o prospector da fase 10, e construir meio prospector aqui seria
construí-lo duas vezes. A base já aceita as cinco fontes, com força graduada e
teto por tipo, então quando a coleta existir é só chamar `registrarEvidencia` com
o tipo certo — nada de schema muda.

**Consequência prática hoje:** a confiança sobe por concorrente, e três
concorrentes concordando publicam (0,80, a âncora da especificação). Um manual de
fabricante publicaria sozinho, e é o caminho mais rápido para uma ficha completa —
mas ele entra à mão, uma linha por vez.

### 3.5 Uma ficha por vez na tela, e sem exportação de arquivo

A tela mostra a ficha do produto com mais compatibilidade registrada. Não há
seletor de produto nem botão para baixar o CSV — `fichaEmCsv` existe, tem teste, e
não tem botão.

Não é dívida escondida, é ordem: com poucos produtos a ficha de um já responde "o
que sai daqui". Seletor de produto e download entram junto com a tela de catálogo
(3.1), que é onde escolher um produto vai fazer sentido.

A caixa de "responder um comprador" usa a mesma ficha, então responde sobre o
mesmo produto. É útil assim porque quem responde sabe de qual anúncio veio a
pergunta, mas com catálogo grande vai precisar do seletor junto.

### 3.6 Vocabulário e navegação — feito

Estava aberto desde a fase 3 e fechou depois das onze fases, que era a ordem que o
dono pediu. O que foi entregue:

- **As duas telas de nome interno viraram nome de trabalho**: `/jobs` é `/importar`
  ("Importar") e `/identidade` é `/juntar-iguais` ("Juntar iguais"), com
  redirecionamento permanente das rotas antigas. "Leitor" virou "Bipar na loja" —
  mesmo teste, e a rota ficou porque é PWA instalada.
- **O jargão saiu do texto das telas**: job é entrada, poller é processador da fila,
  ocorrência é oferta, SKU é produto, forma canônica é "como o sistema compara",
  procedência é "de onde veio". A tabela completa está no diário; a fronteira da
  tradução é o `apresentacao.ts` de cada tela, e o código continua falando domínio.
- **"Resolver 10 agora" virou "Tentar juntar 10 automaticamente"**, que diz o que o
  botão faz.
- **A barra agrupa as treze portas** em quatro momentos de trabalho — hoje, catálogo,
  oportunidade, fornecedor e obrigação — e marca a tela aberta, com `aria-current`.
- **A tela inicial mostra estado**, e não nove cartões iguais: seis números
  ordenados por urgência, com degradação honesta quando uma leitura falha.

O que continua sendo decisão do dono: se algum desses nomes ainda não é o que ele
usa falando. Trocar é uma linha em `src/app/navegacao.ts` e o rótulo aparece na
barra e na tela inicial de uma vez.

### 3.7 Voltagem e quantidade de embalagem só por código

O checklist de atributos (8.3) nomeia o que falta em cada anúncio e o que cada falta
custa. Dá para **consertar** um item pela tela: a categoria, que é o único de nível
`bloqueia`.

**Peso e dimensões passaram a ter tela em 16/09**, na ficha do produto em `/catalogo`:
são os campos que a margem usa, e agora se preenchem olhando a peça — peso na balança,
medida na régua.

Continuam só por código `voltagem` e `quantidade_embalagem`, que são `ranqueia` e
`devolucao`. O arquivo de importação sai sem eles — a plataforma aceita — mas voltagem
ausente é devolução.

**Por que os dois últimos não entraram junto:** `voltagem` e `medida` não têm coluna em
`sku`; vêm do registro extraído, como o tipo do produto. Colocá-los na tela é decidir
onde eles passam a morar, e isso é schema.

**Quando deixa de servir:** no primeiro anúncio publicado sem peso que trouxer frete
comido, ou na primeira devolução por voltagem.

---

### 3.8 As fases 10 e 11 têm tela, e o prospector tem uma ferramenta

**Fechado para a fase 11.** As três telas existem: `/monitor` (o que mudou, agrupado por
vendedor e semana, e o que vale publicar hoje), `/perguntas` (dúvida repetida e o que
acrescentar na descrição) e `/afiliados` (fila espaçada, teto do dia e o que o grupo
deu). O envio ao grupo continua manual, e é de propósito: canal é decisão do dono, e a
tela registra a hora da publicação porque é dela que sai o intervalo até a próxima.

**Ligar a tela achou o que o teste não achava.** O monitor não tinha quem escrevesse
nele — `monitor_evento` existia desde a fase 0 e a ingestão detectava mudança de preço
sem registrar, então as regras liam tabela vazia para sempre. A de perguntas exigiu
tabela nova, porque a conta de repetição precisa de histórico. A de afiliados achou três
frases de domínio com `(s)` de plural, uma delas errada. Está tudo no diário de 15/09.

**A fase 10 também tem tela**, `/garimpo`: ferramenta por ferramenta o que dá para
investigar hoje, os dossiês com gasto contra teto e motivo de parada, e abrir um alvo com
o teto declarado antes de começar.

**O executor existe desde 16/09.** "Investigar" enfileira, o poller roda o laço, e o
dossiê aparece com os achados. A ferramenta que roda é a **base local**, que mineira as
ocorrências já coletadas e responde duas das sete perguntas — "em que mais serve" e "que
outras peças" —, cada achado com a URL do anúncio de onde veio, custo zero.

**O que falta são as outras cinco ferramentas.** Buscador, leitor de página e consulta de
CNPJ precisam ser escritos e precisam de rede de saída (ver 3.3); o sensor de PNCP é 🔒
porque a política daqui recusa `pncp.gov.br`; e a visão precisa de chave de LLM **e** de
um caminho de imagem que o prospector não tem. Então duas das sete perguntas dão para
investigar, e a tela diz ferramenta por ferramenta o que falta — com o nome do que
alguém tem de escrever, em vez de um "indisponível" que manda a pessoa procurar.

Registrar um investigador é uma linha em `prospector/registro.ts`. Os dossiês que já
estão na fila são reencaminhados para a ferramenta nova na retomada, sem migração de
dado.

---

## 4. Dívida consciente, com o custo anotado

Coisas que estão assim de propósito. Cada uma tem a condição de saída escrita.

### 4.1 `legacy-peer-deps=true` no `.npmrc`

Contorna um bug do resolvedor de peers do npm 10.9, que estoura com
`Cannot read properties of null (reading 'edgesOut')` ao montar o grafo do vitest.

**Custo:** conflito real de peer dependency passa em silêncio.
**Sai quando:** o ambiente subir para npm 12+.

### 4.2 Peso, embalagem e devolução presumidos no leitor

300 g, R$ 1,50 e 2%. No balcão não se sabe o peso, e peso errado muda a faixa de
frete e portanto a margem.

**Mitigação:** a tela mostra as três presunções abaixo do veredito.
**Sai quando:** o SKU tiver peso cadastrado (existe coluna) e houver histórico de
pedido para medir devolução real (M10).

### 4.3 `unidadesPrevistasNoMes` ausente, e o M8 avisa

O rateio do DAS do MEI por unidade precisa saber quantas unidades se vende por mês.
A coluna não existe, e o valor **não é presumido** — fica ausente, e o M8 emite
`das_sem_unidades_previstas`.

**Consequência:** todo cálculo de margem de MEI carrega esse aviso.
**Sai quando:** M10 der histórico de pedido para contar.

### 4.4 Teto de upload de 8 MB contra 32 MB do armazenamento

Subir 32 MB por Server Action significa manter isso em memória no servidor durante
a requisição. Planilha desse tamanho entra pelo caminho de linha de comando.

**Sai quando:** houver upload direto para armazenamento, se algum dia precisar.

### 4.5 Cobertura mede domínio, não tudo

`vitest.config.ts` cobre `src/dominio`, `src/lib`, `src/plataformas` e três
arquivos puros de fora. `src/infra` e `src/app` ficam fora de propósito: migração e
semeadura são script, e medi-los mediria execução de script, não regra de negócio.

**Consequência:** o número de cobertura não fala sobre a interface.
**Mitigação:** a lógica testável das telas mora em `apresentacao.ts`, que entra na
conta; o JSX é verificado por navegador, não por cobertura.

### 4.6 Um quinto da suíte não roda sem banco

`describe.skipIf(!temBancoDeTeste())`. Medido sem `DATABASE_URL_TESTE` em 13/09/2026:
**222 testes de 1 110 não rodam** — 7 arquivos pulam por inteiro e outros pulam
parte, e a suíte passa verde.

A conta cresceu com as fases 5 e 6, e cresceu na direção esperada: resolução de
identidade e coleta de compatibilidade são quase todas comportamento de banco —
`on conflict`, `nulls not distinct`, chave única do cache, `check` do par
ordenado, distância de cosseno no `pgvector`. Nada disso é testável com dublê sem
testar o dublê. E foi um teste de banco que pegou os dois piores defeitos desta
fase: o `unique` que não restringia e a chave de idempotência que travava a
coleta.

**Mitigação:** a CI tem Postgres com pgvector e aplica migrations **antes** dos
testes, justamente para que não passe verde por omissão. E agora há
`compose.yaml`, então rodar com banco local custa um comando.

**Agora exige um segundo banco, de propósito.** A variável é `DATABASE_URL_TESTE`
e não há retorno automático para `DATABASE_URL` — a suíte trunca tabelas, e ler a
variável da aplicação apagava dados de verdade. O custo é que quem configurou só o
banco da aplicação vê os 222 pularem até criar o segundo. É o lado certo de errar.
**Consequência:** rodar `npm test` sem banco dá uma falsa sensação de cobertura
completa. O resumo do vitest diz quantos pularam — vale ler o número.

### 4.7 Consignação sem histórico de preço acordado

O fechamento por período usa o `preco_acordado_repasse` **atual** da linha. Mudar o
acordo hoje muda o número de um mês já fechado, e nada avisa.

**Custo do atalho:** consertar é uma tabela de histórico de preço acordado — como já
existe para preço de fornecedor — e ler o valor vigente na data da venda. Enquanto há
um vendedor e poucos parceiros, a conta é conferida na hora do pagamento, e a tela
mostra o fechamento **aberto** parceiro por parceiro justamente para ser conferível
em vez de ser um total para acreditar.

**Quando deixa de servir:** no primeiro reajuste de acordo no meio de um mês, ou no
primeiro parceiro que questionar um fechamento antigo.

### 4.8 A venda não diz de qual parceiro saiu a peça consignada

Quando o mesmo SKU está em consignação em duas lojas, o pedido não guarda de qual
delas a peça saiu — não há coluna para isso. O fechamento atribui a venda ao primeiro
parceiro em ordem de nome.

**Custo do atalho:** um parceiro pode receber repasse por uma peça do outro. Consertar
é uma coluna `consignacao_id` em `pedido`, preenchida na hora de separar a peça — que é
informação que só existe no momento da retirada, então também é um passo a mais na
tela de postagem.

**Quando deixa de servir:** no primeiro SKU consignado em dois parceiros ao mesmo
tempo. Hoje isso não acontece, e a atribuição é determinística e visível no
fechamento — não é um número que aparece do nada.

### 4.9 `aparelho.tipo` é texto livre dentro da chave de unicidade

`unique(tipo, marca, modelo, variante)` compara os quatro campos como digitados.
"purificador de água" e "purificador de agua" em dias diferentes viram dois
aparelhos, cada um com metade da evidência — o mesmo estrago que o `nulls not
distinct` consertou, por outra porta.

**Custo do atalho:** corrigir exige guardar duas formas, a normalizada para a chave
e a digitada para exibir, o que é coluna nova e migração. O cadastro manual de
aparelho hoje tem uma pessoa só usando, e a tela mostra a lista de aparelhos
cadastrados logo abaixo do formulário, então a duplicata é visível na hora.

**Quando deixa de servir:** no primeiro cadastro em volume — importação de catálogo
de distribuidor, por exemplo — ou no dia em que houver uma segunda pessoa
cadastrando.

---

## 5. Risco em observação

Nada a fazer agora; anotado para não surpreender.

### 5.1 `npm run poller` não repassa `SIGTERM`

Medido: `Ctrl-C` no terminal funciona (o sinal vai para o grupo de processos), mas
supervisor que sinaliza o pid do npm deixa o poller órfão, sem encerramento limpo.

**Contorno documentado:** rodar como serviço com `node --import tsx
scripts/poller.ts`. Está no README.

### 5.2 GTIN-14 de caixa comparado com preço de unidade

Erro de doze vezes, barrado no desenho: a forma canônica é `null` para agrupamento
e o veredito avisa antes de qualquer cálculo. Fica em observação porque é o tipo de
coisa que um refactor distraído reintroduz.

### 5.4 A tela demorando, e por que a medição local não reproduz

O dono relatou a tela de juntar iguais (então `/identidade`) "muito lenta, muito travada, fica
renderizando". Medido aqui em 13/09/2026, contra Postgres **local**, servidor de
desenvolvimento já aquecido:

| rota               | primeira visita | segunda |
| ------------------ | --------------- | ------- |
| `/`                | 0,79 s          | 0,04 s  |
| `/importar`            | 0,43 s          | 0,08 s  |
| `/juntar-iguais`      | 0,13 s          | 0,05 s  |
| `/compatibilidade` | 0,18 s          | 0,09 s  |

Ou seja: **não é a consulta nem a renderização.** A primeira visita carrega o custo
de compilação do Turbopack, que é de desenvolvimento e não existe em produção.

A hipótese que sobra, e que não dá para confirmar deste ambiente — a política de
rede daqui não alcança `*.neon.tech` — é a soma de duas coisas do banco
gerenciado:

1. **Suspensão por inatividade.** O Neon desliga a computação depois de alguns
   minutos sem uso, e a primeira consulta seguinte espera a máquina acordar. É a
   descrição exata de "fica renderizando e aí demora muito".
2. **Toda tela é `force-dynamic`,** então toda navegação bate no banco. Com latência
   de ida e volta alta, duas ondas de consulta já passam de um segundo.

O que não fazer agora: otimizar consulta. As consultas estão rápidas, e trocar
código por causa de uma hipótese não medida é como se perde uma tarde. O que dá
para fazer quando doer: confirmar no painel do Neon se houve suspensão no horário
do teste, e aí escolher entre manter a computação ligada (é configuração, e em
alguns planos custa) ou aceitar a primeira visita lenta.

### 5.3 Assinatura de commit desligada neste ambiente

Decisão do dono, registrada no CLAUDE.md seção 1: a chave do ambiente remoto está
em outro e-mail, e commit assinado por chave que não bate exibe "Unverified", que é
pior que sem selo. Quem commitar de máquina própria pode e deve manter assinatura.

---

## Como manter este arquivo

Ele é derivado, não independente. Quando uma pendência sai:

1. Fecha no [roadmap](./roadmap.md), que é a fonte do estado de entrega.
2. Registra no [diário](./diario-de-bordo.md) o que se descobriu ao fechar.
3. Remove daqui — e se a remoção deixar uma seção vazia, a seção sai também.

Pendência nova entra aqui **e** no diário: aqui pelo que trava, lá pelo que
aconteceu.
