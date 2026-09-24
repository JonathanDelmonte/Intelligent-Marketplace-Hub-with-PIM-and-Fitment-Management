# ADR 0009 — A navegação se divide por loja, e o que serve a todas aparece uma vez

**Estado:** Aceito · **Data:** 2026-09-24 · Pedido e aprovação do dono

## Contexto

A barra agrupava as quinze telas por momento de trabalho: hoje, catálogo,
oportunidade, fornecedor e obrigação. O dono disse que não era o que tinha na cabeça:
"parece um painel geral, um painel que alguém que não vende nessas lojas pode usar".
O que ele descreveu:

- uma área para cada plataforma, com um painel só dela ("só o faturamento da Shopee");
- conectar a loja com um clique, autorizando na central do vendedor;
- uma IA geral, que responde "qual foi meu faturamento na Shopee?";
- a separação clara entre o que serve a qualquer loja (garimpo, fornecedores,
  afiliados, fiscal) e o que é de uma loja só.

O desenho foi proposto em protótipo e aprovado em 24/09 ("pode prosseguir; se algo
não ficar bom, mudamos depois"). Ele tinha de caber nas regras que já valiam: a UI
pergunta por capacidade (ADR 0001), nenhuma tela depende de loja conectada (ADR 0002),
a IA entra só onde é IA (ADR 0005) e tudo funciona de graça primeiro (CLAUDE.md, 3.7).

## Decisão

**1. Duas espécies de coisa, dois lugares.** O que pertence a uma loja fica dentro da
área dela: pedidos, repasse, perguntas, anúncios, conexão e o faturamento. O que serve
a todas aparece uma vez só, fora das lojas: catálogo e preço, onde serve, garimpo,
monitor, bipar na loja, afiliados, fornecedores, consignação, fiscal e meu negócio.
Quando uma dessas precisa de loja, pergunta **em quais** — o achado do garimpo ganha
"Publicar em".

**2. A barra tem seis grupos.** No topo, sem título: o botão "Importar arquivo", Visão
geral, Assistente IA e Postar hoje. Depois Minhas lojas, Produtos, Oportunidades,
Fornecimento e Empresa. Juntar iguais passa a morar dentro do catálogo; perguntas e
repasse passam a morar na área de cada loja.

**3. A área da loja é uma tela só para todas as lojas**, `/lojas/[plataforma]`, com as
abas Resumo, Pedidos, Anúncios, Perguntas, Repasse e Conexão. Nada nela pergunta
`plataforma === 'x'`: o filtro dos dados é a coluna `plataforma`, e o que muda de uma
loja para outra — como conecta e o que oferece — vem das capacidades do adaptador. Loja
sem conexão funciona com a planilha e diz até que dia vão os números.

**4. Conectar é porta com estado.** A loja aparece como conectada, por planilha ou sem
dados, e a conexão mostra o caminho de cada uma. A autorização por OAuth é a etapa 2.6b,
e espera a decisão do dono sobre as APIs, adiada em 24/09. Até lá o caminho é a
planilha, e a tela diz isso em vez de mostrar um botão que falha.

**5. O assistente não inventa número.** O modelo só transforma a pergunta numa consulta
de um conjunto fechado — o quê, em que loja, em que período —, validada por Zod. Quem
faz a conta é o código, com os pedidos do perfil, e a resposta leva a fonte e a data do
dado. As perguntas comuns são entendidas sem IA, e as perguntas prontas nunca gastam
cota; com a cota esgotada, o assistente diz isso e as prontas continuam respondendo.

**6. Plataforma nova é entrega, não chave.** O conjunto de plataformas continua fechado
no código: o enum do banco e os `Record<Plataforma, …>` são o alarme de propósito. Cada
loja nova precisa de tabela de comissão conferida, mapeamento das colunas da planilha
tirado de uma exportação real, limite de título e formato do arquivo de importação.
"Adicionar loja" mostra as candidatas e o que falta a cada uma.

## Consequências

**A favor.** O dono lê o negócio loja por loja, e a visão geral soma todas. Plataforma
nova não cria tela: entra no registro, e a área dela aparece. A IA não tem como errar
um faturamento, porque não é ela que soma.

**Contra.** `pergunta_recebida` ganha a coluna `plataforma`, e as perguntas antigas,
sem loja, continuam na lista geral. Os números de uma loja por planilha são tão novos
quanto a última importação — a tela diz a data. A aba Anúncios mostra o catálogo pronto
ou não para aquela loja, e não os anúncios publicados nela: nada ainda lê o anúncio
publicado, nem planilha de anúncios nem API.

**Obrigação para quem mantém:** tela que filtra por loja recebe a plataforma pela URL ou
pelo registro, nunca por `if` de nome; coisa que depende do que a loja oferece lê o
estado da capacidade no adaptador. E a lista do que é "de uma loja" contra o que "serve
a todas" é esta: mudar um item de lado é decisão, e entra aqui.
