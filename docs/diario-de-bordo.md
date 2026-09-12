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

## 2026-09-12 — Fase 5: resolução de identidade (M3)

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
