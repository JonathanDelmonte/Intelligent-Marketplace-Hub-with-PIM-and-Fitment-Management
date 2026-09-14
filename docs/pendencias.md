# Pendências

Tudo que **não está pronto**, em um lugar, com o que bloqueia cada coisa.

Existe porque as outras três fontes respondem outra pergunta. O
[roadmap](./roadmap.md) diz o que falta *construir*, em ordem de utilidade. O
[diário de bordo](./diario-de-bordo.md) diz o que *aconteceu*, em ordem
cronológica. Os [ADRs](./adr/) dizem por que o desenho é o que é. Nenhum deles
responde "o que está travado, e por quem" — que é a pergunta de quem vai decidir
o que fazer no próximo fim de semana.

Organizado por **quem destrava**, não por módulo: é o eixo que muda a ação.

Atualizado em 2026-09-12.

---

## 1. Só o dono do repositório destrava

Nada aqui é problema de código. São decisões, contas e chaves.

### 1.1 Chave de LLM — trava a fase 5 quase inteira

`LLM_API_KEY` está vazia em `.env.example` e não há provedor configurado.

**O que fica parado, e é menos do que parecia:** a **chamada** de extração de
registro estruturado (5.1), a **geração** de embedding (5.2) e a **execução** do
julgamento binário (5.4). Também os extratores de ingestão 3.2 a 3.6 — anúncio,
listagem, catálogo de distribuidor, PDF de tabela de preços e imagem de tabela.

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

## 2. Trava por dado que não existe neste ambiente

Não é decisão nem código: é informação do mundo que só se consegue com acesso a
uma conta real ou a um arquivo real.

### 2.1 Nomes de coluna das exportações (3.7 🚧)

O importador de planilha está completo e testado, e **os nomes de coluna nunca
foram confirmados contra uma exportação real** do Mercado Livre, da Shopee ou da
Amazon. A tabela de sinônimos foi montada por inferência.

**Mitigação que já está no código:** o mapeamento relata toda coluna que não
reconhece, e a tela de jobs mostra isso como alerta em cada job. Então a primeira
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

Há oito telas: início, `/jobs` (com detalhe por job), `/leitor`, `/identidade`,
`/compatibilidade`, `/fornecedores`, `/postagem` e `/consignacao`. **Não há tela de
catálogo, de SKU, de precificação nem de anúncio.** O motor de margem (fase 1), o
repositório de SKU (3.10) e o gerador de anúncio (8.1/8.2/8.3/8.5) seguem chamáveis
por código e por teste, não por tela — a de anúncio é a 8.11.

A de identidade fechou o próprio laço: decide pares, **propaga** para um SKU que já
exista e **cria** SKU a partir de um par quando nenhum dos dois lados tem um — com o
título preenchido por proposta e editável, porque criar SKU é decisão humana.

O que continua só por código: criar SKU **fora** de um par de identidade, editar SKU,
listar catálogo, e informar custo — que é o dado que falta para a margem sair. A
proposta de SKU deliberadamente não presume custo: preço de anúncio é o que outro
cobra, e presumir um pelo outro erraria a margem para o lado otimista.

A ordem é deliberada: a tela de jobs veio primeiro porque sem ela nada do que a
ingestão faz é auditável, e o leitor veio depois porque é a primeira função que
gera dinheiro. Mas a consequência é que **usar o M8 hoje exige escrever código**.

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

### 3.6 Vocabulário e navegação, por decisão do dono

Os rótulos "Jobs" e "Identidade" são nomes internos, e o dono do repositório disse
com clareza que não entende nenhum dos dois — nem "Resolver 10 agora", nem o texto
que explica o que é um SKU. Ele pediu para **terminar as fases primeiro** e revisar
vocabulário, funcionalidades faltantes e aparência depois, de uma vez.

O que foi feito nesta passada, porque era o mínimo para o sistema ser usável: a
tela nova não usa nenhum termo interno, e a navegação virou uma lista só, com
descrição por porta na página inicial — antes a tela de compatibilidade existia e
só se chegava nela digitando a URL.

O que **não** foi feito, de propósito: renomear as telas antigas. Meia renomeação é
pior que nenhuma, e a decisão de vocabulário é dele.

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

O dono relatou a tela de identidade "muito lenta, muito travada, fica
renderizando". Medido aqui em 13/09/2026, contra Postgres **local**, servidor de
desenvolvimento já aquecido:

| rota               | primeira visita | segunda |
| ------------------ | --------------- | ------- |
| `/`                | 0,79 s          | 0,04 s  |
| `/jobs`            | 0,43 s          | 0,08 s  |
| `/identidade`      | 0,13 s          | 0,05 s  |
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
