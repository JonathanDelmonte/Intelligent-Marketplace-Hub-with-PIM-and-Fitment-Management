# Diário de bordo

Registro corrido de **problemas, erros e decisões pequenas** encontrados durante a
construção. É o complemento dos [ADRs](./adr/): ADR é decisão de arquitetura, que
muda o desenho do sistema; aqui entra o resto — o bug que só o teste pegou, a
biblioteca que não serviu, o número que eu não pude confirmar, a escolha que
custou meia hora e vai economizar uma tarde.

Existe porque esse tipo de informação **desaparece**. Seis meses depois ninguém
lembra por que a coluna de preço da planilha da Shopee é tratada de forma
diferente, e o próximo a mexer refaz o mesmo caminho.

Ordem cronológica inversa: mais recente no topo.

Este arquivo diz **o que aconteceu**. Para a lista do que continua aberto, com o
que trava cada coisa, ver [pendências](./pendencias.md) — que é derivada daqui e do
roadmap.

Convenção de marcação:

- 🐛 **Bug** — algo estava errado e foi corrigido
- ⚠️ **Risco** — algo que pode dar errado e está sendo monitorado
- 🔀 **Decisão** — escolha entre alternativas, com o porquê
- ❓ **Não confirmado** — algo que assumi sem poder verificar
- 🧹 **Dívida** — atalho consciente, com o custo anotado

---

## 2026-09-15 — A interface parou de falar o nome das tabelas

### 🔀 Tela fala vendedor, código fala domínio — e a tradução mora num lugar só

O dono já tinha dito que não entendia "Jobs" nem "Identidade". Fechadas as fases, dava
para consertar de verdade, e o conserto foi maior que dois rótulos: as duas telas
estavam escritas no vocabulário do banco.

A tradução que passou a valer na interface:

| na tela                | no código                       | por que a palavra do código não serve |
| ---------------------- | ------------------------------- | ------------------------------------- |
| entrada                | `job`                           | nome de tabela, e em inglês           |
| processador da fila    | `poller`                        | nome de processo, não de trabalho     |
| oferta                 | `produto_externo`, "ocorrência" | "ocorrência" é palavra de log         |
| produto                | `sku`                           | sigla que o dono não usa falando      |
| como o sistema compara | `forma_canonica`                | nome de algoritmo                     |
| de onde veio           | `fonte`, "procedência"          | correto e frio                        |

O código ficou como estava. A regra que vale daqui em diante: **`apresentacao.ts` é a
fronteira da tradução** — dentro dele e para baixo, o vocabulário é o do domínio; para
cima, o de quem vende. Traduzir no meio (renomear a propriedade `ocorrencias` do
componente e deixar a tabela como `produto_externo`) seria ter dois vocabulários sem
fronteira, que é pior que ter um só errado: ninguém saberia qual está lendo.

A troca mais útil não foi de palavra e sim de frase. "Resolver 10 agora" virou "Tentar
juntar 10 automaticamente": o verbo velho não dizia o que ia acontecer, e num botão que
dispara trabalho automático isso é a informação principal.

### 🔀 A rota acompanhou o rótulo, menos a do leitor

`/jobs` virou `/importar` e `/identidade` virou `/juntar-iguais`, com redirecionamento
permanente das duas antigas: a URL é texto que alguém lê, e um favorito que cai em 404
faz parecer que a tela foi removida.

`/leitor` ficou. É a tela instalável como aplicativo, e trocar a rota de uma PWA já
instalada quebra o atalho que está na tela inicial do celular — o rótulo virou "Bipar na
loja" e a rota continuou `/leitor`. Rótulo e rota não precisam coincidir; o que não pode
é o rótulo mentir.

## 2026-09-15 — O contêiner parou o Postgres, e desta vez foi só isso

### 🐛 Cluster parado com as bases intactas — o roteiro de reconstrução era maior que o problema

Depois de uma pausa da sessão, a suíte de banco voltou a falhar com o sintoma da entrada
"O contêiner reiniciou e levou o Postgres inteiro", da fase 8: teste de banco falhando em
série, cada um esperando conexão até estourar. `pg_lsclusters` disse o que importava —
cluster **`down`**, ainda na porta 5433, com o diretório de dados no lugar.

`pg_ctlcluster 16 main start`, e nada além disso. A porta continuou 5433, o `pg_hba.conf`
continuou com `trust` no laço local, e as duas bases continuaram com schema e com o dado
de demonstração. O roteiro de sete passos da entrada anterior vale para quando o contêiner
é reciclado de fato; este era o caso menor, e aplicar o roteiro grande teria recriado à toa
o que já estava lá.

A ordem certa de diagnóstico, então, é `pg_lsclusters` **antes** de qualquer conserto: ele
separa "parado" de "sumiu", e são consertos de tamanhos muito diferentes. O sintoma nos
testes é o mesmo nos dois casos.

Nota sobre o tempo, que vale como sinal: `npm run check` com o banco fora **não** falha
rápido. Cada teste de banco espera o timeout de conexão, e a suíte que roda em 40 segundos
passou de cinco minutos antes de eu interrompê-la. Suíte subitamente lenta é sinal de banco
fora, não de teste pesado.

## 2026-09-15 — Estado do roadmap: o que ⬜ escondia

### 🔀 Nove entregas passaram de ⬜ para 🔒, e a conta de ⬜ agora é zero

Fechada a fase 11, contei os estados do roadmap: 82 ✅, 9 🚧, 9 ⬜, 5 🔒. Fui olhar as
nove em ⬜ uma por uma — 2.6b, 3.2, 3.3, 3.4, 3.5, 3.6, 6.10, 6.11 e 7.3 — e nenhuma
delas **pode** começar neste ambiente: cinco precisam de rede de saída, duas de chave de
LLM, uma de app no Mercado Livre, e a nona é a 3.5, logo abaixo.

"Não começou" e "está bloqueado" parecem a mesma coisa de longe, e são opostos na hora de
decidir o que fazer amanhã: o primeiro é fila de trabalho, o segundo é fila de decisão — e
as decisões dessa fila são do dono, não minhas. Uma lista que mistura os dois faz o dono
procurar tempo quando o que falta é uma chave.

### 🔀 A 3.5 (PDF de tabela de preços) ficou 🔒 por escolha, não por impedimento

É a única das nove que eu **conseguiria** entregar aqui: gerar um PDF sintético de tabela
de preços, escrever o leitor e passar o teste é trabalho de uma tarde.

Ficou 🔒 de propósito. O problema real da 3.5 não é ler PDF, é a variedade de layout de
tabela de fornecedor — e um extrator calibrado contra um PDF que eu mesmo gerei testaria a
minha suposição de layout, não o mundo. Sairia com teste verde, a primeira tabela real
quebraria, e o verde já teria comprado confiança que não existia.

É o mesmo cuidado de `ingestao/planilha/mapeamento.ts`, que relata coluna não reconhecida
em vez de adivinhar — com a diferença que decide o caso: lá existe uma planilha de verdade
do outro lado para corrigir o mapeamento; aqui não existiria nada para corrigir.

## 2026-09-15 — Fase 11: monitor, pós-venda e afiliados

### 🐛 `codigosDeModelo` inventava código juntando números por uma palavra

`codigosDeModelo("é 110 ou 220?")` devolvia `110OU220`. A junção de tokens vizinhos
existe porque metade das fontes escreve `PA 21 G` com espaço, e as três guardas dela
olhavam tamanho do fragmento, alternância de classe e tamanho do primeiro — nenhuma
reparava que o fragmento do meio era **uma palavra**.

O efeito não era teórico. `responder()` usa esta função desde a fase 6: uma pergunta de
voltagem chegava como pergunta sobre um modelo inexistente, e o comprador receberia a
resposta errada. Dois módulos, um bug, e ele só apareceu quando escrevi o detector de
pergunta recorrente — que agrupa dúvidas pelo mesmo caminho e, por isso, tropeçou nele.

Vale como padrão: **função compartilhada carrega bug compartilhado**, e o segundo
chamador é quem costuma encontrá-lo. A guarda nova é uma lista curta de palavras do
português que cabem no limite de quatro caracteres e alternam classe com um número.

### 🐛 `par` casava dentro de "paralelo"

No detector de tema da pergunta, `par` (de "vem em par?") estava na lista de quantidade
e casava por substring — então "é original ou paralelo?" era classificada como pergunta
de quantidade.

Consertei o **casamento**, não a lista: palavra curta agora é comparada por fronteira.
Tirar `par` da lista resolveria este caso e deixaria o próximo em pé — "par" mora dentro
de parafuso, aparelho e separado, e a lista tem outras palavras de três letras.

Fronteira escrita à mão em vez de `\b`, porque há termos numéricos na tabela (`110`,
`220`) e `\b` trata dígito como caractere de palavra, o que daria comportamento
diferente para os dois tipos de termo na mesma função.

### 🔀 O agrupamento é o que separa alerta de inteligência, e é determinístico

A especificação define M15 pela diferença entre "o preço do concorrente caiu 8%" e
"caiu 8% **e** aumentou o estoque ao mesmo tempo… provável troca de fornecedor, não
queima de estoque".

Achei que a segunda frase fosse toda LLM, e não é. "Mesmo alvo, mesma semana" é regra;
"preço caindo com estoque subindo" é uma combinação nomeável; e a conclusão — queima de
estoque não vem com reposição — é uma frase escrita uma vez. O que sobra para o LLM é
a leitura específica daquele caso, e ela entra **em cima** disso, não em vez disso.

Então o exemplo que dá nome ao módulo sai sem chave de LLM. O que não sai é a nuance
("três semanas depois de um fornecedor novo aparecer no 1688"), e isso é honesto: essa
parte exige ligar eventos de fontes diferentes com julgamento.

### 🔀 A mudança pequena não é evento, e dizer isso é metade da entrega

Preço de marketplace oscila por centavo e por arredondamento de frete embutido. Um
monitor que avisa de 0,5% é um monitor desligado na segunda semana — então
`eventoDePreco` devolve `null` abaixo de 3%, e devolver `null` é parte do contrato.

A severidade é assimétrica de propósito: queda de concorrente é mais grave que alta.
Alta é oportunidade e pode esperar; queda come a venda de hoje.

### 🔀 Sem clique, a conversão é nula e não zero

No rastreio de afiliados, zero conversão sobre zero clique não é "o grupo não
converte" — é "ninguém clicou". As duas leituras levam a ações opostas: uma manda mexer
na oferta, a outra no texto do post e no horário. Então `conversaoBp` é `null` sem
clique, com a frase que diz qual é qual.

Mesmo raciocínio do dossiê sem achado e da referência de preço sem observação: **falta
de dado tem nome próprio**, e colapsá-la num zero é a forma mais comum de o sistema
mentir sem mentir.

### 🔀 No grupo de ofertas, o limite não é técnico

É a paciência de quem lê. A especificação dá o número que mata — 40 por dia silencia o
grupo — e o detalhe que torna isso perigoso é que grupo silenciado **não dá erro**: não
aparece em log, não falha, e continua recebendo publicação para ninguém.

Por isso o teto diário e o espaçamento são a entrega deste item, e não uma precaução em
volta dela. Oito por dia e 45 minutos são escolha declarada, e ficam nomeados para
ajustar com taxa de saída do grupo na mão — a medida que importa, e que não existe ainda.

### 🧹 Dois `as` que eu escrevi e tirei na mesma sessão

`as PontosBase` no cálculo de conversão e `as MotivoDeParada` na leitura do dossiê. Os
dois foram atalho para fazer o compilador calar num lugar onde ele estava certo, e os
dois tinham conserto de uma linha: `pontosBase()` na borda, e `$type` no schema.

Anotado porque a tentação foi idêntica nos dois casos e o custo era baixo nos dois —
que é exatamente quando a regra das convenções vale: se `as` fosse aceitável quando o
conserto é barato, ele apareceria em todo lugar onde o conserto é barato.

## 2026-09-15 — Fase 10: a máquina do prospector, separada do julgamento

### 🔀 O que é máquina e o que é julgamento, e por que a linha fica ali

A especificação diz que o prospector é IA de verdade porque "as decisões de o que
investigar a seguir, em quem acreditar quando as fontes discordam, e quando parar não
são expressáveis como regra fixa".

Duas das três são. **Quando parar** é regra fixa: orçamento gasto, ou três
investigações seguidas sem achado novo. E escolher o próximo item da fronteira é
ordenação, não julgamento — o julgamento está em *que valor atribuir* a cada item, não
em *qual dos valores é maior*.

Então a linha ficou aqui: a máquina ordena, conta, detecta saturação e não repete; o
LLM atribui valor, levanta hipótese e decide em quem acreditar. E isso paga duas vezes
— máquina determinística se testa com dezenas de cenários em milissegundos, e o erro
caro do módulo (não parar) é falha de máquina, não de julgamento.

### 🔀 Valor esperado **por custo**, e por que a divisão importa

A especificação diz "o item de maior valor esperado por custo", e é fácil ler isso
como "maior valor esperado". Não é a mesma coisa, e a diferença aparece no primeiro
orçamento pequeno: duas hipóteses de valor 80, uma custando uma busca e a outra seis
páginas. Ordenar por valor escolhe qualquer uma; por valor por custo escolhe a barata.

Num teto de dez passos, a primeira leitura gasta seis num item e sobra quatro; a
segunda investiga seis itens. É a diferença entre meia investigação e uma inteira.

A divisão é inteira (valor × 1000 ÷ custo) e o desempate é pelo id. Sem ordem estável,
duas execuções do mesmo dossiê investigam em ordens diferentes, e aí o dossiê não é
auditável — que era o ponto dele.

### 🔀 Saturação é verificada antes de orçamento

Parecem dois limites da mesma natureza, e não são: orçamento é parada por **limite**,
saturação é parada por **ter terminado**. Se as duas condições valem ao mesmo tempo, o
motivo reportado precisa ser saturação — senão o dono aumenta o teto e paga passos
para confirmar o que o sistema já sabia.

A mensagem diz isso com palavras: "parar aqui é ter terminado, não ter esbarrado no
teto — aumentar o orçamento não traria mais nada".

### 🔀 Dossiê parcial é o caminho normal, não o de exceção

`paraGravar` monta um dossiê completo e salvável em qualquer ponto da execução, e o
repositório grava a cada passo. Estourar o teto então não perde nada: o que está no
banco é o que foi descoberto até ali, e continuar não recomeça.

Se o dossiê só fosse montado no fim, estourar o orçamento jogaria fora a investigação
inteira — pagando duas vezes pela mesma coisa, que é exatamente o que o teto existe
para evitar.

O upsert é por alvo normalizado. "Refil Purificador PA21G" e "refil purificador pa21g"
como dois dossiês seria o jeito mais silencioso de perder investigação paga: nenhum dos
dois estaria errado, e nenhum dos dois estaria completo.

### 🔀 `achadosSemOrigem` existe para a auditoria ser verificável

A especificação promete que cada item do dossiê tem a URL de onde veio. Promessa em
prosa não se verifica, então há uma função que lista os achados sem origem e um resumo
que avisa quando há algum. Achado sem fonte é afirmação sem fonte, e a disciplina de
evidência do M4 já decidiu o que isso vale.

### ⚠️ A rede deste ambiente recusa o PNCP

`curl` em `pncp.gov.br` volta `CONNECT tunnel failed, response 403` — a política de
rede do ambiente remoto libera registries de pacote e as APIs da Anthropic, e nada
mais. Então 10.4 ficou 🔒 com a porta pronta: leitura com Zod, casamento de descrição e
referência de preço testados, e implementação de consulta ausente, como a base de GTIN
do M14.

Vale registrar porque a conclusão errada seria "o PNCP não serve": ele serve, e o
código para usá-lo está escrito. O que falta é a rede de um ambiente que possa sair.

### 🔀 A referência de preço público é mediana, e a mediana par não faz média

Compra pública tem cauda longa: um contrato de mil unidades a preço de atacado, ou um
item cadastrado com dois zeros a mais, arrasta a média para longe do que o mercado
pratica. Mediana não se move por causa de um — a mesma escolha do detector de queda de
preço do M13.

Com quantidade par, devolve o **menor** dos dois centrais em vez da média deles. A
média de dois centavos inteiros pode dar meio centavo, e meio centavo não existe
(ADR 0004) — arredondar ali seria inventar precisão que a fonte não tem.

### 🐛 Commitei com o `tsc` quebrado, pela segunda vez na semana

Rodei `npm run check > log 2>&1; echo "EXIT=$?"` e emendei `&& git add … && commit`. O
`&&` olha o código de saída do `echo`, que sempre passa — então o commit entrou com dois
erros de tipo.

É o mesmo erro de forma que o `npm run check | tail` de duas semanas atrás, e o
conserto é o mesmo: **o commit tem de estar depois de um `&&` cuja esquerda seja o
`check`**, sem `echo` no meio. Consertei os tipos e emendei o commit antes de publicar,
mas o hábito é que falhou, não a sorte.

O que os dois erros eram, de passagem: a classe de porta ausente não aceitava o
parâmetro que a interface declara, e o `EstadoDaCapacidade` do projeto exige um
`rotulo` que meus fixtures não tinham.

## 2026-09-15 — Fase 9: fiscal, e o regex de dinheiro escrito quatro vezes

### 🔀 O alerta de teto do MEI lidera pela projeção, não pelo acumulado

70% do teto em setembro é tranquilo. 70% em abril vai estourar. O acumulado é o
**mesmo número** nos dois casos, e é por isso que ele sozinho avisa tarde — quando
avisa, já não dá para fazer nada além de mudar de regime.

Então há dois avisos, de naturezas diferentes: o acumulado cruzou 70% ou 85%, que é
fato sobre o passado, e a projeção estoura no ritmo atual, que é hipótese sobre o
futuro. A mensagem diz qual é qual, com essas palavras — "é hipótese, calculada em
linha reta".

A projeção linear é escolha declarada. Receita de reposição tem estação, e linear
subestima quem vende em novembro e dezembro. Modelar sazonalidade exigiria histórico
de anos que este sistema não tem, e projeção sazonal errada assusta mais que linear
honesta. A linear erra para o lado conservador: quem projeta estouro com ela vai
estourar mesmo.

### 🐛 O teto proporcional era a diferença entre "tranquilo" e "já estourou"

R$ 40.000 de receita é metade do teto cheio — tranquilo. E é quase todo o teto de
quem abriu o CNPJ em julho, porque o teto do MEI é proporcional no ano de abertura.
Sem isso o controle diria "com folga" para quem está a um mês do desenquadramento.

Só apareceu ao escrever o teste do caso; a primeira versão dividia por doze sem olhar
o mês de abertura. Trunca em vez de arredondar para cima, porque arredondar daria ao
vendedor um teto que ele não tem.

### 🔀 Erro de formato recusa; valor fora da lista grava com aviso

O cadastro fiscal tem duas formas de estar errado, e elas merecem tratamentos
opostos.

NCM com sete dígitos é **digitação**, não opinião: recusa, porque gravar viraria nota
rejeitada em janeiro descoberta com o pedido esperando postagem. CST com um valor que
não está na minha lista de valores comuns é outra coisa: a lista é o que **eu**
conheço, não o que existe, e recusar um código correto pararia a operação por causa da
minha ignorância. Esse grava, com aviso.

É a pior assimetria possível de errar ao contrário — um sistema que recusa o certo e
aceita o errado.

### 🔀 A sugestão de NCM nunca grava, e o botão dela é separado

A especificação pede "exige confirmação sua", e a forma mais fácil de trair isso
seria um botão que sugere e grava de uma vez. Então são dois formulários: "Sugerir
NCM" preenche o campo e mostra a justificativa; "Gravar" é outro clique.

NCM errado não dá erro na hora — dá nota emitida com tributo errado, descoberta na
fiscalização. É o tipo de erro em que a confirmação humana não é burocracia.

A justificativa é obrigatória no schema da resposta, com tamanho mínimo. Sem ela não
existe a "revisão de trinta segundos" que a especificação promete: `84212100` sozinho
não dá para conferir.

### 🧹 O mesmo regex de dinheiro estava escrito quatro vezes

`^\d+(?:[.,]\d{1,2})?$` aparecia no leitor, na consignação, na montagem de anúncio e
na tela fiscal. Cada cópia nasceu de um formulário novo, e nenhuma era errada — o
problema é que regra de dinheiro repetida é regra que vai divergir: basta alguém
afrouxar uma cópia para o mesmo valor ser aceito numa tela e recusado na outra.

Virou `lerReaisDigitados` em `lib/dinheiro`, com a versão mais pensada das quatro (a
do leitor, que recusa separador de milhar de propósito: num campo de preço de peça,
`1.200` é quase sempre `12,00` com o dedo errado). Devolve nulo em vez de lançar,
porque quem chama é formulário e formulário precisa de um "não", não de uma exceção.

O que era específico ficou específico: o leitor continua exigindo maior que zero,
porque custo zero no balcão é campo em branco com um dedo no teclado, e viraria markup
infinito no veredito.

### 🐛 `Record<string, …>` escondeu o nome errado de uma coluna

`gravarCodigos` montava o objeto de atualização num `Record<string, string | null |
Date>` e escrevia `categoria_regulada` — o nome da **coluna**. O Drizzle espera
`categoriaRegulada`, o nome da **propriedade**, e aceita chave desconhecida em
silêncio: a gravação simplesmente não aconteceria, sem erro nenhum.

O tipo solto foi o que escondeu. Trocado por `Partial<typeof sku.$inferInsert>`, que
recusa a chave errada na compilação, e o teste de banco grava e relê a marcação para
provar.

É a mesma família do `as` que as convenções proíbem: tipo largo demais não é
conveniência, é o compilador desligado no lugar exato onde ele ajudaria.

### 🐛 Três testes meus não alcançavam a guarda que nomeavam

Escrevi testes de "descarta NCM fora de forma" com códigos de sete caracteres — que o
**schema Zod** recusa antes, então nunca chegavam à guarda. A guarda existe para
caractere errado (`8421.21.0X`, dez caracteres, passa o schema), e é isso que os
testes testam agora.

O terceiro pedia `Orcamento(1_000, 0)` esperando estouro, e `Orcamento` recusa teto
zero na construção — com razão: orçamento zero é configuração errada, não execução sem
orçamento. Agora o teto é de uma chamada, a primeira passa e a segunda estoura.

Teste que passa sem exercitar o que nomeia é pior que teste ausente: ele afirma uma
garantia que não existe.

### 🔀 O tom de prazo vencido é neutro, não alerta

Parece errado à primeira vista, e é deliberado: ou o prazo foi cumprido, e não há
alerta nenhum, ou não foi — e aí o alerta de verdade é a nota sendo rejeitada, não a
data no painel. Pintar de vermelho para sempre uma data que passou treina a pessoa a
ignorar a cor.

Por outro lado, prazo vencido **não desaparece** da lista. Desaparecer faria parecer
que estava tudo bem.

### 🐛 "Os 1 produtos ativos estão com NCM preenchido"

Concordância no plural fixo, e um produto só é exatamente o caso de quem está
começando — a primeira pessoa a ver a tela ia ver a frase errada. Só apareceu no
navegador; nenhum teste lia a frase com contagem 1.

## 2026-09-15 — Fase 8: a tela de anúncio, e o banco que o contêiner levou

### 🔀 A montagem do anúncio mora na URL, não em estado de sessão

Formulário GET em vez de ação de servidor, e a escolha tem uma razão concreta: a
rota que devolve o arquivo de importação precisa montar **o mesmo anúncio** que a
tela mostrou. Se a montagem vivesse em estado, o botão de baixar refaria as escolhas
de memória, e "o arquivo saiu diferente do que eu vi na tela" seria um bug possível.

É o bug mais caro desta tela, porque ninguém confere um CSV de sete colunas antes de
subir na plataforma — o erro apareceria como anúncio publicado errado. Com os dois
lados lendo a mesma query string pela mesma função, não há por onde divergir, e o
teste de ida e volta da query string fixa isso.

De brinde: link compartilhável, botão de voltar funcionando, e histórico do
navegador servindo de rascunho.

### 🐛 O checklist apontava um problema que nenhuma tela sabia consertar

Dirigindo a tela recém-escrita, o download ficou bloqueado por falta de
`categoria` — corretamente, porque a importação do ML recusaria a linha. Aí veio a
descoberta: **nenhuma tela do sistema escrevia `categoria_ml`**. Só código.

Ou seja, a entrega da fase — "baixar o arquivo" — era inalcançável para qualquer SKU
real, e o checklist que eu tinha acabado de escrever apontava o único atributo
bloqueante sem oferecer caminho de conserto. Meio checklist, e a metade inútil.

O conserto entrou na mesma tela, ao lado do item que aponta a falta, e volta para a
mesma montagem depois de gravar — a pessoa preencheu a categoria **para** ver o
anúncio sair, e perder a escolha ali faria ela refazer tudo.

A lição de método: só dirigir a tela mostra isso. Teste de unidade da conferência
passava, teste do repositório passava, e a tela estava correta — o buraco era entre
as peças, num lugar que nenhum teste olhava.

### 🔀 O tipo do produto não tem coluna, e vem do registro das ocorrências

`montarAnuncio` pede `tipoProduto` ("refil de purificador de água"), e `sku` não tem
esse campo. O dado existe: mora em `atributos_extraidos` de `produto_externo`, que é
de onde a propagação de identidade monta o título interno como "tipo marca modelo".

Então é de lá que ele volta, com duas decisões. Entre duas ocorrências vence a **mais
completa**, não a mais recente — uma ocorrência nova de distribuidor que só publica o
código da peça é mais recente e sabe menos que a antiga de um anúncio com a ficha
inteira; `riquezaDoRegistro` já existia para essa comparação, escrita para decidir se
valia gastar LLM. E o valor aparece em **campo editável** na tela em vez de ser usado
em silêncio, porque extração erra e quem está vendo a tela sabe mais que ela.

### 🔀 A rota recusa o que a plataforma recusaria

Primeira rota de API do projeto, e ela abre uma convenção: rota só existe quando a
resposta não é HTML.

A decisão que vale registrar é a recusa. Anúncio com atributo de nível `bloqueia`
faltando devolve 409 e diz o que falta, em vez de gerar o arquivo. Gerar seria
entregar algo que a importação rejeita — o sistema gastaria a confiança de quem subiu
para a pessoa descobrir sozinha o que ele já sabia. E a tela, pelo mesmo motivo, só
mostra o link quando o arquivo sai: **botão que existe e recusa é pior que botão que
não existe**, porque o primeiro promete e o segundo explica.

### 🐛 O contêiner reiniciou e levou o Postgres inteiro

A suíte de banco falhou com `ECONNREFUSED` em 5433. O cluster estava parado, e ao
subir voltou na porta 5432 com `pg_hba.conf` de fábrica e **sem as bases**: `bancada`
e `bancada_teste` não existiam mais, nem o papel `bancada`.

O que consertou, na ordem: subir o cluster, mover a porta de volta para 5433, trocar
`scram-sha-256` por `trust` em 127.0.0.1 (a URL local não tem senha), recriar papel e
as duas bases com `vector`, migrar as duas, semear o perfil, e refazer o passeio do
README para ter dado de demonstração.

Fica registrado porque vai acontecer de novo, e porque o diagnóstico inicial engana:
`ECONNREFUSED` parece problema de configuração do projeto, e era o contêrner tendo
sido reciclado. **Nada disso vive em disco persistente** — em ambiente remoto, banco
local é descartável, e é por isso que o passeio do README precisa continuar
funcionando de ponta a ponta.

### 🐛 Dois testes meus passavam no vitest e não no `tsc`

Escrevi a fixture da conferência de atributos sem anotação de tipo, então
`categoria: 'MLB1234'` foi inferido como `string` e não `string | null` — e os testes
que passam `null` para ver a falta compilavam errado. O vitest não typecheca, então
passaram; `npm run check` pegou.

Segunda ocorrência do mesmo tema desta semana: **rodar o teste não é o mesmo que
verificar o código.** A primeira foi `npm run check | tail`, que devolve o código de
saída do `tail`.

### 🧹 Fixture de teste esqueceu duas colunas obrigatórias

`aparelho.fonte` e `compatibilidade.verificado_por` são `not null`, e a fixture nova
não as preenchia. O erro é bom: significa que o schema não deixa entrar registro sem
procedência nem afirmação de compatibilidade sem quem a verificou, que é exatamente a
regra da seção 3.3 das convenções sendo cumprida pelo banco em vez de por disciplina.

## 2026-09-14 — Fase 8: gerador de anúncio

### 🔀 Exigência de atributo nomeada pela consequência, não pela força

`obrigatorio` / `opcional` foi a primeira ideia e não sobreviveu a uma pergunta: o
que a pessoa faz diferente ao ler cada um? Nada — os dois viram "depois eu vejo".

Os níveis passaram a dizer o que acontece se faltar: `bloqueia` (a linha do arquivo
de importação não existe), `devolucao` (publica, vende e volta), `ranqueia` (a frase
da especificação) e `ajuda` (reduz pergunta). Com isso a ordem da tela sai de graça,
e o texto de cada item pode explicar o custo em vez de repetir o nome do campo.

`bloqueia` e `devolucao` pesam **igual** no preenchimento, de propósito. Um é anúncio
que não existe; o outro é anúncio que existe e perde dinheiro com a reputação junto.
Não achei forma honesta de ordenar os dois num número só, então o número não finge
ordenar — a tela lista os dois grupos separados.

### 🔀 O número do checklist chama-se preenchimento, não completude

Escrevi `completudeBp` primeiro, e o nome estava mentindo. Um anúncio com 90% dos
atributos preenchidos e um `bloqueia` aberto não publica de jeito nenhum, e
"completude 90%" convida exatamente à conclusão errada ("está quase pronto").

Ficou `preenchimentoBp` — que é o que mede, a fração do checklist que está cheia — e
`podeExportar` como a resposta separada para "dá para gerar o arquivo". Nome de campo
é interface: o número não muda, a conclusão de quem lê muda.

### ❓ Os traços de produto vêm de tabela de palavra, e isso é palpite declarado

O checklist de 8.3 decide o que exigir a partir de traços do produto (elétrico,
medida crítica, consumível), detectados por palavra no tipo do produto. Não há
validação nenhuma dessa tabela contra catálogo real — é o mesmo tipo de palpite dos
nomes de coluna de exportação, e falha do mesmo jeito correto: traço não detectado é
exigência **não cobrada**, nunca exigência errada.

A exceção é `reposicao`, que vem da ficha de compatibilidade em vez de palavra: se
há qualquer linha de compatibilidade, o produto serve em outro produto, e é isso que
peça de reposição quer dizer. Estrutura onde a estrutura existe, palpite só onde não
existe.

### 🔀 Alerta de catálogo do ML: dois sinais, e o fraco nunca decide

8.5 não tinha como ser confirmado sem API. O que havia eram dois sinais nos dados que
a ingestão já traz: a URL `/p/MLB…`, que é estrutural e forte, e vários vendedores no
mesmo GTIN, que é indício — pode ser só concorrência sem ficha nenhuma.

Sinal fraco sozinho para em `provavel` e a mensagem manda confirmar abrindo um
anúncio. É a mesma disciplina da confiança graduada da fase 6, aplicada a outro
assunto, e a primeira vez que reusei a regra em vez de reinventá-la.

O que não esperava ao escrever: **o mesmo fato muda de sinal conforme quem lê**. Com
reputação verde, ficha de catálogo é oportunidade — dá para disputar o destaque e
ficar com a vitrine inteira em vez de dividir. Sem, é a quase invisibilidade de
"outras opções de compra". Um alerta que não sabe quem está lendo diria a coisa
errada para metade dos casos, então a reputação é parâmetro — e `nao_informada` não é
o mesmo que ruim: chutar ruim para todo mundo é como se desliga um alerta.

### 🔀 Conferência de consignação: o risco é unidade exposta, não data vencida

A primeira versão do alerta comparava `conferido_em` com sete dias atrás. Ela erra
nos dois sentidos, e só vi isso escrevendo o teste: linha com zero unidade sem
conferir há um mês não tem risco nenhum — não há o que a loja venda no balcão nem o
que eu venda errado —, e linha com trinta unidades anunciadas conferida há oito dias
é a que cancela uma venda hoje.

A urgência passou a combinar tempo com exposição, e a ordem dentro do mesmo estado é
por unidade exposta. A frase da especificação já dizia isso desde o começo — "o risco
é a loja vender no balcão o que você tem anunciado" — e eu tinha lido "alerta
semanal" como se o prazo fosse o assunto.

### 🔀 Conferir exige a contagem do parceiro, sem botão "conferi"

Um botão que só marca a data é o pior resultado possível nesta tela: apaga o alerta e
deixa o número errado. Então o formulário tem campo numérico obrigatório, já
preenchido com o que o sistema acha — para a pessoa só mexer quando difere, que é o
caso raro e o único que importa.

Pelo mesmo motivo, o pedido de conferência ao parceiro manda a contagem do sistema:
"quantos você tem?" recebe "acho que uns cinco"; "tenho cinco anotados, confere?"
recebe sim ou o número certo.

### 🐛 `networkidle` do Playwright volta antes de o roteador aplicar o payload

Dirigindo a tela de consignação no navegador, o cadastro gravou no banco — a tela de
postagem mostrou "6 unidades sem conferência" — e a própria tela de consignação, lida
logo depois do envio, mostrou "nenhum item em consignação".

Quase abri caça a bug de cache no Next. O que era: `waitForLoadState('networkidle')`
depois do clique volta antes de o roteador do App Router aplicar o payload novo, e eu
lia o DOM antigo. `curl` na URL de destino mostrou a tela correta, com o item, o aviso
e o fechamento. O conserto é esperar a navegação (`waitForURL`), não a rede.

Fica anotado porque o sintoma imita um bug de produto de forma convincente: dado
gravado, uma tela vê, a outra não.

### 🧹 Duas dívidas conscientes entraram com a consignação

O fechamento usa o preço de repasse **atual**, então mudar o acordo mexe em mês já
fechado; e quando o mesmo SKU está em duas lojas, a venda não diz de qual delas a
peça saiu. As duas estão em pendências (4.7 e 4.8) com o custo e o gatilho de
consertar, e as duas ficam **visíveis** no fechamento — que é a razão de ele aparecer
aberto, parceiro por parceiro, em vez de só o total.

### 🐛 O núcleo guardado em `globalThis` servia a forma antiga do código

Sintoma: depois de acrescentar o executor de pedido ao núcleo, a tela de jobs
quebrou com `Cannot read properties of undefined (reading 'processarProximo')`.
Mensagem que não aponta para nada — o código que falhou estava certo, e o objeto que
chegou nele é que era velho.

Causa: `montarNucleo()` guardava a instância num `Symbol.for` em `globalThis`,
"pelo mesmo motivo do pool de conexão". O motivo não se aplicava. `globalThis`
sobrevive à reavaliação de módulo da recarga a quente — que é exatamente o ponto de
usá-lo para o pool — e o que sobrevive aqui é **um objeto com a forma do código
anterior**. Campo novo no núcleo, e a tela continua com o núcleo sem ele.

Conserto: tirar o cache. O pool já é guardado em `banco/cliente.ts`, e todo
componente do núcleo é casca sem estado em volta dele — montar por chamada é um
punhado de `new` em objeto vazio.

A parte que interessa: **isso não apareceu em teste nenhum, e não apareceria.**
Teste monta o grafo do zero toda vez, então nunca vê um núcleo velho. É bug que só
existe em desenvolvimento, e o custo dele é o tempo de quem procura no lugar errado
— eu procurei no executor de pedido, que estava correto. Cache de grafo de objeto é
armadilha por mudança de forma; cache de recurso caro (conexão) não é.

### 🐛 Planilha sem plataforma no nome mandava configurar LLM, que não era o problema

Visto no navegador, não em teste. Subi uma planilha de venda chamada
`vendas-demo.csv` e ela foi para revisão com:

> não há extrator para "planilha_generica" ainda. Esse tipo depende de extração por
> LLM (roadmap, etapas 3.2 a 3.6), que precisa de chave de LLM configurada.

A mesma planilha, renomeada para `vendas_mercadolivre.csv`, atravessou o sistema
inteiro: ingestão, encaminhamento, pedido gravado, margem calculada. Ou seja: não
faltava extrator, não faltava LLM, e não faltava chave nenhuma. Faltava **o nome do
arquivo dizer de qual plataforma são as colunas**, porque é isso que escolhe a
tabela de sinônimos.

A mensagem era verdadeira para seis dos sete tipos que caíam naquele `case`, e falsa
justo para o que tem conserto trivial. Pior: mandava a pessoa gastar tempo
configurando LLM para resolver um problema de renomear arquivo.

Conserto: `planilha_generica` ganhou `case` e mensagem próprios, que dizem o que
falta, **negam o LLM explicitamente** e dão exemplos de nome que funcionam. Os
exemplos moram ao lado das pistas de reconhecimento, com teste conferindo que cada
um é de fato aceito — mensagem que ensina a renomear e padrão que aceita o nome
mudando juntos.

A lição que passa do caso: mensagem de erro genérica agrupada por implementação
("todos estes não têm extrator") mente sobre o caso particular. O agrupamento certo
é por **o que a pessoa tem de fazer**, e aqui eram duas coisas diferentes —
esperar o extrator, ou renomear o arquivo e reenviar.

### 🔀 Planilha de venda virou job próprio, e não um ramo do executor de ingestão

A distinção entre planilha de anúncio e de venda só existe depois de ler o
cabeçalho e mapear as colunas. Então alguém tem de descobrir no meio do caminho, e
havia duas formas:

1. **Injetar** repositório de pedido e resolvedor de perfil no executor de
   ingestão, e gravar ali. Mais curto.
2. **Encaminhar** para uma fila própria, com executor próprio.

Escolhi a segunda por um motivo de acoplamento: pedido é dado operacional e exige
`perfil_id`, e o executor de ingestão grava base compartilhada, que não tem perfil
nenhum. A primeira forma colocaria perfil num lugar que não precisa dele — o tipo
de acoplamento que não dói hoje e dói quando alguém for mexer.

O custo é reler o arquivo. É armazenamento endereçado por hash em disco local, e
reler é exatamente o que a retomada de job já faz.

De passagem, o resultado do executor de ingestão ganhou um caso `encaminhado`, em
vez de fingir que concluiu uma ingestão que não aconteceu. Resultado honesto custa
um membro na união e evita a pergunta "por que este job diz que gravou zero
ocorrências".

### 🧹 `LinhaImportada` passou a expor o mapeamento, como `LinhaRejeitada` já fazia

O conversor de pedido precisa da linha mapeada, e só a linha **rejeitada** expunha
isso. A alternativa era uma segunda cópia do leitor inteiro — detecção de
separador, busca de cabeçalho, mapeamento de coluna — para planilha de venda. Cópia
de código testado é como o conserto de um lado não chega no outro.

Custo do atalho: `LinhaImportada` carrega um campo que só um consumidor usa. É
pequeno e simétrico com a linha rejeitada, que já carregava.

### 🔀 Margem realizada é gravada; veredito de fornecedor e ficha, não

Três módulos desta semana tomaram a decisão oposta sobre a mesma pergunta — gravar
o resultado ou recalcular na leitura — e vale registrar por quê, porque o critério
é o mesmo nos três:

- **Veredito de fornecedor** e **ficha de compatibilidade**: recalculados. O
  resultado depende de critério configurável, e mudar o critério tem de valer para
  o cadastro antigo. Gravar deixaria a base com dois vereditos conforme a data.
- **Margem realizada**: gravada. O número é **histórico** — a margem daquela venda
  foi aquela, com o custo que o item tinha naquele dia. Recalcular com o custo de
  hoje reescreveria o passado, e é o passado que se quer medir.

O critério, então: **recalcula o que é julgamento sobre o presente; grava o que é
fato de uma data.** Há teste que muda o custo do catálogo depois da venda e
confere que a margem não se move.

### ❓ Casar pedido com SKU por EAN é o que dá hoje, e é limite conhecido

A chave boa seria o id de anúncio: toda planilha de venda traz, e ele aponta para
um anúncio, que aponta para um SKU. Só que a tabela `anuncio` está vazia — povoar
depende de importar anúncio, que é outra entrega.

Então o casamento é por EAN, que a planilha de venda às vezes traz. Quando não
casa, o pedido é gravado com `sku_id` nulo e **contado**: venda sem SKU é venda sem
margem, e recusar a linha ou esconder a contagem seria esconder o número que o
catálogo existe para produzir.

### 🐛 `npm run check | tail` engoliu a falha e o commit passou com lint quebrado

Rodei `npm run check 2>&1 | tail -4 && git add . && commit` numa linha só. O
`npm run check` **falhou** com dois erros de lint, e o commit aconteceu do mesmo
jeito: o `&&` olha o código de saída do `tail`, não o do `npm`. Pipe zera o status
do comando à esquerda, e a convenção de "rodar `check` antes de commitar" foi
cumprida na letra e violada no efeito.

O hook de pre-commit não pega: ele confere autoria e trailer proibido, que é o que
foi desenhado para fazer. Consertei com `--amend` antes de publicar, então o
histórico ficou limpo, mas o erro de processo é meu e vale anotado: **ler a saída
de um comando não é o mesmo que verificar se ele passou.** Quando o resultado
decide o passo seguinte, o comando vai sozinho na sua própria chamada.

O erro em si era pequeno e a regra do lint é boa: negação unária sobre o tipo
marcado `Centavos`. `0 - x` em vez de `-x`, que é a forma que `margem.ts` já usava
— e o motivo da regra é que negar valor marcado costuma ser sinal de aritmética de
dinheiro fora das funções que validam.

### 🔀 A fila do dia calcula "hoje" no fuso do vendedor, e há teste dos dois fusos

Prazo às 23h de quinta em São Paulo é 02h de sexta em UTC. Um cálculo em UTC
mostraria "amanhã" na quinta à noite — justamente quando ainda dava para postar
hoje, e a fila do dia existe para não perder esse prazo.

O fuso entra por parâmetro com padrão brasileiro, e o dia civil sai do `Intl` em
vez de aritmética de data à mão. O teste compara os dois fusos **no mesmo
instante**, que é o único jeito de essa classe de bug não voltar.

### ❓ Margem realizada devolve nulo sem custo, e isso é decisão repetida

É a terceira vez que a mesma disciplina aparece no projeto: a proposta de SKU da
fase 5 se recusa a presumir custo a partir de preço de anúncio, o scanner devolve
`null` para markup sobre custo zero, e agora a margem realizada devolve `null` sem
custo na venda.

O padrão vale escrito: **chutar o número desconhecido produz o resultado mais
bonito exatamente quando se sabe menos.** Custo zero dá margem máxima; markup
sobre custo zero é infinito e passa em qualquer corte. Nos três casos, `null` é a
resposta honesta e a tela pede o dado.

### 🐛 O título estourava o limite quando o tipo do produto era longo

A primeira versão montava a base — tipo mais marca — e só depois conferia o limite
ao acrescentar modelos. Com tipo longo, a base sozinha já passava, e o título saía
maior que o permitido: arquivo que a plataforma recusa na importação.

Pegou no teste que percorre vários limites, e a correção obrigou a decidir **em que
ordem se abre mão**, que é uma decisão de negócio e não de código:

1. O **fim do tipo** primeiro ("de água"), que é o que menos identifica.
2. Depois a **marca**, que já é termo de busca forte — "Refil Electrolux" encontra
   mais gente que "Refil purificador".
3. E, se nem a primeira palavra couber, cortar essa palavra e avisar que o título
   precisa de revisão à mão.

De passagem apareceu um detalhe de redação: encurtar palavra por palavra passa por
"refil de purificador de", com conector solto no fim. Tem uma passada que remove.

### 🐛 O título limpava "promoção" e a descrição mantinha

Os dois saem do mesmo `tipoProduto`, e só um limpava. O efeito seria a palavra
desaparecer da vitrine e reaparecer três linhas abaixo, na descrição.

A correção veio com uma distinção que vale guardar: o sistema limpa o que **gera**,
e não toca no que a pessoa escreveu. `observacoes` é texto do vendedor e passa
intacto — se ele quer escrever "promoção de lançamento" ali, é decisão dele.

### 🔀 `original` fica fora da lista de palavras proibidas

A lista tira promoção ("frete grátis", "imperdível") e enfeite ("lindo", "super"),
porque as duas ocupam caracteres que um código de modelo usaria melhor. Mas
`original` **não** entra na lista: em peça de reposição, "original" distingue
produto de genérico e é termo de busca real. Tirar seria confundir enfeite com
informação.

### ❓ Os limites de caracteres por plataforma são levantamento

60 no Mercado Livre, 120 na Shopee, 200 na Amazon. Sem conta conectada e sem
documentação acessível de forma automatizada daqui, são o melhor palpite informado
— a mesma situação do mapeamento de colunas da fase 3, e a mesma disciplina: dito
em voz alta, e o gerador recebe o limite por parâmetro para o ajuste ser em um
lugar. O do ML é o mais restritivo, e é o que manda no desenho: título que cabe lá
cabe nas outras duas.

---

## 2026-09-13 — Fase 7: as duas regras de fornecedor

### 🔀 O scanner importa os cortes do módulo de margem em vez de repeti-los

A especificação diz, sobre o corte de markup e o de ticket mínimo, que "a tela de
preço também usa" — então eles já existiam em `precificacao/margem.ts`, desde a
fase 1. Repetir `3x` e `R$ 80` no scanner seria dois números iguais em dois
arquivos, que divergem na primeira mudança.

O teste fixa a ligação: se alguém mudar o corte num lugar e não no outro, ele
falha. É mais barato que descobrir pela diferença entre o aviso da tela de preço e
o veredito do garimpo.

### ❓ Dois dos sete cortes do M7 são escolha, não número da especificação

A especificação numera cinco cortes e descreve dois em palavras:
"substituibilidade: baixa" e "recorrência: alta". Não há número, e inventar um com
cara de fato seria pior que assumir a escolha — então `4 000` e `6 000` pontos-base
estão no código como decisão deste projeto, com o motivo ao lado, e são
configuráveis como todos os outros.

O share dos três maiores ela dá em faixa, "40–50%". O padrão é o **meio**, 45%, e
também está registrado como escolha.

### 🐛 A quinta porta na barra de navegação deu rolagem horizontal em todas as telas

A barra é uma linha de `flex` sem `flex-wrap`. Com quatro portas cabia em 390px;
com a quinta, passou — e o efeito não ficou na tela nova: **a página inteira ganhou
rolagem horizontal em todas as rotas**, porque a barra está no `layout`.

Achado medindo no navegador, e localizado varrendo o DOM por elemento cuja borda
direita passa da largura da janela — que é mais rápido que adivinhar qual regra de
CSS é a culpada. Eu tinha apostado em `width: 100%` com `padding` nos campos do
formulário, e estava errado: o `box-sizing: border-box` global já cuidava disso.

Lição: uma linha de `flex` que não quebra é uma largura mínima escondida, e ela
cresce a cada item que alguém acrescenta meses depois.

### 🐛 Três erros de texto que só a tela mostrou

Os três passaram por teste, typecheck e lint:

1. **"quatro perguntas rápidas"** escrito à mão na mensagem de contato, com três
   perguntas listadas embaixo. Nenhum teste pegava porque nenhum lia a frase.
2. **"Sou essencial-emporium e vendo em marketplace"** — a semeadura usava o slug
   cru como nome do perfil quando não vinha `--nome`, e isso escapou para uma
   mensagem que vai para fora, para um fornecedor. O padrão passou a ser o slug
   legível, ainda derivado do dado.
3. **"descartar"** como etiqueta de estado no cartão. Imperativo ali lê como botão;
   o certo é "descartado".

Nenhum é grave e os três são visíveis em dois segundos de leitura de tela. É o
argumento de sempre, agora com três casos em uma única tela: **abrir a tela é etapa
de verificação.**

### 🔀 `null` não é `false`, e é a decisão que estrutura a triagem

"Ainda não perguntei" e "perguntei e a resposta é não" são estados diferentes. O
schema da fase 0 já dizia isso em comentário; a triagem faz valer: `null` vira
**pergunta pendente**, que é tarefa, e `false` vira ressalva ou descarte, que é
decisão.

Confundir os dois produz os dois erros caros em sequência — descartar fornecedor bom
por falta de dado, e aprovar fornecedor ruim por otimismo. E há precedência entre
eles: pendência ganha de ressalva, porque aprovar sem saber é o erro que aparece
três semanas depois, no primeiro pedido.

Uma exceção que só apareceu escrevendo o teste: **pedido mínimo**. "Não tem pedido
mínimo" é resposta, e se parece com "não perguntei" porque os dois campos ficam
vazios. A pendência só existe quando nenhum dos dois foi preenchido — quantidade
zero é resposta.

### ❓ O prazo de postagem de 3 dias é escolha, não número de plataforma

Nenhuma das três plataformas publica um limite único e verificável de prazo de
postagem; o que existe são penalidades de reputação por atraso. Então o corte é
configurável e o padrão é conservador, com a ressalva escrita no código: atraso em
conta nova é o que mais custa, e é melhor errar para o lado de avisar.

### 🔀 Só a pergunta da vitrine descarta sozinha

`vende_direto_marketplace = true` é o único descarte automático, e as outras quatro
pesam. Não é falta de rigor: "não emite nota" e "não posta com etiqueta" são caros e
**às vezes aceitáveis** — a decisão é do dono, e o sistema explica o custo em vez de
decidir por ele. Já quem vende na mesma vitrine com preço de fábrica não tem margem
a negociar, e é contra isso que a primeira tentativa do dono no Mercado Livre
falhou.

---

## 2026-09-13 — A suíte apagava o banco da aplicação

### 🐛 `npm run check` truncava as tabelas do banco de verdade

O pior defeito achado neste projeto até agora, e o mais perto de ter causado dano
irreversível a dado de outra pessoa.

Os testes de banco fazem `truncate table ... cascade` no `beforeEach`. A conexão
vinha de `DATABASE_URL` — **a variável da aplicação**. E o `CLAUDE.md` manda rodar
`npm run check` antes de todo commit. Ou seja: o dono do repositório, seguindo as
instruções do próprio projeto, com o Postgres gerenciado dele configurado no
`.env`, apagaria os próprios dados. Toda vez.

Como apareceu: eu estava conferindo a tela de compatibilidade no navegador, rodei
`npm run check` entre duas conferências, e os dados da demonstração sumiram. Levei
um instante para entender, e por sorte eram dados de demonstração num Postgres
local. No banco do dono teria sido o catálogo dele.

Não foi introduzido hoje: está assim desde a fase 0, e passou por seis fases sem
ser notado, porque neste contêiner o banco local **é** descartável — o ambiente de
desenvolvimento esconde exatamente esta classe de erro. Só ficou perigoso quando o
projeto ganhou um banco gerenciado com dado real, ontem.

A correção tem três camadas, e as três importam:

1. **Variável própria, `DATABASE_URL_TESTE`, sem retorno automático para
   `DATABASE_URL`.** Retorno automático é como isto aconteceu. A consequência de
   faltar a variável é "222 testes pulam"; a de acertar por engano é "os dados
   foram apagados". Só uma das duas se desfaz.
2. **Guarda em `abrirBancoDeTeste`:** se as duas variáveis tiverem o mesmo valor, a
   suíte falha com a mensagem dizendo o que fazer. Protege contra a forma mais
   provável de reintroduzir o estrago — copiar a URL para "fazer os testes
   rodarem".
3. **Guarda no `preparar:env`:** recusa gravar as duas iguais, com o mesmo aviso.

No CI o banco é do contêiner e morre com ele, mas mesmo lá a suíte roda contra um
banco de nome diferente — para o caminho testado ser o mesmo que o de todo mundo.

A lição que vale além deste bug: **ambiente de desenvolvimento descartável esconde
erro de destruição de dado.** Um `truncate` no banco errado é invisível quando todo
banco à mão é sacrificável. Vale procurar, de propósito, o que no projeto só é
seguro por acidente do ambiente.

---

## 2026-09-13 — Fase 6: compatibilidade, o fosso

### 🐛 `unique` com coluna anulável não restringe nada

`unique(tipo, marca, modelo, variante)` em `aparelho`, com `variante` nula — que é o
caso de quase todo aparelho. Índice único trata `NULL` como valor **distinto** por
padrão, então duas linhas de `(purificador, Electrolux, PA21G, NULL)` entram as duas,
o `on conflict` nunca dispara e o upsert duplica em silêncio.

O sintoma foi o pior possível: dois ids para o mesmo aparelho, cada um com metade da
evidência. Quem perguntasse "em que aparelhos esta peça serve" receberia a resposta
partida em duas linhas iguais com confiança pela metade em cada.

Pegou o teste de idempotência, e só ele — typecheck, lint e a tela toda passavam.
`nulls not distinct` faz a restrição dizer o que sempre quis dizer: variante nula é
"o modelo sem variante", que é **um** aparelho.

Conferi os outros quatro `unique` com coluna anulável do schema. Em três — `sku` sem
EAN, anúncio e pedido sem id externo — `NULL` distinto é o comportamento certo: dois
SKUs sem EAN não são o mesmo SKU. Só o aparelho queria o contrário. **A regra que
fica: `unique` com coluna anulável exige decidir, em cada caso, se `NULL` é "um valor
específico" ou "desconhecido".**

### 🐛 Chave de idempotência tem que identificar o evento, não o alvo

O job de coleta de compatibilidade nasceu com a chave igual ao `skuId`, por analogia
com o job de identidade — cuja chave é o id da ocorrência. A analogia estava errada, e
de um jeito silencioso.

A fila colapsa por `(tipo, chave)` **para sempre**, não "enquanto o job está
pendente". Identidade funciona assim porque uma ocorrência é resolvida uma vez e
pronto. A coleta de compatibilidade não: ela reabre a cada ocorrência nova ligada ao
SKU. Com a chave sendo o alvo, o primeiro job concluído bloqueava toda coleta futura
daquele SKU — nada falha, nada aparece no log, a ficha simplesmente para de crescer.

Só o teste da **terceira** ocorrência pegou. O da primeira e o da segunda passavam,
porque o primeiro job ainda não existia quando o segundo enfileirou.

A chave passou a ser `skuId:gatilho`. O que colapsa é o mesmo evento repetido —
decidir duas vezes o mesmo par gera um job, não dois.

### ❓ Faltava onde gravar a decisão de compatibilidade, e não se notava sem implementar

A tabela `compatibilidade` da fase 0 tinha `confianca_bp` e nenhuma coluna dizendo
confiança **em quê**. `9 000` era ambíguo entre "com certeza serve" e "com certeza
não serve", e uma fonte forte afirmando que a peça **não** serve não tinha onde ser
gravada — o que é metade do valor da base, porque é o que evita sugerir o modelo
errado.

Não é descuido do schema original: o furo só fica visível quando se escreve a
resolução. Vale como lição sobre o limite de projetar tabela antes de escrever o
código que a usa — e como argumento a favor de fazer as duas coisas na mesma fase
quando possível.

### 🔀 A regra de combinação de confiança, e por que as âncoras não fecham exatas

A especificação fixa três âncoras: fabricante 1,0, três concorrentes concordando 0,8,
um fórum 0,4, com corte de publicação em 0,7. Faltava a regra que liga as três.

Escolhi o complemento do produto — `1 − Π(1 − fᵢ)` —, que é monótona, saturante, e
tem leitura direta: "a chance de todas as fontes estarem erradas ao mesmo tempo".
Somar não serve: passa de 1 no terceiro item e não significa nada.

Para três concorrentes darem 0,80, cada um vale 4 152 pontos-base. O número não é
redondo porque **a âncora é sobre o trio, não sobre o indivíduo** — e a conta inteira
dá 8 001, não 8 000. O teste fixa 8 001, para uma mudança de calibragem aparecer lá.

Aritmética inteira em pontos-base, com divisão truncada: o arredondamento sempre
para baixo, que é o lado seguro num corte que decide publicar.

### 🔀 Três regras que só apareceram escrevendo o teste da resolução

- **Qualquer objeção derruba o par abaixo do corte.** Não foi imposto: é consequência
  de descontar (`apoio × (1 − objeção)`), e é o comportamento certo. Discordância em
  compatibilidade de peça é exatamente o caso que merece olho humano antes de virar
  anúncio.
- **Fonte sem URL conta uma vez por tipo.** Não há como distinguir duas fontes
  anônimas de uma registrada duas vezes. Sem essa regra, colar o mesmo anúncio de
  concorrente três vezes publicaria a compatibilidade — a forma mais fácil de
  transformar descuido em devolução.
- **Teto por tipo**, porque dez posts de fórum não são dez observações independentes:
  um cita o outro. O teto do fórum fica cem pontos abaixo do corte, de propósito.

### 🔀 Decisão humana vence, mas evidência do fabricante que chega depois reabre

Primeira versão: decisão humana vence, ponto. Isso deixaria uma pessoa que decidiu
errado travar o erro para sempre, mesmo com o manual do fabricante dizendo o
contrário.

Segunda versão: qualquer contradição do fabricante reabre. Isso criou um travamento
ao contrário — quem revisasse **depois** de ler o manual nunca conseguiria fechar o
caso, porque a revisão reabriria a si mesma para sempre.

A regra que ficou é temporal: evidência do fabricante **posterior** à revisão reabre;
anterior não, porque a pessoa já viu. Fonte fraca não reabre nunca, que é a regra de
procedência do ADR 0002.

### 🔀 Anúncio seu não confirma nada, e vale zero de propósito

O coletor transforma título de anúncio já capturado em evidência de compatibilidade.
Mas anúncio vindo da própria exportação do vendedor (M1) é ele confirmando a si
mesmo, e catálogo que se confirma sozinho é como erro de cadastro fica permanente: o
erro passa a ser a evidência de si mesmo.

Entra com força zero: registrado, com o título citado à vista, sem decidir nada, e
aparece na fila para um clique virar `humano` — que vale tudo. Também não serve de
semente para inferir família, senão um título seu geraria uma família inteira de
compatibilidades deduzidas.

Efeito colateral: "empate de forças em zero" precisou de texto próprio. "Fontes de
mesma força discordam" estava certo para dois fóruns brigando e errado para o caso
que aparece na prática, e mandava a pessoa procurar um conflito que não existe.

### 🔀 Inferência propõe, evidência publica — e o fator 60% vem daí

A inferência de família herda 60% da confiança da origem. O número foi escolhido por
uma propriedade, não por gosto: `10 000 × 0,60 = 6 000`, abaixo do corte de 7 000.
Então inferência a partir da melhor fonte que existe — o manual — ainda precisa de
confirmação.

Emergiu uma propriedade que não foi projetada e é boa: inferência (6 000) mais **um**
concorrente (4 152) passa do corte. Nenhuma das duas publicaria sozinha. A gramática
levanta a hipótese, uma fonte do mundo confirma.

Linha vizinha (`PA21` → `PA26`) herda 25%, com teto que nenhuma soma de sugestões
atravessa. E uma linha que já provou distinguir a peça desliga a sugestão em toda a
linhagem: aí a gramática está funcionando, e sugerir seria ruído.

**Inferência nunca serve de origem para outra inferência.** Sem essa regra a
confiança decairia de irmão em irmão até o catálogo inteiro ficar "compatível com
tudo" a partir de uma afirmação só.

### 🐛 Três defeitos de texto que só apareceram dirigindo a tela no navegador

Nenhum dos três aparece em teste de unidade, e os três mentiam para quem lê:

1. **Procurar duas vezes seguidas dizia "nenhum anúncio capturado cita um modelo
   cadastrado"** — com três anúncios citando e a ficha cheia na mesma página. Dois
   estados diferentes cabiam na mesma mensagem: "não havia anúncio para ler" e "leu e
   nada mudou".
2. **O PA31G aparecia como "deduzido de um modelo irmão"**, sendo outra linha de
   aparelho. Irmão e linha vizinha são coisas diferentes — é a distinção que os dois
   fatores de confiança existem para fazer, e apagá-la no texto apaga o motivo de a
   confiança ser diferente.
3. **`purificador de agua`, sem acento, na gramática** — e a gramática aparece na
   tela, na linha que explica o código do modelo.

Confirma o que a fase 5 já tinha mostrado com o `bigint` chegando na formatação de
moeda: **abrir a tela é uma etapa de verificação, não um luxo.**

### 🐛 Três buracos que só o roteiro do README de ponta a ponta achou

Escrevi o roteiro do README dizendo o que o sistema faria, e depois **executei o
roteiro no navegador** para conferir. Os três defeitos abaixo apareceram nessa
conferência, e nenhum deles apareceria de outra forma: cada peça tinha teste, cada
teste passava, e a cadeia parava no meio.

**1. O botão "Processar agora" drenava só a fila de ingestão.** A planilha entrava,
a tela de jobs dizia "nada para processar", e a de identidade continuava zerada.
É exatamente o que o dono relatou depois de testar a fase 5 — "Identidade, não sei
se eu consegui" — e eu tinha atribuído à lentidão da tela. A causa era outra e era
minha: o botão tinha a **própria composição** de tarefas, diferente da do poller.
É a divergência que `montagem.ts` existe para evitar, cometida dentro de uma tela.
A composição das três filas mudou de lugar, e agora as duas pontas chamam a mesma
função. Nenhum teste pegava porque cada fila tinha o seu teste e as duas passavam:
faltava teste do **encaixe**, que agora existe.

**2. Par juntado automaticamente não tinha caminho para virar produto.** Duas
ocorrências do mesmo código de barras são ligadas com 100% de confiança e por isso
**não** entram na fila de revisão — não há o que revisar. Mas o produto é criado por
decisão humana, e a única tela que criava produto era a fila de revisão. Então o
caso **mais comum** do M3 terminava num par correto, ligado, e sem produto — e sem
produto não há comparação de preço nem ficha de compatibilidade. A fase 5 tinha
consertado esse buraco para os pares em revisão e deixado o buraco maior aberto.

**3. Confirmar uma linha não propagava na hora.** Quem confirma o PA21G acaba de
autorizar a hipótese sobre o PA21X, e a tela pedia outro clique em "Procurar" para
mostrar isso. Esconder o efeito da própria decisão da pessoa é a forma de fazer
uma ação parecer que não funcionou.

A lição não é nova, é a mesma da fase 5 com o `bigint` chegando na formatação de
moeda — mas agora tem uma forma mais forte: **escrever no README o que o sistema
faz é uma obrigação de verificar, não de prometer.** Se o roteiro não foi
executado, ele é palpite com aparência de documentação.

### 🐛 A ficha desaparecia quando ficava completa

A primeira versão da tela mostrava a ficha do **primeiro item da fila de
conferência**. Fila vazia significa "tudo conferido", então a ficha sumia
exatamente quando ficava completa — e a caixa de responder comprador sumia com
ela. Acoplamento arbitrário: a fila é sobre o que falta, a ficha é sobre o que já
está pronto.

Passou a ser o produto com mais compatibilidade registrada, com desempate por
título para a tela não trocar de produto entre dois carregamentos.

### 🐛 A resposta ao comprador citava o anúncio próprio como fonte

A linha "pode enviar" listava as fontes da afirmação, e incluía `anúncio seu, a
confirmar` — que vale zero e não pesou em nada. Convidava a apontar o próprio
anúncio como prova ao comprador, que é o raciocínio circular que a força zero
existe para impedir.

Só entra na citação o que pesou. Apareceu lendo a resposta na tela, não no teste:
o teste conferia o texto e o tipo da resposta, e a lista de fontes tinha passado
sem conferência.

### ❓ A planilha de exemplo não publica nada, e está certo assim

Seguindo o roteiro, a ficha ficou vazia: as três linhas do CSV de exemplo são uma
exportação do painel do **próprio** vendedor, então entram como `anuncio_proprio`,
valem zero, e não decidem nem servem de semente para inferência.

Foi o sistema funcionando como projetado, e eu tinha escrito no README que a ficha
se montaria sozinha. Reescrevi o roteiro para dizer o que acontece de verdade — e o
roteiro ficou **melhor**, porque agora ele demonstra a regra de autoconfirmação em
vez de esconder: a linha aparece em 0%, um clique em "Serve" a leva a 100%, e o
modelo irmão aparece na hora a 60%, abaixo do corte, esperando conferência.

### 🧹 Gramática por marca é constante versionada, não tabela

Segue o formato das tabelas de taxa: conhecimento sobre o mundo, versionado em código,
com a data e a fonte do levantamento. Custo anotado: acrescentar marca exige editar
código e publicar. Quando o dono precisar cadastrar marca sem isso, vira tabela — e o
parser já recebe as gramáticas por parâmetro justamente para essa troca ser local.

Disciplina do arquivo de sementes: só entra o que a especificação afirma. O prefixo
`PE` aparece lá (`PE11B`) sem explicação, então não tem regra; nenhum sufixo tem
significado individual, porque ninguém conferiu qual letra é cor e qual é voltagem.
`null` é a resposta honesta, e a tela escreve "não identificado".

### ⚠️ `aparelho.tipo` é texto livre e entra na chave de unicidade

"purificador de água" e "purificador de agua" digitados em dias diferentes viram dois
aparelhos, porque `tipo` faz parte de `unique(tipo, marca, modelo, variante)` sem
normalização. Marca e modelo têm o mesmo problema em menor escala — o casamento por
código normaliza, a chave não.

Não corrigi nesta passada: normalizar na chave e guardar a forma digitada para exibir
exige coluna nova, e o cadastro manual de aparelho hoje tem uma pessoa só usando.
Anotado nas pendências como dívida com o custo escrito.

---

## 2026-09-13 — Preparar o ambiente em um comando

### 🐛 Editar o `.env.example` em vez do `.env` é o erro natural, não descuido

O dono configurou o banco, salvou, rodou, e recebeu
`DATABASE_URL: received undefined` — com a URL correta salva. A linha anterior da saída
explicava: `.env not found. Continuing without it.`

Ele editou o `.env.example`. E isso não é falta de atenção: **o `.env` não existe até
alguém criá-lo.** É ignorado pelo git, então não vem no clone; o editor lista só o
exemplo; e o README dizia "copie para `.env`" numa linha que se lê e não se executa.

Havia mais um agravante do meu lado: eu vinha dando instruções em prosa ("substitua a
linha", "remova este parâmetro", "gere a chave e cole"), e ele disse, com razão, que
estava confuso. Quatro passos manuais com três formas de errar não se resolvem
escrevendo melhor a explicação — se resolvem virando um comando.

`npm run preparar:env` copia o exemplo, gera a chave mestra, aceita
`--database-url=`, remove `channel_binding` sozinho (a armadilha medida ontem) e
**nunca sobrescreve `.env` existente**. Testado nos três caminhos antes de entrar.

### ⚠️ O `.env.example` é versionado, e o repositório é público

Consequência do erro acima que não é só cosmética: a credencial foi colada num arquivo
**rastreado pelo git**, em repositório público. Commitado, seria raspado em minutos —
diferente de compartilhar em conversa, que tem outro alcance. `git checkout
.env.example` desfaz.

### 🐛 Eu matei o Postgres seis vezes e culpei o contêiner

Sintoma: o Postgres local caía a cada poucos minutos, sempre no meio de uma operação.
Culpei o ambiente por meia sessão e escrevi isso em duas mensagens.

Causa: **eu**. Antes de cada `pg_ctl start` eu rodava `rm -f postmaster.pid` para
"limpar pid velho" — e quando o servidor já estava no ar, aquilo apagava o pid **dele**.
O Postgres relê esse arquivo, não acha, e conclui que perdeu o lock do diretório de
dados: `performing immediate shutdown because data directory lock file is invalid`. O
log dizia isso desde a primeira vez.

A lição não é sobre Postgres: eu tinha uma hipótese ("o contêiner reaper mata processos
ociosos") que explicava o sintoma, e por isso não fui ler o log até o sexto incidente.
Hipótese plausível é exatamente o que atrasa a leitura da evidência.

`rm postmaster.pid` só é seguro com o servidor desligado — `pg_isready` antes.

### ❓ Este ambiente não alcança o Neon

TCP 5432 para `*.neon.tech` responde `403 to CONNECT` no proxy, e HTTPS para
`console.neon.tech` também falha. A política de rede do contêiner bloqueia o domínio,
então **não consigo rodar nada contra o banco gerenciado do dono daqui** — nem
migration, nem verificação de tela.

O que dá para fazer, e foi feito: rodar contra o Postgres local do contêiner e entregar
as telas em imagem, com o `.env` pronto para a máquina dele. Vale registrar porque muda
o que eu posso prometer: verificação contra o banco de produção é dele, não minha.

---

## 2026-09-13 — O `.env` só valia para a aplicação

### 🐛 `.env` lido pelo Next, ignorado por todo o resto — e os testes pulavam em silêncio

Descoberto porque alguém foi configurar um banco gerenciado e perguntou onde colar a
string. O `.env` estava certo, e:

- `npm run db:migrate` falhava com `DATABASE_URL: expected string, received undefined`
- `npm run db:seed` e `npm run poller` idem
- `drizzle-kit` (`db:generate`, `db:studio`) rodava sem a variável
- e o pior: **o vitest pulava os 202 testes de banco em silêncio**

O Next carrega `.env` sozinho (`@next/env`), então `npm run dev` funcionava e escondia
tudo o resto. O README documentava uma sequência (`cp .env.example .env` e depois
`npm run db:migrate`) que **não funcionava**.

O caso do vitest é o mais perigoso dos quatro, e não por ser o mais quebrado: os outros
três **falham**, e falha se vê. O vitest passava verde dizendo "202 skipped" — que é
exatamente o que ele diz para quem não tem banco configurado. O sinal de "não testei" era
idêntico ao de "não tenho banco". Passa despercebido para sempre.

A correção usa `process.loadEnvFile`, API nativa do Node 22 — zero dependência nova. A
precedência foi **medida** antes de escolher: variável do shell vence a do arquivo, igual
ao dotenv. Então o `DATABASE_URL` do CI continua ganhando de um `.env` esquecido.

`carregarEnv()` entra nos quatro pontos de entrada de linha de comando, no
`vitest.config.ts` e no `drizzle.config.ts`. Os scripts do `package.json` ganharam
`--env-file-if-exists=.env` também — cinto e suspensório, para quem rodar o arquivo
direto sem passar pelo npm. Verificado: `949 passam` com só o `.env`, onde antes eram
`747 passam, 202 pulam`.

### 🐛 `drizzle.config.ts` caía em `localhost:5432` sem avisar

O padrão era `process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/bancada'`. Isso é
pior que falhar: `db:studio` sem variável configurada abre um editor de banco apontado
para **qualquer** Postgres que esteja na 5432 da máquina — que pode ser o banco de outro
projeto, e o dono desta máquina tem outro projeto com Docker rodando.

Agora o padrão é um host `.invalid`, que não resolve. `db:generate` não conecta (lê schema
e escreve SQL), então segue funcionando sem banco; o que conecta falha ruidosamente em vez
de acertar um estranho.

### 🐛 `channel_binding=require` na URL derruba a conexão

A string que o painel do Neon entrega vem com
`?sslmode=require&channel_binding=require`. Colada como está, **não conecta**.

O motivo está no `postgres.js`: parâmetro de URL que ele não conhece vai para
`connection`, e `connection` é enviado ao servidor como parâmetro de startup. `sslmode`
ele trata; `channel_binding` não é parâmetro do Postgres. Resultado medido:
`unrecognized configuration parameter "channel_binding"`.

Ler o código da biblioteca deu a hipótese; rodar contra um Postgres deu a prova. As duas
coisas levaram dez minutos e evitaram meia hora de "por que não conecta".

### 🔀 URL direta, não a de pool

Painel de banco gerenciado oferece duas strings: direta e *pooled*. Aqui a direta é a
certa — `postgres.js` já mantém pool próprio com *prepared statements*, e o endpoint de
pool é PgBouncer em modo transação, onde *prepared statement* não sobrevive. A *pooled*
serve para serverless, que este projeto não é (ver pendências §3.3).

---

## 2026-09-13 — Rodar o projeto em máquina de verdade

### 🐛 Clone feito na janela em que o repositório estava vazio nunca oferece Pull

Três sintomas na máquina do dono, que juntos pareciam defeito de sincronização:
pasta vazia no VS Code, "0 changed files" no GitHub Desktop, e `Fetch origin`
clicado várias vezes **sem nunca aparecer Pull** — com 53 commits no servidor.

A causa é uma janela de 22 minutos: o repositório foi criado no GitHub às
`02:19:37` e o primeiro commit foi empurrado às `02:41:49`. Clonar nesse intervalo
produz um clone com **zero commits** e uma branch `main` que não existe como
referência local (*unborn branch*).

E aí o mecanismo: o GitHub Desktop calcula "atrás por N" comparando `main` com
`origin/main`. Sem a referência local, não há o que comparar — ele não oferece
Pull, e fica em "Fetch origin" para sempre. **Empurrar mais commits nunca resolve**,
porque o problema não está no remoto.

Como confirmar em um clique: a aba **History** do GitHub Desktop mostra
"No history". Como resolver: `git pull origin main` na pasta (funciona em branch
unborn), ou apagar a pasta `.git` e clonar de novo.

Armadilha dentro da armadilha: "Remove" no GitHub Desktop **sem marcar** a opção de
mover para a Lixeira só tira o repositório da lista e deixa a pasta no disco — e o
clone seguinte falha com *"This folder contains files"*, porque o `.git` oculto
conta como conteúdo. Mover para a Lixeira também falha se o VS Code estiver com a
pasta aberta. O caminho que funcionou: apagar o `.git` no Explorer e clonar.

### 🧹 "Postgres com pgvector" era uma frase, não uma instrução

O README pedia "Postgres 16+ com `pgvector`" e parava aí. No Windows a extensão não
vem no instalador oficial, então a única saída era compilar `pgvector` à mão para
testar o projeto — desproporcional.

Agora há `compose.yaml` com a **mesma imagem e as mesmas credenciais do CI**
(`pgvector/pgvector:pg16`, `bancada:bancada@localhost:5432/bancada`). Banco local
diferente do banco do CI é como um teste passa na máquina e falha no push, e a
igualdade é de propósito. Tem `healthcheck` porque o contêiner existe alguns
segundos antes de o Postgres aceitar conexão, e `db:migrate` rodado logo depois do
`up` falhava com "connection refused".

### 🐛 Escrevi no README um número de testes que eu não tinha medido

Documentei "sem `DATABASE_URL`: 828 passam, 121 pulam". Medi depois: **747 passam,
202 pulam**. O 121 era o número da fase 4, e a fase 5 — que é quase toda
comportamento de banco — mudou a conta sem eu refazer a medição.

Número em documentação tem a mesma regra de número em código: ou é medido, ou não
entra. As pendências (§4.6) tinham o mesmo 121 velho, corrigido junto.

### 🔀 Exemplo de planilha no repositório, e ele é exercitado

`docs/exemplos/anuncios-mercadolivre-exemplo.csv`, no formato real de um relatório
do Mercado Livre: linha de título, separador `;`, preço com vírgula. Duas das três
linhas compartilham o mesmo EAN **de propósito** — é o que faz a resolução de
identidade agrupar sozinha na primeira passada do poller, e transforma "o sistema
funciona" em algo que se vê em dois minutos.

Importado de verdade antes de entrar no repositório: 3 gravados, 0 recusados, um par
ligado por `gtin` com 10 000 pontos-base. Exemplo que não roda é pior que exemplo
nenhum.

---

## 2026-09-13 — Branch única

### 🐛 A branch de trabalho estava escondendo o trabalho, não protegendo

Sintoma relatado pelo dono: `main` aberta no GitHub Desktop, "No local changes",
`Fetch origin` clicado, **nenhum Pull oferecido** — e o VS Code sem os arquivos da
fase 5. Parecia defeito de sincronização.

Não era. `main` estava em `66d971f` (fim da fase 4) e a branch de trabalho em
`e3d850d`, **18 commits à frente**, com a fase 5 inteira. E o GitHub Desktop só
oferece *Pull* para a branch que está aberta: para `main` não havia nada a puxar,
porque `main` não tinha mudado. O trabalho estava publicado, só não onde ele
olhava.

A causa raiz não é a ferramenta: é que o `CLAUDE.md` §2 mandava desenvolver em
`claude/epic-allen-1r2zyy` e tratar a ida para `main` como decisão explícita do
dono — decisão que nunca foi pedida de novo depois da fase 4. Cada fase entregue
aumentava a distância.

**Decisão do dono:** branch única, `main`. Fast-forward de `66d971f` para
`e3d850d`, branch de trabalho apagada, `CLAUDE.md` §2 reescrito.

O raciocínio que ficou escrito na convenção: branch de trabalho protege de trabalho
ruim publicado. Com um desenvolvedor, `npm run check` antes de cada commit e CI
verde em todo push, o que ela protegia já estava protegido — e o que ela causava era
um dono que não encontrava o próprio projeto. Volta a valer quando houver segundo par
de mãos, ou trabalho longo que deixe o sistema sem rodar por dias.

### 🧹 `origin/HEAD` ficou apontando para a branch apagada

Detalhe de clone antigo: `origin/HEAD -> origin/claude/epic-allen-1r2zyy` continua
no `.git` de quem clonou antes da mudança, mesmo com o padrão do GitHub já em `main`.
Não quebra nada, mas confunde: `git log origin/HEAD` mostra ref que não existe mais.
`git remote set-head origin -a` corrige em cada clone.

---

## 2026-09-12 — Fase 5: resolução de identidade (M3)

### 🐛 A tela dizia "a decisão não foi gravada" com a decisão gravada

`decidirPar` faz três coisas: grava a decisão, grava o exemplo, e — se um dos lados
já é um SKU — propaga. A propagação é a última e a menos essencial, e estava dentro
do mesmo `try`. Quando ela falhou (perfil padrão apontando para um slug que não
existia no banco), o `catch` de fora respondeu **"a decisão não foi gravada"** — com a
decisão gravada e o exemplo gravado.

Mentira na pior direção: quem lê isso clica de novo. Agora a propagação tem captura
própria e um aviso próprio — "decisão registrada, mas não deu para ligar ao SKU" —,
que é o que aconteceu de fato.

### 🔀 A frase mais útil vai no destaque, e a repetida sai

Com três pares na tela ficou óbvio o que não aparecia lendo código: o destaque de
todo cartão dizia a mesma frase inútil ("a comparação determinística não decidiu")
enquanto a informação de verdade — "mesma marca e modelo, mas a quantidade de
embalagem difere: 1 contra 3" — ficava em segundo plano. Em telefone isso custava duas
linhas do espaço mais caro da tela.

Agora, quando não há confiança para explicar, a **justificativa é o título**. E aspas
com itálico ficaram reservadas a julgamento de LLM: aspas implicam que alguém falou, e
motivo determinístico não foi dito por ninguém — foi calculado.

### 🐛 `sql<number>` é asserção de tipo, não conversão — e o `bigint` chegou ao formatador

A fila de revisão junta `produto_externo` duas vezes (um lado por coluna do par), e a
primeira versão fez o alias do segundo lado com `sql\`produto_externo as pb\``. Com
alias em `sql` cru, as **colunas** também têm de ser escritas em `sql` cru — e
`sql<number>` é uma asserção: o compilador acredita, o driver devolve `bigint` para
coluna `bigint`, e a tela morre em *Cannot mix BigInt and other types* dentro do
formatador de dinheiro.

`alias()` do Drizzle resolve: o mapeador de coluna continua valendo nos dois lados.
Detalhe que custou uma segunda rodada — o nome do alias entra no **tipo** da tabela,
então uma função comum para "as colunas de um lado" perde a tipagem; os dois lados
são escritos lado a lado de propósito.

**Só rodar a tela pegou isso.** Typecheck, lint e 899 testes passavam.

### 🐛 "falta GTIN dos dois lados" era falso na tela

O motivo do casamento indeciso dizia "falta GTIN ou código de peça **dos dois
lados**". O caso comum é o anúncio ter GTIN e o catálogo do distribuidor não — então a
frase era falsa exatamente no par mais frequente. Virou "em um dos lados". Tela de
revisão existe para a pessoa confiar no que lê.

### 🔀 A fila de revisão dava em nada quando nenhum dos dois lados era um SKU

O caso mais comum da fila é justamente esse: duas ocorrências que alguém afirma serem o
mesmo produto, e **nenhuma** delas em um SKU. A decisão ficava gravada, virava exemplo,
e o valor — comparar preço entre fornecedores — não aparecia, porque não havia SKU para
receber as duas. A propagação só sabe ligar ao SKU que já existe.

Então o cartão, quando nenhum lado tem SKU, oferece criar. O título vem **preenchido com
uma proposta e é editável**, porque "um `sku` é criado por decisão sua" inclui o nome —
gerar sozinho seria decidir em nome de alguém.

`propostaDeSku` é função pura com teste: título do registro extraído (`tipo marca
modelo`) quando há, senão o **menor** dos dois títulos brutos — menor é quase sempre o
menos poluído de palavra-chave, e é heurística assumida, não verdade. GTIN divergente
entre os dois lados **não** entra no SKU e vira aviso: a coluna é única por perfil, e
gravar um dos dois esconderia que as fontes discordam.

Custo fica de fora de propósito. Preço de anúncio é o que **outro** cobra, `custo_atual`
é o que você paga, e presumir um pelo outro erraria toda margem calculada em cima — para
o lado otimista.

### 🐛 A proposta de título saía `pa 21 g`, do jeito que a fonte digitou

Visto na tela, não no código: o campo vinha com "elemento filtrante Electrolux pa 21 g".
Está certo em relação ao dado e errado em relação ao uso — o campo vem preenchido e
quase ninguém edita, então o padrão tem de sair do jeito que alguém escreveria à mão.
Agora o código de modelo é normalizado (`PA21G`) e a inicial é maiúscula.

### 🔀 O módulo de CSS tipado pagou por si de novo

Três classes novas no formulário de SKU, e o `tsc` recusou o componente antes de
qualquer teste rodar — porque as classes não existiam no `.d.ts` escrito à mão. Sem ele,
a assinatura de índice do Next aceitaria `estilo.formularioDeSku` inexistente e o
sintoma seria um formulário sem estilo em produção.

### 🐛 Adiar um job gastava o direito a retentativa dele

A fila ganhou `adiar` para o caso do orçamento estourado: o job fez trabalho, gravou o
que decidiu, e o que falta é retomável — usar `falhar` consumiria uma tentativa por
rodada e mandaria para a lista de mortos um job que progride.

Só que `reivindicar` incrementa `tentativas` em **toda** reivindicação, e é o mesmo
contador que `falhar` usa para decidir se ainda há backoff. Então a primeira versão do
`adiar`, que deixava o contador "intacto", na prática gastava uma tentativa por
adiamento: um job adiado três vezes chegaria ao primeiro erro de verdade já sem direito
a retentativa, e iria para `falhou` por ter sido **pausado**, não por ter errado.

`adiar` agora devolve a tentativa (`greatest(tentativas - 1, 0)`), porque só aceita job
`rodando` — então há exatamente uma reivindicação a desfazer. A lição maior: contador de
reivindicação e orçamento de retentativa são o mesmo número, e qualquer operação nova que
devolva um job à fila tem de decidir explicitamente o que faz com ele.

### 🔀 Orçamento por job, não por vida do processo

O resolvedor de identidade é construído **por job**, com `Orcamento` novo. Um resolvedor
único de vida longa no poller esgotaria o teto na primeira hora e nunca mais deixaria
nada rodar — e "teto por execução" do ADR 0005 viraria "teto por vida do processo", que
não é teto nenhum. A montagem recebe uma fábrica (`(jobId) => ResolvedorDeIdentidade`), e
o `jobId` vai para `llm_call.job_id`, o que liga custo a trabalho.

### 🔀 A ingestão enfileira identidade também para linha duplicada

Parecia certo enfileirar resolução só para `gravado`. Não é: se o job de ingestão quebrar
entre gravar a linha e enfileirar, a reexecução vê a linha como `duplicado` — e aquela
ocorrência ficaria sem resolução **para sempre**. Enfileirar nos dois casos fecha o buraco
de graça, porque a chave de idempotência é o id da ocorrência: reenfileirar não cria job
repetido nem reabre job concluído.

### 🐛 Dois tipos de job na tabela quebraram teste que dizia `limit 1`

Três testes de ingestão liam o job com `ultimos()[0]` ou `select … from job limit 1`, sem
filtrar tipo. Passavam porque havia um tipo só. Com a ingestão enfileirando identidade, o
mais recente passou a ser um job de identidade — e um deles lia `resultado->'rejeitadas'`
de um job cujo resultado é nulo.

Corrigidos para filtrar por `tipo`, o que também os deixou dizendo o que querem dizer. E
dois deles ganharam asserção nova: a de que a ingestão **enfileirou** a resolução, que é
o comportamento que passou a existir.

### 🔀 Um poller, duas filas, em ordem de prioridade

`tarefasEmOrdem` junta tarefas numa só: o tique para na primeira que trabalhou, e é
ocioso só quando todas estão ociosas — dizer o contrário faria o poller acelerar a espera
com a fila vazia. Ingestão vem antes de identidade porque identidade só tem o que fazer
depois que a ingestão gravou a ocorrência, e fila de identidade grande não deve atrasar a
entrada de dado novo.

Dois pollers seriam dois processos, duas conexões e dois encerramentos para acertar.

### ❓ O importador de planilha não extrai marca nem modelo, então a forma canônica sai vazia

Rodando a corrente inteira de verdade — planilha, poller, grafo — o agrupamento por GTIN
funcionou e o por marca com código de peça **não teve o que fazer**: as três ocorrências
ficaram com forma canônica vazia e chave de agrupamento nula.

O motivo é anterior ao M3: extrair `{tipo, marca, modelo}` de um título é trabalho do
extrator por LLM (3.2, sem chave), e o importador de planilha só copia colunas. Ou seja, a
via determinística mais valiosa do M3 — a que liga `PA21G` a `EF-ELX-21` — está construída
e testada, e **em dado real só vai andar quando houver extração**. O GTIN cobre o resto, e
é por isso que ele é a primeira via e não a segunda.

Vazia é uma resposta, e é de propósito: a coluna deixa de ser nula, então a ocorrência não
volta para a fila de preparação a cada rodada.

### 🔀 `next dev` escrevia no `CLAUDE.md`, e agora não escreve

O Next 16 anexa um bloco de instruções para agentes ao `CLAUDE.md` do projeto a cada
`dev` e a cada `build` — e o próprio bloco sugere commitá-lo "para manter a árvore
limpa".

Aqui esse arquivo é a **fonte da verdade das convenções**, inclusive da regra de
autoria de commit. Ferramenta que edita sozinha o documento que define as regras é o
começo de um problema que ninguém percebe: o bloco reaparece a cada build, entra num
commit distraído, e dali em diante a diferença entre o que o dono escreveu e o que a
ferramenta escreveu deixa de ser visível.

`agentRules: false` no `next.config.ts` desliga na origem. A orientação útil que o
bloco trazia fica registrada aqui, e é real: **esta versão do Next tem mudanças que
quebram compatibilidade com o que se sabe de versões anteriores**, e a referência é
`node_modules/next/dist/docs/`.

### 🐛 Toda página do sistema dava 404 em `/favicon.ico`

Sem `<link rel="icon">` declarado, o navegador pede `/favicon.ico` por conta própria —
e o 404 aparecia no console de **todas** as telas. `public/icone.svg` já existia (o
manifesto da PWA usa), então bastou declarar `icons` no metadata do layout. Um arquivo,
duas referências, nenhuma duplicata para manter em sincronia.

### 🔀 Agrupar automático **não** liga SKU

`produto_externo.sku_id` aponta para um `sku`, que é operacional e carrega
`perfil_id`; a equivalência entre ocorrências é conhecimento compartilhado e não tem
perfil. A resolução, que é compartilhada, não pode escolher em nome de um perfil.

Então a resolução grava a aresta e para aí. Ligar é `propagarSku(perfil, skuId)`, que
exige `PerfilId` no tipo — e dá um passo por chamada, sem fecho transitivo: `A ≡ B` e
`B ≡ C` não implicam `A ≡ C`, e transitividade automática em grafo de identidade é o
caminho conhecido para uma aresta errada transformar o componente inteiro em um SKU.

Ocorrência equivalente que **já** pertence a outro SKU não é religada: vira conflito
reportado. Fundir SKU tem consequência fiscal e de anúncio, e automação que funde
sozinha é automação que ninguém audita depois.

### 🔀 O par vai ordenado ao modelo, senão (A,B) e (B,A) são duas chamadas pagas

A pergunta de identidade é simétrica, e o hash não sabe disso. `perguntaDeIdentidade`
ordena os dois lados pela forma canônica antes de montar o objeto, e não leva id de
banco dentro — o mesmo par de descrições capturado em outra instalação bate no mesmo
cache.

### 🔀 Três degraus de certeza, não um número de quatro dígitos

A especificação fala de "limiar" e é tentador pedir ao modelo uma confiança de 0 a
10 000. Não: **modelo de linguagem não é calibrado**, e esse número teria aparência
de medida com comportamento de chute — decidindo agrupamento automático. O contrato
pede `alta | media | baixa`, que é o que ele distingue de verdade, e o mapeamento
para pontos-base (9 000 / 7 000 / 5 000) é nosso, explícito e ajustável em um lugar.

### 🔀 Par descartado fica gravado

Abaixo do piso da zona cinzenta o par não vira nada — nem agrupamento, nem revisão.
A tentação é não gravar. Errado: sem a linha, a varredura seguinte gera o mesmo
candidato, paga o mesmo julgamento e chega ao mesmo nada. `status = 'descartado'` é
o que faz a conta não crescer com o número de execuções.

### 🧹 O teste do julgamento por LLM teve de ir pela via do embedding, e isso ensinou algo

A primeira versão do teste fixava `chave_agrupamento` à mão para gerar um candidato
indeciso. Não funcionou, e por um motivo correto: `resolver()` chama `preparar()`
primeiro, que recalcula a chave a partir do registro — valor cravado à mão é
sobrescrito, como deve ser para um campo derivado.

O que isso revelou é que **um par indeciso só aparece por embedding**, na prática:
com código de peça dos dois lados o determinístico decide, e sem código não há chave
de agrupamento. Ou seja, o julgamento por LLM depende de embedding, que depende de
chave — e o teste sintético é o único jeito de exercitar esse caminho hoje. Refeito
assim, ele cobre o desenho da especificação de ponta a ponta: forma canônica,
embedding, vizinho, julgamento, limiar.

### 🔀 Decisão humana de identidade é a origem mais forte, e o `setWhere` é quem garante

A regra de procedência do ADR 0002 — origem fraca não sobrescreve origem forte — vale
para decisão de identidade também. Quem decidiu "não são o mesmo produto" não pode
ser desfeito pela próxima varredura que discordar. Está no `setWhere` do
`onConflictDoUpdate` (`origem <> 'humano'`), não em uma convenção, e `registrar`
devolve `gravado: false` quando recusou — quem chamou sabe que não mudou nada.

### 🐛 `exactOptionalPropertyTypes` e o `setWhere` condicional do Drizzle

Passar `setWhere: undefined` não compila: o projeto distingue "propriedade ausente"
de "presente e `undefined`", e o Drizzle só aceita a primeira forma. O jeito é
espalhar o objeto condicionalmente (`...(cond ? {} : { setWhere: … })`). Vale para
todo campo opcional de API de terceiro neste projeto.

### 🐛 Constraint violada não aparece na mensagem de fora do erro do Drizzle

O Drizzle embrulha o erro do driver em `Failed query: …` e põe o original em `cause`.
Asserção de teste em `rejects.toThrow(/nome_da_constraint/)` **passa a impressão de
testar e não testa** — a mensagem de fora nunca tem o nome. O teste agora lê
`cause.constraint_name`.

### 🔀 Cache por conteúdo e exemplo few-shot se contradizem; a saída é separar pergunta de contexto

Duas regras do ADR 0005 colidem de frente. "Todo resultado é cacheado pela entrada
que o gerou" e "cada decisão humana vira exemplo para os prompts seguintes": se os
exemplos entram no hash, **cada decisão nova invalida o cache de todos os pares**, e
o sistema passa a re-resolver a base inteira justamente por estar aprendendo. O
inverso — ignorar os exemplos no registro — quebra "todo resultado é persistido com a
entrada que o gerou".

A saída é separar os dois papéis no próprio tipo do pedido: `entrada` é a **pergunta**
e define o cache; `contexto` é o que mais foi enviado, fica gravado junto para a
chamada ser reproduzível, e não entra no hash. `llm_call.entrada` guarda
`{pergunta, contexto}`, então quem audita a conta vê exatamente o que foi hasheado e
o que mais o modelo viu.

### 🔀 `chave_agrupamento` virou coluna indexada

O gerador de candidato precisa funcionar **sem embedding**, porque hoje não há chave
de LLM e portanto não há embedding nenhum. Com a chave `marca|modelo` gravada e
indexada, achar as outras ocorrências do mesmo `PA21G` da Electrolux é uma igualdade
indexada; sem ela seria varredura da tabela inteira, ou nada. Nula quando falta marca
ou modelo — nunca `''`, que casaria com toda outra string vazia.

### 🐛 `cosineDistance` do Drizzle não casta o parâmetro para `vector`

`cosineDistance(coluna, vetor)` gera `"vetor" <=> $1`, e o parâmetro chega como
`double precision`. O Postgres recusa: *operator does not exist: vector <=> double
precision*. O `customType` do schema sabe converter na **escrita**, e não em
parâmetro de `sql` cru.

A correção é montar o literal e castar: `${coluna} <=> ${'[1,0,…]'}::vector`. E a
expressão inteira precisa de parênteses antes de `::float8`, senão o cast gruda no
último token — que é o parâmetro, não a conta.

### 🔀 `vizinhosDe` devolve `null`, não lista vazia, quando não há embedding

Lista vazia significa "procurei e não achei parecido". `null` significa "não pude
procurar". Tratar os dois como a mesma coisa faria todo produto sem embedding
parecer um produto sem par — e hoje, sem chave de LLM, **nenhum** produto tem
embedding. O tipo obriga quem chama a distinguir.

### ❓ `DISTANCIA_MAXIMA_PADRAO = 0.35` não está calibrado

É o corte de distância de cosseno para um vizinho virar candidato a julgamento.
Calibrar exige uma base com embedding de verdade, que exige chave. Está como
constante nomeada em um lugar só, justamente para ser ajustada quando houver com o
que medir. O mesmo vale para `VIZINHOS_PADRAO = 20`.

### 🔀 A busca vetorial é testável sem chave, e por isso a 5.3 fecha hoje

Gerar embedding custa chamada de API; **buscar** é operação do banco. Vetor
sintético — unitário em um eixo, ou a um ângulo calculado do eixo 0 — exercita
ordenação por distância, corte, exclusão do próprio produto e separação por modelo.
É o mesmo raciocínio do GTIN na fase 4: a parte determinística do módulo de IA fecha
antes da parte que depende de chave.

### 🐛 A chave única do cache de LLM transforma uma falha em bloqueio permanente

`llm_call` tem chave única em `(proposito, modelo, hash_entrada)`, que é a chave de
cache. A consequência que eu não tinha visto: quando uma chamada falha e a falha é
registrada — e ela **precisa** ser registrada, senão não se sabe onde o dinheiro
foi —, a linha de erro ocupa **exatamente o lugar** da resposta boa. Um `insert`
simples na tentativa seguinte colide, e o `select` de cache serve a falha para
sempre.

Duas mudanças fecham: o `insert` é `onConflictDoUpdate`, então a resposta boa
atualiza a linha de erro; e o `select` de cache exige `saida is not null and erro
is null`. O teste que pegou é o que faz o provedor falhar na primeira chamada e
responder na segunda, e depois confere que sobrou **uma** linha, sem erro.

### 🔀 `ServicoDeLlm` só lança quando estourar o orçamento

Falha de rede, schema inválido e ausência de chave voltam como valor no tipo de
retorno, porque cada um é tratado de forma diferente por quem chamou. Orçamento é a
única exceção, e a razão é concreta: um laço que trata "estourei o teto" como "esse
par falhou" segue para o par seguinte e estoura de novo, uma vez por par — e é
exatamente o laço com defeito que o teto existe para conter.

### 🔀 Dois tetos de orçamento, não um

Centavos é o teto que interessa ao bolso, e **chamadas** é o que continua valendo
quando o provedor não informa custo. Sem o segundo, um provedor calado
transformaria o teto em decoração. `Orcamento` recusa nascer sem os dois, no
construtor — "agente sem teto por execução não roda" verificado, não combinado.

### 🐛 Ausência de chave não vai para `llm_call`

A primeira versão registrava tudo, inclusive a tentativa que morreu em
`ChamadorAusente`. Errado por dois motivos: nada foi enviado, então não houve custo
nem latência para registrar, e o relatório de gasto por finalidade ficaria cheio de
linhas de chamadas que não aconteceram. Também não consome orçamento.

### 🐛 `Date` em template `sql` cru não chega ao Postgres

`sql\`${coluna} >= ${data}\`` manda a `Date` ao driver sem o tipo da coluna, e o
`postgres` recusa com "The string argument must be of type string... Received an
instance of Date". Com `gte(coluna, data)` o Drizzle informa o tipo. Vale para toda
comparação de `timestamptz`: o operador tipado, não o template.

### 🐛 `W10295370` é peça de Whirlpool, e `W` é watt

O reconhecedor de código de modelo recusava todo token de `letra + dígito` cujas
letras coincidissem com uma unidade de medida — a regra existe para que `500ml`,
`12v` e `3x` não sejam confundidos com identificador. Só que a mesma regra,
aplicada nas duas ordens, recusava `W10295370`, que é o número de peça de uma
Whirlpool, e `A1234`, e todo prefixo de uma letra — que é o padrão de várias
marcas de linha branca.

A correção é a ordem: **medida é dígito seguido de unidade**, nunca o contrário.
`500ml` sim, `W10295370` não. O teste que pegou usava justamente um número de peça
real, e é por isso que ele estava lá.

### 🐛 Juntar tokens vizinhos inventava código onde não havia

`PA 21 G` e `PA21G` são o mesmo código escrito por duas fontes, então o extrator
tenta juntar tokens vizinhos. A primeira versão juntava qualquer vizinho, e o
resultado foi pior que não juntar:

- `Refil PA 21` virava `REFILPA21`
- `R$ 89,90` virava `R89`

Três regras resolveram, cada uma atrás de um desses: fragmento é só letra ou só
dígito e tem no máximo 4 caracteres (`Refil` tem 5 e não é fragmento); a classe
alterna (`por R 89` tem duas palavras seguidas); e o primeiro fragmento tem 2
caracteres ou mais (é o que recusa `R 89`).

E a janela é tentada **da maior para a menor**, senão `PA 21 G` vira `PA21` e o
sufixo — que é a variação de cor ou de voltagem — se perde.

### 🔀 Hífen fica dentro do código, barra separa

`EF-ELX-21` e `DA29-00020B` são um código cada; `PA21G/PA26G` são dois. O
tokenizador trata `-`, `.` e `_` como parte do token e barra, vírgula e parêntese
como separador. Sem isso, o código do distribuidor — que é justamente o registro
pobre que o M3 existe para ligar aos ricos — era despedaçado antes de ser
comparado.

### 🧹 Corrida de letras: o limite é 5, e é escolha consciente

`purificador-PA21G` tem letra, dígito e tamanho de código; o que o desqualifica é
a palavra dentro. A regra é "nenhuma corrida de 6 letras ou mais", e ela recusa
`FILTRO21` junto com os falsos positivos. Aceito: o custo de errar para o lado
permissivo é agrupar produtos diferentes, e agrupamento errado não se desfaz
sozinho — some dentro de um SKU e reaparece como margem calculada sobre o custo do
produto errado.

### 🐛 `"N/A"` como marca colapsa o grafo de identidade em um nó

A regra da especificação é "atributo que não aparece vira `null`, nunca invenção",
e eu li isso como "o modelo não deve inventar um valor plausível". Não é só isso, e
o caso comum é mais bobo: o modelo escreve `"N/A"`, `"não informado"` ou `"-"` no
lugar de `null`. A diferença parece cosmética e não é — `"N/A"` vira marca, entra
na forma canônica, e a partir daí **todo produto de marca desconhecida fica
semelhante a todo outro produto de marca desconhecida**.

O schema do registro agora mapeia 30 formas de ausência para `null`, comparadas
depois de normalizar caixa, acento e pontuação. `"sem marca"` ficou **fora** da
lista de propósito: produto genérico sem marca é uma afirmação verdadeira sobre o
produto, e apagá-la perderia informação.

### 🔀 `chaveDeAgrupamento` devolve `null`, nunca string vazia

A chave determinística é `marca|modelo`. Se ela devolvesse `''` quando falta um dos
dois, todo registro sem marca teria a mesma chave de todo outro registro sem marca,
e o casamento determinístico fundiria a base inteira em um SKU. O tipo é
`string | null` e o `null` é a defesa.

### 🔀 Confiança em pontos-base, não em fração

A especificação fala de limiar e de confiança em fração (`0.7`, `0.8`). O sistema
não tem um `float` em lugar nenhum — dinheiro é centavo inteiro, percentual é
ponto-base — e abrir a primeira exceção para confiança de identidade seria começar
a ter dois padrões. `CONFIANCA.MARCA_MODELO_IGUAL = 8_500` é `0.85`.

### 🔀 Mesmo GTIN vence quantidade divergente; sem GTIN, a quantidade manda

Dois registros com o mesmo GTIN e quantidades de embalagem diferentes **são** o
mesmo produto: o GTIN é atribuído à unidade de venda pelo dono da marca, então ele
é o árbitro. Mas uma das duas extrações errou, e isso vai anotado em
`inconsistencias` — sinalizar em vez de escolher em silêncio.

Sem GTIN é o contrário: "refil avulso" e "kit de três refis", mesma marca e mesmo
código, são produtos de venda diferentes com preço diferente, e não há árbitro. O
par vai para revisão em vez de virar um SKU errado.

### 🔀 O casamento determinístico existe tanto para juntar quanto para descartar

O uso óbvio é juntar de graça o que o GTIN já resolveu. O que se esquece é o
inverso: **descartar de graça o que é obviamente diferente**. Sem isso, cada
produto novo gera uma chamada de julgamento por vizinho que o `pgvector` devolver,
e vizinho é o que ele devolve em quantidade. `valeJulgamento()` é a guarda, e ela
também recusa julgar dois registros sem sinal nenhum — a resposta do modelo seria
um chute com aparência de justificativa, que é pior que não ter resposta.

## 2026-09-12 — Fase 4: leitor de código de barras (M14)

### 🐛 Offline não funcionava, e a tela mentia dizendo que sim

O defeito mais grave da fase. `avaliar()` chamava a ação do servidor **antes** de
gravar a leitura na fila local. Sem rede, a chamada falhava, o `catch` assumia, e
a leitura nunca era gravada.

O pior não é perder a leitura: é que a barra de estado dizia **"tudo
sincronizado"**. A pessoa escaneia quarenta itens no balcão de um parceiro,
acredita que estão guardados, e não há nada.

Achado desligando a rede no navegador durante a verificação, não lendo o código —
e o código parecia certo: o `try` tinha a ordem "avalia, grava, sincroniza", que
lê bem e está errada.

Agora a ordem é: grava com `sem_dado`, **depois** tenta avaliar, e se a avaliação
vier o mesmo `idLocal` atualiza a leitura. É para isso que a chave de idempotência
existe nas duas pontas.

De brinde, offline ficou útil em vez de só inofensivo: o módulo de GTIN é função
pura, então roda no navegador. Sem rede ainda se sabe se o código passa no dígito
verificador, de que tipo é, se é caixa e de que país. Descobrir na hora que o
código foi lido errado vale mais que um veredito que não vem.

### 🐛 Dezenove fixtures usavam EAN com dígito verificador inválido

Passavam porque nada validava. `7896541200123` — que eu mesmo escrevi em várias
planilhas de teste — tem verificador errado; o certo é `...121`. Corrigidos, e a
correção do primeiro veio da própria validação nova reprovando a entrada que eu
tinha deixado no teste.

Vale a lição: dado de teste inventado à mão passa a ser mentira no dia em que o
sistema começa a validar. Se há algoritmo de verificação, o fixture tem que
respeitá-lo desde o primeiro dia.

### 🐛 O ingestor gravava o EAN cru, e o importador canonicalizava

Duas portas com comportamentos diferentes. Um UPC-A de 12 dígitos entrado pelo
ingestor não era achado pela consulta, que procura a forma de 13 — metade dos
códigos ficaria inencontrável, e o sintoma seria "sem dado" para produto que está
na base.

Pego pelo teste da consulta, que gravou por um caminho e buscou por outro.
Canonicalizar passou para o ingestor, que é a porta única de toda captura,
inclusive de extrator futuro que nunca veja uma planilha.

### ⚠️ GTIN-14 de caixa comparado com preço de unidade é erro de doze vezes

Não é bug encontrado: é bug **previsto e barrado no desenho**. O código de barras
grande na lateral de uma caixa é um GTIN-14 com dígito indicador de 1 a 8, e ele
identifica o fardo, não a peça. Ler aquilo e tratar como unidade compara o custo de
uma caixa de doze com o preço praticado de uma peça.

Por isso `Gtin.ean13` é `null` para agrupamento — não existe conversão honesta de
caixa para unidade sem saber o conteúdo da caixa, e o código de barras não diz. E
o veredito avisa antes de qualquer cálculo.

### 🔀 `custoMaximoParaComprar` é a fronteira do próprio veredito

A pergunta que a pessoa faz depois de "compro?" é "até quanto pago?". Podia ser
uma margem alvo nova, e não é: é o maior custo com que o veredito ainda diria
`compra`. Assim não existe um segundo conjunto de limiares para divergir do
primeiro. No exemplo do refil praticado a R$ 69,90, dá R$ 23,30 — exatamente um
terço do preço, porque naquele ticket o corte que amarra é o de markup.

Calculado por bisseção e não por fórmula fechada. A fórmula existe: medi que a
margem cai `1 + taxa de devolução` por centavo de custo, porque a provisão incide
sobre o custo. Mas depender da monotonicidade é mais seguro que reproduzir a
álgebra do M8 — fórmula acertaria hoje e passaria a errar em silêncio no dia em
que a provisão mudasse de base.

### 🔀 Mediana do melhor nível de procedência, não mediana de tudo

Cinco extrações de página não podem sobrepujar uma leitura de API oficial. É a
regra 3.3, e numa mediana "não sobrescreve" tem que significar "não entra na
contagem junto" — senão a fonte fraca decide por maioria.

E o maior preço observado nunca é a base: um anúncio absurdo de quem não vende
nada viraria o preço praticado, e o veredito sairia otimista.

### 🔀 A câmera é escolhida por capacidade, como as plataformas

`BarcodeDetector` não existe no Safari de iPhone, que é metade do mercado. Então o
`zxing-wasm` não é plano B exótico: para boa parte dos usuários é o único plano.
O código não pergunta "é Android?", pergunta "existe `BarcodeDetector`?" — e
verifica também **quais formatos** ele suporta, porque existir não é suportar, e
detector que nunca acha nada é o pior modo de falha: parece que a câmera funciona.

Neste ambiente o `BarcodeDetector` não existe, então o caminho que dá para testar
é justamente o do wasm. Verificado de ponta a ponta: EAN-13 desenhado à mão com as
tabelas do padrão, canvas, `captureStream`, `getUserMedia`, vídeo, decodificador —
e o código saiu exato.

### 🔀 O wasm vem do próprio domínio, não de CDN

Requisito de offline, não conforto: CDN é exatamente o que não responde numa loja
com sinal ruim, e o service worker só cacheia o que é servido daqui. Um script de
build copia o binário de `node_modules` para `public/wasm/`. Confirmado na
verificação: `transferSize` zero, servido do cache.

### 🔀 Leitura a quatro por segundo, não a 60

Bateria. Decodificar a cada quadro esquenta o aparelho e não lê mais rápido — o
gargalo é a mão da pessoa alinhando o código. Numa sessão de quarenta itens no
balcão, bateria é recurso escasso.

### 🔀 A fila local só remove o que o servidor confirmou

Falha de rede não mexe na fila além de contar a tentativa. O dispositivo não sabe
se o servidor recebeu, e apagar na dúvida é perder leitura. Duplicar não é
problema: a sincronização é idempotente por `idLocal`, e foi desenhada para isso.

Depois de cinco tentativas para de insistir sozinha — insistir para sempre gasta
bateria — mas **não descarta**: a tela mostra e oferece tentar de novo.

### 🔀 IndexedDB, não localStorage

`localStorage` é síncrono e trava a interface, tem teto de 5 MB, e guarda texto —
o que obriga a serializar a fila inteira a cada gravação. Numa sessão de quarenta
leituras são quarenta reserializações da lista completa.

### 🔀 O armazenamento da fila é injetável, e isso não é cerimônia

IndexedDB não existe em Node, então fila amarrada a ele é fila sem teste. E o que
pode dar errado aqui é lógica, não armazenamento: ordem de descarga, o que fazer
com o recusado, não perder leitura quando a descarga falha no meio.

### 🔀 `decisao` é a coluna que justifica a tabela de leituras

É o único lugar do sistema onde julgamento humano sobre uma recomendação fica
registrado ao lado da recomendação — "cada decisão humana vira exemplo para os
prompts seguintes", da seção 9. Quarenta leituras de balcão com a decisão de cada
uma valem mais que qualquer prompt.

### 🔀 Custo com separador de milhar é recusado

`1.200` num campo de custo de balcão é quase sempre `12,00` com o dedo errado.
Aceitar como mil e duzentos transformaria erro de digitação em veredito confiante.
E `1.2.3` não é erro recuperável: é número que ninguém sabe ler, e chutar
significa calcular margem sobre um custo inventado.

### 🔀 O campo de custo não é limpo entre leituras

No saldão o item seguinte costuma ter o mesmo preço. Limpar obrigaria a redigitar
quarenta vezes. O que se limpa é o código.

### ❓ Não existe base pública e gratuita de GTIN com NCM brasileiro

A etapa 4.4 pede fallback de base pública para descrição e NCM. O levantamento:
Cosmos (Bluesoft) tem descrição, marca e NCM, e exige token; Open Food Facts é
livre e cobre alimento e higiene, sem NCM e sem o nicho; UPCitemdb tem faixa de
teste, sem NCM e com cobertura fraca de produto brasileiro.

Neste ambiente as duas tentativas de alcançar provedor foram bloqueadas pela
política de rede, então nem o que existe eu pude confirmar. A porta ficou pronta
com o estado `sem_credencial`, que é o mesmo padrão honesto da sonda de
capacidades: cadastrar endpoint e sair chamando seria inventar capacidade.

### 🧹 Peso, embalagem e devolução são presumidos, e a tela diz

Peso de 300 g, embalagem de R$ 1,50, devolução de 2%. No balcão não se sabe o
peso, e peso errado muda a faixa de frete e portanto a margem. A tela mostra as
três presunções abaixo do veredito em vez de escondê-las — a pessoa precisa saber
o que o número assume.

`unidadesPrevistasNoMes` não é presumido: fica ausente, e o M8 avisa que não
consegue ratear o DAS por unidade. Virá do M10, quando houver histórico de pedido
para contar. Inventar faria o rateio sobre um número imaginário.

### 🧹 O lint do React Compiler recusou três padrões meus, e estava certo

`setState` síncrono dentro de `useEffect`, memoização manual com `useCallback` que
ele não consegue preservar, e função chamada antes de ser declarada. A saída não
foi desativar regra: a rede virou `useSyncExternalStore` (que é a ferramenta certa
para ler estado de fora do React e resolve a hidratação com o instantâneo de
servidor), a descarga passou para o **callback** do evento em vez do corpo do
efeito, e a fila local passou a ser construída no primeiro uso.

A construção no primeiro uso ficou melhor de uso, não só de regra: o aviso de "pode
perder leitura" só faz sentido quando existe leitura, e antes da primeira não há
nada a perder.

### 🧹 `db:migrate` despejava vinte linhas de aviso de driver

Rodar de novo produzia uma sequência de `NOTICE: already exists, skipping`, cada
uma como objeto com `file`, `line` e `routine` — que é exatamente o que a cláusula
`IF NOT EXISTS` significa. Vinte linhas que parecem erro são como se perde o erro
de verdade no meio. Silenciado; falha continua saindo, e sai ruidosa.

---

## 2026-09-12 — Poller e tela de jobs

### 🐛 A detecção de separador olhava só a primeira linha, e o fallback escondia o bug

**O defeito.** `detectarSeparador` contava ocorrências de `;`, `,`, tabulação e `|`
**na primeira linha útil** do CSV. Exportação de painel quase sempre começa com
linha de título — "Relatório de anúncios", "Gerado em 12/09/2026" — que não tem
separador nenhum. Todas as contagens davam zero e a função caía no padrão `;`.

Consequência: arquivo separado por vírgula era lido como **uma coluna só**. E o
sintoma não aparecia ali: aparecia três camadas depois, como "nenhuma das
primeiras 12 linhas parece um cabeçalho de exportação", mensagem que manda a
pessoa conferir os nomes das colunas quando o problema era o separador.

**Por que passou tanto tempo escondido.** A planilha usada nos testes é do Mercado
Livre, que usa `;` — exatamente o valor do fallback. **Fallback que coincide com o
caso de teste é a forma mais confiável de esconder um bug**, porque o teste passa
pelo motivo errado. Só apareceu quando subi uma planilha separada por vírgula pela
tela nova, que é o tipo de coisa que teste não faz e uso faz.

**A primeira correção também estava errada.** Passei a olhar as 12 primeiras
linhas e escolher o candidato com mais linhas **concordando** na contagem. Num
arquivo real:

```
Relatorio de anuncios, Mercado Livre     uma vírgula
Gerado em 12/09/2026, 09:14              uma vírgula
MLB;Titulo;Preco;Estoque                 três ponto e vírgulas
MLB1;Refil;69,90;10                      três, mais a vírgula decimal
MLB2;Vedacao;19,90;20                    três, mais a vírgula decimal
```

A vírgula aparece em **quatro** linhas e o `;` em três: consistência sozinha
elegia a vírgula. A pontuação final é `linhas concordantes x contagem` (4x1 contra
3x3), que corresponde à intuição certa — **separador de verdade não aparece uma
vez por linha, aparece uma vez por coluna**.

Fixado em teste com cinco arranjos: título sem separador, dois preâmbulos,
vírgula só no título, linha vazia no meio, e fim de linha do Windows.

### 🐛 `new URL()` remove quebra de linha em vez de recusar

Duas URLs coladas uma por linha — o caso **comum** numa caixa que aceita texto —
passavam por `ehUrlValida`, porque o analisador do padrão WHATWG **remove**
tabulação e quebra de linha do meio da URL em vez de rejeitar.
`https://a.com` + `https://b.com` virava `https://a.comhttps//b.com`: uma URL
válida, sem sentido, que teria ido para extração como se fosse um anúncio.

Corrigido em `analisarUrl`, não no chamador: espaço em branco depois do `trim`
recusa antes de chegar ao `URL`. Assim todo chamador futuro está protegido, e a
lista de links continua caindo em `texto`, que é onde o classificador a reconhece
como lista e o executor abre um job por link.

### 🐛 `recortar` estourava o próprio limite

`recortar(texto, 90)` cortava em 89 e acrescentava três pontos: 92 caracteres.
Função de limite que não respeita o limite. Sem consequência grave — é `title` de
célula — mas é o tipo de coisa que nunca mais seria olhada. O teste agora varre
máximos de 1 a 90 e exige que a saída **nunca** passe do pedido.

### 🐛 Arquivo com `'use server'` só pode exportar função assíncrona

Duas `export const` em `acoes.ts` derrubaram o build inteiro. A mensagem do
Turbopack é enganosa: diz *"the module has no exports at all"*, que parece falha
de resolução de módulo, e não violação de regra. As constantes foram para
`constantes.ts`.

### 🐛 O pool de conexão vazava a cada recarga a quente

`banco()` guardava a instância num `let` de módulo. O servidor de
desenvolvimento do Next reavalia módulo a cada recarga: o `let` volta a `null` e
abre **outro** pool de dez conexões, sem fechar o anterior. Meia hora editando
componente esgotaria o `max_connections` do Postgres, e o sintoma apareceria como
erro de conexão numa tela que não foi tocada. Agora mora em `globalThis`, que
sobrevive à reavaliação. O núcleo montado (`montarNucleo`) usa o mesmo mecanismo.

### 🐛 Um `span` de leitor de tela fazia a página rolar na horizontal

A tabela tem `min-width: 54rem` dentro de um envelope com `overflow-x: auto`, e a
tabela ficava corretamente contida. Mesmo assim, a **página** rolava na horizontal
a 420 px de largura: `documentElement.scrollWidth` de 807 contra
`body.scrollWidth` de 420.

O culpado era o `<span class="sr-only">ações</span>` do cabeçalho da última
coluna. `.sr-only` é `position: absolute`, e o envelope não tinha `position`, então
o bloco contêiner do span era o **documento** — ele escapava do `overflow-x: auto`
e ia parar na posição que ocuparia na tabela não cortada, 889 px. Um elemento de
1 px, invisível, esticando a página.

Corrigido com `position: relative` no envelope. A lição generaliza: **contêiner de
rolagem precisa ser posicionado**, senão descendente absoluto não é cortado por
ele. Achado medindo no navegador, não olhando: na captura de tela o conteúdo
parecia certo, e só o `scrollWidth` denunciava.

### ⚠️ `npm run poller` não repassa SIGTERM, mas `Ctrl-C` funciona

Precisei medir duas vezes porque a primeira medição estava errada: mandei sinal
para o pid que o `pgrep` achou, que era o do `npx`, e concluí coisa demais a partir
disso. Refeito com `$!` e com o pid que o próprio poller registra no log, nas
quatro situações que importam:

| como sobe | quem recebe o sinal | encerramento limpo |
| --- | --- | --- |
| `npm run poller` | SIGTERM no pid do npm | **não** — o poller fica órfão |
| `npm run poller` | SIGINT no **grupo** (o que o `Ctrl-C` faz) | sim, 107 ms |
| `tsx scripts/poller.ts` | SIGTERM no pai | sim, 105 ms |
| `node --import tsx scripts/poller.ts` | SIGTERM no processo | sim, 106 ms |

A distinção é a que interessa na prática: **uso interativo com `npm run` está
bem**, porque o terminal sinaliza o grupo de processos inteiro. O que quebra é
supervisor — contêiner, systemd — mandando SIGTERM só para o pid do npm: npm não
repassa, e isso não muda com a forma do script (testei com o script já num
processo único e o comportamento é o mesmo).

Duas consequências no código: os scripts `poller` e `poller:uma-vez` passaram a
usar `node --import tsx`, que roda **no mesmo processo** em vez de o `tsx` abrir um
segundo node; e o README manda chamar node direto para rodar como serviço.

### 🐛 O poller morria se o banco estivesse fora no arranque

A consulta de estado inicial da fila rodava solta, fora de qualquer tratamento. Um
`ECONNREFUSED` ali derrubava o processo com código 1 — enquanto a **mesma falha**,
três linhas depois, dentro do laço, entraria em backoff e se recuperaria sozinha.
Duas políticas para a mesma falha, decididas por onde ela acontece.

Aconteceu de verdade: o Postgres de teste caiu no meio da sessão e o poller morreu
no arranque em vez de esperar. Agora o estado inicial é diagnóstico e não
pré-requisito: a falha vira `fila.estado_inicial_indisponivel` em nível de aviso, e
o laço começa e faz o backoff. Banco que volta em dez segundos não deve custar um
reinício de serviço.

### 🔀 O poller não conhece ingestão

O laço recebe uma `Tarefa` — nome, mais um método que executa uma unidade e diz se
havia trabalho. A tradução de `ResultadoDoProcessamento` para esse contrato mora em
`dominio/ingestao/tarefa.ts`. Assim `infra/` não depende de `dominio/`, e o mesmo
laço vai servir para extração, resolução de identidade e monitor de preço sem
alteração.

### 🔀 Falha de job não é erro de poller

`{ tipo: 'falhou' }` já foi tratado pela fila, com backoff e tentativa contada.
Aplicar backoff de poller em cima disso puniria a fila inteira pelo defeito de um
job — exatamente o que a fila existe para evitar. Só **exceção** conta como erro
de poller, porque só ela indica que o laço não tem como continuar.

### 🔀 O sono do poller é interrompível, e o tique em andamento não é interrompido

Duas metades da mesma decisão. `parar()` acorda a espera na hora, senão `Ctrl-C`
durante uma espera de dois segundos parece travamento. Mas **não** interrompe o
tique em andamento: job pela metade deixaria `rodando` no banco até o prazo de
execução estourar, e job que demora é melhor que job partido.

### 🔀 O log é uma linha de JSON, e o registrador nunca lança

Quatro formas reais de `JSON.stringify` derrubar o laço, todas tratadas antes da
serialização: `bigint` lança `TypeError` (e o sistema guarda dinheiro em `bigint`),
referência circular lança, `Error` serializa como `{}` porque `message` e `stack`
não são enumeráveis, e texto colado de 8 KB não cabe numa linha. Acima disso, a
escrita ainda vai dentro de `try/catch` com linha de recurso.

Campo cujo nome sugere segredo é redigido por nome — grosseiro de propósito, erra
para o lado de esconder. `chave_idempotencia` é a exceção explícita: é o que liga a
linha de log ao registro no banco.

### 🔀 Redação por nome de campo, e não por lista de campos conhecidos

A alternativa seria marcar os campos sensíveis um a um. Não sobrevive: quem
acrescenta um campo de token dentro de um objeto de erro não vai lembrar de
registrá-lo. Por nome, `accessToken` novo já entra coberto.

### 🔀 A lógica da tela tem teste; o JSX não

`apresentacao.ts` concentra o que pode estar errado — resumir um payload `jsonb`
escrito por outra versão do código, formatar duração, decidir se a fila está
parada — e tem 37 casos. O JSX fica sem teste de renderização, e é escolha
consciente: montar `@testing-library/react` para verificar que uma tabela produz
`<tr>` cobre o que o compilador e o olho já cobrem. O que o olho não cobre é
`resumirEntrada` recebendo o payload de um job de dois meses atrás.

Em vez de teste de renderização, a tela foi exercitada **por navegador** com o
Chromium do ambiente: colar URL, colar a mesma URL de novo, colar texto, subir
planilha, enviar vazio, processar, reenfileirar. Achou dois defeitos reais — o
separador e o botão de reenfileirar.

### 🔀 O aviso da ação viaja como código, não como texto

A ação termina em `redirect`, e o caminho fácil seria `?aviso=Entrada+aceita`.
Texto livre na URL significa que **qualquer link** consegue fazer a tela dizer
qualquer coisa, inclusive "3 registros removidos". O React escapa, então não é
injeção: é mentira, e numa tela de auditoria isso é pior. Só código previsto em
`CODIGOS_DE_AVISO` produz mensagem; o único número que atravessa a URL é coagido
para inteiro não negativo.

### 🔀 `redirect` do Next lança, então nenhum dele fica dentro de `try`

`redirect()` sinaliza por exceção (`NEXT_REDIRECT`). Um `try { ...; redirect() }
catch {}` engoliria o redirecionamento e a tela ficaria parada sem explicação. Em
`acoes.ts` o trabalho acontece, o resultado vira código, e o `redirect` é a última
linha, fora de qualquer captura.

### 🔀 A tela não afirma se existe poller rodando

Não há batimento gravado, então o sistema **não sabe**. Inventar um estado de
processo que não se mede seria pior que não dizer nada. O aviso usa só o
observável: há job pronto **e** nada terminou no último minuto. Diz isso, oferece
as duas saídas — "Processar agora" ou rodar o poller — e não afirma a causa.

### 🔀 Declaração de tipo escrita à mão para o módulo CSS

A declaração que o Next injeta para `*.module.css` é assinatura de índice. Com
`noPropertyAccessFromIndexSignature` isso obrigaria `estilo['pagina']` em toda
classe e — pior — `estilo['paigna']` compilaria, devolvendo `undefined`. Com
`jobs.module.css.d.ts` escrito à mão, erro de digitação de classe vira erro de
compilação. A divergência possível falha para o lado seguro: classe no CSS que
falta na declaração não compila; classe declarada que falta no CSS só produz
elemento sem estilo.

### 🧹 Teto de upload de 8 MB contra 32 MB do armazenamento

`MAX_BYTES` do armazenamento de conteúdo é 32 MB; o formulário aceita 8 MB. Não é
inconsistência: subir 32 MB por Server Action significa manter isso em memória no
servidor durante a requisição. Planilha desse tamanho entra pelo caminho de linha
de comando, que lê do disco. Os dois números vêm de `src/config/limites.ts`, e
`next.config.ts` importa de lá — divergir faria o Next recusar o arquivo com erro
genérico **antes** de a ação poder explicar o motivo.

### 🐛 A linha recusada guardava só as colunas reconhecidas

Ao construir a tela de detalhe, a primeira versão mostrou os campos com nome
normalizado — `preco`, `id_externo` — em vez do nome da coluna do arquivo. Olhando
o motivo, o problema era maior que o rótulo: `LinhaRejeitada.bruto` é montado a
partir do **mapeamento**, então só tem as colunas que o mapeador reconheceu.

Uma linha recusada justamente porque a coluna de preço não foi reconhecida não
guardava o preço em lugar nenhum. A promessa de "nada é descartado, corrija à mão"
não se sustentava. Agora cada linha recusada carrega também `original`: nome de
coluna como está no arquivo e valor, na ordem, **inclusive as colunas não
reconhecidas**. Lista em vez de objeto, porque cabeçalho de painel repete nome mais
do que devia, e coluna sem nome ganha rótulo por posição.

### 🐛 Um `h1` com nome de arquivo fazia a tela de detalhe rolar na horizontal

Mesmo defeito de forma que o `span` de leitor de tela, causa diferente: o título da
tela de detalhe é o nome do arquivo ou a URL do anúncio — token único, sem espaço,
que não quebra sozinho. A 420 px o `h1` media 478 px e, com os 24 px de padding,
dava exatamente os 502 px de `scrollWidth` medidos. `overflow-wrap: anywhere`
resolve.

Vale a generalização: **todo texto que vem de dado externo precisa poder quebrar em
qualquer ponto**, porque nome de arquivo e URL não têm espaço onde quebrar.

### 🔀 A tela de detalhe é a última instância, e mostra o payload como está

Quando o resumo não explica, a pessoa precisa ver o que está gravado. A tela mostra
`entrada` e `resultado` como JSON indentado, cortado em 20 000 caracteres com aviso
de que cortou. Identificador que não é UUID responde 404 em vez de 500 — sem essa
verificação, a consulta lançaria erro de sintaxe do Postgres para o que é só uma URL
digitada errada.

---

## 2026-09-12 — Ligação de ponta a ponta

### 🐛 A fila comparava dois relógios diferentes, e um job ficava invisível

**O defeito.** `reivindicar` capturava `new Date()` do JavaScript e comparava com
`agendado_para`, que é escrito pelo relógio do **banco** (`now()`). O JavaScript
trunca em **milissegundo**; o Postgres tem precisão de **microssegundo**.

Resultado: um job enfileirado em `.764154` era comparado contra `.764000`, e
`agendado_para <= agora` dava **falso**. O job ficava invisível.

**Por que isso é pior do que parece.** Num poller o defeito se cura sozinho no
tique seguinte, então em produção seria **invisível**. Mas em qualquer fluxo que
enfileira e processa em sequência — endpoint síncrono, comando de linha, teste —
é intermitente, e a falha aparece como "fila vazia" sem nenhuma relação com a
causa. Custou uma investigação inteira.

**O caminho até a causa, porque o erro do meio importa.** Minha primeira hipótese
foi exatamente a certa: truncamento de milissegundo. Escrevi um teste para
confirmar e ele deu **0 de 60** — hipótese aparentemente refutada. O teste é que
estava errado: eu capturava o relógio da aplicação **depois** de uma ida e volta
extra ao banco, então ele estava sempre à frente.

Só reproduzindo o caminho real, com o conteúdo real, e despejando a tabela no
momento da falha, os números apareceram e a hipótese original se confirmou. Lição:
um teste de hipótese que não reproduz o caminho real não refuta nada.

**Correção.** O "agora" da fila passa a ser o do banco: `reivindicar` e
`quantidadePronta` usam `now()` em SQL em vez de `Date` da aplicação. O parâmetro
`agora` explícito continua aceito, para teste que precisa de tempo determinístico.

Comparar `agendado_para` com o relógio da aplicação era o erro de origem: quem
escreve o valor é o banco, então quem o compara também tem que ser.

**Teste de regressão:** trinta repetições de enfileirar-e-reivindicar em
sequência imediata, e vinte de `quantidadePronta`. Uma repetição só passaria por
sorte.

### 🔀 Conteúdo endereçado por hash, não no payload do job

O payload do job carrega o **hash** do arquivo, não o arquivo. Três ganhos:

1. **Idempotência por construção** — mesmo conteúdo, mesmo hash, sem comparar
   nada.
2. **A tabela `job` fica pequena.** Um XLSX de 4 MB em `jsonb` transformaria a
   fila em depósito de arquivo, e a tela dos últimos 100 jobs ficaria impossível
   de carregar.
3. É o **cache de extração** que a seção 7 da especificação pede, e o mesmo
   mecanismo serve depois para HTML, PDF e foto de fornecedor.

Escrita atômica (arquivo temporário e `rename`): sem isso, um processo morto no
meio da escrita deixaria um arquivo truncado **com o hash de um conteúdo
completo**, e toda leitura seguinte confiaria nele.

E o hash é validado antes de virar caminho — ele chega do payload de um job, e um
valor como `../../etc/passwd` seria leitura de caminho arbitrário.

### 🔀 Tipo sem extrator vai para revisão, não para erro

Dos nove tipos de entrada, só dois têm extrator: planilha de exportação e lista
de links. Os outros dependem de LLM e não existem.

O executor **não finge**: manda para `pendente_revisao` com o motivo dizendo o
tipo, a etapa do roadmap e o que falta. Falhar como erro faria o job entrar em
backoff tentando para sempre um extrator que não existe, e a pessoa veria um erro
genérico que parece defeito em vez de uma lacuna conhecida.

### 🔀 Lista de links vira N jobs, não um job que percorre a lista

Se o terceiro link falha, os outros já concluíram e só ele reagenda. Um job só
perderia isso — e a lista de vinte links viraria tudo ou nada.

### 🐛 Minhas URLs de teste tinham ID irreal, e o classificador estava certo

Quatro testes de ponta a ponta falharam com `MLB-1-a` e `MLB-0-a`. O padrão de
item do ML exige seis dígitos ou mais, então essas URLs caíam em "site conhecido,
caminho não reconhecido" com confiança 5000 — abaixo do limiar de 6000 — e iam
para revisão antes de chegar ao executor.

Não era bug: era o limiar de confiança fazendo exatamente o trabalho dele. Corrigi
as URLs de teste para IDs realistas.

**Vale registrar o efeito colateral:** uma URL de plataforma conhecida com caminho
em formato novo também cai em revisão. É o comportamento desejado — melhor
perguntar que gastar LLM numa página que pode ser qualquer coisa — mas significa
que mudança de formato de URL da plataforma aparece como fila de revisão
crescendo, não como erro. É onde olhar quando isso acontecer.

---

## 2026-09-12 — Importador de planilha de exportação (M1, etapa 3.7)

### 🐛 `interpretarPreco` corrompia preço em silêncio — o defeito mais grave até agora

A primeira versão era uma cadeia de heurísticas: "tem ponto? tem vírgula? qual
vem por último? então strip". Ela aceitava **`1.2.3` como `123`**.

Por que isso é grave e não uma curiosidade: preço vem de célula de planilha de
fornecedor, e um preço errado por mil vezes passa pela calculadora de margem sem
nenhum aviso — `calcularMargem` não tem como saber que o custo estava errado. O
resultado seria uma decisão de compra baseada em número inventado.

**Correção:** a interpretação passou a ser por **forma validada inteira**, não por
heurística. Sete formas explícitas, cada uma correspondendo a uma convenção real:

| Forma | Exemplo | Resultado |
|---|---|---|
| inteiro | `1234` | 1234 |
| decimal com ponto | `69.90` | 69.90 |
| decimal com vírgula | `69,90` | 69.90 |
| milhar `.` + decimal `,` (pt-BR) | `1.234,56` | 1234.56 |
| milhar `,` + decimal `.` (en-US) | `1,234.56` | 1234.56 |
| só milhar com ponto | `1.234` | 1234 |
| só milhar com vírgula | `1,234` | 1234 |

O que não casa com nenhuma é `ilegivel` e vai para revisão. `1.2.3` agora é
recusado.

**A regra que desfaz a ambiguidade:** grupo de até dois dígitos após o separador é
decimal; grupo de exatamente três é milhar. `1,50` é um e cinquenta; `1,500` é mil
e quinhentos. Funciona porque preço tem duas casas decimais — não é tolerância, é
a estrutura do problema.

### 🐛 Minhas expectativas de teste estavam erradas duas vezes, e as duas ensinaram algo

1. **`12,345`** — escrevi esperando `ilegivel`. É `12345` pela minha própria regra
   documentada, e está certo. Minha lista de casos ruins contradizia a regra que
   eu tinha acabado de escrever no comentário acima.
2. **`R$` sozinho** — escrevi esperando `ilegivel`. O código devolve `ausente`, e
   isso é melhor: planilha desleixada põe o símbolo numa coluna e o número na
   seguinte. Como `ausente`, a linha importa com preço nulo e a coluna vizinha
   aparece no relatório de não reconhecidas — que é exatamente onde a pessoa vai
   procurar. Como `ilegivel`, a linha seria rejeitada sem necessidade.

Os dois casos viraram teste próprio, com o raciocínio no comentário, em vez de
serem corrigidos em silêncio.

### 🧹 O verificador de caractere literal caiu na própria armadilha

A armadilha de escape virou byte aconteceu **quatro vezes**, então escrevi
`scripts/verificar-fontes-texto.mjs` para bloquear mecanicamente.

A primeira versão do verificador usava faixas literais num regex — e o `U+2028`
(separador de linha) virou quebra de linha **de verdade**, partindo a expressão no
meio e quebrando o arquivo com `SyntaxError`. A segunda tentativa nem chegou a ser
escrita: o próprio comando foi recusado por conter caractere de controle.

**Versão final:** nenhuma sequência de escape no arquivo. Compara ponto de código
numericamente e monta os caracteres especiais com `String.fromCharCode`. É o único
jeito honesto de escrever um verificador imune ao problema que ele detecta.

E funcionou de imediato: achou um BOM literal em `leitor.test.ts` que eu tinha
deixado passar na limpeza manual. Está ligado ao `npm run check` e ao CI.

### 🔀 `exceljs`, não `xlsx`

A `xlsx` da SheetJS no npm está parada em **0.18.5** com CVEs conhecidas de
prototype pollution e ReDoS; a equipe migrou para CDN próprio, que o proxy deste
ambiente não alcança. `exceljs@4.4.0` é mantida e resolve.

**Custo anotado:** 21,8 MB descompactados e algumas dependências transitivas
deprecadas (`glob@7`, `fstream`, `uuid@8`). Aceitável para dependência de
servidor; se um dia pesar, o leitor de XLSX é o único ponto que precisa mudar,
porque `lerXlsx` já isola a biblioteca atrás de uma função que devolve
`Grade`.

### 🐛 `String()` sobre valor de célula desconhecido daria `[object Object]`

O ESLint pegou. Célula de XLSX pode ter forma que o `exceljs` representa como
objeto (fórmula, hyperlink, texto rico, erro) e eu tratava as conhecidas, mas caía
em `String(valor)` no fim.

Consequência se tivesse passado: `"[object Object]"` viraria **título de produto**
e entraria no grafo de identidade.

**Correção:** forma desconhecida vira string vazia, o que faz a linha cair em
`pendente_revisao` — onde ela deve estar. `bigint` é tratado à parte porque é dado
de verdade.

### ❓ Os nomes de coluna das exportações não pude confirmar

**O problema.** O importador precisa saber que "Preço" da exportação do Mercado
Livre é o preço, e `standard_price` é o da Amazon. **Não tenho acesso a uma
exportação real de nenhuma das três** — não há conta conectada, e a documentação
das plataformas bloqueia acesso automatizado.

**O que fiz em vez de chutar e fingir certeza.** Três coisas que, juntas,
transformam "palpite errado" em "aviso na tela":

1. Casamento por **sinônimo normalizado**, não por nome exato. "Preço",
   "PREÇO", "Preço (R$)" e "preco_unitario" caem todos no mesmo campo.
2. **Toda coluna não reconhecida é relatada** no resultado. O palpite errado
   aparece como "coluna não reconhecida: X".
3. **Campo obrigatório é só o título.** Exigir preço rejeitaria exportação de
   rascunho inteira.

**O que ainda é necessário para fechar a 3.7:** na primeira importação de
verdade, conferir o relatório de colunas não reconhecidas e completar a tabela de
sinônimos em `mapeamento.ts`. Está anotado no roadmap.

### 🔀 Campo duplicado: a primeira coluna vence, e a segunda é relatada

Exportação do ML traz "Preço" e "Preço de venda" na mesma planilha. Escolher uma
em silêncio esconderia **qual das duas alimentou a margem**. A primeira vence e a
segunda entra em `naoReconhecidas`, então a escolha fica visível.

### 🔀 Leitor de CSV escrito à mão; XLSX por biblioteca

CSV é formato pequeno e o que quebra na prática é conhecido: aspas escapadas,
quebra de linha dentro de campo, BOM, separador que varia com a localidade.
Escrever custa pouco, fica testável célula por célula e evita dependência.

O caso que justifica o esforço: **quebra de linha dentro de campo entre aspas**.
Descrição de anúncio tem parágrafo, e uma implementação por `split` desloca a
planilha inteira a partir dali.

### 🔀 Cabeçalho é procurado, e escolhe-se a melhor linha, não a primeira

Exportação de painel vem com linha de título, aviso de validade e linha em branco
antes do cabeçalho. Presumir linha 1 faria tudo deslocar em silêncio.

E não é "a primeira linha que passa do mínimo": uma linha de aviso pode casar duas
colunas por coincidência enquanto a seguinte casa oito. O critério é **a linha com
mais colunas reconhecidas** nas primeiras doze.

Quando nenhuma passa, a planilha vai para `pendente_revisao` com as primeiras
linhas anexadas — a pessoa precisa ver o que chegou.

### 🔀 Detecção de separador conta fora de aspas

Planilha pt-BR usa `;` e tem preço `69,90` dentro dos campos. Contar vírgulas
ingenuamente escolheria `,` e deslocaria tudo. Contar **fora de aspas** resolve, e
é por isso que existe `contarForaDeAspas` em vez de `split(',').length`.

### 🔀 Toda célula de XLSX vira texto, inclusive número e data

Tentador entregar `number` para preço. Mas então o mapeador teria dois caminhos —
um para XLSX e um para CSV — e o de CSV seria o menos testado, justamente o que
recebe formato mais imprevisível. Um caminho só, alimentado por texto.

Data vira ISO e não formato local: `12/09/2026` é ambíguo entre dia e mês.


---

## 2026-09-12 — Núcleo determinístico da fase 3

### 🐛 Classificador confundia listagem do Mercado Livre com anúncio

No ML o sinal de listagem está no **subdomínio**, não no caminho: `lista.` é
busca, `produto.` é item. A primeira versão dos padrões olhava só
`pathname + search`, então `lista.mercadolivre.com.br/refil-purificador` era
classificado como `anuncio_marketplace`.

**Consequência se tivesse passado:** o extrator de item rodaria sobre uma página
de listagem, gastaria token e devolveria um produto onde havia vinte.

**Correção:** o alvo do casamento passou a ser `hostname + pathname + search`, e o
padrão de listagem do ML ganhou `/^lista\./`.

Pegou no teste que já existia — o caso estava na lista de URLs de listagem.

### 🐛 Quatro arquivos-fonte eram binários para o git

Escrevi as sequências de escape do byte nulo e da faixa de diacríticos combinantes
esperando que ficassem como escape no código, mas a camada
JSON da ferramenta de escrita converteu para **bytes literais**. Resultado:
`git grep` e `git diff` tratavam os arquivos como binários.

**Correção, e por que não foi só reescrever o escape:**

- O separador de hash virou prefixo de tamanho:
  `partes.map(p => \`${p.length}:${p}\`).join('')`. Além de ASCII puro, é à prova
  de colisão de fronteira — nenhum conteúdo consegue simular a divisão, o que um
  separador sempre permite em teoria.
- Os diacríticos passaram a `\p{Diacritic}` com flag `u`: mesma semântica, fonte
  legível.

### 🐛 Configuração de tipos do driver estava duplicada

`cliente.ts` configurava `types: { bigint: postgres.BigInt }` e o cliente de teste
não. Sem isso o driver devolve **string** para `bigint`, então um teste compararia
`'6990'` com `6990` e passaria ou falharia pelo motivo errado — exatamente a classe
de bug que o [ADR 0004](./adr/0004-dinheiro-em-centavos-inteiros.md) existe para
impedir.

**Correção:** `criarBancoCom()` é o construtor único, usado por produção e por
teste. Duas definições podem divergir; uma não.

### 🐛 Testes em paralelo se atropelavam no banco

Os arquivos de teste de infraestrutura compartilham **um** banco e limpam tabelas
no `beforeEach`. Rodando em paralelo, o `truncate` de um arquivo apagava as linhas
que outro tinha acabado de inserir, e a falha aparecia como erro de chave
estrangeira sem nenhuma relação com o que o teste verificava — o tipo de falha que
consome uma hora para diagnosticar.

**Correção:** `fileParallelism: false`.

**Alternativa considerada e descartada:** um schema Postgres por worker, com
migrations por schema. É a solução certa para uma suíte grande; aqui a suíte
inteira roda em dez segundos, e a complexidade não se paga.

### 🐛 No CI as migrations rodavam depois dos testes

Consequência: sem as tabelas, `describe.skipIf(!temBancoDeTeste())` pularia a
suíte de banco **em silêncio**, e o CI passaria verde sem ter exercitado
idempotência, `SKIP LOCKED` nem isolamento de perfil. Verde enganoso é pior que
vermelho.

**Correção:** migrations antes dos testes.

### 🔀 `exigeLlm` virou tabela em vez de `switch`

O `switch` com casos agrupados e comentários entre eles disparava `no-fallthrough`
no ESLint. Em vez de silenciar a regra, virou `Record<TipoDeEntrada, boolean>`: dá
exaustividade pelo compilador — acrescentar um tipo de entrada sem classificá-lo
não compila — e some com a ambiguidade.

---

## 2026-09-12 — M8, precificação

### 🐛 Minha própria expectativa de teste estava errada, e o motivo é instrutivo

Escrevi `multiplicarPorFator(centavos(100), 1.005, 'meio-para-cima')` esperando
101. Dá **100**, porque `100 * 1.005` é `100.49999999999999` em IEEE-754.

Não é bug da função: é a razão de percentual **nunca** passar por ela.
`aplicarPontosBase` multiplica em inteiro antes de dividir e acerta os mesmos
0,5%. O teste virou documentação desse perigo, em vez de ser corrigido em silêncio.

### ❓ As taxas das plataformas são levantamento, não fonte oficial

Todas as tabelas de taxa entram com `fonte: 'manual'` e geram o aviso
`tabela_presumida` em **todo** cálculo. Os números vêm do levantamento de
11–12/09/2026 da especificação, e taxa de marketplace muda e varia por categoria.

A distribuição da taxa de frete da Shopee por peso (R$ 16 a R$ 28) é interpolação
minha: a especificação dá a faixa, não a curva. Está comentado no código como tal.

O aviso só desaparece quando `listing_prices` do ML responder e a tabela entrar
com `fonte: 'm3_api'`.

---

## 2026-09-12 — Fundação

### 🐛 `Math.round` do JavaScript não é simétrico

`Math.round(-0.5)` é `-0`, não `-1`. Num sistema que nega valores (estorno,
crédito, margem negativa), isso significa que arredondar e negar dá resultado
diferente de negar e arredondar.

O modo `meio-para-cima` do `dinheiro.ts` aplica o sinal por fora, e há teste
comparando com o comportamento nativo para o próximo a mexer entender por quê.

### 🐛 Negação unária sobre tipo com marca é recusada pelo lint

`-valor` onde `valor: Centavos` dispara `no-unsafe-unary-minus`. Trocado por
`0 - valor`, que diz a mesma coisa sem apagar a marca de tipo. Preferível a
desligar a regra: a marca é justamente o que impede confundir reais com centavos.

### 🔀 `exactOptionalPropertyTypes` fica ligado, e custa três construtores no teste

A opção distingue "chave ausente" de "chave com `undefined`". Isso impede gravar
`undefined` num campo opcional por acidente — num sistema que guarda credencial e
classificação fiscal, é proteção real.

O custo apareceu no teste de M8: não dá para ter um construtor único com
`tipoAnuncioML: undefined`, então há um por plataforma. Três construtores contra a
garantia de que nenhum `undefined` entra em campo opcional por descuido: vale.

### 🧹 `legacy-peer-deps=true` no `.npmrc`

npm 10.9 tem um bug no resolvedor de peer dependencies que estoura com
`Cannot read properties of null (reading 'edgesOut')` ao montar o grafo do vitest.

**Custo do atalho:** conflito real de peer dependency deixa de ser reportado.
**Quando remover:** quando o ambiente subir para npm 12+. Está comentado no
`.npmrc`.

### ⚠️ O push ficou bloqueado por horas, e a causa não era o que o erro dizia

`git push` devolvia 403 com a mensagem "Claude doesn't have GitHub access ... for
your organization", apontando para instalação em organização. Diagnóstico real:

- `get_me` funcionava e retornava o dono do repositório — a conexão existia
- leitura funcionava (o repo é **público**, então não exige o App)
- escrita dava `403 Resource not accessible by integration`, que é erro de
  **permissão de instalação de GitHub App**, nunca de permissão de conta
- `can_push: true` engana: reflete a permissão da **conta**, não a do App

Causa: o App estava instalado com "Only select repositories", e este repositório
foi **criado depois** — nunca entrou na lista. A mensagem falar de "organização"
é enganosa: era conta pessoal.

**Lição para a próxima vez:** repositório novo e público exibe exatamente esse
padrão — leitura ok, escrita 403. Conferir a lista do App antes de investigar
qualquer outra coisa.
