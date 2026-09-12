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

Convenção de marcação:

- 🐛 **Bug** — algo estava errado e foi corrigido
- ⚠️ **Risco** — algo que pode dar errado e está sendo monitorado
- 🔀 **Decisão** — escolha entre alternativas, com o porquê
- ❓ **Não confirmado** — algo que assumi sem poder verificar
- 🧹 **Dívida** — atalho consciente, com o custo anotado

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
