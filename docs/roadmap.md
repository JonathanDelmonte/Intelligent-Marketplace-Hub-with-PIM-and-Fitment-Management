# Roadmap de implementação

Derivado da seção 8 da [especificação](./especificacao.md). O princípio de
ordenação é **utilidade, não arquitetura**: cada fase entrega algo que serve
sozinho no dia em que fica pronta, e o projeto pode parar em qualquer fase sem
deixar um esqueleto inútil.

A armadilha explicitada na especificação e que este roadmap existe para evitar:
construir o prospector e o painel bonito primeiro, e a venda depois. As fases 1
a 4 existem para que cada noite de código tenha contrapartida em venda possível.

Legenda de estado: ✅ pronto · 🚧 em andamento · ⬜ não começou · 🔒 bloqueado por
dependência externa.

**Não há mais nada em ⬜, e isso é informação e não conquista.** As nove entregas que estavam marcadas como "não começou" passaram a 🔒
porque nenhuma delas **pode** começar neste ambiente — e "não começou" sugeria que era
questão de tempo. São três causas, todas já descritas em
[pendências](./pendencias.md):

- **Chave de LLM** (1.1): 3.4 e 3.6 dependem dela por definição — catálogo de
  distribuidor e visão sobre print de tabela.
- **Rede de saída** (1.6): 3.2, 3.3, 6.10, 6.11 e 7.3 precisam buscar página, PDF e
  CNPJ. A política de rede daqui libera registries de pacote e as APIs da Anthropic, e
  recusa o resto.
- **App no Mercado Livre** (1.2): a 2.6b é o fluxo de OAuth, e não há app para o qual
  fazer OAuth.

A 3.5 (PDF de tabela de preços) é a única com nuance: um leitor de PDF **daria** para
escrever e testar contra um PDF sintético. Ficou 🔒 de propósito — o problema real dela
é a variedade de layout de tabela de fornecedor, e um extrator calibrado contra um PDF
que eu mesmo gerei testaria a minha suposição, não o mundo. É o erro que
`ingestao/planilha/mapeamento.ts` evita ao relatar coluna não reconhecida, e ali há
feedback; aqui não haveria.

Este arquivo diz **o que falta construir**, em ordem de utilidade. Para saber **o
que está travado e por quem** — chave de LLM, app no Mercado Livre, exportação
real de planilha, dívida consciente — ver [pendências](./pendencias.md).

---

## Fase 0 — Fundação (não está na especificação; é pré-requisito de tudo)

| #   | Entrega                                                                    | Estado |
| --- | -------------------------------------------------------------------------- | ------ |
| 0.1 | Regra de autoria de commits + hooks de verificação                         | ✅     |
| 0.2 | Toolchain: Next.js App Router, TS strict, ESLint, Prettier, Vitest         | ✅     |
| 0.3 | `src/config` — marca, perfil e credenciais fora do código (seção 1.2)      | ✅     |
| 0.4 | `src/lib/dinheiro.ts` — aritmética monetária em centavos inteiros          | ✅     |
| 0.5 | Schema de banco completo da seção 3 + migrations + pgvector                | ✅     |
| 0.6 | Procedência: tipo `Fonte`, `coletado_em`, regra de precedência (seção 2.3) | ✅     |

**Entrega:** nenhuma refatoração de marca depois, e nenhuma decisão de modelagem
adiada para o momento em que doer.

---

## Fase 1 — Calculadora de margem (M8)

> Especificação: “Função pura + testes. Sem interface. Uma noite.”

| #   | Entrega                                                              | Estado |
| --- | -------------------------------------------------------------------- | ------ |
| 1.1 | Tabelas de taxa versionadas por plataforma e vigência                | ✅     |
| 1.2 | `calcularMargem()` — função pura, ML/Shopee/Amazon                   | ✅     |
| 1.3 | Regime fiscal: CPF, MEI (DAS rateado), Simples                       | ✅     |
| 1.4 | Provisão de devolução como custo, por categoria                      | ✅     |
| 1.5 | Aviso de zona morta do ML (R$ 79 – ~R$ 120)                          | ✅     |
| 1.6 | `simularFaixa()` — curva de margem por preço com os degraus marcados | ✅     |
| 1.7 | `precoParaMargem()` — inverso: preço mínimo para margem alvo         | ✅     |
| 1.8 | Suíte de testes cobrindo cada degrau e cada aviso                    | ✅     |

**Entrega:** nunca mais publicar anúncio com margem negativa.

**Por que primeiro:** é a única função do sistema que muda uma decisão de
dinheiro no mesmo dia em que existe, e não depende de nada.

---

## Fase 2 — Teste de capacidades + perfil

> Especificação: “Criar o app no ML, gerar token, testar endpoint por endpoint e
> escrever a matriz da seção 2.2 com dados reais. Meia noite.”

| #   | Entrega                                                                     | Estado |
| --- | --------------------------------------------------------------------------- | ------ |
| 2.1 | Contrato `Adaptador` + erro `NaoSuportado` (seção 2.4)                      | ✅     |
| 2.2 | Registro de capacidades com descoberta em runtime e cache de 24 h           | ✅     |
| 2.3 | Adaptadores ML / Shopee / Amazon declarando modo por capacidade             | ✅     |
| 2.4 | `matriz-capacidades.md` — arquivo de configuração, não surpresa em produção | ✅     |
| 2.5 | Sonda de capacidades — roda sem credencial, ainda não bate em endpoint | 🚧     |
| 2.6 | Seed de `perfil_vendedor` (primeira linha, regime CPF)                 | ✅     |
| 2.6b | Fluxo de OAuth que grava `credencial` cifrada                         | 🔒     |
| 2.7 | Cifragem de credencial em repouso (AES-256-GCM), nunca em `.env`            | ✅     |

**Entrega:** saber o que é possível em vez de supor, e nunca precisar refatorar
marca para fora do código.

**Nota sobre o 403:** `GET /sites/MLB/search` está registrado como
`BLOQUEADO` na matriz, com a data e a evidência.

**O que falta na 2.5, e por que está 🚧:** a sonda roda, roda sem credencial, e
relata o estado honesto de cada capacidade — mas **ainda não bate em endpoint
nenhum**, porque o app em `developers.mercadolivre.com.br` não existe. Ela
reporta o que a matriz declara e diz explicitamente o que falta confirmar.
Cadastrar um endpoint e sair chamando antes de haver app seria inventar
resultado, e a matriz existe justamente para não confundir expectativa com fato:
toda capacidade não confirmada aparece como `presumido`, não como disponível.

Para fechar a 2.5, nesta ordem: criar o app no ML, passar pelo OAuth (2.6b), e
rodar a sonda de novo — que então promove `presumido` a `disponivel` ou rebaixa
a `bloqueado`, com o status HTTP na mão.

---

## Fase 3 — Ingestão universal (M1) + catálogo (M2)

> Especificação: “Colar link e importar planilha. Duas a três noites. Tudo
> depois depende disto.”

| #    | Entrega                                                               | Estado |
| ---- | --------------------------------------------------------------------- | ------ |
| 3.1  | Classificador de entrada (URL, xlsx, csv, pdf, imagem, texto)         | ✅     |
| 3.2  | Extrator de HTML de anúncio — seletores por plataforma + fallback LLM | 🔒     |
| 3.3  | Extrator de listagem/categoria com paginação                          | 🔒     |
| 3.4  | Extrator de catálogo de distribuidor (LLM obrigatório)                | 🔒     |
| 3.5  | Extrator de PDF de tabela de preços                                   | 🔒     |
| 3.6  | Extrator de imagem de tabela (print de WhatsApp) — visão              | 🔒     |
| 3.7  | Importadores de planilha de exportação das três plataformas           | 🚧     |
| 3.8  | Fila `job` idempotente e retomável + contagem por status              | ✅     |
| 3.11 | Orquestrador e executor: entrada → fila → extração → `produto_externo` | ✅     |
| 3.12 | Armazenamento de conteúdo por hash (cache de extração da seção 7)     | ✅     |
| 3.9  | `pendente_revisao` em vez de descarte quando o schema falha           | ✅     |
| 3.10 | M2: repositório de `sku` com `perfil_id` exigido pelo compilador      | ✅     |
| 3.13 | Poller: o laço que consome a fila sozinho, com encerramento limpo     | ✅     |
| 3.14 | Log estruturado (seção 7)                                             | ✅     |
| 3.15 | Tela de jobs: campo único de entrada, contagem e erro visível (seção 7) | ✅   |
| 3.16 | Tela de detalhe de job, com cada linha recusada e o motivo              | ✅     |

**Entrega:** o sistema começa a acumular base.

**Invariante:** tudo que entra vira `produto_externo`, nunca `sku` direto.

**O que está pronto e o que não está.** O caminho determinístico da fase 3 está
completo, **ligado de ponta a ponta**, **rodando sozinho** e testado contra
Postgres e sistema de arquivos reais: a entrada chega pela tela ou por código, é
classificada, guardada por hash, enfileirada, consumida pelo **poller** sem
ninguém pedir, importada, e grava `produto_externo` — e daí um SKU é criado
ligando as ocorrências. **Os extratores (3.2 a 3.6) não começaram**, e é neles que
o LLM entra — não há chave de LLM configurada, e escrever extrator sem poder
rodá-lo contra página de verdade produziria código que parece funcionar.

**Como rodar.** `npm run poller` mantém o laço; `npm run poller:uma-vez` drena a
fila e sai, o que serve para cron. Em contêiner ou supervisor, chamar
`tsx scripts/poller.ts` direto em vez de passar pelo `npm` — o npm não repassa
`SIGTERM` para o filho, e o encerramento limpo do poller nunca seria acionado (ver
o diário). A tela fica em `/importar` e funciona sem poller nenhum: tem um botão que
processa alguns jobs na hora.

A fronteira está desenhada: `exigeLlm()` diz quais tipos de entrada gastam token
e quais não, e o classificador já roteia.

**A 3.7 está 🚧 e não ✅, e o motivo é honesto.** O importador está completo e
testado — leitor de CSV/TSV próprio, XLSX por `exceljs`, busca de cabeçalho,
interpretação de preço por forma validada, `pendente_revisao` com o bruto
preservado. O que falta não é código: é **confirmar os nomes de coluna** contra
uma exportação real das plataformas, que não existe disponível aqui. O
mapeamento relata toda coluna que não reconhece — e agora a tela mostra isso como
alerta em cada job —, então fechar a 3.7 é rodar uma importação de verdade e
completar a tabela de sinônimos com o que o relatório apontar. Ver o diário de
bordo.

Subir uma planilha pela tela nova já pagou parte disso: apareceu um defeito de
detecção de separador que estava escondido havia semanas, porque o `;` do Mercado
Livre coincidia com o valor de fallback. Uso encontra o que teste não encontra.

**As linhas recusadas são visíveis.** O executor guarda cada linha que a
importação não aceitou, e a tela de detalhe do job mostra todas: número da linha,
motivo, e a linha **como está no arquivo** — nome de coluna original, inclusive as
colunas que o mapeamento não reconheceu. É o que permite corrigir três linhas à mão
em vez de reimportar quatro mil.

**O que ainda não existe na interface.** Não há tela de catálogo, de SKU nem de
precificação: o motor de margem (fase 1) e o repositório de SKU (3.10) são
chamáveis por código e por teste, não por tela. A ordem do roadmap é deliberada —
a tela de importação vinha primeiro porque sem ela nada do que a ingestão faz é
auditável.

---

## Fase 4 — Leitor de código de barras (M14)

> Especificação: “Uma noite sobre M8. É a primeira função que gera dinheiro.”

| #   | Entrega                                                  | Estado |
| --- | -------------------------------------------------------- | ------ |
| 4.1 | PWA com `BarcodeDetector`, fallback `zxing-wasm`          | ✅     |
| 4.2 | Veredito compra / não compra em dois segundos, usando M8  | ✅     |
| 4.3 | Fila de sincronização offline (loja tem sinal ruim)       | ✅     |
| 4.4 | Fallback de base pública de GTIN para descrição e NCM     | 🔒     |
| 4.5 | GTIN como primitiva, com dígito verificador e embalagem   | ✅     |
| 4.6 | Coluna `ean` indexada em `produto_externo`, com backfill  | ✅     |
| 4.7 | Tabela `leitura`: decisão humana ao lado do veredito      | ✅     |

**Entrega:** sair de casa e comprar com dado. Arbitragem e avaliação de estoque
de parceiro no balcão.

**Como usar.** A tela fica em `/leitor`, e dá para instalar na tela inicial do
celular — o manifesto abre direto nela. Informe o custo, leia o código pela câmera
ou digite, e o veredito sai com preço praticado, margem, markup e **até quanto dá
para pagar**. Depois marque "comprei" ou "não comprei": é essa marca que ensina o
sistema depois.

**Funciona sem rede, e isso foi verificado desligando a rede.** A leitura é
gravada no aparelho **antes** de qualquer tentativa de servidor, e sobe quando a
conexão volta. Sem rede o veredito não vem — preço praticado mora no banco —, mas a
validação do código vem, porque o módulo de GTIN é função pura e roda no navegador.

**O decodificador tem dois caminhos, escolhidos por capacidade.**
`BarcodeDetector` do sistema quando existe; `zxing-wasm` quando não — que é o caso
do Safari de iPhone, metade do mercado. O wasm é servido do próprio domínio e
cacheado pelo service worker, porque CDN é justamente o que não responde na loja.
Verificado de ponta a ponta com um EAN-13 desenhado à mão alimentando a câmera.

**A 4.4 está 🔒 e não 🚧, e o motivo é externo.** Não existe base pública,
gratuita e sem credencial que devolva NCM de GTIN brasileiro: a Cosmos tem e exige
token, a Open Food Facts é livre e não cobre o nicho nem tem NCM, a UPCitemdb tem
faixa de teste sem NCM. A porta está pronta com estado `sem_credencial`; ligar a
Cosmos é cadastrar credencial e escrever trinta linhas de adaptador. Ver o diário.

**O que o leitor precisa para valer: base.** Ele lê o código e compara com o preço
praticado que o sistema conhece — sem planilha importada (fase 3), lê e não tem com
o que comparar. As duas fases se completam, e é por isso que esta vem depois.

---

## Fase 5 — Resolução de identidade (M3) 🧠

> Especificação: “Duas a três noites. Daqui em diante o sistema fica mais
> inteligente a cada link colado.”

| #   | Entrega                                                                  | Estado |
| --- | ------------------------------------------------------------------------ | ------ |
| 5.1 | Extração de registro estruturado por LLM, com `null` em vez de invenção  | 🚧     |
| 5.2 | Forma canônica + embedding (`tipo + marca + modelo normalizado`)         | 🚧     |
| 5.3 | Busca de vizinhos por `pgvector`                                         | ✅     |
| 5.4 | Julgamento binário por LLM com justificativa                             | 🚧     |
| 5.5 | Agrupamento automático acima do limiar; fila de revisão na zona cinzenta | ✅     |
| 5.6 | Decisão humana vira exemplo few-shot para as chamadas seguintes          | ✅     |
| 5.7 | Cache por conteúdo — resolver o mesmo produto uma única vez              | ✅     |
| 5.8 | Propagação de equivalência para SKU, com `perfil_id` exigido pelo tipo   | ✅     |
| 5.9 | Tela de revisão em `/juntar-iguais`, de dois cliques                        | ✅     |
| 5.10 | Job de resolução na fila, consumido pelo poller junto com a ingestão    | ✅     |
| 5.11 | Criar SKU a partir de um par, com título proposto e editável            | ✅     |

**Entrega:** o grafo de identidade começa a existir. Qual fornecedor é mais
barato, a que preço o mercado vende, e qual é a margem real.

**O que já funciona hoje, sem chave de LLM.** É mais do que parecia quando a fase
foi escrita, e o motivo é o ADR 0005: a regra de ouro manda usar LLM só onde a
entrada é texto livre heterogêneo, e boa parte da resolução de identidade não é.

O que decide de graça: **mesmo GTIN** é o único caso definitivo do sistema, e
**mesma marca com mesmo código de peça** é justamente o caso que o M3 existe para
resolver — o anúncio que diz `PA21G` e o catálogo do distribuidor que diz
`EF-ELX-21`, ligados sem gastar um centavo. O casamento determinístico também
**descarta** de graça o que é obviamente diferente, o que importa mais do que parece:
sem esse filtro, cada vizinho que o `pgvector` devolvesse viraria uma chamada paga.

O que fica na fila de revisão, com o motivo escrito: o par que só julgamento resolve.
Sem chave, ele aparece em `/juntar-iguais` dizendo "sem chave de LLM, então ninguém
julgou" — o sistema sabe que não sabe, e quem olha entende por quê.

**O que as três linhas 🚧 esperam.** Não é código: é `LLM_API_KEY`. O contrato do
registro extraído existe e aplica a regra de `null` em vez de invenção; a forma
canônica existe e é determinística; o julgamento tem contrato, cache, teto de
orçamento e roteamento por limiar, tudo exercitado por um chamador falso. Falta a
chamada. Ligar é implementar `Chamador` e apontar `LLM_MODELO_JULGAMENTO` — ver
`src/infra/llm/`.

**A 5.3 está ✅ e a 5.2 não, e a diferença é honesta:** gerar embedding custa chamada
de API; **buscar** é operação do banco. A busca inteira — ordenação por distância,
corte, exclusão do próprio produto, separação por modelo — é exercitada com vetor
sintético contra `pgvector` de verdade. O que falta na 5.2 é só o vetor.

**A 5.7 desvia da especificação de propósito.** A especificação diz "cache por
`hash_conteudo`". O cache é pela **pergunta** — o par de formas canônicas e atributos
—, e não pelo `hash_conteudo` da ocorrência, que inclui a URL. Assim duas capturas do
mesmo produto em vendedores diferentes compartilham a resposta em vez de pagarem duas
vezes. E `par_identidade` memoriza no nível do par: par já avaliado não volta para
julgamento, nem para o cache.

Outra tensão resolvida no caminho: exemplo few-shot **não** entra no hash. Se
entrasse, cada decisão humana invalidaria o cache de todos os pares, e o sistema
re-resolveria a base inteira justamente por estar aprendendo. Pergunta define o cache;
contexto vai gravado ao lado, para a chamada continuar reproduzível.

**Como usar.** A tela fica em `/juntar-iguais`. O botão resolve algumas ocorrências na
hora, sem processo de fundo. Cada par pendente mostra os dois lados no mesmo formato —
preço, vendedor, procedência, GTIN, forma canônica —, a evidência que os aproximou e a
justificativa de quem julgou. Três botões: é o mesmo, são diferentes, não sei dizer.

"Não sei dizer" não é preguiça: forçar sim ou não em quem não sabe produz exemplo
errado, ensinado com autoridade — e trava o topo da fila para sempre.

Quando você diz "é o mesmo" e um dos lados já pertence a um SKU, a outra ocorrência
entra no SKU na hora, e os preços de cada fonte passam a aparecer juntos. É a resposta
que o grafo existe para dar.

**E roda sozinho.** A ingestão enfileira uma resolução por ocorrência gravada, e o
poller consome as duas filas em ordem — ingestão primeiro, identidade depois. É o que
faz a frase da especificação ser verdade: o sistema fica mais inteligente a cada link
colado, não a cada clique. A tela continua tendo o botão, para quem quiser forçar.

Orçamento é por job, com resolvedor novo a cada um: um resolvedor de vida longa
esgotaria o teto na primeira hora e nunca mais deixaria nada rodar. Teto estourado
**adia** o job em vez de falhar, e devolve a tentativa — o job progrediu, e par avaliado
não volta para avaliação.

**O limite honesto disso**, que só apareceu rodando de verdade: o importador de planilha
não extrai marca nem modelo, então a via de marca com código de peça não tem dado para
morder até existir o extrator por LLM (3.2). Planilha com EAN já agrupa; catálogo sem EAN
acumula ocorrência que não liga a nada. Ver [pendências](./pendencias.md), 3.2.

---

## Fase 6 — Compatibilidade (M4) 🧠 ← o fosso

> Especificação: “Uma semana, e continua evoluindo sempre. É a funcionalidade de
> maior retorno do sistema inteiro.”

| #    | Entrega                                                                     | Estado |
| ---- | --------------------------------------------------------------------------- | ------ |
| 6.1  | Coleta de evidência — anúncio capturado e entrada manual                    | 🚧     |
| 6.2  | Gramáticas de nomenclatura por marca — parser determinístico e auditável    | ✅     |
| 6.3  | Inferência de família a partir da gramática                                 | ✅     |
| 6.4  | Resolução de conflito por restrição, com inconsistência sinalizada          | ✅     |
| 6.5  | Confiança graduada (fabricante 1.0 · 3 concorrentes 0.8 · fórum 0.4)        | ✅     |
| 6.6  | Corte de publicação em 0.7; resto vai para fila                             | ✅     |
| 6.7  | Saída dupla: ficha do anúncio e resposta ao comprador na tela                | ✅     |
| 6.8  | Coleta como tarefa de fila, ligada à resolução de identidade                | ✅     |
| 6.9  | Tela de compatibilidade: fila de conferência, ficha e cadastro de aparelho  | ✅     |
| 6.10 | Manual do fabricante em PDF e página oficial como fontes de coleta          | 🔒     |
| 6.11 | Fórum e catálogo de distribuidor como fontes de coleta                      | 🔒     |

**Entrega:** vender sem disputar centavo. É o que ninguém no mercado brasileiro
faz bem, e é a razão de construir em vez de assinar.

**O que está pronto e o que não está.** O caminho de evidência que já funciona é o
que não custa nada: todo anúncio que a ingestão capturou tem título, título de peça
de reposição cita os modelos em que a peça serve, e casar isso com os aparelhos
cadastrados é comparação de texto normalizado — sem LLM e sem API. Mais a entrada
manual, que é o caminho de quem tem o manual na mão.

As três fontes que faltam (6.10 e 6.11) são todas "buscar e ler página", e são o
mesmo trabalho do prospector da fase 10 — PDF de manual, página de fabricante,
fórum, catálogo. Fazer aqui seria construir meio prospector duas vezes; ficam para
depois, e a base já aceita as cinco fontes com força graduada.

A cadeia fecha sozinha a partir de uma decisão humana: planilha → ocorrência →
identidade → **você confirma o produto** → compatibilidade coletada e inferida. Só o
"confirmar o produto" é manual, e é onde deve ser.

---

## Fase 7 — Fornecedores (M5) + scanner (M7)

| #   | Entrega                                                           | Estado |
| --- | ----------------------------------------------------------------- | ------ |
| 7.1 | Triagem pelas cinco perguntas — função pura com teste             | ✅     |
| 7.2 | `vende_direto_marketplace = true` → descarte automático com aviso | ✅     |
| 7.3 | Verificação automática desse campo por nome e CNPJ (M0)           | 🔒     |
| 7.4 | Histórico de preço por SKU e fornecedor (aumento silencioso)      | ✅     |
| 7.5 | Score de confiabilidade alimentado por atraso real                | 🔒     |
| 7.6 | Gerador do primeiro contato com as cinco perguntas preenchidas    | ✅     |
| 7.7 | M7: cortes numéricos configuráveis, aplicados em subcategoria     | ✅     |
| 7.8 | Repositório e tela de fornecedor                                  | ✅     |

**Começou pelas duas regras, não pela tela.** A triagem e o gerador de contato são
função pura com teste; a tela veio depois e usa as duas. O veredito **não é
gravado**: é recalculado a cada leitura, então mudar o critério de prazo vale para
o cadastro antigo em vez de deixar a base com dois vereditos conforme a data.

O histórico de preço (7.4) entrou junto porque é a mesma gravação: registrar preço
de fornecedor devolve a variação em pontos-base e avisa quando o aumento passa do
corte. Uma linha de histórico por gravação, mesmo com preço igual — saber que o
preço foi conferido ontem vale tanto quanto saber qual é.

O scanner (7.7) é o filtro numérico, não o descobridor — a própria especificação
desce ele de posto. Sete cortes sobre números medidos, com o motivo de cada um,
todos configuráveis, e o corte de markup e de ticket importados do módulo de
margem em vez de repetidos: a especificação diz que "a tela de preço também usa",
e dois números iguais em dois arquivos divergem na primeira mudança.

**O que falta, e por quê.** 7.3 — verificar por nome e CNPJ se o fornecedor tem
loja própria — é busca em página, o mesmo trabalho das fontes de evidência que
ficaram para a fase 10, e fica com elas. O campo continua respondível à mão, e é
ele que descarta.

7.5 está **bloqueado por dependência**, não adiado: confiabilidade "alimentada por
atraso real" exige pedido com data prometida e data real, e isso é a fase 8 (M10).
Um score calculado sobre impressão seria pior que nenhum — daria ao palpite a
aparência de medição, que é o oposto do que o resto do sistema faz.

---

## Fase 8 — Anúncios (M9) + pedidos (M10) + consignação (M11)

| #    | Entrega                                                                 | Estado |
| ---- | ----------------------------------------------------------------------- | ------ |
| 8.1  | Gerador de título com códigos de modelo e termos de busca reais         | ✅     |
| 8.2  | Descrição com tabela de compatibilidade gerada de M4                    | ✅     |
| 8.3  | Checklist de atributos obrigatórios por categoria                       | ✅     |
| 8.4  | Gerador de arquivo de importação em massa (caminho padrão)              | ✅     |
| 8.5  | Alerta de catálogo do ML para conta sem reputação verde                 | ✅     |
| 8.6  | Importação de pedidos, casamento com SKU, margem realizada              | ✅     |
| 8.7  | Fila de postagem do dia — a tela mais usada do sistema                  | ✅     |
| 8.8  | Etiqueta e envio ao fornecedor no dropship, com cobrança de confirmação | 🔒     |
| 8.9  | Conferência de repasse: previsto contra o que caiu                      | ✅     |
| 8.10 | M11: consignação, alerta de conferência, fechamento por período         | ✅     |
| 8.11 | Tela de anúncio: montar, revisar avisos e baixar o arquivo              | ✅     |

**A fase 8 fechou, menos a 8.8, que depende da API do ML.** Onze das doze entregas
estão em pé, e a operação do dia a dia sai da planilha: a venda entra por planilha,
casa com SKU, calcula margem realizada, aparece na fila de postagem ordenada por
prazo, e o repasse é conferido contra o que as taxas explicam. Do outro lado, o
anúncio é montado com título, descrição, checklist e arquivo de importação, sem
plataforma conectada.

**8.11 revelou um buraco que só o uso mostra.** A tela bloqueava o download por
falta de `categoria` — corretamente, porque a importação recusaria — e **nenhuma
tela do sistema escrevia `categoria_ml`**. O checklist apontava um problema sem
caminho de conserto, e a entrega "baixar o arquivo" era inalcançável para qualquer
SKU real. O conserto entrou na mesma tela, ao lado do item que aponta a falta.

**A montagem mora na URL, e isso não é detalhe de implementação.** Formulário GET
em vez de ação de servidor: o link é compartilhável, o botão de voltar funciona, e a
rota do arquivo monta o mesmo anúncio que a tela mostrou porque recebe os mesmos
parâmetros. Com estado de sessão, "o arquivo saiu diferente do que eu vi" seria um
bug possível — e é o mais caro desta tela, porque ninguém confere um CSV antes de
subir.

**8.3 é por traço do produto, não por categoria da plataforma.** A tabela de
atributo obrigatório por categoria é da plataforma e daqui não há como obtê-la — o
mesmo limite de `mapeamento.ts`. E não é o que o vendedor pergunta: ele pergunta o
que falta neste anúncio e o que cada falta custa. Então a conferência detecta traços
(reposição, elétrico, medida crítica, consumível), acumula a exigência de cada um, e
nomeia cada nível pela **consequência** — bloqueia a exportação, gera devolução,
ranqueia pior, ou só ajuda. O traço de reposição vem da ficha de compatibilidade,
que é estrutura; os outros vêm de tabela de palavra, e falham do jeito certo.

**8.5 é o alerta que M8 não dava.** A precificação avisa quando *você escolhe*
anunciar em catálogo — consequência da sua escolha, que você já sabia. O que faltava
é o produto **já ter ficha** e você não ter escolhido nada: anúncio comum de produto
com ficha é absorvido por ela, e sem reputação verde você fica em "outras opções de
compra". Detectado sem API, por dois sinais: a URL `/p/MLB…` (estrutural, forte) e
vários vendedores no mesmo GTIN (indício, que nunca confirma sozinho).

**8.10 inverteu o alerta de conferência.** Um controle que compara a data com sete
dias atrás erra nos dois sentidos: linha com zero unidade sem conferir há um mês não
tem risco, e linha com trinta unidades anunciadas conferida há oito dias é a que
cancela venda hoje. Então a urgência é tempo **e** exposição, e a tela lidera por
unidades em risco. A conferência exige a contagem do parceiro: marcar a data sem
corrigir o estoque apaga o alerta e deixa o erro.

O que 8.10 ainda não tem, anotado em pendências: histórico de preço acordado (mudar
o acordo hoje mexe em mês já fechado) e de qual parceiro saiu a peça quando o mesmo
SKU está em duas lojas. Os dois ficam **visíveis** no fechamento em vez de
silenciosos.

**8.4 já existia e não estava marcado.** O arquivo de importação é gerado pelo
adaptador de cada plataforma desde a fase 2 — `exportarParaImportacao` é a única
capacidade sempre suportada, com teste de que nunca lança `NaoSuportado`. O que
faltava era quem produz o objeto a ser exportado, e é o 8.1/8.2.

**8.6, 8.7 e 8.9 fechadas.** A cadeia de venda funciona de ponta a ponta e tem
teste: planilha de venda entra pela mesma porta da de anúncio, a ingestão descobre
pelo **cabeçalho** que é venda — nome de arquivo não serve —, encaminha para a fila
de pedido, e o pedido é gravado com casamento por EAN, custo congelado na venda e
margem realizada. A conferência de repasse acha o pedido em que a plataforma
repassa menos do que as taxas informadas explicam.

**A tela de 8.7 põe a conferência de repasse no fim dela, não em uma sua.** Quem
confere repasse é a mesma pessoa que está imprimindo etiqueta, e a conferência só
tem conteúdo quando há divergência — tela separada seria tela que ninguém abre.

Duas escolhas da tela que vale registrar. `sem_prazo` aparece **primeiro**, não
último: sem prazo não é "sem pressa", é "ninguém sabe quando vence", e é o pedido
que mais some. E pedido sem SKU casado aparece na fila com a explicação do que
falta, em vez de aparecer sem margem e deixar o vendedor adivinhar por quê — a
fila do dia é para postar, então não esconde pedido por falta de margem.

Foi de propósito começar pelas regras: margem realizada é a razão de o catálogo
existir, e ela é função pura sobre números que a planilha traz. A importação é
encanamento, e encanamento sem a regra pronta tende a gravar o campo errado.

**O casamento de pedido com SKU é por EAN, e isso é limite conhecido.** Casar por
id de anúncio seria melhor — é a chave que toda planilha de venda traz — e exige a
tabela `anuncio` povoada, que depende de importar anúncio. Enquanto não houver,
pedido sem EAN casado fica com `sku_id` nulo, **contado e visível**, porque venda
sem SKU é venda sem margem.

**A ordem dos termos no título é a decisão que mais importa nesta fase.** O código
do aparelho vem antes do código da peça: o comprador sabe o modelo do purificador
dele — está na etiqueta — e quase nunca sabe o código do refil. Ele busca "refil
PA21G", não "refil EF-ELX-21".

E só entra no título o que é **publicável** na ficha de M4. Título é afirmação de
compatibilidade na vitrine; afirmar ali o que está abaixo do corte é o caminho
curto para a devolução que a fase 6 existe para evitar.

---

## Fase 9 — Fiscal (M12) 🧠 — **tem prazo: antes de dezembro**

| #   | Entrega                                                               | Estado |
| --- | --------------------------------------------------------------------- | ------ |
| 9.1 | Classificador de NCM/CEST com alternativas justificadas e confirmação | 🚧     |
| 9.2 | CST e cClassTrib por SKU (rejeição de NF-e em 04/01/2027)             | ✅     |
| 9.3 | Controle de teto do MEI com projeção; avisos em 70% e 85%             | ✅     |
| 9.4 | Painel de prazos (01/01/2027, 04/01/2027)                             | ✅     |
| 9.5 | Integração com emissor de NF-e existente — não reescrever             | 🔒     |
| 9.6 | Alerta de categoria regulada (ANVISA em suplemento)                   | ✅     |

**Por que tem prazo:** esse cadastro com 20 SKUs é uma tarde; com 200 no meio da
operação é uma semana perdida em janeiro.

**A fase 9 fechou o que dá para fechar sem chave de LLM e sem emissor de NF-e.**
Quatro entregas ✅, a 9.1 em 🚧 pelo mesmo motivo das de M3, e a 9.5 🔒. O prazo de
janeiro deixou de ser uma data no papel: há tela que
mostra quantos dias faltam, o que acontece na data, e o que fazer antes — com a base
legal de cada prazo, para ser conferível.

**9.4 mostra quanto tempo ainda dá para fazer com calma**, e não avisa no dia. O
corte de trinta dias vem do trabalho que o prazo exige, não do calendário. Prazo de
outro regime aparece marcado em vez de escondido, porque o regime muda: quem é CPF
hoje pode ser MEI em dezembro.

**9.3 lidera pela projeção, porque o acumulado sozinho avisa tarde.** 70% em setembro
é tranquilo; 70% em abril vai estourar, e o acumulado é o mesmo número. A projeção é
linear e declarada como hipótese — modelar sazonalidade exigiria histórico de anos
que não existe, e projeção sazonal errada assusta mais que linear honesta. O teto é
proporcional ao mês de abertura do CNPJ, senão o controle diria "tranquilo" para quem
já estourou.

**9.2 valida forma e deixa a lista aberta.** Erro de formato recusa, porque dígito a
menos é digitação; valor fora da lista conhecida grava com aviso, porque a lista é o
que este sistema conhece e não o que existe — recusar um código correto pararia a
operação por ignorância do sistema. Ponto e espaço são ignorados, para dar para colar
como está na tabela oficial.

**9.6 vive no checklist do anúncio, não em relatório.** Anúncio irregular de
categoria regulada é cancelado, e a hora de saber é antes de publicar. A marcação no
SKU vence a detecção por palavra, sempre: é onde a pessoa decidiu.

**A 9.1 está 🚧 e não ✅, pelo mesmo critério das entregas de M3.** O classificador
existe, valida a resposta, ordena candidatos por certeza, descarta código fora de
forma e é cacheado por conteúdo — e **não produz sugestão nenhuma hoje**, porque não
há provedor de LLM. Marcar ✅ diria que a entrega funciona, e ela não funciona: o que
está pronto é tudo menos a chamada.

Sem chave, a tela diz "ninguém sugeriu" e explica que isso não trava nada — o campo
continua preenchível à mão e o cadastro fica pronto do mesmo jeito. Ligar a chave é
implementar `Chamador` em `infra/llm/ambiente.ts`, que é o único arquivo que precisa
saber disso.

---

## Fase 10 — Prospector de mercado (M6) 🧠

> Especificação: “Uma a duas semanas. O módulo mais ambicioso e o mais divertido
> — e por isso mesmo vem depois.”

| #    | Entrega                                                                    | Estado |
| ---- | -------------------------------------------------------------------------- | ------ |
| 10.1 | Loop de fronteira: hipóteses, fronteira, achados                           | ✅     |
| 10.2 | Seleção por valor esperado por custo                                       | ✅     |
| 10.3 | Famílias de hipótese (fabricante, distribuidor, custo, compatibilidade, …) | ✅     |
| 10.4 | Sensor de demanda pública via PNCP                                         | 🔒     |
| 10.5 | **Orçamento obrigatório por execução** (passos e reais)                    | ✅     |
| 10.6 | Critério de parada por saturação                                           | ✅     |
| 10.7 | Dossiê auditável, com URL de origem em cada item                           | ✅     |
| 10.8 | Dossiê parcial salvo quando o orçamento estoura                            | ✅     |

**O prospector investiga desde 16/09.** O laço existe (`prospector/motor.ts`), roda pela
fila como os outros jobs, e tem uma ferramenta de verdade: o investigador de **base
local**, que mineira `produto_externo` e responde duas das sete perguntas — "em que mais
serve" (código citado no mesmo anúncio) e "que outras peças" (anúncio do mesmo aparelho
com peça diferente). Cada achado com a URL de onde veio. Custo: zero, porque é consulta
local; o que limita é o teto de passos.

**O que falta são as outras cinco ferramentas, e uma delas é 🔒.** A 10.4 espera rede (a
política deste ambiente recusa `pncp.gov.br` com `CONNECT` 403); buscador, leitor de
página e consulta de CNPJ esperam ser escritos, e a visão espera chave de LLM **e** um
caminho de imagem que o prospector não tem. Registrar um investigador é uma linha em
`prospector/registro.ts`, e a tela passa a mostrar a ferramenta como disponível sem mais
nada — inclusive destravando dossiê que já estava na fila.

**Escrever o executor mostrou que o dossiê não era retomável**, apesar de a tabela
existir para isso desde a fase 1: a fronteira era gravada sem ferramenta, peso nem
custo, e `investigados` e o contador de saturação não eram gravados. Retomar re-investigava
e mudava a ordem. Está no diário de 16/09, com o resto do que a ligação achou.

**A máquina tem tela desde 15/09** (`/garimpo`): o que dá para investigar hoje
ferramenta por ferramenta, os dossiês com gasto contra teto e motivo de parada, e abrir
um alvo — que escreve as sete hipóteses e a fronteira, em ordem de valor por custo, com
o teto declarado antes de gastar o primeiro centavo. Não há botão de investigar, porque
o executor não existe: botão que não faz nada é pior que ausência de botão.

Ligar a tela achou três coisas. O repositório gravava o alvo **normalizado** na coluna de
exibição, e o dossiê aparecia escrito "correia de maquina de lavar" — agora `alvo` guarda
a grafia e `alvo_chave` tem índice único, que é a garantia que a verificação de leitura
não dava. O resumo do dossiê convidava a continuar o que havia saturado, duas frases
contraditórias no mesmo parágrafo. E faltava `abrirAlvo`: a máquina recebia estado
montado à mão em teste, e o começo de uma investigação — quais hipóteses levantar — nunca
tinha sido escrito.

**"Disponível" passou a ser "tem investigador registrado", e não "tem configuração".** A
primeira versão da tela derivava a visão da chave de LLM no ambiente e dizia "falta
chave" — o que implica que pôr a chave a faria rodar, e não faria, porque ninguém a
chamava.

**A separação entre máquina e julgamento é a decisão desta fase.** O que é
determinístico está em `dominio/prospector` e é testado com dezenas de cenários em
milissegundos: escolher da fronteira, contar orçamento, detectar saturação, não
repetir investigação, montar o dossiê salvável. O que exige julgamento — *o que
investigar quando a fronteira esvazia*, *em quem acreditar quando as fontes
discordam* — é LLM e entra por fora.

Paga duas vezes. Máquina determinística se testa; agente com LLM não. E **o erro caro
do módulo não é escolher a hipótese errada — é não parar**, e não parar é falha de
máquina.

**Ordenação por valor esperado por custo, não por valor.** Duas hipóteses de valor 80:
uma custa uma busca, a outra ler seis páginas. Ordenar por valor escolheria qualquer
uma; por valor por custo escolhe a barata — e é o que faz orçamento pequeno render
investigação inteira em vez de meia.

**A ordem das paradas é a ordem da honestidade:** saturação antes de orçamento. Um
agente que reporta "estourei o teto" quando na verdade saturou faz o dono aumentar o
teto para nada.

**O dossiê parcial é o caminho normal**, não a exceção. `paraGravar` funciona em
qualquer ponto e o repositório grava a cada passo, por alvo normalizado — investigar o
mesmo alvo duas vezes continua o dossiê em vez de criar um segundo.

---

## Fase 11 — Monitor (M15) + pós-venda (M16) + afiliados (M13)

| #    | Entrega                                                             | Estado |
| ---- | ------------------------------------------------------------------- | ------ |
| 11.1 | Monitor com leitura, hipótese, recomendação e severidade            | 🚧     |
| 11.2 | Agrupamento de eventos relacionados antes de avisar                 | ✅     |
| 11.3 | M16: resposta a pergunta de comprador a partir de M4, como rascunho | 🚧     |
| 11.4 | M16: detector de pergunta recorrente                                | ✅     |
| 11.5 | M13: detector de queda real de preço contra mediana de 90 dias      | ✅     |
| 11.6 | M13: link de afiliado, fila de publicação espaçada, rastreio        | ✅     |

**Quatro fechadas; 11.1 e 11.3 em 🚧 pela metade que depende de fora.** Em 11.1 a
detecção, a severidade e o agrupamento estão prontos — falta a **leitura** por LLM, que
é a hipótese em linguagem natural. Em 11.3 o rascunho existe desde a fase 6
(`responder()` monta a resposta a partir da ficha de M4, com as fontes); falta o
**envio**, que depende da API do ML e que a especificação já dizia para deixar manual
no começo.

**O agrupamento é o que separa alerta de inteligência, e é determinístico.** "Mesmo
alvo, mesma semana" é regra, não opinião — e a combinação conhecida ganha leitura
própria: preço caindo **e** estoque subindo na mesma semana não é queima de estoque,
porque queima de estoque não vem com reposição. É fornecedor novo, e aí o piso do nicho
baixou de forma permanente. É exatamente o exemplo com que a especificação define M15, e
ele sai sem LLM.

**A mudança pequena não é evento.** Abaixo de 3% é oscilação de arredondamento e frete
embutido; avisar dela treina a pessoa a ignorar o painel. E queda de concorrente é mais
grave que alta, de propósito: alta é oportunidade e pode esperar, queda come a venda
hoje.

**Em 11.5, a referência é a mediana de 90 dias, nunca o "preço de" anunciado** — que é
escrito pelo vendedor e não é evidência de nada. Quatro vereditos, e `preco_inflado`
existe para nomear o truque de subir para depois baixar.

**Em 11.6 o limite não é técnico: é a paciência de quem lê o grupo.** Grupo silenciado
não dá erro e continua recebendo publicação para ninguém, então o teto diário é a
entrega. E o rastreio devolve conversão **nula** sem clique, porque zero afirmaria que o
grupo não converte quando o que houve foi ninguém clicar.

**As três têm tela desde 15/09** (`/monitor`, `/perguntas`, `/afiliados`), e o que cada
uma responde está em [A casa](#a-casa--vocabulário-navegação-e-aparência), C.7 a C.9.

**Um defeito antigo caiu junto:** `codigosDeModelo` juntava `110 ou 220` no código
`110OU220`, e `responder()` tratava pergunta de voltagem como pergunta sobre um modelo
inexistente. Apareceu ao escrever o detector de pergunta recorrente, que agrupa pelo
mesmo caminho.

---

## A casa — vocabulário, navegação e aparência

Não é fase da especificação: é o que o dono pediu para depois das fases, e o que a
[pendência 3.6](./pendencias.md) guardava desde a fase 3.

| #   | Entrega                                                               | Estado |
| --- | --------------------------------------------------------------------- | ------ |
| C.1 | Rótulo e rota com nome de trabalho (`/importar`, `/juntar-iguais`)    | ✅     |
| C.2 | Jargão fora do texto das telas, com a fronteira da tradução declarada | ✅     |
| C.3 | Barra agrupada pelos momentos de trabalho e marca de tela aberta      | ✅     |
| C.4 | Tela inicial mostrando estado, com degradação honesta                 | ✅     |
| C.5 | Uma definição por peça de estilo (`ui/comum.module.css`)              | ✅     |
| C.6 | Tokens que faltavam e foco visível em tudo que recebe foco            | ✅     |
| C.7 | Tela do monitor: o que mudou, agrupado, e o que vale publicar hoje    | ✅     |
| C.8 | Tela de perguntas: dúvida recorrente e o que acrescentar ao anúncio   | ✅     |
| C.9 | Tela de afiliados: fila espaçada, teto do dia e o que o grupo deu     | ✅     |
| C.10 | Tela do garimpo: dossiê, fronteira, orçamento e por que parou        | ✅     |
| C.11 | Executor do prospector, com a base local como primeira ferramenta    | ✅     |

**Entrega:** o sistema para de falar o nome das próprias tabelas, a navegação diz
onde você está, e a tela inicial responde "o que eu faço agora" em vez de listar
todas as portas com o mesmo peso.

A decisão que vale guardar é a da C.5. As trinta classes de estilo estavam definidas
de seis a onze vezes, uma por tela, e tinham **divergido no que importa**: `.botao`
era preenchido em duas telas e de contorno em três, `.campo` era o invólucro do campo
em seis e a própria entrada em duas. Isso não é dívida de repetição, é a interface
ensinando coisas contraditórias. Agora cada peça tem uma definição e as telas
compõem dela com `composes`, sem tocar no JSX.

**As três telas da fase 11 (C.7 a C.9) acharam trabalho que o teste não acharia.** O
monitor não tinha **quem escrevesse** nele: `monitor_evento` existia desde a fase 0 e a
ingestão detectava mudança de preço sem registrar — as regras de agrupamento e severidade
liam uma tabela que ninguém alimentava. A de perguntas exigiu tabela nova
(`pergunta_recebida`): a conta de repetição precisa de cinco perguntas parecidas, e cinco
chegam ao longo de semanas, não de uma vez. A de afiliados achou três frases de domínio
com `(s)` de plural e uma delas errada ("saiu há 0 minuto(s)", quando zero minuto é
"agora"). É o padrão: **texto e caminho de escrita sem tela não são revisados**, porque o
teste unitário verifica um pedaço da frase e chama a função direto.

**A C.11 é a metade que faltava do garimpo:** a tela mostrava dossiê e ninguém preenchia
dossiê. Agora "Investigar" enfileira, o poller roda o laço, e o dossiê aparece com os
achados e a URL de cada um. O que a ligação achou está no diário de 16/09 — e o achado
grande é que o dossiê não era retomável.

**A C.10 fechou o mesmo padrão pela quarta vez.** A tela do garimpo achou o alvo do
dossiê gravado normalizado na coluna de exibição, um parágrafo do domínio que se
contradizia, e uma função que faltava na máquina (`abrirAlvo`). Quatro telas, quatro
achados que o teste unitário não pegaria — porque o teste chama a função direto e confere
um pedaço da frase, e a tela é o primeiro leitor que lê tudo e mostra tudo.

O que continua aberto e é decisão do dono: se os rótulos novos são os que ele usa
falando. Trocar é uma linha em `src/app/navegacao.ts`.

---

## Fase 12 — Adaptadores de Shopee e Amazon por API

Só quando o volume em cada uma justificar a burocracia de aprovação. Até lá, M0
e M1 cobrem, e isso é suficiente para o painel ser útil.

---

## Fora de escopo, permanentemente

Da seção 10 da especificação, e não se reabre sem decisão explícita:

- **M4 como modo de acesso** (extensão de navegador sob login). Ganho marginal
  sobre exportação de planilha; risco é suspensão da conta, que é o ativo.
- **Multi-tenant.** Isolamento de dados, convite, papéis, cobrança, onboarding.
  Multi-perfil sim (uma coluna e um filtro); multi-tenant não (semanas, e não
  vende nada hoje).
- **API pública.**
- **App mobile nativo** (o PWA da fase 4 resolve).
- **Tema claro/escuro customizável.**
- **Emissor de NF-e próprio.** Integrar.
- **ERP, loja virtual, gerador de conteúdo.**
