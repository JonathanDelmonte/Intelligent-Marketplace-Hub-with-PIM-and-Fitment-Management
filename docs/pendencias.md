# Pendências

Tudo que **não está pronto**, em um lugar, com o que bloqueia cada coisa.

Existe porque as outras três fontes respondem outra pergunta. O
[roadmap](./roadmap.md) diz o que falta *construir*, em ordem de utilidade. O
[diário de bordo](./diario-de-bordo.md) diz o que *aconteceu*, em ordem
cronológica. Os [ADRs](./adr/) dizem por que o desenho é o que é. Nenhum deles
responde "o que está travado, e por quem" — que é a pergunta de quem vai decidir
o que fazer no próximo fim de semana.

Organizado por **quem destrava**, não por módulo: é o eixo que muda a ação.

Atualizado em 2026-09-24, no fim do dia — depois de fechadas todas as lacunas de
funcionalidade que não dependem de API de plataforma nem de emissor de nota, e da
navegação por loja (ADR 0009, seção 3.9).

---

## 1. Só o dono do repositório destrava

Nada aqui é problema de código. São decisões, contas e chaves.

**O roadmap não tem item em ⬜, e o que sobra em 🔒 depende de fora.** API de plataforma
(1.2), emissor de nota (1.5) e a base de GTIN do leitor (1.3) — três decisões do dono, as
três adiadas por ele. O que está em 🚧 tem o código pronto e testado, e espera o primeiro uso
de verdade: a chave de IA rodando (1.1) e uma exportação real de cada painel (2.1).

### 1.1 Chave de IA — colada, com modelos gratuitos

**Mudou duas vezes em 24/09.** O dono criou a chave no OpenRouter e colou no `.env` da
máquina dele (ela vive só lá; nada no repositório a conhece). E decidiu: **só modelo
gratuito** por enquanto — regra que virou a seção 3.7 do CLAUDE.md. O padrão de toda
finalidade de texto é o roteador `openrouter/free`, que escolhe a cada pedido um modelo
gratuito disponível; o de embedding é `liquid/lfm-2.5-embedding-350m:free`. Trocar por um
modelo escolhido, inclusive pago, é uma linha no `.env`.

**O que falta do dono, uma vez só:** liberar os modelos gratuitos em
openrouter.ai/settings/privacy — sem isso o OpenRouter recusa os gratuitos —, dar `git pull`
e reabrir o atalho.

**O que acende com a chave, sozinho, pelo processador da fila:** a leitura de marca, peça e
aparelho dos títulos (5.1, 20 títulos por pedido), o vetor de cada produto (5.2, 50 por
pedido), o julgamento de "mesmo produto" (5.4, 10 pares por pedido), a sugestão de NCM/CEST
na tela Fiscal (9.1), a hipótese do monitor (11.1, 8 grupos por pedido) e a leitura de
imagem de tabela (3.6). Tudo em lote porque a cota do gratuito é de 20 pedidos por minuto e
50 por dia — 1.000 por dia depois de uma compra única de US$ 10 em créditos. Cota esgotada é
teto: o trabalho para e continua quando ela volta, sem perder o que já leu.

**Não verificado contra o OpenRouter de verdade:** a rede deste ambiente recusa o site. O
pedido foi conferido contra um servidor local que imita a API e contra a documentação; se o
roteador gratuito não aceitar imagem, a revisão da imagem diz isso e aponta
`LLM_MODELO_VISAO`. A primeira execução na máquina do dono é o teste que falta.

**O que não dá para calibrar sem uso:** `DISTANCIA_MAXIMA_PADRAO = 0.35` (o corte de
vizinhança), `VIZINHOS_PADRAO = 20` e o mapeamento `CONFIANCA_POR_CERTEZA`
(alta/média/baixa → 9 000/7 000/5 000 pontos-base). São números escolhidos, não medidos, e
cada um mora numa constante nomeada em um lugar só justamente para ser ajustado quando
houver base com embedding de verdade. `par_identidade.distancia_bp` guarda a distância de
cada par decidido — é com algumas centenas dessas linhas que o corte sai de palpite para
medida.

**Quanto custa:** nada, com os gratuitos. O teto por execução continua valendo
(`LLM_ORCAMENTO_PADRAO_CENTAVOS=500`), e conta chamadas mesmo quando o modelo é gratuito —
agente sem teto não roda (ADR 0005). Se um dia entrar modelo pago, o custo em dólar vira
centavos de real por `LLM_COTACAO_DOLAR_CENTAVOS=600`, cotação acima da corrente.

### 1.2 APIs das plataformas — adiado pelo dono

**Decisão do dono, em 24/09: depois.** As três plataformas têm API — Mercado Livre, Shopee
(Open Platform) e Amazon (SP-API) —, e a diferença entre elas é a porta de entrada: o app
do Mercado Livre se cria sozinho, em minutos, em `developers.mercadolivre.com.br`; a Shopee
e a Amazon pedem cadastro de desenvolvedor aprovado pela plataforma. É por isso que a sonda
de capacidades (2.5 🚧) começou pelo Mercado Livre, e o roadmap deixa as outras duas para a
fase 12, "quando o volume justificar a burocracia de aprovação".

Sem API, nada para: a importação por planilha (M1) cobre as três, e o caminho padrão de
publicar continua sendo gerar arquivo de importação (CLAUDE.md, 3.3).

**O que destrava, quando for a hora:** criar o app do ML, gerar token e rodar
`npm run sondar:capacidades` — a matriz da seção 2.2 passa de expectativa a fato. Três
entregas esperam a API do ML: a sonda (2.5), a etiqueta do dropship (8.8) e o envio da
resposta ao comprador (11.3), que a especificação já mandava fazer à mão no começo.

### 1.3 Base de GTIN com NCM — trava a 4.4 (🔒)

**Decisão do dono, em 24/09: por último.** O leitor de código de barras é útil, mas não vai
ser usado tão cedo; a conta na Cosmos espera junto com ele. O que está abaixo fica como
registro do levantamento, para quando a hora chegar.

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

### 1.5 Emissor de NF-e — adiado pelo dono (9.5 🔒), com as opções levantadas

A especificação é explícita: "integrar emissor existente, **não escrever**. Começar pelo
emissor gratuito da SEFAZ do estado."

**O que é um emissor, para decidir.** A nota fiscal eletrônica é um arquivo XML no leiaute
da SEFAZ, assinado com o certificado digital da empresa e transmitido ao serviço da SEFAZ do
estado, que devolve a autorização; o DANFE é a impressão dele. O emissor é o programa que
faz isso — monta, assina, transmite, cancela, corrige, guarda por cinco anos e cobre a
contingência quando a SEFAZ cai. Escrever um é possível, porque o leiaute é público, e é um
projeto próprio com manutenção sem fim: o leiaute está mudando agora, com os grupos de
IBS/CBS da reforma. Integrar custo por nota; escrever custo semanas, e depois toda nota
técnica nova.

**Por que a decisão ficou urgente.** Pela LC 214/2025, a partir de 2027 o MEI preenche IBS e
CBS na nota, e o marketplace responde pelo imposto quando o vendedor não emite — ou seja, nota
em toda venda deixa de ser opcional na prática. O cadastro por item (9.2) é o pré-requisito, e
está pronto.

**As opções, levantadas em 24/09/2026:**

| Opção | Custo | Cobre | Com o sistema |
| --- | --- | --- | --- |
| Emissor integrado do Mercado Livre | grátis | só vendas do Mercado Livre | não precisa: emite na venda |
| Emissor gratuito do Sebrae, ou o app Nota Fiscal Fácil | grátis | qualquer venda, digitada à mão | não |
| Hub com emissor (Bling e parecidos) | R$ 55 a R$ 650 por mês, pelo volume de notas e integrações | Mercado Livre, Shopee e Amazon, emissão automática | por API, quando valer |
| API de emissão (Focus NFe, Nuvem Fiscal, PlugNotas, NFE.io) | por nota ou por plano | o que o sistema mandar | é o caminho para o próprio sistema emitir |
| Escrever o próprio | semanas, e manutenção permanente | — | — |

**Pré-requisitos de qualquer opção:** CNPJ habilitado na SEFAZ do estado — inscrição estadual
para quem vende mercadoria, e alguns estados exigem credenciamento antes da primeira nota — e
certificado digital e-CNPJ A1, de R$ 130 a R$ 235 por ano, com validade de um ano. Desde
1º/04/2025 a nota de MEI leva CRT 4.

**Recomendação provisória:** com a maior parte das vendas no Mercado Livre, começar pelo
emissor integrado dele, que é grátis, e emitir as vendas das outras plataformas no emissor
gratuito do Sebrae enquanto forem poucas. Quando Shopee e Amazon pesarem, passar para um hub
que emite sozinho nas três. Nos três casos o sistema faz a parte difícil — NCM, CST e
cClassTrib certos por produto —, e a 9.5 vira mandar esse cadastro ao emissor escolhido.

**Decisão do dono, em 24/09: depois.** Ainda não há CNPJ, nota fiscal nem produto real — é
tudo teste —, e a emissão fica para quando houver. O que a decisão do emissor pedia (estado,
vendas por mês, certificado, inscrição) passou a ser informado em **Meu negócio**, e não no
chat; a tela Fiscal mostra o emissor recomendado com esses dados, gratuito primeiro, e se
refaz quando um dado muda. A 9.5 continua 🔒 até o dono decidir emitir.

### 1.6 Rede de saída — resolvida no código; só este ambiente continua sem

O que estava parado por falta de rede **foi escrito em 24/09**, todo com serviço gratuito e
sem chave: o buscador (DuckDuckGo em HTML), o leitor de página, a consulta de CNPJ
(BrasilAPI) e as compras públicas (PNCP, 10.4); a leitura de link de anúncio, de lista, de
catálogo e de PDF (3.2 a 3.5); o manual, a página oficial, o catálogo e o fórum como fontes
de compatibilidade (6.10, 6.11); e a conferência de fornecedor por CNPJ e vitrine (7.3). A
saída para a rede é uma só (`infra/web/rede.ts`), com tempo limite, teto de tamanho e nada de
endereço da rede local.

Na máquina do dono a rede funciona. O que fica sem rede é **este** ambiente de
desenvolvimento, que recusa os quatro serviços (`CONNECT tunnel failed, response 403`) — por
isso cada um foi testado com o formato de resposta conferido contra a documentação e contra
o código de quem já os consome, e a primeira execução de verdade é na máquina do dono (ver
2.4).

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

**Decisão do dono, em 24/09: o leitor fica por último** (ver 1.3).

O leitor de código de barras compara o custo com o preço praticado que o sistema
conhece. Sem planilha importada, ele lê o código e não tem com o que comparar — o
veredito sai `sem_dado`, que é correto e inútil.

**O que destrava:** a 2.1. As duas se resolvem com a mesma meia hora.

### 2.4 Os serviços de fora nunca foram chamados de verdade

DuckDuckGo, BrasilAPI, PNCP e OpenRouter foram alcançados só por dublê, com o formato de
resposta conferido contra documentação e contra quem já os consome — a rede daqui recusa os
quatro. O que pode surpreender na primeira execução: a página de resultado do buscador mudar
de marcação (os resultados viriam vazios, e a conferência de fornecedor diria "nada achado"
sempre), o roteador gratuito não aceitar imagem, ou o endereço de loja de um marketplace ter
outra forma (ver o diário, 7.3). Cada caso cai num caminho previsto — revisão com o motivo,
ou "procurei e não achei" —, e nenhum derruba o resto.

**O que destrava:** usar. Um fornecedor conferido, um alvo investigado no garimpo e um print
de tabela enviado, na máquina do dono, dizem se os formatos batem.

---

## 3. O que falta, por fase

Refeita no fim de 24/09, depois de fechadas todas as lacunas de funcionalidade que não
dependem de fora. O que sobra em cada fase, e o que trava.

| Fase | O que falta | Trava |
| --- | --- | --- |
| 2 | Sonda de capacidades batendo em endpoint (2.5); OAuth (2.6b) | APIs adiadas pelo dono (1.2) |
| 3 | Colunas confirmadas das planilhas (3.7) | Uma exportação de cada painel (2.1) |
| 4 | Base pública de GTIN com NCM (4.4) | Leitor por último, por decisão (1.3) |
| 5 | Calibrar os cortes de vizinhança e de confiança | Uso com a chave (1.1) |
| 8 | Etiqueta e envio ao fornecedor no dropship (8.8) | API do ML (1.2) |
| 9 | Emissor de NF-e (9.5) | Adiado pelo dono (1.5) |
| 10 | Visão no garimpo | O garimpo não tem de onde receber imagem |
| 11 | Envio da resposta ao comprador (11.3) | API do ML (1.2) |
| 12 | Adaptadores de Shopee e Amazon por API | Adiado pelo dono (1.2) |
| Casa | Desenho novo nas telas que ainda têm o antigo (C.17) | Nada: direção aprovada com a navegação por loja |
| Casa | Conectar pela aba Conexão da loja (OAuth, 2.6b) | APIs adiadas pelo dono (1.2) |
| Casa | Lojas novas: Shein, AliExpress, Magalu, TikTok Shop | Comissão conferida e uma exportação real de cada painel (3.9) |

As fases 6 e 7 não têm mais nada. **Toda funcionalidade que não depende de API de
plataforma nem de emissor de nota está construída** — o que o dono pediu antes de mexer na
interface.

### 3.1 Telas que não existem

Há dezenove telas: a visão geral, `/assistente`, `/lojas` (adicionar loja) e a área de
cada loja (`/lojas/<loja>`), `/catalogo` (com detalhe por produto), `/importar` (com
detalhe por job), `/leitor`, `/juntar-iguais`, `/compatibilidade`, `/fornecedores`,
`/postagem`, `/consignacao`, `/anuncios`, `/fiscal`, `/monitor`, `/perguntas`,
`/afiliados`, `/garimpo` e `/negocio`. Um teste exige `page.tsx` para cada porta da
barra, desde 24/09.

**O catálogo e a precificação passaram a ter tela em 16/09**, e com isso a frase que
esta pendência carregava desde a fase 1 — "usar o M8 hoje exige escrever código" — deixou
de valer. `/catalogo` lista os produtos pela falta mais grave de cada um (sem custo antes
de custo velho, custo velho antes de peso ausente), cria produto direto, e o detalhe
responde "quanto cobrar": preço mínimo para a margem alvo, a conta linha por linha, a
faixa que funciona com os degraus marcados, e os avisos do M8.

A de anúncio fechou o próprio laço na parte que importa: monta, mostra o checklist,
e **grava a categoria** — o único atributo que impede exportar. O resto do checklist
passou a se preencher na ficha do produto no mesmo dia: peso e dimensões, que a margem
usa, e voltagem, medida e quantidade de embalagem, que decidem devolução (ver 3.7). Hoje
não sobra item do checklist sem caminho de conserto por tela.

A de identidade fechou o próprio laço: decide pares, **propaga** para um SKU que já
exista e **cria** SKU a partir de um par quando nenhum dos dois lados tem um — com o
título preenchido por proposta e editável, porque criar SKU é decisão humana.

**Nada mais fica só por código, desde 24/09.** Desativar produto tem botão no fim do
detalhe, com a volta no mesmo lugar — o repositório desativa em vez de apagar, porque pedido
antigo ainda precisa resolver para o produto —, e os desativados ficam recolhidos no fim da
lista do catálogo. Os dados fiscais aparecem no detalhe do produto, com um botão que abre a
tela Fiscal focada nele e volta para lá. A proposta de SKU continua deliberadamente sem
presumir custo: preço de anúncio é o que outro cobra, e presumir um pelo outro erraria a
margem para o lado otimista — a tela diz isso quando o custo está ausente, em vez de
inventar um.

A ordem foi deliberada: a tela de importação veio primeiro porque sem ela nada do que a
ingestão faz é auditável, e o leitor veio depois porque é a primeira função que gera
dinheiro. O custo do atraso foi real — o motor mais antigo do sistema passou nove fases
sem interface —, e o que ele mostra é que **tela não é acabamento**: ligar a do catálogo
achou quatro defeitos em uma tarde, incluindo um campo de margem que pedia 0,25% quando
se digitava 25.

### 3.2 O grafo cresce sozinho — e, com a chave, pela via mais valiosa

A resolução tem tipo de job, a ingestão enfileira uma por ocorrência gravada, e o poller
consome as filas na ordem de prioridade. A via determinística mais valiosa do M3 — a que
liga `PA21G` do anúncio a `EF-ELX-21` do distribuidor pela chave `marca|modelo` — precisava
de marca e código lidos do título, e isso é a extração por IA (5.1), que existe desde 24/09:
vinte títulos por pedido, com o que já tem marca e modelo resolvido antes, sem pedir.

**Consequência prática:** importar planilha com EAN agrupa na hora; catálogo sem EAN agrupa
quando a extração passa por ele — sozinha, com a chave, e parando quando a cota do dia
acaba. A tela de juntar iguais diz quantas ofertas esperam essa leitura.

### 3.3 Hospedar fora da máquina — feito; falta criar as contas

**Fechada em 25/09, do lado do código.** O dono pediu o sistema no ar, de graça, com
cada mudança publicada sozinha — e com tela de cadastro e login. Entrou:

- **Contas de acesso** (ADR 0011): login, cadastro fechado por código, sessão no banco e
  um porteiro na frente de toda rota. Permissões ficam para quando escalar.
- **A hospedagem gratuita em peças** (ADR 0013): o Render roda site e fila num contêiner
  só; o Supabase guarda o banco e os arquivos, pela API S3; o UptimeRobot não deixa o
  Render dormir. Substituiu o servidor da Oracle (ADR 0010 e 0012), que não passou do
  "Out of capacity" de São Paulo.
- **A publicação**: todo push no `main` vai para o ar depois do CI, e o CI sobe o
  contêiner do jeito que o Render sobe, contra o Postgres da versão do Supabase.

**O que falta é do dono:** criar as três contas e seguir o [guia](./hospedagem.md) — o
projeto do Supabase (banco, bucket e chave S3), o Blueprint do Render (colando os
valores) e o monitor do UptimeRobot. O servidor próprio, com cópia todo dia, fica guardado
para quando escalar ([hospedagem-servidor.md](./hospedagem-servidor.md)).

**Aberto, e se resolve no primeiro uso:** o S3 do Supabase foi ensaiado contra imitações,
e a primeira planilha enviada no ar é a prova (diário, 25/09). Sem cópia de segurança
nesta fase, por decisão do dono: dado de verdade traz a cópia de volta ao plano.

**Para depois de estar no ar — o computador do dono no lugar da nuvem.** Pedido do dono
em 25/09: o que puder ficar no computador de quem usa, fica lá, para a cota gratuita
render mais. Combinado tratar quando o sistema estiver no ar, nesta ordem:

1. **A planilha na nuvem vira temporária.** O original já está no computador de quem
   enviou; a cópia no Supabase Storage pode ser apagada sozinha uns 7 dias depois de
   processada, e reprocessar depois disso pede o arquivo de novo. Muda o ADR 0002 ("nunca
   jogar a entrada fora"): entra por ADR novo, com a decisão do dono.
2. **A cópia do banco baixada para o computador.** Um botão que gera a cópia e baixa. É a
   cópia de segurança que o Supabase gratuito não tem, e sem custo.
3. **O princípio vale para o que vier.** O que o sistema gera — arquivo de importação,
   ficha, relatório — já é baixado, e não fica guardado. Processar a planilha no próprio
   navegador foi avaliado e não compensa agora: poupa processamento do servidor, mas não
   o banco, que é o que enche primeiro (os dados extraídos vão para ele de todo jeito).
   Reavaliar se a máquina do Render ficar pequena.

O que vem abaixo é a análise de antes, que levou à decisão, e continua valendo como
registro: o banco sem SDK de provedor, o armazenamento em disco que tirou o serverless
da mesa, e o login que faltava.

---

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

**O que trava antes de tudo, e esta seção não dizia: não há login.** O sistema é
multi-perfil e não multi-tenant (CLAUDE.md, 3.4), e por isso nunca teve autenticação —
em `localhost` isso é correto. Num endereço público, **qualquer pessoa com a URL vê e
altera custo, margem, pedido e fornecedor**. Hospedar exige, antes, uma de duas coisas:

- **Uma senha na porta do sistema:** uma senha no `.env` e uma verificação que roda antes
  de toda rota. Pequeno — uma sessão de trabalho —, e é o caminho se a ideia é abrir do
  celular em qualquer lugar.
- **Não ter endereço público:** túnel privado (Tailscale, ou Cloudflare Tunnel com
  controle de acesso), em que só aparelho autorizado alcança o sistema. Zero código, e o
  sistema continua rodando no computador de casa.

**Decisão do dono, em 23/09: senha agora, não.** Mais adiante, um sistema de
autenticação com **tela de login e de cadastro**. Até lá o sistema roda só no próprio
computador, e isso já está garantido: o lançador sobe o servidor em `127.0.0.1`, que
nenhum outro aparelho da rede alcança.

Uma pergunta a responder junto, quando chegar a hora: _cadastro_ encosta no CLAUDE.md,
3.4, que manda não construir convite de usuário, papéis nem onboarding. Login de quem
opera o perfil cabe na regra como está; cadastro aberto, em que qualquer pessoa cria a
própria conta com os próprios dados, é multi-tenant. Se for esse o caso, a regra muda por
decisão do dono, escrita lá — e não por um formulário que apareceu na tela.

**E há um motivo concreto para hospedar, que também não estava escrito:** a tela de bipar
na loja usa a câmera, e navegador só libera câmera em `https` ou em `localhost`. O celular
abrindo o computador pela rede de casa (`http://192.168.x.x:3000`) **não** tem câmera. Na
loja, com o celular, a tela só funciona com o sistema num endereço `https` — hospedado ou
por túnel.

**Para rodar no próprio computador**, `Atalhos/Iniciar.bat` sobe tudo com um clique desde
23/09 — ver o README.

---

### 3.4 As cinco fontes de evidência de compatibilidade — feito

**Fechada em 24/09.** Das cinco fontes que a especificação lista para M4, duas existiam —
anúncio de concorrente, automático, e decisão na tela. As outras três (manual do
fabricante, página oficial, e fórum ou catálogo de distribuidor) entraram juntas, pelo
formulário "Trazer de um manual, página, catálogo ou fórum" na ficha de cada produto: PDF,
link ou texto colado.

A regra que decide a força está no diário: a fonte precisa citar o código do produto. Manual
e página oficial que citam publicam sozinhos — é o caminho mais rápido para uma ficha
completa —; os que não citam vão para a fila com o trecho. Catálogo e fórum só contam o
aparelho que está na seção do produto.

### 3.5 Seletor de ficha e exportação — feito

**Fechada em 16/09, no mesmo dia em que a tela de catálogo a destravou.** O que
faltava não era o código: `fichaEmCsv` tinha teste desde a fase 6. Faltava de qual
ficha baixar, e isso dependia de haver como escolher produto.

Agora a tela lista os produtos do perfil por quanta compatibilidade cada um tem
registrada, a escolha viaja na URL (`?sku=`), e a pergunta do comprador viaja junto
para trocar de produto não apagar o que estava digitado. Sem escolha, abre a ficha do
produto mais provado — o comportamento anterior. Com um produto só, o seletor não
aparece.

Produto de outro perfil vira aviso e **não** troca de ficha em silêncio: mostrar a
ficha de abertura quando alguém pediu outra é o caminho para responder a um comprador
com a ficha errada.

O download recusa o que não vale baixar — 400 sem produto, 404 fora do perfil, 409
quando não há nada publicável —, e o link só aparece quando o arquivo sai.

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
  Substituída em 24/09 pela navegação por loja (ADR 0009, ver 3.9).
- **A tela inicial mostra estado**, e não nove cartões iguais: seis números
  ordenados por urgência, com degradação honesta quando uma leitura falha.

O que continua sendo decisão do dono: se algum desses nomes ainda não é o que ele
usa falando. Trocar é uma linha em `src/app/navegacao.ts` e o rótulo aparece na
barra e na tela inicial de uma vez.

### 3.7 Atributos do checklist sem onde preencher — feito

**Fechada em 16/09.** Todo item do checklist de atributos (8.3) tem agora caminho de
conserto por tela. A categoria já tinha; peso e dimensões entraram com a ficha do produto
em `/catalogo`; e `voltagem`, `medida` e `quantidade_embalagem` ganharam coluna em `sku`
(migração 0010) e campo no mesmo formulário — que é onde a pessoa está com a peça na mão.

Voltagem e medida são **texto livre**, decidido e não por falta de ideia melhor: voltagem
tem quatro respostas certas na prática (110 V, 220 V, bivolt, e "dois modelos, um de
cada") e um enum de dois forçaria a errar no bivolt; medida é a medida funcional, e a
unidade é parte da resposta. A quantidade passou a preferir o cadastro ao registro
extraído, pela mesma regra que já valia para a marca.

**O que a ligação achou:** `categoria_regulada` tinha coluna desde a fase 9 e tela
fiscal desde então, e nunca chegava a `montarAnuncio` — o alerta de anúncio cancelado em
categoria regulada decidia sempre sobre `null`. Ver o diário de 16/09; é o segundo caso
do mesmo tipo, e os dois eram parâmetro opcional que o compilador não cobra.

**O que continuava por código** — desativar produto, e os campos fiscais fora da tela
Fiscal — ganhou tela em 24/09 (ver 3.1).

---

### 3.8 As fases 10 e 11 têm tela, e o garimpo tem cinco ferramentas

**Fechado para a fase 11.** As três telas existem: `/monitor` (o que mudou, agrupado por
vendedor e semana — com a hipótese da IA embaixo da leitura por regra desde 24/09 —, e o
que vale publicar hoje), `/perguntas` (dúvida repetida e o que acrescentar na descrição) e
`/afiliados` (fila espaçada, teto do dia e o que o grupo deu). O envio ao grupo continua
manual, e é de propósito: canal é decisão do dono.

**A fase 10 tem tela e cinco das seis ferramentas**, todas gratuitas: base local,
buscador, leitor de página, consulta de CNPJ e PNCP. Com elas as sete perguntas do garimpo
dão para investigar. Falta a visão, porque o garimpo não tem de onde receber imagem — a
leitura de imagem que existe é a da ingestão (3.6), para tabela de fornecedor.

Registrar um investigador é uma linha em `prospector/registro.ts`. Os dossiês que já
estão na fila são reencaminhados para a ferramenta nova na retomada, sem migração de
dado.

---

### 3.9 Navegação por loja (ADR 0009) — feita, e o que ficou de fora

Pedido do dono em 24/09, aprovado no mesmo dia. O que foi entregue:

- **A barra se divide por loja.** No topo, "Importar arquivo", Visão geral, Assistente IA e
  Postar hoje; depois Minhas lojas — cada uma com o estado (conectada, por planilha até tal
  dia, sem dados) e a contagem do que postar —, e o que serve a todas em Produtos,
  Oportunidades, Fornecimento e Empresa.
- **A área de cada loja**, uma tela para todas: painel dos últimos 30 dias contra os 30
  anteriores, gráfico por dia, mais vendidos, pedidos, anúncios, perguntas, repasse e
  conexão. Pedidos, perguntas e planilha importados de dentro da área já sabem de qual loja
  são.
- **A visão geral** soma as lojas, com um cartão por loja e a fatia de cada uma.
- **O assistente** responde em português com número do sistema, nunca da IA: perguntas
  prontas sem cota, regra antes da IA, e a resposta diz como entendeu e o que falta nos
  números.
- **"Publicar em"** na ficha do produto, no anúncio montado e em cada dossiê do garimpo.
- **Juntar iguais mora no catálogo**, com a contagem de pares esperando decisão; o repasse
  mora na aba de cada loja, e "Postar hoje" mostra quanto espera em cada uma.

O que ficou de fora, e por quê:

- **Conectar é porta com estado.** A aba Conexão diz como cada loja conecta e o que ela
  libera; a autorização por OAuth é a 2.6b, que espera a decisão sobre as APIs (1.2). Até
  lá, a loja funciona pela planilha, e a tela diz isso em vez de mostrar botão que falha.
- **Lojas novas precisam de dado, não de tela.** Shein, AliExpress, Magalu e TikTok Shop
  aparecem "a caminho". Cada uma entra com a tabela de comissão conferida, as colunas de uma
  exportação real do painel, o limite de título e o formato do arquivo de importação — com
  isso ela ganha área, painel, visão geral e assistente sem tela nova.
- **A aba Anúncios mostra prontidão, não anúncios publicados.** Nada grava na tabela
  `anuncio` (o caminho de publicação é o arquivo de importação); vira lista de anúncios
  quando alguma fonte passar a escrever nela.
- **"Repasse informado", e não "a receber".** A planilha de pedidos não traz data de
  pagamento.
- **O assistente sabe uma lista fechada:** faturamento, pedidos, ticket médio, margem, mais
  vendidos, o que postar e repasse divergente; hoje, ontem, 7, 30 ou 90 dias, este mês e o
  mês passado. Pergunta fora dela recebe "ainda não sei", com a lista. Cada métrica nova é
  uma entrega pequena — a consulta, a regra e a frase —, e a tradução pela IA gratuita ainda
  não foi exercida contra o provedor (2.4).
- **Perguntas coladas antes das áreas ficam sem loja**, na lista geral.

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

### 4.10 Feriado conta como dia útil na confiabilidade do fornecedor

A nota de confiabilidade (7.5) mede o atraso contra o prazo prometido em dias úteis, e não
há calendário de feriados no sistema: feriado conta como dia útil. O erro é a favor do
fornecedor — um pedido postado no dia seguinte a um feriado conta como um dia a menos de
atraso do que foi.

**Sai quando:** a nota de algum fornecedor ficar na fronteira de um corte por causa de
feriado — aí um calendário nacional simples resolve.

### 4.11 A coluna `fornecedor.confiabilidade` sem uso

A confiabilidade é medida na leitura, por perfil, porque pedido é do perfil e fornecedor é
compartilhado; uma nota gravada no fornecedor misturaria os perfis. A coluna antiga saiu do
tipo do repositório e ficou na tabela, para não exigir migração.

**Sai quando:** a próxima migração que mexer em `fornecedor` pode apagá-la junto.

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
