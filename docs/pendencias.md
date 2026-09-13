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

Há quatro telas: início, `/jobs` (com detalhe por job), `/leitor` e `/identidade`.
**Não há tela de catálogo, de SKU, de precificação nem de fornecedor.** O motor de
margem (fase 1) e o repositório de SKU (3.10) seguem chamáveis por código e por teste,
não por tela.

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

`describe.skipIf(!temBancoDeTeste())`. Medido sem `DATABASE_URL`: **202 testes de
949 não rodam** — 6 arquivos pulam por inteiro e outros 9 pulam parte, e a suíte
passa verde.

A conta cresceu com a fase 5, e cresceu na direção esperada: resolução de
identidade é quase toda comportamento de banco — `on conflict`, chave única do
cache, `check` do par ordenado, distância de cosseno no `pgvector`. Nada disso é
testável com dublê sem testar o dublê.

**Mitigação:** a CI tem Postgres com pgvector e aplica migrations **antes** dos
testes, justamente para que não passe verde por omissão. E agora há
`compose.yaml`, então rodar com banco local custa um comando.
**Consequência:** rodar `npm test` sem banco dá uma falsa sensação de cobertura
completa. O resumo do vitest diz quantos pularam — vale ler o número.

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
