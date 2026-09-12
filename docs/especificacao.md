# Bancada — Especificação do Sistema

Versão 2 — 12/09/2026
Hub de operação e inteligência para venda em marketplaces (Mercado Livre, Shopee, Amazon): catálogo, fornecedores, compatibilidade, precificação e garimpo de oportunidade.

**Sobre o nome:** "Bancada" é codinome de projeto, não marca — é a superfície de trabalho onde as ferramentas ficam à mão, e serve só para o sistema ter como ser chamado no código, no repositório e nas conversas. Trocar depois é um find-and-replace, desde que a regra da seção 1.2 seja respeitada. "Essencial Emporium" **não** é o nome do sistema: é o perfil de vendedor que opera dentro dele, e entra como dado.

---

## 0. Correção necessária antes de qualquer linha de código

Nas duas conversas anteriores eu afirmei que a API de busca do Mercado Livre era aberta e gratuita, e coloquei o endpoint `GET /sites/MLB/search` como base do scanner. **Isso está errado hoje.**

Fato confirmado: existe um volume grande de reclamações formais de desenvolvedores, de dezembro de 2025 em diante, relatando **403 Forbidden** nesse endpoint mesmo com token válido, escopo correto e `site_id` correto. O Mercado Livre não publicou o critério de liberação, e os casos seguem sem resolução.

Inferência minha (marcada como inferência, não como fato): o endpoint foi movido para uma lista de acesso restrito, liberada caso a caso para aplicações aprovadas. Não consegui validar isso em fonte oficial — a documentação do ML bloqueia acesso automatizado, e o próprio endpoint é proibido por `robots.txt`, então não testei por outros meios.

**Consequência para o projeto, e é uma consequência boa:** a sua intuição de querer um sistema que funcione *sem* conexão direta com as plataformas deixa de ser preferência e passa a ser o requisito central de arquitetura. Um sistema que depende de uma API que pode fechar sem aviso é um sistema que morre sozinho. O desenho abaixo parte do princípio de que **toda fonte de dados é opcional e substituível**.

Primeira tarefa prática do projeto: criar o app em `developers.mercadolivre.com.br`, gerar token e testar, um por um, quais endpoints respondem. O resultado desse teste é um arquivo de configuração, não uma surpresa em produção.

**Pista sobre como destravar:** a Nubimetrics — ferramenta de inteligência de mercado especializada em Mercado Livre — aparece na Central de Parceiros oficial do ML, e obviamente tem acesso a dados de busca. O ML mantém um **Developer Partner Program**, com níveis de aplicação (há integradores se anunciando como "aplicação Platinum"). Hipótese forte, não confirmada: o acesso a `/sites/MLB/search` passou a depender de aprovação nesse programa. Vale a pena investigar o processo de inscrição cedo, porque é um caminho de meses e não de dias — mas **o sistema não pode depender disso**, e o desenho abaixo garante que não dependa.

---

## 1. O que o sistema é

Um painel único de operação e garimpo para vender em múltiplos marketplaces, com duas metades:

- **Metade operacional** — o que eu tenho, por quanto vendo, quanto sobra, o que saiu, o que falta. Dados da minha própria conta.
- **Metade de inteligência** — o que eu deveria vender, de quem eu compro, em que serve, e a que preço. Dados do mundo.

A segunda metade é a que tem valor defensável. A primeira é higiene.

**O que o sistema não é:** não é ERP, não é loja virtual, não é gerador de conteúdo. Qualquer função que já existe bem feita e barata em ferramenta de prateleira (emissão de NF-e, por exemplo) é integrada, não reescrita.

### 1.1 Como essa categoria de software se chama

O sistema não é de uma categoria só — é a união de quatro, e saber o nome de cada uma serve para estudar o que já existe e não reinventar o que está resolvido:

| Parte do sistema | Nome da categoria | Quem já faz no Brasil |
|---|---|---|
| Anúncio, pedido, estoque nas três plataformas | **Hub de integração de marketplace** (ou integrador, ou *multichannel listing & order management*) | Anymarket, Magis5, Plugg.to, Bling, Tiny, Ideris |
| Garimpo de produto e medição de concorrência | **Inteligência de mercado / product research** | Nubimetrics (especializada em ML e LatAm), Real Trends; no exterior Jungle Scout e Helium 10 |
| Catálogo, atributos, compatibilidade | **PIM** (Product Information Management). A parte de compatibilidade tem nome próprio: ***fitment management*** — em autopeças nos EUA existem até padrões formais (ACES e PIES) | praticamente ninguém faz bem no Brasil |
| Ajuste de preço por regra e margem | **Repricer / pricing intelligence** | alguns hubs têm como módulo |

Duas conclusões úteis disso:

1. **O hub e o repricer são commodity.** Existe meia dúzia de empresas maduras fazendo isso por R$ 100 a R$ 300 por mês. Se um dia o custo de manter essa parte pesar mais que a mensalidade, assinar é a decisão certa — e por isso os módulos operacionais (M9, M10) são os mais descartáveis do sistema.
2. **O *fitment* é o buraco.** A parte de compatibilidade, que é justamente a que te tira da guerra de preço, é a que ninguém no mercado brasileiro faz direito. É lá que está a razão de construir em vez de assinar, e é lá que o sistema pode virar produto vendável para outros vendedores de peça de reposição.

### 1.2 Marca, perfil e o que nunca entra no código

Três coisas diferentes que costumam ser confundidas:

- **Quem constrói:** Zirtuno, a empresa de tecnologia.
- **O sistema:** "Bancada" por enquanto, sem marca definida.
- **Quem opera dentro dele:** o perfil do vendedor — "Essencial Emporium" hoje, e possivelmente a Bolthz amanhã, que é um negócio diferente com outros fornecedores e outro catálogo.

**Onde o nome da Zirtuno aparece.** Depende do papel que ela tem, e são três casos distintos:

1. **Sistema interno** (o caso de hoje). A Zirtuno é dona, não fornecedora — não há cliente para quem assinar. O nome vai no rodapé como `© 2026 Zirtuno`, no `<meta name="author">`, no `package.json` e no README. Nada além disso, porque não há leitor externo.
2. **Sistema entregue a um cliente.** Aí a marca dominante na interface é a do cliente, e "desenvolvido por Zirtuno" no rodapé é o padrão — e funciona principalmente como captação, porque quem vê a ferramenta pergunta quem fez.
3. **Sistema vendido como produto.** Aí a Zirtuno é fabricante e o sistema tem marca própria, na relação Adobe/Photoshop. O nome do produto domina a interface; o da empresa aparece no rodapé, na página "sobre", nos termos de uso, no contrato e na nota fiscal.

**Este sistema pode virar o caso 3** — se o grafo de compatibilidade funcionar, ele é vendável para qualquer vendedor de peça de reposição. Por isso a regra de arquitetura, que custa uma hora agora e economiza uma refatoração depois:

> **Nada de marca entra no código.** Nome do sistema, logo, cores, nome do vendedor, CNPJ, regime fiscal e credenciais de plataforma vêm todos de configuração e de banco. Nenhuma string de marca literal em componente, nenhuma query sem filtro de perfil. O dia em que houver um segundo perfil — ou um segundo cliente — deve ser um `INSERT`, não um branch.

---

## 2. Princípio de arquitetura: capacidades, não plataformas

O erro clássico é modelar `MercadoLivreService`, `ShopeeService`, `AmazonService` e deixar a UI perguntar "qual plataforma?". Quando uma plataforma não tem API, o código inteiro trava.

O desenho correto: **a UI pergunta por capacidade, não por plataforma.** Cada plataforma declara quais capacidades suporta e por qual modo de acesso. O que não existe fica desabilitado com um rótulo honesto, e nada quebra.

### 2.1 Os cinco modos de acesso

| Modo | Nome | Credencial | Risco | O que entrega |
|---|---|---|---|---|
| **M0** | Colar link | nenhuma | nenhum | Extração de 1 página: anúncio, categoria, página de distribuidor, PDF de tabela de preços |
| **M1** | Importar arquivo | nenhuma | nenhum | Planilha de anúncios, pedidos e repasses exportada do painel da plataforma |
| **M2** | Leitura pública | nenhuma | nenhum | Endpoints que respondem sem token (a confirmar um por um) |
| **M3** | API oficial OAuth | token da conta | nenhum | Leitura e escrita completas, onde houver aprovação |
| **M4** | Extensão de navegador | sessão do usuário | **alto** | Leitura de página logada. Ver alerta abaixo |

**Alerta sobre M4:** automatizar a navegação sob a sua própria sessão autenticada é área cinzenta nos termos de uso das três plataformas, e a punição possível é suspensão de conta — a conta que é justamente o seu ativo. **Não construa M4 para contornar falta de API.** Praticamente tudo que você precisaria dele está disponível em M1 (exportação de planilha), que é oficial e sem risco. Deixe M4 fora do escopo, e se algum dia entrar, que seja só para leitura de páginas públicas, nunca sob login.

### 2.2 Matriz de capacidades

Preencher na primeira semana, com teste real. Os valores abaixo são a expectativa, não o resultado:

| Capacidade | Mercado Livre | Shopee | Amazon |
|---|---|---|---|
| Ler meus anúncios | M3 / M1 | M1 | M1 |
| Ler meus pedidos | M3 / M1 | M1 | M1 |
| Ler taxas reais por preço | M3 (`listing_prices`) | M0 + tabela manual | tabela manual |
| Publicar / editar anúncio | M3 | — (manual) | — (manual) |
| Gerar etiqueta de envio | M3 | — (manual) | — (manual) |
| Buscar anúncios de terceiros | **bloqueado** | M0 | M0 |
| Ler item de terceiro por ID/URL | M0 / M3 (`/items/{id}`) | M0 | M0 |
| Responder pergunta de comprador | M3 | — | — |

Shopee exige aprovação de partner na Open Platform; Amazon SP-API exige plano profissional e registro de developer. Até lá, as duas entram só por M0 e M1 — e isso é suficiente para o painel ser útil.

### 2.3 Regra de degradação

Três regras, sem exceção:

1. **Nenhuma tela depende de uma plataforma estar conectada.** Plataforma não conectada aparece como coluna vazia com a etiqueta "sem conexão — importe a planilha".
2. **Todo dado tem origem registrada.** Cada registro carrega `fonte` (`m0_link`, `m1_planilha`, `m2_publico`, `m3_api`, `manual`) e `coletado_em`. Dado de origem fraca nunca sobrescreve dado de origem forte automaticamente.
3. **Escrita é sempre opcional.** O caminho padrão de publicação é gerar o **arquivo de importação** da plataforma (que as três aceitam) e o usuário subir. A publicação por API é um atalho, não o caminho.

A regra 3 é a que dá liberdade de verdade: o sistema funciona 100% com zero credencial, só gerando e lendo arquivos.

### 2.4 Contrato do adaptador

```
interface Adapter {
  plataforma: 'ml' | 'shopee' | 'amazon'
  capacidades(): Set<Capacidade>          // descoberto em runtime, cacheado
  lerAnuncios(): Promise<Anuncio[]>       // lança NaoSuportado
  lerPedidos(desde: Date): Promise<Pedido[]>
  taxasPara(preco, categoria, peso): Promise<Taxas>
  publicar(anuncio): Promise<Resultado>
  gerarEtiqueta(pedidoId): Promise<PDF>
  exportarParaImportacao(anuncios): Promise<Arquivo>   // sempre suportado
}
```

`capacidades()` é testado na inicialização e cacheado por 24h. Toda chamada que pode não existir lança `NaoSuportado`, e a UI trata isso como estado normal, não como erro.

---

## 3. Modelo de dados

```
perfil_vendedor                          -- quem opera. "Essencial Emporium" é UMA linha aqui
  id, nome, cnpj_ou_cpf, regime (cpf|mei|simples), inscricao_estadual,
  teto_anual, emissor_nf_config (jsonb), marca_visual (jsonb), ativo

credencial                               -- por perfil e por plataforma, nunca em .env
  id, perfil_id, plataforma, tipo (oauth|planilha|nenhuma),
  token_cifrado, refresh_token_cifrado, expira_em, escopos, ativo

sku
  id, perfil_id, ean, titulo_interno, marca, categoria_ml, categoria_shopee,
  peso_g, dim_mm, ncm, cest, cst, cclasstrib,
  custo_atual, custo_atualizado_em, tipo (proprio | revenda | consignado),
  fornecedor_principal_id, ativo

produto_externo                         -- cada ocorrência do produto no mundo
  id, sku_id (nullable até resolver), fonte, url, plataforma_ou_site,
  titulo_bruto, preco, moeda, vendedor, vendas_estimadas,
  atributos_extraidos (jsonb), capturado_em, hash_conteudo

fornecedor
  id, nome, cnpj, site, contato, canal (whatsapp|email|telefone),
  posta_com_etiqueta (bool|null), emite_nf (bool|null),
  prazo_postagem_dias, pedido_minimo_reais, pedido_minimo_un,
  vende_direto_marketplace (bool|null),     -- campo mais importante da tabela
  origem (nacional|importado|china), confiabilidade (0-5), notas

fornecedor_sku
  fornecedor_id, sku_id, codigo_no_fornecedor, preco, preco_atualizado_em,
  estoque_informado, url_origem

aparelho                                 -- o "em que serve"
  id, tipo, marca, modelo, ano_de, ano_ate, variante, atributos (jsonb)

compatibilidade
  sku_id, aparelho_id, confianca (0-1), evidencias (jsonb[]),
  verificado_por (ia|humano|fabricante), verificado_em

anuncio
  id, sku_id, plataforma, id_externo, url, tipo (classico|premium|catalogo),
  preco, frete_modo, ativo, publicado_em, fonte

pedido
  id, anuncio_id, plataforma, id_externo, data, qtd,
  preco_bruto, taxa_comissao, taxa_fixa, frete_pago, repasse_liquido,
  custo_na_venda, margem_realizada, status_envio, rastreio

oportunidade
  id, termo_ou_nicho, demanda_mes, share_top3, dispersao_preco,
  pct_catalogo, ticket_medio, markup_estimado, veredito,
  fontes_usadas (jsonb), rodado_em

consignacao
  id, parceiro_nome, parceiro_contato, sku_id, qtd_disponivel,
  preco_acordado_repasse, conferido_em

afiliado_oferta
  id, plataforma, url_afiliado, sku_externo, preco, preco_anterior,
  comissao_pct, score_desconto, publicado_em_grupo, cliques, conversoes

monitor_evento
  id, entidade_tipo, entidade_id, tipo_mudanca, valor_antes, valor_depois,
  leitura_ia (text), severidade, detectado_em, lido
```

Quatro detalhes que importam:

- **`perfil_vendedor` existe desde o primeiro dia, mesmo com uma linha só.** Tudo que é operacional (`sku`, `anuncio`, `pedido`, `consignacao`, `credencial`, fiscal) carrega `perfil_id`. O que é conhecimento sobre o mundo (`produto_externo`, `fornecedor`, `aparelho`, `compatibilidade`, `oportunidade`) **não** carrega — é base compartilhada entre perfis, e é o que faz o sistema ficar mais valioso a cada perfil que entra. Essa separação é a decisão de modelagem mais importante do documento: ela é o que permite operar Essencial Emporium e Bolthz no mesmo painel, e é o que permite vender o sistema depois.
- **Credenciais em tabela cifrada, não em variável de ambiente.** Parece detalhe e não é: credencial em `.env` amarra uma conta ao deploy, e no dia do segundo perfil você não tem onde colocar a segunda.
- **`produto_externo` é separado de `sku`.** Você captura dezenas de ocorrências do mesmo produto em lugares diferentes antes de saber que são o mesmo produto. A ligação é feita pelo módulo de resolução de identidade (M3) e é revisável. Fundir na captura é o erro que destrói a base.
- **`compatibilidade.evidencias`** guarda *de onde* veio cada afirmação (URL, trecho, data). Sem isso você não consegue auditar um erro de compatibilidade, e erro de compatibilidade gera devolução e reclamação.

---

## 4. Módulos

Cada módulo traz: objetivo, entrada, saída, e estado (construível hoje / bloqueado / depende de).

### M1 — Ingestão universal

**Objetivo:** um único campo de entrada que aceita qualquer coisa e faz a coisa certa.

**Entrada:** uma URL colada, um arquivo solto (xlsx, csv, pdf, imagem), ou texto colado.

**Como funciona:**
1. Classificador de entrada decide o tipo: anúncio de marketplace, página de categoria, catálogo de distribuidor, tabela de preços em PDF, planilha de exportação, print de tabela no WhatsApp, lista de links.
2. Roteia para o extrator adequado.
3. Extrator devolve JSON estruturado validado por schema. Se o schema falhar, o registro entra como `pendente_revisao` em vez de ser descartado.
4. Tudo que entra vira `produto_externo`, nunca `sku` direto.

**Extratores necessários:**
- HTML de anúncio (ML, Shopee, Amazon, loja própria) — seletores por plataforma + fallback de LLM
- HTML de listagem/categoria — paginação
- Catálogo de distribuidor — estrutura imprevisível, LLM obrigatório
- PDF de tabela de preços — extração de tabela + LLM para cabeçalho bagunçado
- Imagem de tabela (print de WhatsApp de fornecedor) — visão. Isso é comum de verdade: fornecedor manda foto da planilha
- Planilha de exportação das plataformas — mapeamento fixo por plataforma

**Estado:** construível hoje, 100% sem credencial. **É o módulo que destrava todos os outros, e deve ser o primeiro depois da calculadora de margem.**

---

### M2 — Catálogo e SKU

**Objetivo:** a verdade única sobre o que você vende.

Um `sku` é criado por decisão sua, a partir de um ou mais `produto_externo`. Guarda custo, peso, dimensão, classificação fiscal e tipo (próprio, revenda, consignado). Todo anúncio aponta para um SKU; todo pedido resolve para um SKU. Margem realizada só existe porque isso existe.

**Estado:** construível hoje.

---

### M3 — Resolução de identidade de produto  🧠

**Objetivo:** descobrir que "Refil Filtro Purificador Electrolux PA21G PA26G PE11B Original", "Elemento Filtrante Acquaclean p/ purificador Electrolux", e uma listagem de distribuidor chamada "EF-ELX-21" são **o mesmo produto**.

**Por que é IA e não automação:** não há identificador comum. Não há EAN em metade dos casos. Títulos são poluídos com palavra-chave de SEO. Nomes de distribuidor são códigos internos. Regex e comparação de string falham. Isso exige extração de atributos estruturados a partir de texto livre e comparação semântica.

**Como funciona:**
1. Para cada `produto_externo`, um LLM extrai um registro estruturado: `{tipo_produto, marca, modelo_peça, modelos_compatíveis[], dimensões, material, unidade, quantidade_embalagem}`. Atributo que não aparece vira `null` — nunca invenção.
2. Gera embedding de uma forma canônica (`tipo + marca + modelo normalizado`), não do título bruto.
3. Busca vizinhos por similaridade vetorial, depois um LLM julga os candidatos com pergunta binária e justificativa: "estes dois são o mesmo produto físico? sim/não + por quê".
4. Acima de um limiar, agrupa automaticamente. Na zona cinzenta, vai para uma fila de revisão sua, de dois cliques.
5. Cada decisão humana vira exemplo para os prompts seguintes.

**Saída:** grafo de equivalência. Um `sku` com N `produto_externo` de plataformas e fornecedores diferentes, o que te dá imediatamente: qual fornecedor é mais barato, a que preço o mercado vende, e qual é a sua margem real.

**Este grafo é o ativo defensável do negócio.** Não se compra com dinheiro; acumula com uso.

**Estado:** construível hoje. Depende de M1.

---

### M4 — Compatibilidade  🧠 ← o fosso

**Objetivo:** saber, para cada peça, todos os aparelhos em que ela serve — e provar.

**Por que vale mais que tudo:** na categoria de reposição, a busca do comprador não é por preço, é por "serve no meu modelo?". Quem tem o cadastro de compatibilidade correto e completo ganha a venda sem disputar centavo. No Mercado Livre a ficha de compatibilidade é obrigatória em autopeças, e o vendedor é quem preenche marca, modelo, ano e motor. Preencher isso bem, para centenas de combinações, é trabalho que os grandes acham pouco escalável — e é trabalho de dados, que é o seu.

**Como funciona — é um problema de parsing e satisfação de restrições, não de chute:**
1. **Coleta de evidência:** manual do fabricante (PDF), página oficial, descrição de concorrentes que vendem a mesma peça, fórum e grupo de assistência técnica, catálogo de distribuidor.
2. **Parsing de nomenclatura de modelo:** `PA21G`, `PA26G`, `PE11B`, `PA31G` seguem gramática de fabricante. Escrever gramáticas por marca (`PA` = purificador água, `21/26/31` = linha, sufixo = variação de cor/voltagem) permite **inferir famílias** em vez de cadastrar item por item. Aqui a abordagem é parser + regras, não LLM — é determinístico e auditável.
3. **Resolução de conflito por restrição:** fontes discordam. Modelar como restrições (`peça P serve em A`, `P não serve em B`, `A e B são da mesma família`) e resolver, sinalizando inconsistências para revisão em vez de escolher silenciosamente.
4. **Confiança graduada:** afirmação do fabricante = 1.0; três concorrentes concordando = 0.8; um fórum = 0.4. O anúncio só publica compatibilidade acima de 0.7, e o resto vai pra fila.
5. **Saída dupla:** tabela para a ficha do ML, e base para responder pergunta de comprador (M16) e montar kits de curadoria.

**Estado:** construível hoje, não depende de nenhuma API de marketplace. **É a funcionalidade de maior retorno do sistema inteiro.**

---

### M5 — Fornecedores

**Objetivo:** CRM pequeno e brutalmente focado nas cinco perguntas que eliminam 90% dos candidatos.

Campos que decidem: `posta_com_etiqueta`, `emite_nf`, `prazo_postagem_dias`, `pedido_minimo`, `vende_direto_marketplace`.

`vende_direto_marketplace = true` é **descarte automático**, com aviso na tela: fornecedor que vende na mesma vitrine tem preço de fábrica e você tem o preço dele. Foi exatamente contra isso que a primeira tentativa no Mercado Livre falhou, e o sistema tem que lembrar disso por você.

**Verificação automática desse campo:** dado o nome e o CNPJ do fornecedor, procurar se existe loja com esse nome/CNPJ no ML, Shopee e Amazon. Isso é M0 + busca, e é barato.

**Funções:** histórico de preço por SKU e fornecedor (detecta aumento silencioso), score de confiabilidade alimentado por atraso real dos pedidos, e um gerador do primeiro contato com as cinco perguntas já preenchidas com o produto específico.

**Estado:** construível hoje.

---

### M6 — Prospector de mercado  🧠 ← a funcionalidade que você pediu

Você pediu algo que "realmente atue como inteligência artificial e não como automatização", varrendo a internet inteira em todo tipo de link. Vou dividir em duas partes: o que é viável e o que não é.

**O que não é viável, e por quê:** varrer a internet inteira é caro e inútil. Um crawler largo gasta milhares de requisições e tokens para devolver ruído, e 99,9% da web não tem relação com o que você vende. Crawler largo não é mais inteligente que busca dirigida — é menos, porque não tem objetivo.

**O que é viável e é genuinamente mais inteligente: fronteira de busca dirigida por hipótese.** A diferença é que o agente não varre — ele *investiga*, com alvo, orçamento e critério de parada.

**Como funciona:**

Entrada: um alvo. Pode ser um produto (`refil purificador Electrolux`), um aparelho (`purificador Electrolux PA26G`), uma marca, um nicho (`reposição de eletrodoméstico de cozinha`), ou um link que você colou e achou interessante.

O agente mantém três listas vivas: **hipóteses** (o que pode ser verdade), **fronteira** (o que vale investigar a seguir) e **achados** (o que foi confirmado, com evidência). A cada passo ele escolhe da fronteira o item de maior valor esperado por custo, investiga, atualiza as três listas, e decide se continua.

Famílias de hipótese que ele persegue, cada uma com ferramentas próprias:

- **Quem fabrica isso?** → ler a marca nas imagens do anúncio (visão), buscar a marca, achar site do fabricante, achar distribuidor nacional, achar CNPJ.
- **Quem distribui isso no Brasil?** → buscar `"<marca>" distribuidor`, `"<marca>" revenda`, `"<marca>" representante`, consultar CNPJ por razão social parecida, procurar em catálogos B2B.
- **Onde isso é mais barato?** → distribuidores nacionais, 1688, Alibaba, AliExpress, feiras, mercados de atacado. Com cálculo de custo desembarcado, não só preço de etiqueta.
- **Em que mais isso serve?** → alimenta M4.
- **Que outras peças o mesmo aparelho consome?** → expande o catálogo de forma coerente. Quem compra refil hoje compra vedação em seis meses.
- **Quem já vende isso e quão forte é?** → mede concorrência sem depender da API de busca bloqueada, usando páginas públicas e comparadores.
- **Existe demanda pública?** → consultar o PNCP. Órgão público compra refil, toner e peça de ar-condicionado em volume, os preços são dados abertos, e quase nenhum vendedor de marketplace olha para lá. Você já conhece esse terreno de outro projeto — aqui ele vira sensor de demanda e de preço de referência.

Critério de parada: orçamento de passos, orçamento em reais, ou saturação (três investigações seguidas sem achado novo). **Orçamento obrigatório por execução** — agente sem teto de gasto é a forma mais rápida de transformar curiosidade em fatura.

Saída: um dossiê por alvo — fornecedores candidatos com contato e preço, faixa de preço de mercado, compatibilidades encontradas, concorrentes e força de cada um, produtos adjacentes, e uma recomendação com a evidência anexada. Revisável, auditável, e cada item tem a URL de onde veio.

**Por que isso é IA de verdade:** as decisões de *o que investigar a seguir*, *em quem acreditar quando as fontes discordam*, e *quando parar* não são expressáveis como regra fixa. É julgamento sobre informação incompleta e heterogênea. Um scanner que percorre uma lista de termos e calcula médias é automação; isto não é.

**Estado:** construível hoje, sem nenhuma API de marketplace. Depende de M1 e M3.

---

### M7 — Scanner determinístico

O scanner que eu já havia proposto continua existindo, mas desce de posto: ele é o **filtro numérico** que roda sobre o que o M6 trouxe, não o descobridor.

Cortes (todos configuráveis):

| Critério | Corte | Por quê |
|---|---|---|
| Markup sobre custo | ≥ 3x | Abaixo disso, comissão + frete + uma devolução em dez zeram a margem |
| Share dos 3 maiores | < 40–50% | Acima, alguém tem contrato de fábrica e capital de giro |
| Volume do nicho | ~30 un/mês | Pouco pra interessar os grandes, suficiente pra você |
| Ticket médio | > R$ 80 | Abaixo, a taxa fixa come a margem |
| Substituibilidade | baixa | Se há genérico óbvio mais barato, volta a ser briga de preço |
| Recorrência | alta | Consumível traz o cliente de volta com custo zero de aquisição |
| % em catálogo (ML) | baixo | Catálogo exige reputação verde pra ganhar destaque — fechado pra conta nova |

Corte aplicado em **subcategoria**, nunca em categoria. "Eletrodomésticos" não diz nada; "correia de secadora Brastemp" diz tudo.

**Estado:** construível hoje. O dado de volume depende das fontes que sobrarem (M0/M2), não do endpoint bloqueado.

---

### M8 — Precificação e margem

**Objetivo:** nunca publicar anúncio com margem negativa, e saber a margem *realizada*, não a prevista.

Função pura: `margem(preco, plataforma, categoria, peso, custo, embalagem, regime_fiscal) → {liquido, margem_reais, margem_pct, avisos}`.

Regras embutidas:
- **ML:** comissão por tipo de anúncio (clássico 10–14%, premium 15–19%) via `listing_prices` quando disponível, tabela manual quando não; custo fixo por unidade abaixo de R$ 79 (~R$ 6–6,75); frete grátis obrigatório a partir de R$ 79, pago por você.
- **Shopee:** ~20% + R$ 4 até R$ 79,99; 14% + fixo de R$ 16 a R$ 28 acima; +R$ 3/item se CPF; +2,5% em campanha.
- **Amazon:** 10–15% por categoria; R$ 2/item no plano individual.
- **Fiscal:** DAS do MEI rateado por unidade prevista no mês, ou alíquota do regime.
- **Devolução:** taxa de devolução estimada por categoria, como custo, não como surpresa.

**Avisos automáticos na tela de preço:**
- **Zona morta do ML:** preço entre R$ 79 e ~R$ 120 → alerta vermelho. Abaixo de R$ 79 você paga taxa fixa mas o comprador paga frete; a partir de R$ 79 a fixa some mas o frete grátis (R$ 18–28 num item leve) sai do seu bolso. Trocar R$ 6,50 por R$ 22 é mau negócio. As faixas boas são R$ 55–78 ou acima de R$ 140.
- **Simulador de faixa:** dado o custo, mostrar a curva de margem por preço e marcar os degraus das três plataformas. Você vê visualmente onde colocar o preço.

**Estado:** construível hoje. Primeiro módulo a construir, antes de tudo.

---

### M9 — Anúncios

**Objetivo:** produzir anúncio bom em escala sem depender de publicação por API.

- **Gerador de título:** a partir dos atributos do SKU e dos modelos compatíveis, montando com os termos que as pessoas realmente buscam, dentro do limite de caracteres, sem adjetivo inútil. Em peça de reposição, o título precisa conter os códigos de modelo — é por eles que o comprador busca.
- **Descrição com tabela de compatibilidade** gerada de M4.
- **Checklist de atributos obrigatórios** por categoria (anúncio incompleto ranqueia pior).
- **Duas saídas:** publicação por API quando houver, e **geração do arquivo de importação em massa** da plataforma, que é o caminho padrão e funciona nas três sem credencial.
- **Alerta de catálogo:** se o produto existe em catálogo no ML, avisar que conta sem reputação verde não ganha a posição destacada e fica em "outras opções de compra".

**Estado:** geração construível hoje; publicação automática depende de M3 por plataforma.

---

### M10 — Pedidos, envio e etiqueta

- Importar pedidos por API ou planilha; casar com SKU; calcular margem realizada.
- **Fila de postagem do dia** — a tela mais usada do sistema. O que postar hoje, ordenado por prazo restante.
- **Etiqueta:** gerar pelo ML quando houver API. No fluxo de dropship, enviar a etiqueta ao fornecedor automaticamente (e-mail ou WhatsApp) com o pedido, e cobrar confirmação de postagem. Sem confirmação em X horas, alerta.
- **Conferência de repasse:** comparar o que a plataforma disse que ia pagar com o que caiu. É onde aparecem taxas que você não previu.

**Estado:** importação hoje; etiqueta depende de API do ML.

---

### M11 — Consignação

Controle de estoque que não é seu: parceiro, quantidade disponível, preço de repasse acordado, data da última conferência.

- Alerta de conferência semanal (o risco é a loja vender no balcão o que você tem anunciado).
- Ao vender, gerar o aviso ao parceiro com o item e o prazo.
- Fechamento de repasse por período, por parceiro.
- **Avaliador de catálogo de parceiro:** o parceiro manda a lista (ou você escaneia na loja com M14) e o sistema devolve o que vale anunciar, com preço sugerido e margem.

**Estado:** construível hoje, sem nenhuma dependência externa.

---

### M12 — Fiscal  🧠

**Objetivo:** não ser pego pela virada de janeiro, e não perder tarde nenhuma preenchendo código fiscal.

- **Classificador de NCM/CEST** por SKU: sugere com base na descrição e nos atributos, mostra as alternativas com justificativa, e exige confirmação sua. Não é para confiar cegamente — é para transformar uma hora de pesquisa em trinta segundos de revisão.
- **CST e cClassTrib** por SKU, que passam a ser obrigatórios: NF-e de MEI e Simples sem os grupos de IBS/CBS começa a ser **rejeitada em 04/01/2027**. Fazer esse cadastro com 20 SKUs é uma tarde; com 200 no meio da operação é uma semana perdida em janeiro.
- **Controle de teto do MEI:** acumulado do ano contra R$ 81.000, com projeção. Avisar em 70% e em 85%.
- **Painel de prazos:** 01/01/2027 (CNPJ obrigatório para PF contribuinte de CBS, Decreto 12.955/2026), 04/01/2027 (rejeição de NF-e sem IBS/CBS para MEI e Simples).
- **Emissão de NF:** integrar emissor existente, não escrever. Começar pelo emissor gratuito da SEFAZ do estado.
- **Alerta de categoria regulada:** suplemento tem regra específica de ANVISA no ML, com exigência de rótulo e documentação, e anúncio irregular é cancelado. O sistema marca o SKU e mostra o aviso antes de publicar.

**Estado:** construível hoje.

---

### M13 — Afiliados e grupo de promoções

Você quer isso e está certo em querer — o custo marginal é quase zero, porque **reaproveita o motor de M6 e M3 inteiro**. A mesma máquina que acha oportunidade de revenda acha oferta para divulgar.

- **Detector de queda real de preço:** guarda série histórica de preço por `produto_externo` e calcula se o desconto é verdadeiro ou se é o truque de subir o preço para depois "baixar". O score de desconto compara com a mediana dos últimos 90 dias, não com o "preço de" anunciado.
- **Gerador de link de afiliado** por plataforma, com tag.
- **Fila de publicação** para o grupo, com limite por dia e espaçamento (grupo que posta 40 ofertas por dia é silenciado pelos membros).
- **Gerador do texto do post**: produto, preço atual, mediana histórica, desconto real, link.
- **Rastreio de clique e conversão** por oferta, para saber o que o grupo realmente converte.
- **Sinergia com a operação:** o grupo também divulga os seus próprios produtos, e o que converte no grupo é sinal de demanda para o M7.

**Honestidade sobre isso:** comissão de afiliado é de poucos por cento e o grupo só converte com audiência, que leva meses. Não é renda de curto prazo. Construa porque é barato sobre o que já existe, não porque vai pagar as contas.

**Estado:** construível hoje.

---

### M14 — Leitor de código de barras

PWA no celular: câmera lê o EAN, o sistema consulta as fontes disponíveis e devolve em dois segundos — preço praticado, volume, comissão da categoria pelo M8, e o veredito **compra / não compra**.

Dois usos, os dois valiosos:
1. **Arbitragem:** você está na liquidação, no saldão, na loja fechando. Capital de R$ 50 a R$ 100, decisão baseada em dado.
2. **Avaliar estoque de parceiro:** escanear 40 itens no balcão em quinze minutos e saber quais valem anunciar. Isso transforma a conversa de consignação em proposta concreta no mesmo dia.

Funciona offline com fila de sincronização — loja tem sinal ruim.

Base de EAN como fallback quando a plataforma não responde: bases públicas de GTIN resolvem descrição e NCM a partir do código.

**Estado:** construível hoje. Depende de M8.

---

### M15 — Monitor com julgamento  🧠

A diferença entre alerta e inteligência:

- **Automação:** "o preço do concorrente caiu 8%."
- **Inteligência:** "este concorrente caiu 8% e aumentou o estoque anunciado ao mesmo tempo, três semanas depois de um novo fornecedor aparecer no 1688 com preço 20% menor. Provável troca de fornecedor, não queima de estoque. Se for isso, o piso de preço do nicho baixou de forma permanente e sua margem de 3x não volta."

O que monitorar: preço e estoque de concorrentes nos SKUs que importam, preço dos seus fornecedores (aumento silencioso), sua posição de busca, mudanças de taxa das plataformas, entrada de vendedor novo forte num nicho seu, e produto seu que parou de vender.

Cada evento gera uma leitura curta com hipótese e recomendação, e severidade. O sistema agrupa eventos relacionados antes de te avisar — dez alertas soltos são ruído, um evento explicado é informação.

**Estado:** construível hoje sobre M0 e M3.

---

### M16 — Pós-venda

- **Responder pergunta de comprador** usando M4: "serve no meu purificador PA26G?" é respondido com a tabela de compatibilidade e a evidência. Na categoria de reposição, responder em minutos é o que fecha a venda — e responder rápido pesa no ranqueamento.
- **Rascunho, não envio automático**, no começo. Depois de algumas centenas de acertos, liberar envio automático só para as perguntas de compatibilidade com confiança acima de 0.9.
- **Pedido de avaliação** com cartão no pacote; acompanhar taxa de avaliação.
- **Detector de pergunta recorrente:** se a mesma dúvida aparece cinco vezes, o anúncio está incompleto. Sugerir o que acrescentar.

**Estado:** rascunho hoje; envio depende da API do ML.

---

## 5. Onde a IA é IA, e onde é automação

Seção explícita porque foi o seu pedido central. Ser honesto sobre isso é o que evita gastar token em coisa que `if` resolve.

**É automação — e deve ser código determinístico, barato e auditável:**
- Cálculo de taxa e margem
- Aplicação dos cortes numéricos do M7
- Parsing de nomenclatura de modelo por gramática de fabricante
- Importação de planilha com mapeamento fixo
- Série histórica de preço e detecção de variação
- Geração de arquivo de importação
- Fila de postagem

**É IA — e não tem solução determinística:**
- **Resolução de identidade** entre fontes sem identificador comum (M3)
- **Extração estruturada** de página e PDF de layout imprevisível (M1)
- **Inferência e conciliação de compatibilidade** entre fontes que discordam (M4)
- **Decidir o que investigar a seguir** e quando parar (M6)
- **Classificação fiscal** a partir de descrição livre (M12)
- **Ler um padrão** em séries temporais e dizer o que provavelmente está acontecendo (M15)

**Regra de ouro:** LLM entra onde a entrada é texto livre heterogêneo ou onde a decisão exige julgamento sobre evidência incompleta. Onde a entrada é estruturada e a regra é conhecida, LLM é desperdício — e pior, é uma fonte de erro onde não precisaria haver nenhum.

**Disciplina de custo:** resolver identidade de um produto é caro e se faz **uma vez** — cacheado por `hash_conteudo`. Re-resolver o mesmo produto a cada varredura é o jeito mais fácil de transformar um projeto barato em conta alta. Todo resultado de LLM é persistido com a entrada que o gerou.

---

## 6. Fontes de dados — o mapa completo

| Fonte | O que dá | Credencial | Risco |
|---|---|---|---|
| API do ML (`/items/{id}`, `listing_prices`, `/orders`, `/users/{id}/items`) | própria operação, taxas reais, item por ID | OAuth | nenhum |
| `/sites/MLB/search` | busca de terceiros | **403 reportado** | inutilizável hoje |
| Páginas públicas de ML, Shopee, Amazon (link colado) | preço, vendas, vendedor, atributos | nenhuma | baixo |
| Exportação de planilha das 3 plataformas | anúncios, pedidos, repasses | login manual | nenhum |
| Sites de distribuidor nacional | preço de atacado, catálogo, mínimo | nenhuma | nenhum |
| 1688, Alibaba, AliExpress | custo de origem | nenhuma | nenhum |
| Sites e manuais de fabricante (PDF) | compatibilidade autoritativa | nenhuma | nenhum |
| Bases públicas de GTIN/EAN | descrição, NCM, marca por código de barras | varia | nenhum |
| PNCP (compras públicas) | demanda e preço de referência, dados abertos | nenhuma | nenhum |
| Comparadores de preço | faixa de mercado fora do marketplace | nenhuma | baixo |
| Grupos e fóruns de assistência técnica | compatibilidade de campo, problemas reais | nenhuma | baixo |
| Foto de tabela de fornecedor (WhatsApp) | preço de atacado real | nenhuma | nenhum |

Note que **a maioria das fontes não exige credencial nenhuma**. O sistema inteiro de inteligência roda sem conectar conta. Só a metade operacional precisa de API — e ela tem a planilha como substituta.

---

## 7. Stack e arquitetura

Nada exótico. Escolha pelo que você já domina:

- **App:** Next.js (App Router), TypeScript. Uma aplicação, não microserviços.
- **Banco:** Postgres com `pgvector` para os embeddings de M3. SQLite só se for rodar local e sozinho — mas `pgvector` vale o Postgres.
- **Fila:** uma tabela `job` com polling, ou BullMQ se precisar. Extração, resolução e prospecção são assíncronas por natureza.
- **Extração de página:** Playwright para páginas com JS, `fetch` + parser para o resto. Cache agressivo de HTML por URL e hash.
- **LLM:** chamadas com saída estruturada validada por schema (Zod). Toda chamada registra entrada, saída, custo e modelo em `llm_call`, para você saber onde o dinheiro foi.
- **PWA:** o leitor de código de barras usa `BarcodeDetector` onde existe, `zxing-wasm` como fallback.
- **Auth:** login simples, um usuário. Mas **toda query operacional filtra por `perfil_id` desde a primeira linha** — ver a distinção entre multi-perfil e multi-tenant no risco 5.
- **Observabilidade mínima:** log estruturado e uma tela de "últimos 100 jobs" com erro visível. Sistema de ingestão sem isso se torna inauditável em uma semana.

**Princípio de robustez:** todo job é idempotente e retomável. Extração que falha não perde o que já extraiu. Agente que estoura orçamento salva o dossiê parcial.

---

## 8. Ordem de construção

Cada etapa é útil sozinha no dia em que fica pronta. Você pode parar em qualquer ponto e ainda ter valor.

**1. Calculadora de margem (M8).** Função pura + testes. Sem interface. Uma noite.
Entrega: nunca mais publicar anúncio com margem negativa.

**2. Teste de capacidades + perfil.** Criar o app no ML, gerar token, testar endpoint por endpoint e escrever a matriz da seção 2.2 com dados reais. Criar `perfil_vendedor` e `credencial` com a primeira linha ("Essencial Emporium", regime CPF por enquanto). Meia noite.
Entrega: saber o que é possível em vez de supor, e nunca precisar refatorar marca para fora do código.

**3. Ingestão universal (M1) + catálogo (M2).** Colar link e importar planilha. Duas a três noites.
Entrega: o sistema começa a acumular base. Tudo depois depende disto.

**4. Leitor de código de barras (M14).** Uma noite sobre M8.
Entrega: você já pode sair de casa e comprar com dado. É a primeira função que gera dinheiro.

**5. Resolução de identidade (M3).** Duas a três noites.
Entrega: o grafo começa a existir. Daqui em diante o sistema fica mais inteligente a cada link colado.

**6. Compatibilidade (M4).** Uma semana, e continua evoluindo sempre.
Entrega: o fosso. É o que te permite vender sem disputar preço.

**7. Fornecedores (M5) + scanner (M7).** Duas noites.
Entrega: decisão de compra com critério.

**8. Anúncios (M9) + pedidos (M10) + consignação (M11).** Uma semana.
Entrega: a operação do dia a dia sai da planilha.

**9. Fiscal (M12).** Dois dias. **Tem prazo: antes de dezembro.**

**10. Prospector (M6).** Uma a duas semanas. É o módulo mais ambicioso e o mais divertido — e por isso mesmo vem depois, porque é o que mais tenta consumir tempo sem retorno imediato.

**11. Monitor (M15) + pós-venda (M16) + afiliados (M13).** Conforme a operação pedir.

**12. Adaptadores de Shopee e Amazon por API (M3 de acesso).** Quando o volume em cada uma justificar a burocracia de aprovação. Até lá, M0 e M1 cobrem.

**A armadilha a evitar:** construir na ordem inversa — o prospector e o painel bonito primeiro, a venda depois. O risco real deste projeto não é o sistema ficar ruim; é o sistema ficar pronto e você não ter vendido nada. As etapas 1 a 4 existem justamente para que cada noite de código tenha uma contrapartida em venda possível.

---

## 9. Custo de operação

Estimativa grosseira, para não tomar susto:

- Hospedagem: R$ 0 (plano free de Vercel/Railway) a R$ 50/mês.
- Postgres gerenciado: R$ 0 a R$ 40/mês no início.
- LLM: o custo está na resolução de identidade e na extração. Com cache por hash, uma base de 500 produtos externos custa poucas dezenas de reais **uma vez**. O prospector é o que pode fugir — por isso orçamento por execução é obrigatório, não opcional.
- Proxy para extração: só se começar a levar bloqueio. Evite até precisar.

Teto saudável no início: **R$ 100/mês**. Acima disso, ou a operação está pagando, ou algo está rodando sem cache.

---

## 10. Riscos, limites e o que não fazer

1. **Não construa M4 (extensão sob login).** O ganho é marginal sobre a exportação de planilha e o risco é suspensão da conta que é o seu ativo.
2. **Não dependa de um único endpoint.** O 403 do `/sites/MLB/search` é a prova. Toda fonte entra atrás de uma interface com fallback.
3. **Não publique compatibilidade sem evidência.** Erro de compatibilidade em peça de reposição gera devolução e reclamação, que é pior que não vender.
4. **Não deixe LLM decidir sem revisão** onde o erro é caro: classificação fiscal, compatibilidade, e preço. Sugerir sempre; confirmar sempre, até ter histórico.
5. **Multi-perfil sim, multi-tenant não** — e a diferença é grande, então não confunda as duas por causa da seção 1.2. **Multi-perfil** é uma coluna `perfil_id`, um filtro em toda query e nenhuma string de marca no código: custa cerca de uma hora e evita uma refatoração dolorosa. **Multi-tenant** é isolamento de dados, convite de usuário, papéis e permissões, cobrança, onboarding e suporte: custa semanas e não vende nada hoje. Faça o primeiro, não faça o segundo. Na mesma lista de não-fazer: API pública, app mobile nativo, e tema claro/escuro customizável.
6. **Não reescreva emissor de NF-e.** Integre.
7. **Respeite `robots.txt` e limite de requisição.** Extração agressiva leva a bloqueio de IP e, em caso extremo, a problema jurídico. Cache agressivo é também defesa.
8. **Não cadastre produto sem nota de compra** se pretende emitir nota de saída. Guarde cupom de tudo, inclusive da arbitragem.

---

## 11. Resumo em uma página

O sistema — codinome **Bancada**, construído pela **Zirtuno** — tem duas metades: operação (higiene) e inteligência (vantagem). "Essencial Emporium" é o perfil de vendedor que opera dentro dele, uma linha em `perfil_vendedor`, não o nome do produto.

Pela categoria, é quatro coisas ao mesmo tempo: hub de integração de marketplace, ferramenta de inteligência de mercado, PIM com *fitment management*, e repricer. As três primeiras têm concorrentes maduros no Brasil; o *fitment* não tem ninguém fazendo bem, e é por isso que vale construir em vez de assinar.

A arquitetura é organizada por **capacidade**, não por plataforma, e **toda fonte é opcional** — o sistema funciona inteiro com zero credencial, colando link e importando planilha. Conexão por API é atalho, nunca requisito. Isso não é conveniência: o endpoint de busca do Mercado Livre está retornando 403 para desenvolvedores desde dezembro de 2025, e um sistema que dependesse dele já estaria morto.

O ativo defensável são dois grafos que nenhum dinheiro compra e que crescem a cada link colado: o **grafo de identidade** (o mesmo produto em todos os lugares onde ele aparece, com preço de cada um) e o **grafo de compatibilidade** (em que aparelho cada peça serve, com evidência). O primeiro te dá margem; o segundo te tira da guerra de preço.

A IA mora em seis lugares: resolver identidade, extrair de página imprevisível, conciliar compatibilidade, decidir o que investigar, classificar fiscalmente e ler padrão em série temporal. Em todo o resto, código determinístico é mais barato, mais rápido e mais auditável.

A ordem de construção é por utilidade, não por arquitetura: margem, capacidades, ingestão, leitor de código de barras — nessa altura o sistema já gera dinheiro — e só então identidade, compatibilidade, operação, fiscal e prospector.

---

*Fontes dos números de taxa, prazo fiscal, panorama de ferramentas e restrição de API: levantamento de 11–12/09/2026, cruzado entre pelo menos duas fontes onde havia divergência. Taxas de marketplace mudam; confirme a tabela da sua categoria no painel de cada plataforma antes de precificar. O 403 em `/sites/MLB/search` está documentado em reclamações formais de desenvolvedores de dez/2025 em diante; a ligação com o Developer Partner Program do Mercado Livre é hipótese minha, não fato confirmado.*
