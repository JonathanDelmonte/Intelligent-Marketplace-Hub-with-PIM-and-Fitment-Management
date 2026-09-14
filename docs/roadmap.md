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
| 2.6b | Fluxo de OAuth que grava `credencial` cifrada                         | ⬜     |
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
| 3.2  | Extrator de HTML de anúncio — seletores por plataforma + fallback LLM | ⬜     |
| 3.3  | Extrator de listagem/categoria com paginação                          | ⬜     |
| 3.4  | Extrator de catálogo de distribuidor (LLM obrigatório)                | ⬜     |
| 3.5  | Extrator de PDF de tabela de preços                                   | ⬜     |
| 3.6  | Extrator de imagem de tabela (print de WhatsApp) — visão              | ⬜     |
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
o diário). A tela fica em `/jobs` e funciona sem poller nenhum: tem um botão que
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
a tela de jobs vinha primeiro porque sem ela nada do que a ingestão faz é
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
| 5.9 | Tela de revisão em `/identidade`, de dois cliques                        | ✅     |
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
Sem chave, ele aparece em `/identidade` dizendo "sem chave de LLM, então ninguém
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

**Como usar.** A tela fica em `/identidade`. O botão resolve algumas ocorrências na
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
| 6.10 | Manual do fabricante em PDF e página oficial como fontes de coleta          | ⬜     |
| 6.11 | Fórum e catálogo de distribuidor como fontes de coleta                      | ⬜     |

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
| 7.3 | Verificação automática desse campo por nome e CNPJ (M0)           | ⬜     |
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
| 8.3  | Checklist de atributos obrigatórios por categoria                       | ⬜     |
| 8.4  | Gerador de arquivo de importação em massa (caminho padrão)              | ✅     |
| 8.5  | Alerta de catálogo do ML para conta sem reputação verde                 | ⬜     |
| 8.6  | Importação de pedidos, casamento com SKU, margem realizada              | 🚧     |
| 8.7  | Fila de postagem do dia — a tela mais usada do sistema                  | 🚧     |
| 8.8  | Etiqueta e envio ao fornecedor no dropship, com cobrança de confirmação | 🔒     |
| 8.9  | Conferência de repasse: previsto contra o que caiu                      | 🚧     |
| 8.10 | M11: consignação, alerta de conferência, fechamento por período         | ⬜     |
| 8.11 | Tela de anúncio: montar, revisar avisos e baixar o arquivo              | ⬜     |

**8.4 já existia e não estava marcado.** O arquivo de importação é gerado pelo
adaptador de cada plataforma desde a fase 2 — `exportarParaImportacao` é a única
capacidade sempre suportada, com teste de que nunca lança `NaoSuportado`. O que
faltava era quem produz o objeto a ser exportado, e é o 8.1/8.2.

**O que está pronto em 8.6, 8.7 e 8.9, e o que falta.** As **regras** estão
escritas e testadas: margem realizada com conferência de repasse (8.6 e 8.9) e a
ordenação da fila do dia (8.7). O que falta nas três é o mesmo: **importar pedido**
— por planilha, que é o caminho sem credencial — e as telas. Sem pedido no banco,
as três regras não têm o que morder.

Foi de propósito começar pelas regras: margem realizada é a razão de o catálogo
existir, e ela é função pura sobre números que a planilha traz. A importação é
encanamento, e encanamento sem a regra pronta tende a gravar o campo errado.

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
| 9.1 | Classificador de NCM/CEST com alternativas justificadas e confirmação | ⬜     |
| 9.2 | CST e cClassTrib por SKU (rejeição de NF-e em 04/01/2027)             | ⬜     |
| 9.3 | Controle de teto do MEI com projeção; avisos em 70% e 85%             | ⬜     |
| 9.4 | Painel de prazos (01/01/2027, 04/01/2027)                             | ⬜     |
| 9.5 | Integração com emissor de NF-e existente — não reescrever             | ⬜     |
| 9.6 | Alerta de categoria regulada (ANVISA em suplemento)                   | ⬜     |

**Por que tem prazo:** esse cadastro com 20 SKUs é uma tarde; com 200 no meio da
operação é uma semana perdida em janeiro.

---

## Fase 10 — Prospector de mercado (M6) 🧠

> Especificação: “Uma a duas semanas. O módulo mais ambicioso e o mais divertido
> — e por isso mesmo vem depois.”

| #    | Entrega                                                                    | Estado |
| ---- | -------------------------------------------------------------------------- | ------ |
| 10.1 | Loop de fronteira: hipóteses, fronteira, achados                           | ⬜     |
| 10.2 | Seleção por valor esperado por custo                                       | ⬜     |
| 10.3 | Famílias de hipótese (fabricante, distribuidor, custo, compatibilidade, …) | ⬜     |
| 10.4 | Sensor de demanda pública via PNCP                                         | ⬜     |
| 10.5 | **Orçamento obrigatório por execução** (passos e reais)                    | ⬜     |
| 10.6 | Critério de parada por saturação                                           | ⬜     |
| 10.7 | Dossiê auditável, com URL de origem em cada item                           | ⬜     |
| 10.8 | Dossiê parcial salvo quando o orçamento estoura                            | ⬜     |

---

## Fase 11 — Monitor (M15) + pós-venda (M16) + afiliados (M13)

| #    | Entrega                                                             | Estado |
| ---- | ------------------------------------------------------------------- | ------ |
| 11.1 | Monitor com leitura, hipótese, recomendação e severidade            | ⬜     |
| 11.2 | Agrupamento de eventos relacionados antes de avisar                 | ⬜     |
| 11.3 | M16: resposta a pergunta de comprador a partir de M4, como rascunho | ⬜     |
| 11.4 | M16: detector de pergunta recorrente                                | ⬜     |
| 11.5 | M13: detector de queda real de preço contra mediana de 90 dias      | ⬜     |
| 11.6 | M13: link de afiliado, fila de publicação espaçada, rastreio        | ⬜     |

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
