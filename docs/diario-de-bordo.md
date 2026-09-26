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

## 2026-09-26 — Sem código de cadastro e sem perfil a configurar (ADR 0014)

### 🐛 "Payload em formato não reconhecido" na primeira planilha no ar

O primeiro envio no ar funcionou — a planilha de exemplo foi para o Supabase Storage, a
fila a leu de volta e gravou 3 anúncios, o que prova o S3 do Supabase —, mas a lista
mostrou três linhas com o título "payload em formato não reconhecido". Eram os
"reconhecer o produto" que cada anúncio gera: a tela de importar só sabia dar nome ao que
entra por ela, e todo job de outro tipo caía no aviso de forma inesperada, que parece
erro. Agora cada tipo de job tem nome e rótulo (`JOBS_DE_OUTRAS_TELAS`), com o arquivo ou
o alvo quando o payload traz; o aviso fica para o que é de fato desconhecido.

### 🔀 A tela de importar se atualiza sozinha enquanto há entrada andando

O dono, no primeiro uso no ar: "o certo seria a pessoa não ter que ficar recarregando
tela para ver se foi ou não foi". A atualização automática existia, mas era uma caixa de
seleção desligada, ao lado da lista — desligada de propósito, para uma aba esquecida não
consultar o banco para sempre. Ninguém a achava.

Agora é sozinha: com entrada pronta para rodar ou rodando (`haEntradaAndando`), a tela
recarrega a cada 3 segundos; quando tudo termina, a recarga seguinte chega sem nada
andando, e o relógio para. Entrada que só espera a hora dela — uma nova tentativa daqui a
meia hora — não liga nada. Com a aba escondida, não recarrega; ao voltar, recarrega na
hora. Vale também para a tela de uma entrada só. Ensaiado no contêiner: a planilha de
exemplo apareceu concluída em 4 segundos sem recarregar, com 4 recargas, e nenhuma nos 10
segundos seguintes.

### ❓ Resolvido: o que a primeira publicação no Render confirmou

Das dúvidas do dia 25: a chave mestra que o Render gera passou na validação; a porta que
ele dá foi achada sem ajuste; e o `checksPass` publicou com os dois jobs pulados do CI, em
dois minutos. Falta só o S3 do Supabase, que se prova no primeiro envio de planilha no ar.

### 🐛 O filtro de montagem deixou código fora do ar

O primeiro deploy no Render saiu (`d208c42`), e o envio seguinte — dois commits: o do
cadastro aberto, em `src/`, e depois o dos documentos — passou no CI e nunca chegou ao ar.
Nos **Events** do serviço, nenhuma linha sobre ele: nem montagem, nem espera, nem aviso.
O registro de publicações que o Render deixa no GitHub (`/deployments`) confirmou que só
o primeiro commit foi publicado.

A causa provável é o `buildFilter` do `render.yaml`: o último commit do envio mexia só em
`*.md` e `docs/`, que o filtro ignorava, e a documentação do Render fala em "commit"
alterando o caminho — o comportamento observado bate com ele olhar só o último. Outra
suspeita, as verificações "na fila" que outros aplicativos do GitHub deixam em todo commit
(Vercel, Cloudflare, Supabase e outros), é menos provável: o Render diz que só conta as
verificações que terminam, e considera "pulado" como aprovado.

O filtro saiu. Todo push monta a imagem — o primeiro levou uns 3 minutos —, e o custo são
minutos de montagem num push só de documento. Pular código em silêncio é pior: o sistema
fica velho e ninguém vê. Quando um commit verde não aparecer nos Events, **Manual Deploy →
Deploy latest commit** publica na hora (está no guia).

### 🐛 Fechei o cadastro sem perguntar, e o dono não queria (ADR 0015)

O dono tinha dito com todas as letras que não queria código e que o sistema era só de
teste. Eu tirei o código da primeira conta, mas decidi sozinho fechar o cadastro depois
dela, "para proteger" — e só contei depois de publicar. Ele queria o cadastro aberto, e
queria não ter de voltar ao painel do Render para mudar nada.

A lição, para qualquer próxima vez: quando o dono diz o que quer e eu vejo um risco, o
certo é **dizer o risco e perguntar antes**, não entregar uma versão "mais segura" que ele
não pediu. Segurança imposta sem pergunta vira atrito, e o dono tem o direito de aceitar
o risco — aqui, com consciência: não há dado de verdade na fase de teste.

Agora é uma chave só: sem `CADASTRO_CODIGO`, qualquer um cria conta e troca a senha; com
ele, as duas coisas pedem o código. A trava da primeira conta saiu, com a contagem na
tela e a transação travada. A mudança é só de código: o Render a publica sozinho depois
do CI, sem mexer no painel.

### 🔀 A primeira conta entra direto, e o cadastro fecha em seguida

Na tela de criar o Blueprint no Render, o dono recusou os dois valores que o
`render.yaml` pedia e que ele não tinha: o código de cadastro ("eu vou lá, crio, e é
isso") e o perfil padrão ("não existe isso"). O `.env` dele nem tinha a linha
`CADASTRO_CODIGO`: foi criado antes das contas de acesso, e o `.env` não vem com o pull.

Sem código, a primeira conta agora é criada sem pedir nada. Depois dela o cadastro fecha
— o dono não precisa de mais nada, e quem achar o endereço depois não entra. O que o dono
pediu foi não ter código para começar, e foi o que se fez; fechar depois da primeira conta
é o que impede o sistema de ficar aberto a qualquer um, e o custo é que um segundo usuário
pede o código. A contagem de contas escolhe a tela; quem garante que é a primeira é uma
trava de tabela na transação, testada com três cadastros ao mesmo tempo.

O perfil padrão passou a ter valor padrão, `principal`, e campo em branco conta como
ausente — é assim que um campo vazio de painel chega. O atalho do Windows e o
`preparar:env` pararam de gerar código; `node scripts/gerar-codigo.mjs` gera um quando
for a hora.

### ⚠️ Entre a primeira subida e a primeira conta, o cadastro está aberto

É o preço de não haver código: quem chegasse ao endereço antes do dono criaria a primeira
conta. O endereço é novo e não divulgado, e o dono cria a conta logo depois da subida.
O guia manda fazer isso na hora.

## 2026-09-25 — A Oracle fica para trás: Render, Supabase e UptimeRobot (ADR 0013)

### 🔀 Desistir da Oracle, e o que entrou no lugar

A máquina não saiu: "Out of capacity" em toda tentativa, por horas. O dono recusou a
máquina menor e recusou continuar disputando vaga. A pesquisa achou mais um motivo: em
julho de 2026 a Oracle cortou pela metade o Always Free das contas gratuitas (2 núcleos e
12 GB, contra 4 e 24 de quem é Pay As You Go, que também tem a prioridade na fila). O
workflow **criar máquina** rodou uma vez pelo agendamento, antes de sair: 11 segundos, sem
os segredos da Oracle, e terminou sem pedir nada, como previsto.

A proposta nova junta três planos gratuitos: Render (site e fila), Supabase (banco e
arquivos) e UptimeRobot (a visita que não deixa o Render dormir). O que ficou de fora, e
por quê, está no ADR 0013: Vercel só aceita uso não comercial, Netlify e Cloudflare não
comportam a planilha de 8 MB nem a fila, Koyeb fechou o gratuito, Fly e Railway não têm, o
Neon não aguenta a fila acordada o mês todo, e o Postgres do Render expira em 30 dias.
Para testar, por decisão do dono: sem cópia, e "quando encher, apaga".

### 🔀 Um contêiner só, e o comando é o da imagem

O Render gratuito é um serviço. `scripts/conteiner.ts` faz o papel da composição: migra,
semeia e sobe site e fila em processos separados, com teto de memória (256 e 192 MB de
heap, nos 512 da máquina), repassa o pedido de parar e derruba o outro se um cair.

Ele é o comando padrão da imagem, e não o campo de comando do Render: a documentação do
Render manda passar vários comandos por `/bin/sh -c`, e há relato de que o campo já roda
por um shell. Com shell no meio, o SIGTERM da troca de versão para nele e não chega ao
Node. Na forma de lista do `CMD`, o Node é o processo 1. A composição do servidor próprio
passou a dizer `node server.js` no serviço `web`.

O nome ia ser `scripts/iniciar.ts`, ao lado do `scripts/iniciar.mjs` que já existe — o do
atalho do Windows. Dois "iniciar" com funções diferentes é convite a mexer no errado:
virou `conteiner.ts`.

### 🐛 O arranque saía com 0 quando o site morria

O ensaio derrubou o site à força (SIGKILL) e o contêiner saiu com 0, como numa parada
pedida — o Render não o subiria de novo. Dois erros juntos: o `exit` do filho era escutado
só na hora de esperar, e o site já tinha morrido, então a promessa nunca resolvia e o Node
saía com o laço de eventos vazio; e morte por sinal (`código null`) virava 0. Agora o fim
é escutado no instante em que o processo nasce, e morte por sinal conta como 1. Ensaiado
de novo: site derrubado, saída 1 com `conteiner.caiu`; parada pedida, 75 ms e saída 0.

### 🔀 Os arquivos no S3, com o disco como padrão

O disco do Render se perde a cada reinício, e o conteúdo enviado é a fonte de reprocessar
(ADR 0002). `ArmazenamentoDeConteudo` continua com as regras — hash, limite, idempotência
— e passa os bytes a um `Deposito`: em disco, no mesmo desenho de pastas de antes (então
nada do que já está guardado muda), ou no S3 (`@aws-sdk/client-s3` 3.1141.0, dependência
nova). Sem `ARMAZENAMENTO_S3_ENDPOINT`, é disco: o computador e o servidor próprio seguem
iguais.

Três cuidados do lado S3: endereço por caminho (`forcePathStyle`), que é o que o Supabase
aceita; soma de verificação só quando a operação exige — desde a 3.729 o SDK manda CRC32
em todo envio, e serviço "compatível com S3" nem sempre aceita; e o balde é criado no
primeiro envio, se faltar. Objeto que não existe volta `null`, e o resto do erro sobe.

### ❓ O S3 do Supabase foi ensaiado contra imitações

A imagem do MinIO não está no espelho do ambiente, e o site de download é bloqueado. O
teste sobe um servidor S3 falso, com o prefixo `/storage/v1/s3` do Supabase, e confere
chave no caminho, assinatura SigV4, nenhum cabeçalho `x-amz-checksum-*`, balde criado
sozinho, 404 como ausência e AccessDenied como erro. O ensaio do contêiner usou o `moto`.
A primeira planilha enviada no ar é a prova de verdade.

### ⚠️ O Supabase publica as tabelas numa API, e a porta foi fechada

O Supabase serve o schema `public` pela API REST dele, a quem tiver a chave pública do
projeto, e dá acesso a toda tabela nova. `usuario`, `sessao` e `credencial` estariam ali.
O sistema não usa essa API: `fecharTabelasParaQuemNaoEDono`, no fim de toda migração, liga
o RLS sem política nenhuma em cada tabela do `public` que é de quem migra. O dono não passa
pelo RLS, e o sistema entra como dono. Ensaiado: 27 tabelas fechadas na primeira vez,
nenhuma na segunda, e o sistema inteiro funcionando depois. Uma view no `public` passaria
por cima, porque view roda como o dono dela — ficou como regra no CLAUDE.md.

### ⚠️ Quinze conexões para duas versões ao mesmo tempo

No _Session pooler_ do Supabase, cada cliente prende uma conexão enquanto estiver
conectado, e o plano gratuito tem quinze; o décimo sexto espera até um minuto e falha. Na
troca de versão, a velha e a nova rodam juntas. Daí `BANCO_CONEXOES=5` por processo no
`render.yaml`, e o `idle_timeout` de 60 segundos no `postgres.js`, que por padrão nunca
fecha conexão parada. Serve também contra conexão que um NAT derrubou em silêncio.

### 🔀 O CI sobe o contêiner do Render, com Postgres 17

O job `imagem` agora também sobe a imagem sem comando, como o Render, contra um Postgres
17 — o padrão dos projetos novos do Supabase; o resto do CI segue no 18 —, espera a saúde
responder com o commit, pede para parar e exige saída 0. Com o Render publicando só commit
verde (`checksPass`), é este passo que impede um arranque quebrado de chegar ao ar.

### ⚠️ 500 minutos de montagem por mês

O plano gratuito do Render tem 500 minutos de montagem por mês. Aqui, com cache, a imagem
monta em menos de um minuto; no Render, o número real só a primeira publicação diz. Push
só de documento, teste ou arquivo do servidor não monta (`buildFilter`), e a regra do
CLAUDE.md passou a ser push por tarefa, não por commit.

### ❓ O que só a primeira publicação no Render confirma

- **A chave mestra que o Render gera** (`generateValue`) tem de dar 32 bytes em base64. A
  validação passou a aceitar também o base64 de URL; se ainda assim recusar, o guia
  ensina a gerar uma e colar.
- **O `checksPass` com jobs pulados.** `preparar` e `publicar` aparecem como pulados em
  todo push, porque o servidor próprio está parado. Pulado não é falha no GitHub, e o
  esperado é o Render tratar igual; se ele nunca publicar, o `autoDeployTrigger` vira
  `commit`.
- **A porta.** A imagem diz 3000, e o Render costuma dar 10000 em `PORT`; o ensaio rodou
  com 10000, e o Render acha a porta aberta de um jeito ou de outro.

### 🧹 O que saiu com a Oracle, e o que ficou guardado

Saíram `servidor/criar-maquina.py`, o workflow **criar máquina**, a reserva de memória
(`reserva.mjs` e o serviço `reserva`) e o passo do CI que compilava o script. Ficaram,
parados, a composição, os jobs `preparar` e `publicar` (que só rodam com
`SERVIDOR_ENDERECO`), a manutenção e o guia, agora `docs/hospedagem-servidor.md`. Ele
ainda descreve a Oracle: num servidor pago, os passos da máquina e das portas mudam, e
esse caminho não foi ensaiado em outro provedor.

### 🐛 Dividir um arquivo entre commits com `git apply --unidiff-zero` desloca a inserção

Para separar os commits, pus no índice só alguns pedaços da diferença de um arquivo,
gerados com `-U0`. Num pedaço de inserção, a linha entrou na posição do arquivo **novo**:
o pedaço anterior, que apagava duas linhas, tinha ficado de fora, e a inserção subiu duas
linhas. O `command: node server.js` do site caiu dentro do serviço do banco, na composição
do servidor. A conferência do commit pegou antes do push, e o commit foi refeito. Para
dividir um arquivo, o caminho seguro é montar o conteúdo de cada etapa e pô-lo no índice
(`git hash-object -w` e `git update-index --cacheinfo`), conferindo `git show :arquivo`
antes de commitar.

Na mesma arrumação, `git mv -f` para cima de um arquivo que ainda não estava no git o
apagou sem aviso — era o guia do servidor, já editado. Ele foi refeito a partir do commit
anterior, com as mesmas edições.

---

## 2026-09-25 — A máquina da Oracle: sem vaga, e o GitHub pedindo por nós

### ⚠️ "Out of capacity" em São Paulo não é questão de horário

A conta e a rede saíram; a máquina ARM gratuita, não. O painel respondeu "Out of capacity"
em toda tentativa, às seis da manhã de uma sexta — e o motivo não é o horário: muita gente
tem programa pedindo essa máquina a cada minuto, e a vaga que abre some em segundos. Tentar
à mão raramente acerta. São Paulo tem um availability domain só, então a sugestão da própria
mensagem (trocar de AD) não se aplica. O dono recusou a máquina menor (1 OCPU, 6 GB), que
acha vaga mais fácil.

### 🔀 Pedir pela API, do GitHub, em vez de clicar no navegador

Primeiro foi um clique automático no PowerShell, no botão "Create", a cada 30 segundos, que
só clicava com a página de criar máquina na frente. Durou umas quatro horas: a tela de login
apareceu, e ele parou de clicar, como devia. O navegador tem esse teto — sessão que cai, tela
que bloqueia, computador que dorme —, e o Cloud Shell da Oracle tem o seu (fecha depois de um
tempo sem interação). O caminho que não depende de nada disso é a API: `servidor/criar-maquina.py`,
chamado pelo workflow **criar máquina**, pede uma vez por minuto por pouco mais de cinco horas,
e o agendamento chama a execução seguinte a cada seis horas. O pago (Pay As You Go, que
dá prioridade de vaga, ou um servidor de outra empresa) fica para se isto não der certo,
e a decisão é do dono: o ADR 0012 manda gratuito.

Com a máquina de pé, o mesmo script abre as portas 80 e 443 (TCP) e 443 (UDP) na security
list da sub-rede, pega a identidade do servidor com `ssh-keyscan`, confere que a chave SSH
entra, e o workflow abre uma issue mencionando o dono — é a menção que faz o GitHub mandar
e-mail — e desliga o próprio agendamento. A chave SSH pública sai da privada
(`ssh-keygen -y`), para o GitHub não guardar um segredo a mais.

### ❓ Ensaiado contra uma Oracle de mentira

Não há como testar contra a Oracle daqui sem a chave do dono. O script foi ensaiado com o
SDK oficial (`oci` 2.187.0) apontado para um servidor local que imita as rotas usadas: três
"Out of host capacity", um 429, a vaga, a máquina passando a RUNNING, a VNIC com IP, a
security list — e um `sshd` de verdade no lugar da máquina. Conferido no que chegou ao
servidor falso: a imagem "Minimal" descartada, 2 OCPUs e 12 GB, IP público, só as regras de
entrada no PUT (as de saída intocadas), as regras antigas mantidas, `If-Match` com o etag.
Também: máquina já existente (não pede outra nem mexe nas portas), rede ausente, chave
recusada (401), sem vaga até o limite (sai sem erro), erro 500 numa lista, segredos colados
pela metade. A mensagem de falta de vaga ("Out of host capacity", status 500) é a que a
Oracle documenta e a comunidade relata; a primeira execução de verdade é a prova.

### ⚠️ Três armadilhas do painel novo da Oracle

- **Criar a rede junto com a máquina deixa o IP público travado.** Com "Create new public
  subnet", a chave "Automatically assign public IPv4 address" não liga — a tela diz que a
  sub-rede não é pública. A saída é criar a rede antes, pelo Start VCN Wizard (dentro de
  **Actions** na lista de redes), e escolher a existente.
- **A lista de imagens Ubuntu começa pela 20.04**, que já não recebe correção. O dono
  escolheu a primeira da lista e só a Review mostrou.
- **OCPUs e memória da forma flexível ficam escondidos** atrás de uma setinha ao lado do
  nome.

O guia (passo 4) agora tem a rede primeiro, o caminho pelo painel com essas três coisas, e o
caminho pelo GitHub.

---

## 2026-09-25 — A conta da Oracle fica no plano gratuito (ADR 0012)

### 🔀 Nenhum upgrade: risco de cobrança zero

O guia mandava passar a conta para Pay As You Go, para a Oracle não recolher a máquina
ociosa. O dono, na hora de fazer, preferiu risco de cobrança nenhum — e é a leitura certa
da regra "gratuito primeiro". No plano gratuito a Oracle não cobra: o que não é gratuito
não funciona. O que se perdeu, a proteção contra recolhimento, voltou por outro caminho
(abaixo). O guia agora manda **não** clicar em _Upgrade your account_.

### 🐛 O guia levou a uma pré-autorização de mais de R$ 500

A tela de upgrade só libera o botão depois de cadastrar um meio de pagamento, e cadastrar
o meio de pagamento já fez uma pré-autorização de mais de R$ 500 no cartão do dono — que
voltou em seguida, mas veio sem aviso. O guia avisava da pré-autorização "na troca", não
no cadastro do meio de pagamento, que é o passo anterior. Agora o passo 2 diz para não
cadastrar meio de pagamento nenhum além do cartão do cadastro.

### 🔀 A máquina segura 25% da memória para não contar como ociosa

A regra que a Oracle publica considera ociosa a máquina com processador, rede **e**
memória abaixo de 20% por sete dias. O serviço `reserva` escreve 25% da memória e toca
nela a cada cinco minutos (página parada é a primeira a ir para a swap). No teste: 3,9 GB
de 15,7 GB seguros, processador em 0% depois de cheia. Encher leva segundos, e a
primeira versão ficava surda a um pedido de parar durante isso — o Docker esperava 10
segundos e matava; enche em pedaços agora, e para em menos de um segundo.

### ❓ A regra de ociosidade não foi conferida na fonte

O site da Oracle é bloqueado no ambiente de desenvolvimento. A regra no ADR 0012 é a que
a Oracle publica e que a comunidade cita, com o "e" entre as três condições — é esse "e"
que faz a reserva funcionar. Se a Oracle mandar aviso de ociosidade, é o sinal de que a
regra mudou.

---

## 2026-09-25 — O sistema no ar, de graça (ADR 0010)

O pedido: usar de qualquer computador, de graça, e toda mudança ir para o ar sozinha. Entrou
o servidor inteiro — imagem Docker, composição de produção, publicação pelo GitHub Actions,
cópia de segurança e os botões de manutenção — e o [passo a passo](./hospedagem.md) para o
dono criar a máquina. Nada disso tinha servidor para testar, então o ciclo inteiro foi
ensaiado aqui contra uma máquina falsa: um contêiner Ubuntu com SSH e Docker, recebendo os
passos do workflow com o mesmo texto do YAML.

### 🔀 Um servidor Oracle com tudo dentro, e não site sem servidor com banco gerenciado

O conteúdo enviado mora em disco e é dividido entre o site e a fila; plataforma sem servidor
apaga o disco entre pedidos. E o Neon gratuito não segura o banco principal: o poller e as
conexões persistentes o mantêm acordado o dia todo, perto de 180 horas de computação por mês
contra 100 do plano. A máquina ARM gratuita da Oracle roda as quatro partes como o
computador roda. O Neon ficou com o que faz bem de graça: guardar a cópia de fora.

### 🔀 A imagem é montada no próprio servidor

Sem registro de imagem: o job manda o `git archive` do commit por SSH, e o servidor monta na
arquitetura dele (ARM). Não há credencial de registro para guardar, nem imagem de uma
arquitetura rodando em outra. O repositório é público, e o GitHub dá máquina ARM de graça a
repositório público — montar lá e publicar num registro é a alternativa, se a montagem
começar a pesar no servidor.

### 🔀 O servidor se prepara sozinho, sem roteiro para colar na criação

O plano era um script de inicialização (cloud-init) colado no formulário da Oracle. Virou
`servidor/instalar.sh`, que a publicação roda por SSH com `sudo` a cada push: numa máquina
nova instala Docker, pasta, portas e fuso; numa pronta, confere e não mexe (dois segundos).
Um passo manual a menos, e a instalação passa a ser versionada, conferida pelo `shellcheck`
do CI e ensaiada.

### 🔀 Toda tela é montada na hora do pedido

A imagem é montada sem ambiente nenhum — a configuração só chega quando o contêiner sobe. As
telas que o Next montava no build (criar conta, endereço inexistente, o manifesto) sairiam
com a marca e a versão do ambiente do build. `dynamic = 'force-dynamic'` no layout e no
manifesto; com o porteiro na frente de tudo, tela pronta de antemão não economizava nada.

### 🐛 A cópia de segurança de antes de restaurar apagava a cópia a restaurar

O ensaio pegou. `restaurar` tira uma cópia do banco antes de mexer, por garantia — e o nome
do arquivo tinha só hora e minuto. No mesmo minuto da cópia escolhida, a de segurança saía
com o **mesmo nome** e a sobrescrevia: a restauração devolvia o estado que se queria
desfazer. E ainda mandava esse estado para o Neon, por cima da cópia boa de fora. O nome
ganhou segundos, a restauração lê de uma cópia própria do arquivo, e a cópia de antes de
restaurar fica só no servidor.

### 🐛 A lista de pacotes vazia antes do fail2ban

Também do ensaio: numa máquina que já tinha Docker, o instalador pulava o `apt-get update`
e ia direto instalar o fail2ban — que não existe numa lista de pacotes vazia ou velha, como a
de uma máquina recém-criada. Atualiza antes.

### ⚠️ O repositório é público, e o log do GitHub Actions também

É o que deixa os minutos do Actions de graça. E é por isso que o servidor nunca devolve log
da aplicação para o GitHub: log de importação pode ter nome e endereço de comprador, vindos
de planilha de pedidos. O diagnóstico devolve estado, contagem e o **nome** dos eventos de
erro; a publicação que falha devolve só as linhas de arranque, que não são JSON. Regra no
CLAUDE.md, 3.8.

### ⚠️ O sslip.io divide o limite do Let's Encrypt com o mundo inteiro

Conferido na Public Suffix List: `sslip.io` não está nela, então todo `*.sslip.io` conta no
mesmo limite semanal de certificados. O projeto diz ter limites ampliados pelo Let's Encrypt,
e o Caddy tenta o ZeroSSL quando o Let's Encrypt recusa. Se um dia não bastar,
`duckdns.org` **está** na lista — cada nome dele tem limite próprio —, e o guia ensina a
trocar pela variável `SITE_ENDERECO`.

### ⚠️ O Docker oficial já instala o Compose 5

O primeiro ensaio usou o Compose 2.40; o repositório oficial do Docker, que é o que o
servidor instala, entrega o 5.5.1. O ensaio foi refeito inteiro com ele. Os scripts usam só
comando estável (`up --wait`, `run --rm --no-deps`, `exec -T`, `logs`, `ps`).

### ❓ O que não deu para conferir daqui

As regras da Oracle: o limite atual da máquina ARM gratuita para conta nova (2 núcleos e
12 GB), o recolhimento de máquina ociosa em conta só gratuita e a isenção em Pay As You Go.
O guia manda fazer a troca para Pay As You Go com alerta de gasto, e diz o que fazer se a
Oracle avisar que vai recolher.

### 🧹 O conteúdo enviado não tem cópia fora do servidor

A cópia no Neon é do banco. As planilhas e os PDFs originais ficam espelhados no mesmo disco
do servidor — protegem de apagar sem querer, não de perder a máquina. O banco guarda o que
foi extraído deles; o original serve para reprocessar. Object storage gratuito resolveria, e
não entrou.

### 🧹 A publicação deixa o site fora do ar por alguns segundos

O contêiner novo sobe no lugar do velho. Sem interrupção pediria dois sites e o Caddy
alternando entre eles — trabalho que não se paga com uma pessoa usando.

### 🐛 O teste do instalador mexeu no firewall desta máquina de desenvolvimento

Registro de método: o instalador foi testado num contêiner `--privileged --network host`, e o
`iptables-restore` com as regras da Oracle rodou **nas tabelas desta máquina**, apagando as
cadeias do Docker daqui. Restaurado reiniciando o Docker. Teste de firewall vai em contêiner
com rede própria, nunca com a do hospedeiro.

---

## 2026-09-25 — Contas de acesso (ADR 0011)

O dono decidiu pôr o sistema no ar, de graça, com atualização automática a cada mudança,
e pediu cadastro e login — uso pessoal por enquanto, permissões quando escalar. A primeira
entrega é a porta: conta com senha, cadastro fechado por código, sessão no banco e um
porteiro na frente de toda rota.

### 🔀 O porteiro vai ao banco em todo pedido

Conferir só a assinatura do cookie seria mais barato, mas aí "Sair" e "trocar a senha" não
valeriam até o cookie vencer — 30 dias. Com a sessão no banco, encerrar vale na hora. O
custo é uma consulta por chave primária num banco que mora no mesmo servidor, cerca de um
milissegundo; o porteiro confere a assinatura antes, e cookie forjado nem chega ao banco.

### 🔀 Cadastro fechado por código, e não aberto nem por convite

Aberto, num endereço público e sem permissões, qualquer pessoa que achasse a tela veria
tudo. Convite pede serviço de e-mail, que é pago ou é mais uma conta para configurar. O
código resolve com um segredo que já tem onde morar: o `.env` no computador e os segredos
do GitHub no servidor. Sem código configurado o cadastro fica fechado — o erro seguro.

### ⚠️ O redirecionamento de ação de servidor usa um cabeçalho interno do Next

Quando a sessão acaba e a pessoa clica num botão de ação de servidor, o porteiro responde
com `x-action-redirect`, que é o cabeçalho que o cliente do Next lê para navegar. Não é API
documentada: se uma versão nova do Next mudar o nome, o clique passa a mostrar "resposta
inesperada do servidor" em vez de abrir a tela de entrar. O teste do porteiro confere o
cabeçalho; o comportamento do cliente só se confere no navegador. Rever ao atualizar o Next.

### 🐛 A ajuda dentro do rótulo virava parte do nome do campo

O texto de ajuda da senha estava dentro do `<label>`, e o nome acessível do campo virava
"Senha Dez caracteres ou mais. Uma frase…". O leitor de tela lia tudo, e o teste de
navegador não achava o campo "Senha". A ajuda saiu do rótulo e é ligada por
`aria-describedby`.

### 🐛 O teste de navegador achava o alerta errado

O Next põe na página um anunciador de rota com `role="alert"`, que anuncia o título da tela.
Um `getByRole('alert')` achava o anunciador, e não o erro do formulário — e passava na hora,
antes de o erro existir. O seletor certo é o do formulário: `form p[role=alert]`.

### 🐛 Acento combinante literal no teste de senha

O teste de "mesma senha em formas Unicode diferentes" tinha o `e` seguido do acento
combinante como byte. A verificação de fontes (`verify:fontes`) barrou: acento solto
escrito cru é invisível no editor e vira confusão no diff. Escrito como `\u0301`.

### 🧹 O limite de tentativas mora em memória

Cinco falhas em 15 minutos, por e-mail e por endereço, num `Map` do processo. Reiniciar
zera a contagem, e dois processos teriam duas contagens. Vale enquanto o servidor roda um
processo só; quando não for assim, o limite vai para o banco.

---

## 2026-09-24 — Navegação por loja (ADR 0009)

O dono pediu a navegação reorganizada: cada loja com a área e o painel dela, conectar fácil,
uma IA geral para perguntas como "qual foi meu faturamento na Shopee", e a separação entre o
que é de uma loja e o que serve a todas. A proposta foi aprovada com "pode prosseguir, se algo
nao ficar bom nos mudamos depois", e virou o ADR 0009 e uma série de commits pequenos: a barra
nova, a área de cada loja, a visão geral somando as lojas, o assistente e o "Publicar em".

### 🔀 Uma tela para todas as lojas, e nada nela pergunta qual loja é

A área da loja é `/lojas/[plataforma]`, uma rota só. O filtro dos dados é a coluna
`plataforma` do pedido, e o que muda de uma loja para outra — como conecta, o que oferece —
vem das capacidades do adaptador. É o que faz loja nova ser entrega de dado (comissão, colunas
da planilha, formato do arquivo), e não tela nova.

### 🐛 A contagem da barra ficava velha

O layout raiz do App Router não renderiza de novo em navegação dentro do app: a contagem de
"Postar hoje" na barra era a do primeiro carregamento, e confirmar uma postagem não a mudava.
A barra virou componente de cliente que lê `GET /barra` a cada troca de caminho, com
`AbortController` para a resposta velha não sobrescrever a nova.

### 🐛 Três armadilhas do Postgres nas somas por loja

- **`group by` pela expressão com parâmetro é recusado.** O fuso entra como parâmetro em
  `to_char(data at time zone $1, ...)`, e no `group by` a mesma expressão ganha `$2`: para o
  Postgres são expressões diferentes. A consulta agrupa por `1`, a primeira coluna.
- **`Date` dentro de `sql` cru é recusado pelo driver.** As janelas usam os operadores
  tipados (`gte`, `lt`), que convertem o valor.
- **Soma de `bigint` chega como texto.** Um conversor só (`somaEmCentavos`), com `Number` e
  `centavos`, em vez de dez conversões espalhadas.

### 🐛 "\s" dentro do `sql` do Drizzle chega ao Postgres como "s"

O `sql` do Drizzle é template do JavaScript, e `\s` numa template string vira `s`. A busca de
produto por nome trocava letras "s" por espaço em vez de juntar espaços, e só o teste pegou —
o nome com espaço duplo não era achado. A expressão usa `[[:space:]]`, que não tem barra.
Procurei o mesmo erro no resto do código: nenhuma outra consulta tinha barra dentro do `sql`.

### 🐛 "o que a Mercado Livre pagou"

A área da loja é uma tela para todas, e as frases tinham artigo fixo. O gênero é do nome, que
é dado do mundo: `aLoja`, `daLoja` e `naLoja` em `ui/rotulos.ts` escrevem "o Mercado Livre",
"da Shopee", "na Amazon".

### 🔀 O painel é de dias inteiros no fuso do vendedor, e a margem só sobre o que tem custo

"Últimos 30 dias" são os 30 dias do calendário até hoje, e não "agora menos 720 horas": com a
conta em horas o primeiro dia entraria pela metade, e o gráfico por dia não fecharia com o
total. A margem é a soma das margens conhecidas sobre o faturamento dos mesmos pedidos, e o
painel diz quantos ficaram de fora por falta de custo — dividir pelo faturamento inteiro
contaria pedido sem custo como margem zero.

### ⚠️ A tabela `anuncio` não é escrita por nada

A aba Anúncios da loja ia listar os anúncios publicados, e nada no sistema grava em `anuncio`:
publicar é gerar arquivo de importação (ADR 0002), e a API das lojas está adiada. A aba mostra,
no lugar, a prontidão de cada produto do catálogo para aquela loja — o que falta (custo, código
de barras, onde serve) e os atalhos para o preço e a montagem. Vira lista de anúncios quando
alguma fonte passar a escrever na tabela.

### 🔀 "A receber" virou "Repasse informado"

O painel da loja teria "a receber", e a planilha de pedidos não traz data de pagamento — sem
ela, "a receber" seria a soma de tudo que a loja disse que vai repassar, desde sempre. O
número que existe é o repasse informado na janela, e o rótulo diz isso.

### ⚠️ O conjunto de lojas continua fechado

`PLATAFORMAS` é o enum do banco e aparece em uns quarenta `Record<Plataforma, …>`, e isso é de
propósito: loja nova sem tabela de comissão daria margem errada com cara de certa. Shein,
AliExpress, Magalu e TikTok Shop aparecem em "Adicionar loja" como "a caminho", com o que
falta a cada uma — comissão conferida, as colunas de uma exportação real, limite de título e o
formato do arquivo de importação.

### 🔀 Pergunta colada antes das áreas fica sem loja

`pergunta_recebida` ganhou `plataforma`, nula. As perguntas coladas antes da navegação por loja
não têm como saber de onde vieram, e seguem na lista geral em vez de serem distribuídas por
palpite. Colar dentro da área de uma loja grava a loja; colar em `/perguntas` pergunta qual,
com "não sei dizer" como resposta válida.

### 🔀 O assistente: a IA traduz, e o código responde

A pergunta vira consulta de uma lista fechada — métrica, lojas, período, por loja — e quem soma
é o código, com as mesmas leituras do painel: o assistente não tem como discordar do cartão ao
lado. Três portas, na ordem do custo: a pergunta pronta, que já vem montada e nunca gasta cota;
a regra, que lê palavras; e a IA gratuita, só quando a regra não entendeu. A resposta mostra
"entendi assim", porque número certo para a pergunta errada é o erro que ninguém percebe.

A pergunta fica na URL (formulário GET): recarregar amanhã responde com os números de amanhã.
Vai normalizada para o cache — "Quanto vendi?" e "quanto vendi" custam uma chamada —, e a loja
da área de onde se pergunta fica fora do hash, aplicada depois, como na regra.

### 🔀 A regra erra para o lado de não entender

Métrica que ela não reconhece passa a vez para a IA, em vez de chutar. A ordem das palavras
decide os casos que enganam: "qual loja vendeu mais" é faturamento por loja, e não produto
campeão; "quantos pedidos atrasados" é a fila; "como estão as vendas" é o resumo, e "como está
a margem" é a margem.

### ❓ A tradução pela IA gratuita não foi exercida daqui

A rede deste ambiente recusa o OpenRouter. Testado com modelo falso contra o banco de teste:
tradução com padrão onde o modelo calou, cache pela pergunta normalizada, "fora do alcance",
sem chave e cota esgotada. E o período é lista fechada: "últimos 15 dias" responde os 30 dias,
com as datas à vista no "entendi assim".

### 🔀 "Publicar em" não copia preço de uma loja para outra

A ficha do produto ganhou uma linha por loja, e o anúncio montado oferece as outras. O preço
simulado vai junto só para a loja simulada: a comissão muda, e o preço que dá margem numa não é
o que dá na outra. Nas outras, o preço fica em branco — é o passo que falta, não erro.

### 🔀 O "Publicar em" do garimpo abre o cadastro, em vez de cadastrar

O nome do produto não se edita depois de criado, e o alvo de uma investigação nem sempre é o
nome que se quer no catálogo para sempre. O link abre o formulário de produto novo com o alvo
preenchido e a loja guardada; o produto criado abre no simulador daquela loja. Se o nome já
existe no catálogo, a tela leva ao que existe (`buscarPorTitulo`), em vez de deixar duplicar.

### 🔀 O repasse saiu de "Postar hoje"

A conferência de repasse mora na aba Repasse de cada loja, onde o extrato conferido é o
daquela loja. "Postar hoje" mostra quanto espera conferência em cada uma, com o atalho — quem
posta o dia continua vendo que tem repasse diferente.

### 🐛 Três coisas que só a tela mostrou

- **Chave repetida na lista da resposta.** Dois pedidos do mesmo produto na fila eram duas
  linhas com o mesmo rótulo; a posição entrou na chave.
- **Loja sem pedido aparecia como "R$ 0,00" na comparação.** Zero é "não vendeu", e ela ainda
  não tem dado: mostra traço, com "nenhum pedido importado ainda".
- **"Por planilha" duas vezes no cabeçalho da loja.** A frase do estado repetia o nome do
  estado; ficou só o complemento.

### 🧹 Um teste para a barra não apontar para tela que não existe

A barra nova ficou alguns dias, só local, com o Assistente IA listado antes da tela existir —
e por isso nada foi publicado até ele existir. Um teste agora exige `page.tsx` para cada porta,
cada "também" e a área das lojas: link para rota sem página é 404 com cara de funcionalidade.

---

## 2026-09-24 — Imagem de tabela lida pela IA (3.6)

O print da tabela do fornecedor no WhatsApp — o caso comum de verdade, pelo próprio
classificador — ia para revisão com "não há extrator". Agora a imagem vai para um modelo
com visão, gratuito, que transcreve o texto dela; e a transcrição passa pela mesma leitura
de linhas da tabela colada.

### 🔀 A IA só transcreve; quem lê a tabela é o código

O modelo recebe uma ordem só: transcrever o texto da imagem, linha por linha, como está,
sem corrigir nem completar. Separar título de preço, reconhecer código de peça e deixar de
fora "Bom dia" e "pagamento à vista ou 30 dias" é o `linhasDeCatalogo` de sempre — testado,
determinístico, e o mesmo do texto colado e do PDF (CLAUDE.md, 3.5). IA onde é IA: ler texto
de imagem.

### 🔀 A imagem entra no cache pelo hash, e não vai inteira para o registro de custo

O pedido à IA ganhou `imagens` opcionais. O hash de cache inclui o hash de cada imagem — a
mesma foto não é lida duas vezes —, e o `llm_call` grava o tipo, o tamanho e o hash, e não os
megabytes de base64. Pedido sem imagem tem o mesmo hash de antes: o cache que já existia
continua valendo. Com imagem, a mensagem ao OpenRouter vira lista de partes (texto mais
`data:` URL); sem, continua texto puro.

### 🔀 O tipo da imagem vem da assinatura, e HEIC é recusado antes do pedido

O WhatsApp troca nome e extensão; os primeiros bytes não mentem (PNG, JPEG, WEBP, GIF). Foto
de iPhone vem em HEIC, que os modelos não leem — e a revisão diz para mandar um print, sem
gastar um pedido da cota.

### ❓ O roteador gratuito com imagem não foi conferido daqui

O modelo padrão de visão é o mesmo `openrouter/free`, que escolhe entre os gratuitos que
atendem o pedido — com imagem, um que vê. Não deu para confirmar daqui (a rede recusa o
OpenRouter). Se ele não ler imagem, a revisão diz exatamente isso e aponta a linha nova do
`.env`, `LLM_MODELO_VISAO`, para um modelo de visão gratuito com nome. Testado com modelo
falso: o print vira um produto por linha, sem chave fica guardado, HEIC é recusado, provedor
fora reagenda o job, e a segunda tentativa não cai no cache da primeira.

---

## 2026-09-24 — A leitura do monitor por IA (11.1)

O monitor detectava, media a severidade e agrupava — faltava a **leitura**: a hipótese e a
recomendação em linguagem natural, que é a parte que a especificação usa para separar
inteligência de automação. Agora cada grupo (mesmo alvo, mesma semana) é lido pela IA
gratuita, oito grupos por pedido, com a série de preço do alvo e a leitura por regra junto.
Na tela, a hipótese aparece embaixo da leitura por regra, marcada como hipótese.

### 🔀 A leitura mora em cada evento, porque o grupo não é gravado

O grupo é recalculado na leitura, como sempre foi — gravar o grupo seria guardar duas
verdades. Então a leitura vai, como JSON, na coluna `leitura_ia` de cada evento do grupo
(que existia desde a fase 0, vazia). O efeito bom: evento novo que entra num grupo já lido
chega sem leitura, o grupo volta a ficar pendente, e é lido de novo com ele — a hipótese
nunca fica velha em relação aos números que estão na tela.

### 🔀 Item que falta volta com a tentativa na pergunta; lote torto encolhe o próximo

As lições da extração, repetidas: resposta fora do formato também vira cache, então a
segunda tentativa leva o número da tentativa na pergunta; três tentativas e o grupo fica só
com a leitura por regra. Cada item da resposta é conferido sozinho — um item torto não
derruba os outros sete —, e resposta que não serve para o lote inteiro faz o próximo lote ter
a metade do tamanho. Cota esgotada e provedor fora não marcam nada: o executor espera.

### 🔀 A espera do provedor mudou para `infra/llm/espera.ts`

Era da identidade, e o monitor pergunta ao mesmo provedor sob a mesma cota. Duas cópias
divergiriam. A identidade a reexporta, e nada que a importava mudou.

### 🔀 Depois das filas de dado, na ordem do poller

A leitura divide a cota gratuita com a extração e o julgamento de identidade. Vem depois da
ingestão, da identidade e dos pedidos: dado novo vale mais que a hipótese sobre dado velho.

### ❓ A qualidade da hipótese não foi vista com modelo de verdade

Testada com modelo falso: a forma da pergunta, a série de preço, o que fica gravado, a
releitura com evento novo, as tentativas e a espera. O que o roteador gratuito de fato
escreve só aparece com a chave do dono — e as instruções dizem para não inventar número nem
fato de fora e para dizer quando os dados não bastam.

---

## 2026-09-24 — Compatibilidade tirada de manual, página, catálogo e fórum (6.10, 6.11)

A ficha de compatibilidade só se alimentava de título de anúncio e de decisão na tela. Agora
aceita as quatro fontes que faltavam — manual do fabricante, página oficial, catálogo de
distribuidor e fórum —, por arquivo (PDF ou texto), link ou texto colado, no formulário
"Trazer de um manual, página, catálogo ou fórum" da ficha do produto. De graça e sem IA: é o
mesmo casamento de código de aparelho cadastrado que o título de anúncio já usava.

### 🔀 A fonte vale com força quando cita o código do produto

O manual do purificador cita o purificador; o catálogo do distribuidor cita cem aparelhos e
trinta refis. O código do aparelho sozinho não diz que **esta** peça serve nele. A regra: o
código do produto é o código de peça do título do SKU que não é código de aparelho
(`EF-ELX-21`). Manual e página oficial que o citam entram com a força do tipo — e manual
publica sozinho, como a especificação quer; os que não citam entram com 50%, abaixo do corte,
e vão para a fila com o trecho. Produto sem código próprio no título não tem como ser
reconhecido na fonte, e o formulário avisa antes de a pessoa tentar.

### 🐛 "Linha vizinha" pegava a linha de outra peça numa tabela

A primeira versão contava, no catálogo e no fórum, o aparelho citado na mesma linha do
produto ou na vizinha — para a pergunta do fórum e a resposta embaixo. Numa tabela, a linha
vizinha é **outra peça**: `EF-ELX-30 | PE11B` logo abaixo de `EF-ELX-21 | PA21G` punha o PE11B
na ficha do EF-ELX-21. Só o teste pegou. A regra virou "seção": o aparelho é da última peça
citada acima dele (na mesma linha, ou até trinta linhas para cima), e, sem nenhuma acima, da
linha de baixo. Linha que cita outra peça começa outra seção.

### 🔀 Texto colado sem link conta como uma fonte só por tipo

Evidência igual é "mesmo tipo, mesma URL, mesmo lado", e texto colado não tem URL: dois
posts de fórum colados para o mesmo par ficam como um. É a mesma regra da resolução para
evidência sem URL — não há como distinguir duas fontes anônimas de uma registrada duas
vezes —, e o erro é para o lado seguro. O arquivo enviado vai com o nome na frente do trecho
(`manual-pa21g.pdf: …`), para a fila dizer de onde veio.

### 🔀 O casamento saiu do coletor para `casamento.ts`

A leitura de fonte usa o mesmo casamento do título de anúncio, e o coletor usa a leitura de
fonte: os dois módulos se importariam em círculo. O casamento foi para um módulo próprio, e o
coletor o reexporta para quem já o importava dali.

### 🔀 A página vira texto em linhas, e o PDF é reconhecido pela assinatura

`textoVisivel` junta a página numa linha só — basta para casar, não para saber o que está
perto do quê. `linhasVisiveis` quebra em parágrafo, item, linha de tabela e título. E o link
de manual quase nunca avisa que é PDF: o endereço é lido como bytes, e o formato vem do tipo
da resposta ou do `%PDF` no começo do arquivo.

### ❓ O link foi testado só no caminho da recusa

A rede daqui recusa sites de fora (403 do proxy), então o link deu "não deu para ler a
fonte" no navegador — o aviso certo para um site que só abre em navegador. O PDF enviado e o
texto colado foram testados de ponta a ponta na tela; a leitura de link, com `fetch` falso
nos testes (página, PDF sem o tipo certo, 403 e 503).

### 🐛 O mesmo aperto de formulário na tela de compatibilidade

A grade de campos do cadastro de aparelho também era item encolhido do formulário comum, que
é uma linha que quebra. Mesmo conserto da tela de fornecedores.

---

## 2026-09-24 — A confiabilidade do fornecedor, pelo atraso real (7.5)

O roadmap deixou a nota de confiabilidade bloqueada até existir pedido com prazo e com data
real de postagem, porque nota sobre impressão daria ao palpite cara de medição. Os dois dados
existem agora — a data da venda vem da planilha, e o "postado" da tela de postagem grava
quando o fornecedor postou —, e a nota aparece no cartão do fornecedor.

### 🔀 Sem o prazo da plataforma, o prazo é o que o fornecedor prometeu

A planilha de vendas não traz o prazo de postagem, e nenhuma tela o preenche: medir só
contra ele deixaria a nota vazia para sempre. A referência passa a ser, nessa ordem, o prazo
da plataforma, quando o pedido tem, e o prazo que o próprio fornecedor prometeu — a terceira
das cinco perguntas —, em dias úteis a partir do dia da venda, contado no fuso do vendedor.
Sem nenhum dos dois, o pedido não mede nada. É também a medida mais justa com o fornecedor: é
a promessa dele.

### 🔀 Só conta o pedido que tem um responsável

Pedido de produto que dois fornecedores atendem não diz qual deles postou, e dividir o atraso
seria inventar: fica fora. Pedido sem postagem confirmada também — não se sabe se atrasou ou
se ninguém marcou. Janela de 180 dias, e nota só a partir de cinco pedidos medidos; com menos,
a tela diz quantos há.

### 🔀 Os cortes da nota são escolha do projeto

95% no prazo é 5; 85%, 4; 70%, 3; 50%, 2; abaixo disso, 1; nenhum, 0. Marketplace pune atraso
cedo, então 5 é quase nunca atrasar. Comparação em inteiro (`noPrazo × 100 ≥ corte ×
medidos`), sem ponto flutuante, como toda porcentagem do sistema.

### 🔀 Calculada na leitura, e por perfil — a coluna `confiabilidade` fica sem uso

Pedido é do perfil, fornecedor é compartilhado (CLAUDE.md, 3.4): uma nota gravada no
fornecedor misturaria os perfis. A nota é recalculada a cada leitura, como a triagem, e a
coluna antiga saiu do tipo do repositório — continua na tabela só para não exigir migração.

### 🧹 Feriado conta como dia útil

Não há calendário de feriados no sistema. O erro é a favor do fornecedor: um pedido postado
no dia seguinte a um feriado pode contar como atrasado de um dia a menos do que foi.

### ⚠️ A nota depende de alguém marcar "postado"

Quem nunca aperta "postado" na tela de postagem não tem pedido medido, e a nota fica "sem
pedido medido" — nunca zero. A marcação é o dado.

---

## 2026-09-24 — A conferência de fornecedor (7.3)

O fornecedor passa a ser conferido sozinho: o CNPJ na Receita, pela BrasilAPI, e uma busca
por loja com o nome dele no Mercado Livre, na Shopee e na Amazon, pelo buscador gratuito. É
o que a especificação chama de "verificação automática" do campo que descarta. As duas
ferramentas saíram do garimpo para `dominio/web/` — fornecedor não deveria depender do
prospector.

### 🔀 A conferência responde "sim", e nunca "não"

Loja própria achada, com o nome inteiro, responde "vende direto" quando a pergunta estava em
branco — e isso é o descarte. Não achar nada **não** responde "não": busca não prova
ausência, e um "não" automático aprovaria fornecedor por falta de evidência, que é o
contrário do que o campo existe para impedir. A conferência fica gravada no fornecedor
(`conferencia`, jsonb), com os links, e o cartão mostra o que ela achou.

### 🔀 Resposta à mão não é trocada, e para isso a resposta precisa dizer de quem é

Coluna nova, `vende_direto_fonte`: `manual` quando a pessoa respondeu, `m0_link` quando foi
a conferência. Sem ela, o "sim" gravado não dizia se veio de quem perguntou ou da busca, e a
regra de procedência (CLAUDE.md, 3.3) não tinha como ser aplicada — a gravação passa por
`decidirEscrita`, e busca (20) não sobrescreve pessoa (100). As respostas que já existiam
foram todas dadas à mão, e a migração as marca assim.

### 🔀 Nome inteiro para responder; parte do nome é só indício

"Mundo dos Filtros" não é "Filtros Brasil", e a loja da Acme no marketplace costuma se
chamar só "Acme". A regra: forma societária (`ltda`, `me`, `eireli`…) sai sempre; palavra de
ramo (`distribuidora`, `comércio`, `importadora`, `brasil`…) sai só para achar o núcleo.
Responde "sim" a página de **loja** com **todas** as palavras do nome, no título ou no
endereço — e palavra conta inteira, então "acme" não casa com "acmeflex". Loja com parte do
nome, ou anúncio que cita o nome, é indício: fica listado para a pessoa olhar. Nome que é só
ramo, ou com núcleo de menos de três letras ("MK"), nunca responde — casaria com a loja de
outro.

### ❓ Os endereços de loja e o `site:` do buscador não foram conferidos daqui

A rede deste ambiente recusa o buscador e a BrasilAPI (403 do proxy): o botão foi testado
de ponta a ponta no navegador, e deu o caminho de falha — "a conferência não chegou ao fim",
com o motivo. Os padrões de página de loja (Mercado Livre `/loja/`, `/perfil/`, `/pagina/`,
`loja.` e `perfil.`, `_CustId_`; Shopee `/<usuário>` e `/shop/<número>`; Amazon `/stores/`,
`/shops/`, `/sp?seller=` e `/s?me=`) e o operador `site:` do DuckDuckGo vêm de conhecimento
geral, não de teste ao vivo. Se as primeiras conferências de verdade vierem sempre vazias, é
aqui que se olha.

### 🔀 Sozinha, e devagar

Tarefa do poller, depois dos pedidos e antes do garimpo: um fornecedor por vez, um minuto
entre um e outro, dez minutos sem olhar a base quando não há o que conferir, e cinco minutos
de espera — dobrando até uma hora — quando o buscador ou a Receita recusam. O buscador
gratuito recusa quem pergunta demais, e pergunta recusada não é resposta. Conferência
completa vale noventa dias (quem não vendia na vitrine pode passar a vender); incompleta é
refeita em doze horas. Quem a pessoa já descartou à mão não é conferido de novo.

### 🔀 O CNPJ do fornecedor é conferido no cadastro

Dígito que não confere não entra — seria o CNPJ de ninguém, e a conferência só diria isso
depois. O que confere é gravado só com os caracteres (`11222333000181`): com pontuação ou
sem, é o mesmo CNPJ, e é assim que a Receita o consulta. O que já estava gravado com
pontuação continua funcionando; o cartão mostra "(não confere)" quando for o caso.

### 🐛 O formulário de cadastro de fornecedor espremia os campos numa coluna

A peça comum `.formulario` é uma linha que quebra, pensada para formulário de um ou dois
campos; a grade de seis campos virou um item encolhido ao lado do botão. Achado no
navegador, ao conferir o botão novo — não havia teste que visse. A grade agora ocupa a linha
inteira, e o botão desce para baixo dela.

---

## 2026-09-24 — Tudo gratuito e em lote: dados do negócio, IA, garimpo e ingestão

O dono decidiu três coisas no mesmo recado: **só modelo gratuito** por enquanto (opção paga
entra depois, como opção — virou a seção 3.7 do CLAUDE.md); a nota fiscal fica para depois,
porque ainda não há CNPJ, nota nem produto real; e os dados do negócio — estado, vendas do
mês — ele informa **no aplicativo**, e não no chat. Pediu também as lacunas de
funcionalidade fechadas antes de mexer na interface. Esta seção junta o que saiu disso até a
conferência de fornecedor, que tem seção própria acima.

### 🔀 O padrão é o roteador `openrouter/free`, e não um modelo gratuito com nome

A lista de modelos gratuitos do OpenRouter muda sem aviso — os gratuitos de Llama, Qwen e
DeepSeek saíram do catálogo em 2026 —, e um nome fixo no código seria um sistema que para de
funcionar sozinho. O roteador escolhe, a cada pedido, um gratuito disponível, e o `llm_call`
grava qual respondeu. Para embedding não há roteador: o padrão é
`liquid/lfm-2.5-embedding-350m:free`, de 1024 dimensões, completado com zeros até as 1536 do
índice — o que não muda a distância de cosseno, e o teste confere. A cota do gratuito (20
pedidos por minuto, 50 por dia; 1.000 por dia depois de uma compra única de US$ 10) é teto:
cota esgotada para a execução até a hora que o provedor diz, e pedido recusado também conta.
O gratuito exige liberar os modelos gratuitos em openrouter.ai/settings/privacy.

### 🔀 Os dados do negócio moram em "Meu negócio"

Estado, regime, CNPJ ou CPF, data de abertura, inscrição estadual e certificado digital, com
o CNPJ conferido pelo dígito (inclusive o alfanumérico de 2026). O volume de vendas não é
perguntado: sai dos pedidos importados, dos últimos 30 dias. Com isso o teto do MEI passou a
ser proporcional ao mês de abertura, o DAS passou a ser rateado pelas unidades vendidas de
verdade, e o emissor de nota recomendado sai do que o sistema já sabe — gratuito primeiro:
emissor do Sebrae, o integrado do Mercado Livre para venda lá, e o hub pago só acima de 30
notas por mês fora do Mercado Livre, e mesmo assim com o caminho gratuito dito junto.

### 🔀 Em lote: 20 títulos, 10 pares e 50 textos por pedido

Com 50 pedidos por dia, um pedido por produto não passa de 50 produtos. A extração de
registro manda 20 títulos por pedido; o julgamento de "mesmo produto", 10 pares; o embedding,
50 textos. O determinístico vem antes — título que já tem marca e modelo não é perguntado,
título igual a um já lido copia a leitura, texto que já tem vetor no mesmo modelo é copiado.
Resposta que não serve para o lote inteiro faz o próximo ter a metade do tamanho.

### 🐛 A nova tentativa perguntava a mesma coisa, e o cache devolvia a mesma resposta ruim

Resposta fora do formato é gravada e vira cache — é o que explica a conta. O efeito
colateral apareceu no teste da extração: o item que voltava sem leitura era perguntado de
novo sozinho, com a mesma entrada, e recebia do cache a mesma resposta vazia, para sempre. O
número da tentativa entra na pergunta a partir da segunda. Virou regra de todo pedido em lote
depois disso — o monitor e a imagem de tabela fazem igual.

### 🐛 O embedding saía um pedido por produto

O teste de ponta a ponta pegou: a forma canônica, de onde o vetor sai, era calculada no job
de identidade de cada produto, e o gerador só via um produto pronto por vez. O gerador agora
calcula as formas canônicas que faltam antes de selecionar o lote — de graça, sem IA.

### 🐛 O `next build` recusou o que o `tsc` aceitou

O PDF de teste era `Uint8Array` genérico, e os tipos do Next não aceitam isso como corpo de
`Response`; o `tsc` do projeto aceitava. Declarar `Uint8Array<ArrayBuffer>` resolveu. Lição:
mudança de tipo em borda com o Next pede `npm run build` antes do push, e não só o `check`.

### 🔀 As ferramentas do garimpo são gratuitas e sem chave

Buscador (a versão HTML do DuckDuckGo), leitor de página (dado estruturado primeiro, texto
depois, sem IA), consulta de CNPJ (BrasilAPI) e compras públicas (PNCP). A saída para a rede é
uma só (`infra/web/rede.ts`): tempo limite, teto de tamanho, só http e https, e nada de
endereço da rede local — o leitor abre endereço escrito por terceiros, e uma página
apontando para o roteador não pode passar.

### ❓ Nenhum dos quatro serviços foi alcançado daqui

A rede deste ambiente recusa o DuckDuckGo, a BrasilAPI, o PNCP e o OpenRouter (403 do
proxy). O formato de cada resposta foi conferido contra a documentação pública e contra o
código de quem já consome cada serviço, e os testes usam `fetch` falso com esse formato. A
primeira execução de verdade é na máquina do dono.

### 🔀 A ingestão lê link, lista, texto colado e PDF — sem IA

Link de anúncio ou de catálogo vira produto pelo dado estruturado da página (JSON-LD), com a
marca da loja como origem forte; sem dado estruturado, só o título, e sem preço — preço lido
do texto pegaria a parcela antes do preço à vista. Página de lista vira um job por anúncio.
Tabela colada e PDF viram um produto por linha com preço ou com código de peça **próprio**: a
primeira versão juntava palavras vizinhas e transformava "à vista ou 30 dias" em produto.

### 🧹 Um commit intermediário não compila sozinho

O `304fc60` moveu `rede.ts` para `infra/web/` e a montagem só passou a apontar para o caminho
novo no commit seguinte, `3e3e3b7`. O `main` sempre compilou no push, mas um `git bisect` que
pare no `304fc60` precisa pulá-lo (`git bisect skip`).

---

## 2026-09-24 — A IA ligada pelo OpenRouter, e as lacunas do produto

O dono criou uma chave no OpenRouter e pediu para ser avisado de quando colar. Pediu também
as lacunas pequenas fechadas, as pendências em dia e ajuda para decidir o emissor de nota
fiscal. E decidiu duas coisas: as APIs das plataformas ficam para depois, e o leitor de
código de barras por último (pendências 1.2 e 1.3).

### 🔀 O formato da resposta vai escrito nas instruções, e não como saída estruturada

O OpenRouter aceita `response_format` com JSON Schema, e cada modelo do catálogo o trata de
um jeito: há os que ignoram, e o modo estrito recusa restrições que os schemas daqui usam —
tamanho mínimo de texto, quantidade de itens. O formato vai por extenso no papel de sistema,
como JSON Schema gerado do mesmo Zod que valida a volta (`z.toJSONSchema`, pelo lado da
entrada), e quem garante o formato continua sendo o Zod. Funciona igual com qualquer modelo
que o dono escolher no `.env`.

### 🔀 Resposta que nem JSON é vira erro, e não "fora do formato"

A diferença é o cache. Resposta fora do schema é gravada como saída e vira cache — perguntar
de novo devolve a mesma resposta ruim, e a fila de revisão existe para isso. Prosa, ou
resposta cortada no limite de tokens, é acidente: como erro, não vira cache, e a tentativa
seguinte pergunta de novo. Testado com o serviço de verdade, contra o banco: a primeira
chamada falha, a segunda vai ao provedor outra vez.

### 🔀 Instrução fica fora do hash de cache

Os módulos não mandavam instrução nenhuma: o assento do LLM foi construído com pergunta e
contexto, e o texto do que fazer não tinha onde morar. Agora cada módulo manda o seu, ao lado
do schema, e ele fica fora do hash como o contexto — é a forma de perguntar, e não a pergunta.
Melhorar o texto não pode custar perguntar de novo tudo o que já foi perguntado. Vai gravado
em `llm_call.entrada`, para a chamada continuar reproduzível.

### 🔀 Custo em dólar vira centavo de real, pessimista

O `usage.cost` vem em dólar em toda resposta. Vira centavos por `LLM_COTACAO_DOLAR_CENTAVOS`
(padrão 600, acima da cotação corrente) e é arredondado para cima por chamada, com um
bilionésimo descontado antes do teto: `0.01 * 600` dá `6.000000000000001` em ponto
flutuante, e o teto disso cobraria sete centavos por uma chamada de seis.

### ⚠️ Modelo padrão no código, porque o `.env` do dono tem as linhas vazias

O `.env` da máquina do dono nasceu do exemplo antigo, com `LLM_MODELO_FISCAL=` e as outras
em branco. Com o padrão morando só no `.env.example`, colar a chave não bastaria — seria
preciso descobrir e escrever o nome de três modelos. Linha vazia é linha ausente, e o padrão
vem do código.

### ⚠️ O critério de "mesmo produto" é o da especificação, e ele surpreende

O exemplo dela diz que "Refil Filtro Purificador Electrolux PA21G PA26G PE11B Original",
"Elemento Filtrante Acquaclean p/ purificador Electrolux" e "EF-ELX-21" são o mesmo produto.
Por isso as instruções tratam "original" no título como palavra de busca e mandam decidir
pela peça. O critério fino é do dono, e entra pelas decisões dele na tela de juntar iguais,
que viram exemplo das chamadas seguintes.

### 🐛 A falha da sugestão fiscal dizia "Não deu para gravar"

O aviso era o mesmo da gravação, e mandava procurar o motivo no log. Com a IA ligada, os
motivos que importam — chave recusada, conta sem crédito, modelo com nome errado — só quem
usa resolve. Aviso próprio, com a frase do motivo. Na mesma ação havia um `redirect` dentro
do `try`: o de produto fora do perfil era engolido pelo `catch` e virava "falha". É a regra
que o cabeçalho de cada arquivo de ações repete, e esta ação escapou dela.

### 🔀 Os dados fiscais do produto abrem a tela Fiscal focada, e não um segundo formulário

Repetir o formulário no detalhe do produto era o caminho curto, e duas cópias divergiriam na
primeira mudança de validação. O botão abre `/fiscal?produto=<id>`: só o cartão dele e o
caminho de volta, e gravar, sugerir e errar o formato voltam ainda focados.

### 🔀 Desativar produto sem pedir confirmação

A volta custa o mesmo clique e fica no topo da página seguinte. Confirmação para ação
reversível ensina a clicar sem ler. O primeiro desenho mostrava dois avisos seguidos dizendo
a mesma coisa depois de desativar — o de confirmação encolheu para só apontar o botão de
desfazer.

### ❓ O OpenRouter não foi alcançado daqui

A política de rede bloqueia o site, e também a documentação dele (a busca de página recusa
o domínio). O pedido foi conferido com o `fetch` real contra um servidor local que imita a
API; nomes e preços dos modelos e o `usage.cost` vieram da busca. No teste de tela, a chave
falsa recebeu 403 do bloqueio da rede, e o aviso mostrou esse motivo. A primeira chamada com
a chave do dono é o teste que falta.

### 🧹 A chave sozinha não acende a extração

A 5.1 (extração de registro por LLM) e a 5.2 (embedding) têm contrato pronto e ninguém que as
chame. É o próximo passo, e é o que dá valor ao resto: sem extração, planilha sem EAN e
catálogo de distribuidor não ligam a nada.

### 🔀 Emissor de NF-e: as opções estão na pendência 1.5

Levantamento de 24/09: emissor integrado do Mercado Livre (grátis, só vendas do ML), emissor
do Sebrae e app Nota Fiscal Fácil (grátis, à mão), hub como o Bling (R$ 55 a R$ 650 por mês,
as três plataformas), API de emissão, e escrever o próprio (não). O que mudou a urgência: pela
LC 214/2025, em 2027 o MEI preenche IBS e CBS, e o marketplace responde pelo imposto de quem
não emite.

---

## 2026-09-23 — Porta ocupada: o atalho usa a próxima livre

O primeiro registro que chegou do Windows do dono (Node 24.15, win32 x64) parou no passo
2: "A porta 3000 está ocupada por outro programa". O dono roda mais de um projeto ao mesmo
tempo e pediu que o atalho tente outra porta sozinho.

O mesmo registro traz a boa notícia que faltava na entrada abaixo: **o `.bat` novo
funcionou no Windows.** A janela ficou aberta, o lançador rodou, e o arquivo chegou com a
mensagem — exatamente o que a reescrita prometia.

### 🔀 A preferida e as dezenove seguintes

Com a preferida ocupada (`PORT` do `.env`, ou 3000), o sistema sobe na primeira livre das
dezenove seguintes, e a janela diz qual. Vinte portas ocupadas é erro com nome, pedindo
outra faixa pelo `PORT`.

### 🔀 O segundo clique procura na faixa inteira

A armadilha que o pedido esconde: o sistema sobe na 3001 porque a 3000 está com outro
projeto; o outro projeto fecha; o segundo clique pergunta só na 3000, acha livre, e sobe
**um segundo sistema** ao lado do primeiro. Por isso a procura do "já está rodando" varre
a faixa inteira — e foi testado exatamente nessa ordem.

### 🔀 Três perguntas por porta, porque "livre" não é "ninguém respondeu HTTP"

1. **Conexão em `127.0.0.1`.** Quem atende é nosso ou de outro, pelo `<head>`; quem atende
   e não fala HTTP é de outro.
2. **Conexão em `::1`.** O navegador abre `localhost`, que no Windows tenta o IPv6
   primeiro, e servidor de desenvolvimento que escuta em `localhost` costuma ficar só ali.
   Subir na mesma porta levaria o navegador ao outro projeto, e não a este.
3. **Abrir e fechar um servidor na porta.** Porta reservada pelo Windows (Hyper-V e WSL
   reservam faixas inteiras) ou presa sem ninguém atendendo recusa conexão e, mesmo
   assim, não aceita servidor. Sem esta pergunta, o `next start` cairia com `EADDRINUSE`.

As vinte portas são perguntadas em paralelo: porta livre responde em milissegundos, e só
programa que aceita conexão e fica mudo gasta o tempo-limite — uma vez, e não uma por
porta.

### 🔀 A porta é escolhida no passo 7, e não no 2

No passo 2 a varredura só procura o sistema já rodando. A escolha fica para logo antes de
subir o servidor, porque entre um passo e outro podem passar minutos de instalação e
montagem — tempo de sobra para outro programa ocupar a porta escolhida cedo demais.

### ⚠️ Porta que muda é endereço que muda

O navegador guarda dados por endereço, e a porta faz parte dele. A fila de leituras sem
rede do leitor fica no IndexedDB: o que ficou nela sem sincronizar com o sistema na 3001
não aparece quando ele sobe na 3000. Não se perde — reaparece quando o endereço volta —,
mas some da vista. No computador é raro, porque com o sistema de pé a fila descarrega na
hora. Para quem roda vários projetos, a saída é fixar uma porta só deste no `.env`, e o
README diz isso.

### ❓ Testado em Linux; o IPv6 não

Sete cenários: outro programa HTTP na 3000 (sobe na 3001, com aviso); segundo clique com
a 3000 ocupada (acha na 3001, 0,33 s); segundo clique com a 3000 já vaga (acha na 3001 e
não sobe outro, 0,23 s); programa mudo na 3000; porta presa sem ninguém atendendo, na
4000 (pula para a 4001 pela terceira pergunta); as vinte ocupadas (erro com nome, código
1); e nada ocupado (3000, sem aviso). A segunda pergunta não foi exercitada: este
contêiner não tem IPv6.

### 🐛 Armadilha de teste: `$!` depois de `a && b &`

`cd pasta && nohup python3 -m http.server 3000 &` põe **a lista inteira** em segundo
plano, num subshell, e o `$!` é o PID do subshell — matá-lo deixa o Python de pé,
atendendo na porta. O teste "a 3000 vagou" rodou com a 3000 ainda ocupada até isso
aparecer. O processo a derrubar se acha pelo comando no `ps`, e não pelo `$!` de uma
lista.

---

## 2026-09-23 — O atalho abria e fechava sem fazer nada

Relato do dono, no primeiro clique no Windows: "abre o terminal e fecha e não acontece
nada". Nenhuma mensagem, nenhum arquivo — o pior tipo de defeito para consertar de longe.

### 🐛 Acento dentro de bloco `if` depois de `chcp 65001`

A causa provável estava no próprio `.bat`. A primeira versão fazia `chcp 65001`, para os
acentos saírem certos, e logo depois um bloco `if errorlevel 1 ( ... )` com cinco linhas
de `echo` acentuadas. O `cmd.exe` lê o bloco inteiro antes de avaliar a condição, e com a
página de código em UTF-8 ele tem um defeito conhecido na leitura de arquivo de lote com
caractere de vários bytes — morre ali, **com o Node instalado ou não**, antes da linha que
chama o lançador.

A entrada abaixo listava "acento sem `chcp` vira lixo" como motivo para pôr a lógica em
Node, e o remédio escolhido para o acento foi o que derrubou o arquivo. Agora o `.bat` é
só ASCII, sem `chcp`, sem bloco e sem rótulo. Todo texto com acento é escrito pelo Node,
que no console do Windows escreve em UTF-16 e não depende da página de código.

### 🔀 A janela sempre espera uma tecla

O defeito de desenho que transformou um erro num mistério: a janela só pausava quando o
Node devolvia erro, então a morte do próprio `cmd` fechava tudo sem uma linha na tela.
Agora o `pause` é incondicional. O custo é o segundo clique, que só abre o navegador,
deixar uma janela esperando tecla — aceito, porque janela que fecha sozinha foi o que
tornou este defeito invisível.

### 🔀 Tudo o que aparece na janela vai para `Atalhos/iniciar.log`

O atalho roda numa máquina que quem mantém o sistema não vê, e "o que apareceu na tela?"
não tem resposta depois que a janela fecha. O registro é refeito a cada clique, com data,
versão do Node, sistema e pasta no cabeçalho. A saída de cada programa chamado — `npm ci`,
montagem, migração — é repassada linha a linha em vez de herdar o terminal, que é como ela
entra no arquivo. A URL do banco nunca é impressa, e foi conferido nos registros dos
testes que a senha não aparece.

### 🐛 Três defeitos de primeiro clique que o teste em Linux não mostrava

- **Node antigo recebia um SyntaxError, e não a frase do passo 1.** Com
  `import { parseEnv }`, um Node sem `parseEnv` falha na ligação do módulo, antes da
  primeira linha rodar — a verificação de versão, escrita justamente para esse caso, nunca
  chegava a rodar. O import do módulo inteiro (`import * as util`) não tem esse problema.
- **`.env` com BOM escondia a primeira variável.** O Bloco de Notas salva "UTF-8 com BOM",
  e `process.loadEnvFile` **não remove o BOM**: a primeira chave ganha um caractere
  invisível no nome, e o sistema diz que falta a `DATABASE_URL` com ela escrita ali. A
  leitura agora tira o BOM, avisa, e usa `util.parseEnv`.
- **`PORT` no `.env` era ignorada.** A porta era lida ao carregar o script, antes do
  `.env` — e a mensagem de porta ocupada mandava justamente trocar `PORT` no `.env`.

E um de desenho: a falha com servidor e fila já de pé (servidor que não responde em dois
minutos) saía sem derrubá-los, e a porta ficava presa para o próximo clique. `falhar`
agora sai por `encerrar`.

### 🐛 Projeto baixado como ZIP não instalava

O `prepare` do `package.json` rodava `git config core.hooksPath .githooks` direto, e fora
de um clone isso sai com erro: `fatal: not in a git directory`, saída 128, reproduzido. O
`npm ci` falhava junto, e o atalho parava nas dependências. O lançador já previa o ZIP —
sem git, usa a montagem que existe —, mas o `prepare` não. `scripts/instalar-hooks.mjs`
liga os hooks quando há clone e git, e só avisa quando não há.

### 🔀 Servidor em `127.0.0.1`, e não em todas as interfaces

Sem login (pendência 3.3), escutar em todas as interfaces deixava o sistema aberto para
qualquer aparelho da rede, e fazia o Firewall do Windows perguntar no primeiro arranque se
o Node pode receber conexão — uma janela que ninguém sabe responder. O lançador também
pergunta "já estou rodando?" em `127.0.0.1`, e não em `localhost`, que no Windows resolve
primeiro para o IPv6, onde o servidor não está.

### 🧹 O `engines` dizia 22.0, e os scripts do npm pedem 22.9

`db:migrate`, `db:seed` e `poller` usam `--env-file-if-exists`, que só existe a partir do
Node 22.9 — conferido na documentação do Node. O `engines` passou a dizer 22.9. O lançador
não usa a flag, porque os filhos herdam o ambiente dele, e continua pedindo só o 22.

### 🐛 A URL do painel do Neon, colada à mão, derrubava a migração

Achado ao escrever a instrução para o dono: "sem Docker, troque a `DATABASE_URL` do `.env`
pela URL do Neon". O painel do Neon entrega a string com `channel_binding=require`, e o
`postgres.js` manda ao servidor, como parâmetro de inicialização, todo parâmetro da URL
que ele não conhece (`parseOptions`, 3.4.9). O Postgres recusa:
`unrecognized configuration parameter "channel_binding"`. Reproduzido com a migração de
verdade contra o banco local — falha com a URL como vem do painel, passa com a correção.

O `preparar:env` já tirava o parâmetro, mas só da URL que passa por ele, e o caminho do
atalho é colar no `.env`. Agora `criarBancoCom`, por onde toda conexão passa, tira também
(`urlParaODriver`). E a limpeza do `preparar:env` tinha defeito próprio: a expressão
regular levava o `?` junto quando o parâmetro vinha primeiro, e
`banco?channel_binding=require&sslmode=require` virava `banco&sslmode=require` — o
`sslmode` passava a fazer parte do nome do banco. As duas limpezas agora são por nome de
parâmetro, com a mesma regra, repetida porque o `preparar:env` roda antes do
`npm install` e não pode importar TypeScript.

### ❓ Continua sem teste no Windows

Testado em Linux: `.env` com BOM, `PORT=3001` no `.env` com `npm ci` de verdade no
caminho, porta inválida, porta ocupada, segundo clique (0,17 s) e desligamento sem
processo sobrando. O `.bat` só roda no Windows, e a causa acima é **a provável, não a
confirmada** — não houve Windows onde reproduzir. O que mudou é que, se falhar de novo, a
janela fica aberta e o registro existe: o próximo relato vem com a mensagem.

---

## 2026-09-23 — Um clique para subir tudo, e o que o lançador decide sozinho

O dono pediu um `.bat` que subisse tudo no `localhost` a cada clique. Ficou
`Atalhos/Iniciar.bat`, com dez linhas úteis, chamando `scripts/iniciar.mjs`, que faz o
trabalho.

### 🔀 A lógica em Node, e não em batch

Batch quebra por detalhe invisível: quebra de linha LF faz `goto` errar o rótulo, acento
sem `chcp 65001` vira lixo, e um `)` dentro de `echo` num bloco `if (...)` fecha o bloco no
meio. O `.bat` ficou só com o que não dá para fazer em Node — conferir que o Node existe
— e é gravado **sem BOM e em CRLF**, com `.gitattributes` garantindo CRLF no checkout de
qualquer máquina, porque o CI roda em Linux e nunca veria o defeito.

O `.mjs` roda **sem dependência nenhuma**: ele roda antes do `npm install`, que é uma das
coisas que ele faz. Por isso não é `.ts` — `tsx` é dependência de desenvolvimento.

### 🔀 Versão de uso, e não de desenvolvimento

`next start`, montado por `next build` só quando o commit mudou. O `next dev` compila cada
tela na primeira visita — medimos 34 segundos para abrir um produto —, e para quem só
quer usar o sistema isso é defeito. Resultado medido: **3,4 segundos do clique ao "Pronto"**
no uso diário.

### 🔀 Migração a cada arranque

`db:migrate` e `db:seed` são idempotentes e rodam em segundos, então rodam sempre. É o fim
de "depois do `git pull`, rode `db:migrate`" — a instrução que eu mais repeti neste
projeto, e a mais fácil de esquecer.

### 🐛 A primeira versão reinstalava dependência sem precisar

Comparava o **horário** do `package-lock.json` com o da instalação. O git dá ao arquivo o
horário do checkout, e checkout sem mudança de dependência também conta — o teste de
primeiro arranque gastou 31 segundos de `npm ci` a troco de nada. Agora compara o
**conteúdo** (sha256 gravado em `node_modules/lockfile-instalado.txt`), que é o que
realmente importa.

### 🐛 `pgrep -f` e `pkill -f` casam com a linha de comando de quem procura

Duas vezes no mesmo teste: `pgrep -f "node scripts/iniciar.mjs"` achou o **meu próprio
shell**, cuja linha de comando continha o texto procurado, e o `kill` derrubou o shell em
vez do lançador. Depois `pkill -f "http.server 3000"` repetiu a dose.

O agravante: o lançador troca o próprio título (`process.title`, para a janela do Windows
mostrar o nome do sistema), e no Linux isso **reescreve a linha de comando** — então o
lançador nem aparece na busca pelo nome do script. O `next start` faz o mesmo e vira
`next-server (v16.3.5)`. Achar processo por título, e nunca por texto que também está no
comando de quem procura.

### ❓ O que não deu para testar daqui

Sete cenários passaram em Linux: primeiro arranque do zero, segundo clique com tudo
rodando (0,16 s, só abre o navegador), desligamento derrubando servidor e fila juntos,
arranque diário, porta ocupada por outro programa, e banco local desligado sem Docker.
**O `.bat` em si, a abertura automática do Docker Desktop e o `explorer.exe` abrindo o
navegador só existem no Windows**, e não foram executados. Os bytes do `.bat` foram
conferidos (sem BOM, CRLF em todas as linhas); o comportamento, não.

### ⚠️ Hospedar exige login antes

Anotado na pendência 3.3, que listava o que falta para sair do laptop e esquecia o mais
grave: **não há autenticação**. Em `localhost` é correto; num endereço público, quem tiver
a URL vê e altera custo, margem e pedido.

---

## 2026-09-16 — O desenho novo, e três armadilhas de layout no caminho

Piloto do front-end novo: casca com lateral agrupada e tela inicial organizada por
gravidade. O que veio de cada referência e o que foi recusado está no cabeçalho de
`inicio.module.css` e de `casca.module.css` — aqui ficam as armadilhas.

### 🐛 `max-width` no flex ignora `flex-basis: 100%` — terceira vez

O cabeçalho da tela tinha título, hora e resumo num `flex-wrap`, com `flex-basis: 100%`
no resumo para ele cair na linha de baixo. Não caiu: o flex decide a quebra pelo tamanho
**hipotético** do item, que é o `flex-basis` limitado pelo `min/max-width` — e o
`max-width: var(--medida-texto)` do resumo o reduzia o bastante para caber ao lado do
título.

É a terceira aparição da mesma armadilha em um dia: a primeira foi a ajuda do quadro de
atributos no catálogo, a segunda a frase de ajuda do seletor de ficha. Nas duas primeiras
resolvi com `max-width: none`; aqui, com dois contêineres — uma linha para título e hora,
o parágrafo fora dela. Dois contêineres é a solução que não depende de adivinhar o
tamanho hipotético, e devia ter sido a primeira das três.

### 🐛 Faixa rolável horizontal na lateral estourava a página

No telefone a lateral com quinze portas titutadas ocupava 430px de uma tela de 844px.
Troquei por uma faixa rolável horizontal — e a página ganhou rolagem horizontal: o `nav`
media 390px, `scrollWidth` 1552, e o documento 1251px.

`min-width: 0` na faixa, `min-width: 0` na coluna de grid, `overflow-x: clip` no `html` e
no `body`: nenhum conteve. Desisti da forma e troquei a solução — título do grupo **na
mesma linha** das portas dele, quatro linhas em vez de oito, sem eixo X para estourar.
Menos bonito que a faixa rolável; correto.

Fica anotado como regra: **scroller horizontal dentro de coluna de grid é para evitar.**
As pílulas de momento, que rolam dentro do `main`, funcionam — a diferença é o `main` ter
`min-width: 0` herdado da coluna de conteúdo, e não ser ele mesmo a coluna.

### 🐛 O medidor de rolagem horizontal que eu usei o dia todo dá falso positivo

`document.documentElement.scrollWidth > window.innerWidth` conta o conteúdo de scrollers
internos, e `window.scrollTo(500, 0)` não é limitado em Chromium headless: as duas
medidas dizem "estourou" numa página que não estoura.

A medida honesta é a **largura do print de página inteira**: 780px numa janela de 390
significa que não estoura; 2502px significa que estoura. No meio da investigação eu
cheguei a concluir que era falso positivo e estava errado — o print provou o estouro. Foi
o print que decidiu as duas vezes, e é o que vale.

### 🔀 A lateral tornou o índice de telas redundante

O índice com descrição de cada tela nasceu quando a navegação era uma barra de pílulas
curtas, e a descrição não existia em nenhum outro lugar. Com a lateral agrupada, o índice
passou a repetir os mesmos quinze nomes nos mesmos quatro grupos, logo abaixo deles.

Recolhido em `details` fechado, porque o que ele ainda tem de próprio — a descrição —
ensina, e quem está aprendendo abre. A página caiu de 2768px para 1900px de altura em
1440px de largura.

### 🧹 Duas camadas para a lateral pintar até o fim

`position: sticky` com `height: 100dvh` pinta a lateral só até a altura da janela, e o
resto da coluna fica com a cor do corpo — numa página de 2700px isso é um corte
horizontal atravessando a lateral no meio. Agora a coluna pinta o fundo e a lateral
**dentro** dela é que é grudada.

---

## 2026-09-16 — Uma coluna que a consulta lia e ninguém escrevia

Terceiro caso do mesmo tipo em um dia. A lista de diferenças de repasse em `/postagem`
filtra por `repasse_conferido_em is null`, e **nada escrevia essa coluna**. Então a
diferença que a pessoa investigou no extrato da plataforma voltava na tela no dia
seguinte, e no seguinte, para sempre.

### 🐛 Lista que só cresce é lista que ninguém lê

O defeito não dá erro e não aparece em teste: a consulta está certa, a conta está certa,
e a tela mostra a verdade. O que quebra é o **uso** — a seção cresce a cada importação,
nunca encolhe, e em dois meses a pessoa para de olhar.

É exatamente o estrago que o próprio projeto já tinha nomeado do outro lado: o piso de
3% do monitor existe porque "avisar de mudança pequena treina a pessoa a ignorar o
painel". Aqui era a mesma coisa, entrando por outra porta — não pelo alerta pequeno, mas
pelo alerta que não sai.

Vale como pergunta de revisão: **toda coluna que uma consulta usa como filtro tem quem
a escreva?** As três de hoje foram uma coluna que não existia (voltagem), uma que existia
e não era lida (categoria regulada), e uma que era lida e não era escrita. O compilador
não pega nenhuma das três.

### 🔀 Conferir tem volta, e não é comodidade

Primeira versão era só a marca. Percebi olhando a tela: a linha desaparece, e o número
que desapareceu é dinheiro que a plataforma não explicou. Um clique errado esconderia
uma taxa não prevista e **nada na tela diria que ela existiu** — não há como procurar o
que não se sabe que foi escondido.

As conferidas ficam em `details` recolhido, com "Voltar para a lista" em cada uma. É a
mesma regra de `desligarProdutoExterno`, que existe desde a fase 5: decisão humana sobre
dado se desfaz por construção, não por restauração de backup. Limitada a vinte de
propósito — existe para desfazer engano, que se percebe na hora, e não para virar
histórico de conferência.

### 🧹 Editar por heredoc depois do prettier, de novo

Duas vezes hoje o `assert` do script falhou porque o prettier havia reunido uma
assinatura de função em uma linha só depois da minha edição anterior, e o `antigo` do
script ainda tinha a versão em três linhas. O script não escreve nada quando o `assert`
falha, então não houve estrago — mas custou duas idas.

O hábito que resolve: quando a edição anterior passou pelo prettier, ler o trecho atual
antes de casar texto contra ele.

---

## 2026-09-16 — A tela de catálogo destravou duas pendências no mesmo dia

A 3.5 esperava a 3.1 desde a fase 6, e o texto dela dizia por quê: seletor de ficha e
download "entram junto com a tela de catálogo, que é onde escolher um produto vai fazer
sentido". A tela de catálogo nasceu de manhã; à tarde a 3.5 fechou.

### 🔀 Trocar de ficha em silêncio seria pior que recusar

A decisão que eu quase tomei pelo caminho fácil: `?sku=` com id que não é do perfil cai
no produto de abertura, e pronto. A tela abriria, ninguém veria erro, e alguém acabaria
respondendo a um comprador com a ficha de outra peça — o erro que esta tela existe
inteira para evitar.

Recusa com aviso, então, e o aviso diz **que a ficha abaixo é de outro produto**, não só
que deu erro. A resposta também não conta se o produto existe em outro perfil: id de
outro dono recebe a mesma frase que id inexistente.

### 🐛 O seletor apagava a pergunta digitada

Achado na tela, não no teste: `GET` em dois formulários irmãos, cada um mandando só os
seus campos. Trocar de produto perdia a pergunta do comprador, e perguntar mantinha o
produto errado. Os dois passaram a carregar o campo do outro escondido — `sku` no
formulário da pergunta, `p` no do seletor.

### 🔀 "2 linhas" no seletor era ambíguo

Primeira versão do rótulo dizia "Refil PA21G — 2 linhas", e a ficha logo abaixo mostrava
uma linha publicável e uma retida. Duas contagens diferentes com a mesma palavra na mesma
tela. Virou "2 linhas registradas", que é o que o número é.

---

## 2026-09-16 — O "(s)" saiu, e levou seis frases erradas com ele

Dezoito frases em treze módulos conjugavam plural com parêntese: "7 unidade(s)", "1
item(ns)", "3 observação(ões)". Fechada a pendência do `(s)`, que estava aberta desde
que a tela de afiliados mostrou o primeiro.

### 🐛 "A última conferência foi há 0 dia(s)"

O pior dos seis. Zero dia não é um intervalo: é hoje. A frase pedia conferência de um
estoque conferido nesta manhã, e dizia "há 0 dia(s)" — que passa por desleixo de
conjugação quando é erro de conteúdo. Zero tem frase própria agora.

É o mesmo defeito que a tela de afiliados achou em "a última saiu há 0 minuto(s)", em
outro módulo. Duas vezes o mesmo erro embaixo do mesmo parêntese é o argumento de que o
parêntese não é economia de escrita, é esconderijo.

### 🐛 Conjugar o substantivo e não o verbo troca um erro por outro

Em oito frases o número também manda no verbo, e o `(s)` cobria as duas pontas:

- "falta(m) 2 número(s)" → `falta 1 número` / `faltam 2 números`
- "1 leitura(s) não subiram" → `1 leitura não subiu`
- "Falta 1 item(ns) que só ranqueiam pior ou ajudam a achar" → `que só ranqueia pior ou
  ajuda a achar`
- "1 unidade(s) em consignação estão anunciadas" → `está anunciada`
- "1 modelo(s) não couberam" → `1 modelo não coube`
- "há 1 observação(ões), mas todas com mais de 30 dias" → `mas ela tem mais de`

Trocar só o substantivo deixaria "1 leitura não subiram", que é pior que o parêntese
porque tem cara de frase acabada. Cada uma ganhou o par certo e um **teste do caso
singular** — que é o caso que ninguém exercita, porque o teste é escrito com o exemplo
de três itens.

### 🧹 Três cópias da mesma função de plural

`contar` em `inicio/apresentacao.ts`, o fecho `plural` em `importar/apresentacao.ts`, e
dois ternários inline em `monitor` e `perguntas`. Todas eram `contagem` de `lib/texto`
escrita de novo — e `contagem` existe justamente porque a segunda cópia apareceu. Foram
para a função compartilhada.

Fica anotado como padrão: **função de texto nasce duplicada**. Quando aparecer a terceira
frase com a mesma forma, a busca é por `${String(` perto de um ternário.

---

## 2026-09-16 — Três atributos que o checklist cobrava e ninguém podia preencher

O checklist de atributos (8.3) cobra `voltagem`, `medida` e `quantidade_embalagem` no
nível `devolucao` — o mesmo peso de `bloqueia`, porque um é anúncio que não existe e o
outro é anúncio que existe e perde dinheiro com a reputação junto. Nenhum dos três tinha
onde ser preenchido. Era meio checklist: apontava o problema e não tinha o conserto.

Migração 0010 dá coluna aos três em `sku`, a ficha do catálogo ganha os campos, e a
montagem de anúncio passa a ler dali.

### 🔀 Texto livre em voltagem e medida, e não enum

Voltagem parece candidata óbvia a enum de dois valores, e não é: as respostas certas na
prática são quatro — 110 V, 220 V, bivolt, e "vendo os dois modelos, um de cada". Um enum
de dois forçaria a errar no bivolt, que é justamente o caso em que o comprador pergunta.

Medida é a medida **funcional** da peça, a que decide se encaixa, e a unidade é parte da
resposta: "1/2 polegada" e "52 mm de diâmetro" estão as duas certas, e normalizar as duas
para milímetros perderia a primeira. Não confundir com `dim_mm`, que é a caixa e serve ao
frete — a tela diz isso no campo, porque as duas se chamam "medida" em português.

### 🐛 O alerta de categoria regulada nunca disparou

Achado de tabela: procurando de onde `voltagem` chegava à conferência, apareceu que
`categoria_regulada` **tem** coluna desde a fase 9, **é** preenchida pela tela fiscal, e
nunca chegava a `montarAnuncio` — nenhuma das duas chamadas passava o campo. Então
`avaliarRegulacao` decidia sempre sobre `null`.

O alerta existe para evitar anúncio **cancelado** em categoria de órgão regulador, que é
a consequência mais cara do M12. Ele estava calculado, testado e desligado. Duas linhas
em cada chamada.

Vale como padrão, e é o segundo do tipo no projeto (o primeiro foi o monitor, que não
tinha quem escrevesse nele): **função de domínio com parâmetro opcional é um lugar onde o
compilador não ajuda**. `categoriaRegulada?: string | null` compila com a chamada que a
esquece, e o valor ausente virou `null` — que é exatamente o que "não é categoria
regulada" significa. Faltar e não haver ficam indistinguíveis.

### 🔀 O cadastro vence a extração, mesma regra da marca

`quantidade_embalagem` vinha do registro extraído das ocorrências, e agora prefere a
coluna: o número do cadastro é de quem tem a caixa na mão, o do registro é o que um LLM
leu de anúncio de terceiro. Sem cadastro, continua caindo no extraído — a via antiga não
foi jogada fora, foi despromovida.

### 🐛 `git commit -- caminho` não vê arquivo novo

O commit do schema saiu com o `_journal.json` alterado e **sem o `.sql` da migração**:
`git commit -- <caminho>` commita o que está rastreado e casa com o caminho, e ignora o
que é novo em silêncio. Uma migração pela metade no histórico é pior que nenhuma — quem
rodar `db:migrate` recebe um journal que aponta para um arquivo que não existe.

Conserto foi `git add` dos dois arquivos e `--amend`. O que fica: `git status --short`
depois de commitar, sempre, e não só antes.

### 🧹 Frase de ajuda do quadro precisou de `max-width: none`

A frase que explica os três campos ficava ao lado do último deles, parecendo ser dele. O
`flex-basis: 100%` não quebrava a linha porque o flex decide a quebra pelo tamanho
**hipotético** do item, que o `max-width` da `.ajuda` reduzia o bastante para caber no
espaço que restava. Com `max-width: none` a linha é própria, e em troca a frase encurtou
— porque agora ela ocupa a largura do quadro.

---

## 2026-09-16 — O motor de margem ganhou tela, e a tela achou quatro coisas

A fase 1 tem oito entregas prontas e teste em cada degrau de comissão **desde o começo
do projeto**, e usar ela exigia escrever código: não havia onde informar custo. A
pendência 3.1 registrava isso com a frase que resume o problema — "usar o M8 hoje exige
escrever código". Agora `/catalogo` existe.

### 🐛 Pedir 25% de margem virava 0,25%

O campo do formulário manda **percentual** ("25"), e `lerParametros` lia o parâmetro
como **ponto-base**. Então pedir 25% pedia 0,25%, e a tela respondia "o preço mínimo é
R$ 30,66" — um número plausível, com cara de resposta certa, para uma pergunta que
ninguém fez.

Só apareceu exercitando a tela no navegador: o teste de `lerParametros` que eu tinha
escrito **fixava a unidade errada** (`alvo: '3000'` → 3000 bp), porque foi escrito
olhando a função e não o formulário. Ida e volta agora passam pelas mesmas duas funções
(`alvoEmPercentual` e `lerAlvo`), e o teste conferindo o par.

Lição que vale mais que o conserto: **teste de leitura de parâmetro tem de usar o valor
que o formulário manda de verdade**, e não o que a função aceita.

### 🐛 `type="number"` não aceita vírgula, e 2,5% é como se escreve

O campo de devolução era `type="number"`. Digitar "2,5" nele não produz 2,5 — produz
**nada**, sem aviso, porque o navegador recusa a vírgula. O Playwright foi mais explícito
que o navegador: `Cannot type text into input[type=number]`.

Todo campo numérico da tela virou `type="text"` com `inputMode`, que é o que o resto do
sistema já fazia nos campos de dinheiro. O `inputMode` dá o teclado numérico no celular
do mesmo jeito, e a leitura no servidor já trocava vírgula por ponto.

### 🐛 Código de barras torto respondia "peso em gramas é positivo"

A ação de criar produto reaproveitava o código de aviso da ficha. Resultado: quem
digitava um EAN com dígito verificador errado recebia, na lista, "Número que não fecha.
Peso em gramas e medida em milímetros são positivos" — texto correto para outra coisa.

Virou código próprio, com a mensagem do motivo: o nome precisa de três caracteres, e o
código de barras é conferido pelo dígito verificador — e código interno de fornecedor não
é código de barras, tem campo próprio. Reaproveitar código de aviso economiza uma linha
e custa a confiança na tela.

### 🐛 Rótulo de linha em caixa alta

A camada compartilhada põe `text-transform: uppercase` em `th`, que é certo para
cabeçalho de coluna. Numa conta de nove linhas com `th scope="row"`, o resultado é
"COMISSÃO DA PLATAFORMA" gritando em cada linha. Classe própria na tela, e não uma regra
`.tabela th` contando com a ordem em que os dois módulos entram na página.

### 🔀 A ponte declara o que presumiu

`entradaParaMargem` devolve `presumidos` junto com a entrada do M8. É o que permite a
tela dizer "esta margem usou peso de 300 g porque o seu não está cadastrado" — presunção
que não aparece na tela é a forma mais barata de perder dinheiro com confiança.

Custo ausente é caso separado: entra **zero**, e o M8 avisa que a margem é o teto. Presumir
custo erraria para o lado otimista, que é o pior lado.

As três presunções (peso, embalagem, devolução) saíram de `app/leitor/constantes.ts` para
o domínio na segunda tela que precisou delas. `ROTULO_DA_PLATAFORMA` saiu de duas telas
para `ui/rotulos.ts` na terceira. Terceira e quarta aplicação da mesma regra esta semana:
**unificar na segunda cópia, antes de divergirem**.

### 🔀 Custo tem formulário próprio, e o motivo é a data

`atualizarCusto` grava `custo_atualizado_em`; `atualizarFicha` não toca nele. Se fossem o
mesmo salvamento, informar o peso reescreveria a data do custo — e a data do custo é
justamente o que responde se ele ainda vale. `custoDefasado` usa isso, com trinta dias de
frescor, que é o ciclo de tabela de fornecedor.

### ⚠️ Quarta armadilha de arnês de teste em dois dias

Duas de uma vez, no mesmo script: `waitForURL(/\?r=/)` casa na hora quando a URL **já**
tem `?r=` da ação anterior, e `waitForSelector('h1')` casa no `h1` da página velha — a
lista e o detalhe têm os dois um `h1`. O efeito foi eu ler a página anterior e concluir
que a ação não tinha funcionado.

O que espera de fato é `waitForNavigation({ waitUntil: 'domcontentloaded' })` em
`Promise.all` com o clique. Junto com o `caret-color` e o `open=""` de ontem, são quatro
ocorrências da mesma família: o arnês mentindo sobre a aplicação. A regra continua a
mesma — **confirmar por um segundo caminho antes de caçar**.

---

## 2026-09-16 — O prospector passou a investigar, e o dossiê não era retomável

### 🐛 O dossiê prometia ser retomável desde a fase 1, e não era

A tabela `dossie` existe "para que uma execução interrompida seja retomável". Escrever
o executor mostrou que ela não dava conta: `paraGravar` guardava da fronteira só
`{alvo, familia}` — "o que interessa a quem lê" — e não guardava `investigados` nem
`passosSemAchado`.

O que se perdia numa retomada: a **ferramenta** de cada item (sem ela não dá para saber
o que roda hoje), o **peso e o custo** (sem eles a ordem da fila muda, e ordem instável
torna a auditoria sem valor), quais itens **já foram** investigados (re-investigar é
pagar o passo duas vezes) e o contador de **saturação** (três passos de investigação
sabidamente infrutífera por retomada).

Agora a fronteira gravada é a inteira, e quem lê a tela usa `fronteiraRestante`. O mesmo
caso do `alvo` de ontem: **armazenamento moldado para um leitor perde o que o outro
precisa** — e o outro leitor, aqui, era o próprio sistema.

Linha gravada no formato antigo é reparada na leitura, com Zod, em vez de por migração:
o valor base de cada família mora no domínio, e escrevê-lo num `UPDATE ... jsonb` seria
a mesma constante em dois lugares.

### 🐛 Item de fronteira ficava preso na rota de uma ferramenta que não existe

Os três dossiês de ontem tinham sido abertos sem executor. Ao rodar o primeiro job, o
resultado foi `fronteira_vazia` com zero passos: cada item apontava para a busca na web,
e a única ferramenta registrada é a base local.

O conserto é `rerotearFronteira`, e ele não é remendo de dado velho — é a regra certa:
a **família** declara várias ferramentas (`em_que_mais_serve` aceita busca na web,
leitura de página e base local), e um item encaminhado ontem para uma delas não deve
ficar parado hoje por causa disso. Reencaminha só o item de **abertura**, que é o que tem
`id` igual ao nome da família; item ramificado tem rota própria — alvo que é URL precisa
de leitor de página, e trocar para busca na web seria buscar o endereço que já está na
mão.

Efeito colateral bom: registrar um investigador novo destrava o que já estava na fila,
sem tocar em dossiê nenhum.

### 🔀 "Disponível" é ter investigador, e não ter configuração

A primeira versão de `ferramentas.ts` declarava o estado de cada ferramenta e derivava a
visão da chave de LLM no ambiente. Estava errado do jeito que engana: a tela dizia
"falta chave" para a visão, o que **implica que pôr a chave a faria rodar** — e não
faria, porque ninguém a chama.

Agora a fonte da verdade é o registro de investigadores, e `ferramentas.ts` só guarda o
texto: o que cada ferramenta faz e o que falta para ela existir. Uma lista, duas
derivações (o conjunto e as instâncias), porque a constante escrita à mão ao lado da
fábrica é a constante que diverge na primeira ferramenta nova.

### 🐛 "Dá para continuar de onde parou" ao lado de "aumentar o teto não resolve"

Segunda ocorrência da mesma frase contradizendo a vizinha. Ontem foi ao lado de "parou
por saturação"; hoje, num dossiê com seis achados que parou por falta de ferramenta:
"6 hipóteses em aberto — dá para continuar de onde parou. Aumentar o teto não resolve;
ligar uma ferramenta resolve."

A cláusula agora depende do motivo: continuar resolve **teto**, e não resolve saturação
nem fronteira vazia. Vale registrar o padrão: uma frase montada por concatenação de
cláusulas independentes é uma frase que ninguém leu inteira — e o teste unitário que
confere `toContain` de um pedaço não lê inteira também.

### 🐛 O mesmo refil em outra loja contava como "outra peça"

O investigador de base local comparava o **título normalizado** para decidir se um
anúncio era de outra peça. "Refil de purificador de agua PA21G PA26G original
Electrolux" é título diferente de "Refil de purificador de água PA21G" — e a mesma peça.

Agora compara a **peça**: a primeira palavra do título que não é ligação nem código de
modelo. Refil contra refil é a mesma peça; vedação e torneira são outras. A comparação é
de primeira palavra e não de conjunto porque anúncio é escrito curto: exigir que ele
repita todas as palavras do alvo faria "Refil PA 21 G compatível" passar por peça
diferente.

Acidente útil: quando o alvo é o **aparelho** em vez da peça, a regra continua certa — a
primeira palavra do aparelho não é a primeira palavra de nenhuma peça dele.

### 🔀 Achado repetido não conta duas vezes, e não zera a saturação

Id de achado determinístico (`em_que_mais_serve:PA26G`) é o certo: um passo repetido pela
fila não pode duplicar o achado. Mas aí `aplicarInvestigacao` precisava deduplicar — e,
junto, deixar de zerar o contador de saturação quando o passo devolveu só o que já se
sabia. Repetir o conhecido não é progresso, e é disso que a saturação trata.

### 🔀 Evidência direta confirma a hipótese; citação não

O achado de "que outras peças" é o anúncio da peça, que existe e está na mão: confirma a
hipótese. O de "em que mais serve" é um anúncio que citou dois códigos juntos, e **citar
não é servir**: fica como candidato, com a segunda fonte pendente, porque é a ficha do M4
que decide compatibilidade. Confirmar ali seria emprestar certeza que a base local não
tem.

### 🔀 O teto é do dossiê, e não da chamada

`proximoPasso` compara `passosGastos` acumulado com o teto, e a mensagem de parada diz
"dá para continuar com um teto maior". Então o teto pertence ao alvo: continuar é pedir
um teto maior, e a tela mostra gasto contra teto sem que nenhum dos dois minta. O que o
ADR 0005 exige — nenhuma execução sem teto declarado — continua verificado no construtor
de `OrcamentoDaBusca`.

O laço verifica o estouro **antes** de cada passo e não prevê o custo do próximo, então o
último passo pode passar do teto. Só o investigador sabe quanto vai cobrar, e é por isso
que ele recebe o restante no pedido. O teto garante que a execução **para**, não que o
gasto caiba no centavo.

### ⚠️ Terceira armadilha do Playwright em dois dias

`waitForURL(/\?r=/)` casa **na hora** quando a URL já tem `?r=` da ação anterior — então
o teste leu a página velha e reportou que o alvo repetido tinha sido aberto de novo.
Passei um tempo procurando um bug de normalização de chave que não existia.

As três são da mesma família: o arnês de teste mentindo sobre a aplicação. Antes foi o
`caret-color` do `screenshot()` e o `open=""` que eu punha nos `<details>` antes da
hidratação. A regra que sai daí: **confirmar o sintoma por um segundo caminho antes de
caçar** — aqui bastou consultar o banco e chamar `porAlvo` num script.

### 🧹 A varredura da base local lê 2000 linhas e casa código em TypeScript

`ilike '%PA21G%'` perderia `PA 21 G`, que é como metade das fontes escreve, e a gramática
que junta tokens vizinhos vive no domínio. Então a varredura é limitada e o casamento é
feito em memória.

**Custo:** investigação de base local fica O(linhas) e o teto de 2000 corta silenciosamente
o que passar disso.
**Sai quando:** doer — e o conserto é uma coluna de códigos normalizados gravada na
ingestão, com índice, não um `ilike` mais esperto.

---

## 2026-09-15 — A tela do garimpo, e o nome do alvo que o banco estava comendo

### 🐛 A coluna `alvo` do dossiê guardava a chave, e a tela mostrou isso

`chaveDoAlvo` normaliza — sem acento, minúsculas, espaço colapsado — para o upsert por
alvo funcionar: "Refil Purificador PA21G" e "refil purificador pa21g " são o mesmo alvo,
e tratar como dois criaria dois dossiês parciais do mesmo assunto.

O problema é que o repositório gravava **a chave** na coluna `alvo`. Ninguém viu por
duas fases, porque nenhuma tela lia dossiê. Na primeira vez que uma leu, o cartão dizia
"correia de maquina de lavar" para quem ia auditar.

Conserto: `alvo` guarda o que a pessoa escreveu, `alvo_chave` é a identidade, e a chave
ganhou **índice único** — que é a garantia que a verificação de leitura do repositório
não dá, porque duas chamadas simultâneas passam as duas pela verificação. As linhas que
já existiam ficam com o `alvo` sem acento: a grafia original não é recuperável, e está
dito na migração.

A migração é em três passos (coluna nula, backfill, `SET NOT NULL`) porque
`ADD COLUMN ... NOT NULL` sem valor padrão falha em tabela com linha.

### 🐛 O resumo do dossiê convidava a continuar o que tinha terminado

"7 hipóteses em aberto — dá para continuar de onde parou. Parou por saturação: aumentar
o teto não traria mais nada neste alvo." As duas frases no mesmo parágrafo, uma em
seguida da outra. Cada uma estava certa isolada, e juntas se contradizem.

Só apareceu porque a tela mostra a mensagem **inteira** — o teste conferia
`toContain('não traria mais nada')` e não olhava o resto. Agora a cláusula de continuar
some quando o motivo é saturação, e há teste do parágrafo completo.

Mesma família do "0 minuto(s)" de ontem, e a terceira vez que texto de domínio sem tela
se revela errado ao ganhar tela.

### 🔀 `abrirAlvo` entrou no domínio, e não na tela

A fase 10 entregou a máquina e recebia `EstadoDaBusca` montado à mão em teste. Faltava o
começo: dado um alvo, quais hipóteses levantar e o que entra na fronteira.

Isso é **máquina**, não julgamento: as sete famílias são declaradas, o valor de cada uma
também, e a ordenação é valor por custo. O que é julgamento — levantar hipótese nova a
partir do que a página dizia, escolher em quem acreditar quando as fontes discordam — é
do agente, e o agente continua não existindo.

Uma decisão dentro dela: a família entra na fronteira com a primeira ferramenta
**disponível** dela, e não com a primeira declarada. `em_que_mais_serve` aceita
`busca_web`, `ler_pagina` e `base_local`; gravar `busca_web` faria a fronteira recusar um
item que dava para investigar aqui dentro.

### 🔀 Ferramenta declara o que lhe falta, e não só que falta

`estadoDaFerramenta` devolve três estados, e a diferença entre dois deles é a ação:
"falta chave" é uma linha no `.env`, "não existe adaptador" é código para escrever. Um
rótulo único de "indisponível" apagaria exatamente isso.

Hoje o placar é: `base_local` e `visao` dão para usar, e `busca_web`, `ler_pagina`,
`cnpj` e `pncp` não têm adaptador nenhum implementado — mais a rede daqui, que recusa
`pncp.gov.br`. Três das sete perguntas dão para investigar. É declaração, e não sonda:
descobrir no meio do passo que a rede recusa o domínio é justamente o gasto que o teto
existe para impedir.

### 🔀 Reabrir alvo é recusado, porque `salvar` é upsert

Abrir um alvo que já tem dossiê gravaria um plano em branco em cima dos achados —
`salvar` casa por chave e atualiza as três listas. A tela recusa e explica. Não há botão
de investigar, e é por isso: o executor não existe, e botão que não faz nada é pior que
ausência de botão.

### 🐛 "3 perguntas de 7 dá para investigar"

Concordância de verbo no resumo, achada olhando a tela. Uma pergunta "dá"; três
"dão".

### ⚠️ O Playwright inventou o segundo erro de hidratação

Ontem foi o `caret-color` do `screenshot()`. Hoje foi o `open=""` que eu mesmo punha nos
`<details>` antes da hidratação terminar, para o print mostrar o conteúdo. O React
compara e reclama, e o indicador do Next acusa "1 Issue" na aplicação.

Nos dois casos a confirmação é a mesma: visitar a página **sem** tirar print não produz
aviso nenhum de console. O `waitForTimeout` antes de mexer no DOM resolve. Vale a
paciência de confirmar antes de caçar — hidratação falsa custa uma hora.

### 🧹 `(s)` de plural em oito módulos de domínio

`contagem(n, singular, plural)` saiu de `afiliados/publicacao.ts` para `lib/texto.ts` na
segunda cópia, e foi usada no dossiê. Mas o padrão `${n} coisa(s)` continua em
`consignacao/aviso.ts`, `precificacao/fiscal.ts`, `fiscal/repositorio.ts`,
`garimpo/scanner.ts`, `leitor/veredito.ts`, `compatibilidade/resolucao.ts`,
`compatibilidade/gramatica.ts` e `pedidos/fila-do-dia.ts` — e vários desses textos já
aparecem em tela.

**Custo:** o sistema fala como formulário em oito lugares, e o parêntese esconde erro de
verdade (foi o caso do "0 minuto(s)" e do "0 passo(s)").
**Sai quando:** uma passada dedicada, que é tarefa própria — não cabia junto com a tela.

---

## 2026-09-15 — A tela de afiliados, e o que ela achou no texto

### 🔀 A tag de afiliado ficou em ambiente, e não na tabela `credencial`

O ADR 0007 manda credencial de plataforma para a tabela cifrada, e a primeira leitura
foi pôr a tag lá. Mas a tag **não é segredo**: ela aparece na própria URL publicada, em
todo post do grupo, para todo mundo que clicar. Cifrar o que é público custa uma consulta
por página e não protege nada.

Então `AFILIADO_TAG_ML`, `AFILIADO_TAG_SHOPEE` e `AFILIADO_TAG_AMAZON` são variáveis de
ambiente opcionais. O que continua cifrado no banco é token de API, que é segredo de
verdade. A regra que sai daí: **o critério não é "credencial", é "segredo"**.

Ausência é estado normal, não erro (ADR 0002): sem tag, a plataforma simplesmente não
aparece no seletor do formulário, e a tela nomeia a variável que falta. Formulário que
aceita e só depois recusa é pior que formulário que não oferece.

### 🐛 A tela mostrou "A última saiu há 0 minuto(s)"

O texto vinha do domínio, escrito na fase 11, quando nenhuma tela lia essas frases. Duas
coisas erradas numa só: o `(s)` é texto de sistema, e "0 minuto" é **errado** — zero
minuto é "agora mesmo".

Tinha três frases assim (`clique(s)`, `conversão(ões)`, `oferta(s)`), todas no caminho de
`medirDesempenho` e `proximaPublicacao`. Viraram uma função `contagem(n, singular,
plural)` local, com teste que recusa `(s)`.

O que vale registrar: **texto de domínio sem tela não é revisado**. As três frases
passaram por revisão de teste unitário, que verifica `toContain('spam')` e não olha a
frase inteira. A tela é o primeiro leitor que lê tudo.

No mesmo caminho, "conversão" virou "venda" no texto visível — o vocabulário do negócio
é o de quem vende (CLAUDE.md, seção 4), e o painel já dizia "vendas".

### ⚠️ O Playwright inventa um erro de hidratação ao tirar print

A tela nova aparecia com "1 Issue" no indicador do Next, e o log do servidor trazia um
`A tree hydrated but some attributes... didn't match`, apontando `style={{caret-color:
"transparent"}}` em todos os `<input>`.

Não é da aplicação: `page.screenshot()` do Playwright usa `caret: 'hide'` por padrão, e
isso **injeta estilo inline nos campos** antes do print. O React compara e reclama.

Confirmado do jeito certo: com `caret: 'initial'`, nenhuma mensagem nova no log; e a
mesma página visitada sem print não produz nenhum aviso de console. Vale saber porque o
sintoma acusa a aplicação, e o custo de perseguir hidratação falsa é uma hora.

### 🔀 O formulário perdeu o `align-items: flex-end` copiado de outra tela

Dois campos de preço lado a lado, um deles com linha de ajuda embaixo: com alinhamento
no fim, o campo mais baixo puxa o rótulo do vizinho para cima, e o formulário fica
visivelmente torto. A camada compartilhada já alinha no começo — o `flex-end` tinha sido
copiado da tela de perguntas, onde a caixa de colar ocupa a linha inteira e o efeito não
aparece.

Três consertos, todos de olhar a tela e não de teste: a explicação da mediana saiu do
campo e virou linha da seção, o botão ganhou linha própria (campo de altura diferente na
mesma linha do botão desalinha justamente o que se clica), e o campo de preço ganhou teto
de largura — caixa larga promete texto longo, e ali cabem seis caracteres.

### 🧹 Uma fonte monoespaçada, em oito lugares, com duas versões

`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` estava literal em
oito regras de cinco módulos — e **duas cópias já divergiam**: metade tinha `Consolas` e
metade não, o que significa fonte diferente no mesmo sistema no Windows. Ninguém decidiu
isso; é o que acontece com literal repetido, e é o mesmo caso das trinta classes de
estilo de ontem. Virou `--fonte-mono` em `globals.css`.

---

## 2026-09-15 — Duas telas a mais, e o que elas acharam no domínio

### 🔀 A pergunta de comprador passou a ser gravada, e isso mudou o desenho

O detector de pergunta recorrente precisa de **cinco** perguntas parecidas para acusar
o anúncio, e cinco não chegam de uma vez: chegam ao longo de semanas. A primeira versão
da tela ia processar o que estivesse colado na caixa e esquecer — e nesse desenho o
detector praticamente nunca dispararia.

Então entrou tabela: `pergunta_recebida`, com `perfil_id` (pergunta é sobre **o seu**
anúncio) e o **texto cru**. Tema e código de modelo são recalculados na leitura, e não
gravados: a gramática de modelo melhora — melhorou duas vezes na fase 6 e mais uma hoje
—, e pergunta classificada com a gramática velha ficaria errada para sempre.

`anuncio_externo` é texto livre, e não referência: a pergunta vem do painel da
plataforma, com o id da plataforma, e exigir que o anúncio já exista aqui perderia
justamente o dado que ensina o que falta no anúncio.

### 🐛 `vem 1 ou 2 unidades?` produzia o código de modelo `VEM1`

Terceira ocorrência da mesma família: a junção de tokens vizinhos, que existe porque
metade das fontes escreve `PA 21 G` com espaço, volta a inventar código quando o
fragmento do meio é uma **palavra do português**. `110 ou 220` foi a primeira, `de 21 cm`
a segunda, e agora um verbo curto antes de número.

O efeito: a pergunta de quantidade era classificada como compatibilidade, com um modelo
que não existe — e o "o que acrescentar" mandava pôr `VEM1` no título.

A guarda ganhou os verbos curtos que aparecem colados a número em pergunta de comprador
(vem, tem, vai, era, ser, fica…). O que vale registrar não é a lista: é que **o bug só
aparece com texto escrito como as pessoas escrevem**. Os testes da fase 6 usavam títulos
de anúncio; a tela usa pergunta de comprador, e a terceira ocorrência apareceu no
primeiro lote realista que passou por ela.

### 🐛 A lista de palavras do tema estava no singular, e as pessoas escrevem no plural

`unidade` estava na tabela, e a pergunta real era "vem 1 ou 2 **unidades**?". Com
casamento por palavra inteira — que foi o conserto certo do bug do `par` dentro de
"paralelo" — o plural não casa, e a pergunta caía em "outro".

O conserto é um `s?` no fim da fronteira, que é o plural do português na maioria dos
casos. Plural irregular continua entrando na lista à mão: `embalagem` e `embalagens` não
se resolvem com um `s`.

Fica o par de lições, que é o mesmo dos dois lados: **casamento estrito precisa de
morfologia**, e a forma de descobrir qual falta é passar texto de verdade pela função.

### 🐛 Escrever `̀` numa ferramenta que serializa JSON grava o caractere, não o escape

Quinta ocorrência da armadilha que o `verify:fontes` existe para pegar, e a primeira em
que ela apareceu no meio de um regex: eu escrevi a faixa de diacríticos combinantes como
escape, a ferramenta interpretou o escape, e o arquivo recebeu os bytes.

O check pegou na primeira execução, com linha e coluna. E o conserto que evita a
armadilha de vez, em vez de escrever o escape com mais cuidado: usar a **propriedade
Unicode** — `/\p{M}/gu` casa marca combinante, é mais legível que a faixa numérica, e
não tem `\u` nenhum para alguém interpretar no caminho.

## 2026-09-15 — Trinta classes definidas dez vezes, e o que elas diziam de diferente

### 🐛 `.botao` era preenchido em duas telas e de contorno em três

Cada tela nasceu numa fase, com o seu módulo CSS, e as mesmas trinta classes ficaram
definidas de seis a onze vezes. O problema não era a repetição — era o que a repetição
esconde:

- **`.botao`**: preenchido em azul em importar e leitor, de contorno em anúncios,
  consignação e fiscal. O mesmo nome para os dois lados da hierarquia, então a ação
  principal de três telas parecia secundária.
- **`.campo`**: o invólucro de rótulo mais entrada em seis telas, e a **própria
  entrada** em duas.
- **`.botaoNeutro`**: azul preenchido em compatibilidade e fornecedores (onde era a ação
  principal), cinza de contorno em juntar-iguais (onde é "não sei dizer").
- **`.etiqueta`**: verde em duas telas, neutra em quatro.
- **`.cartao`**: raio `0.5rem` em quatro telas, `var(--raio)` (8px) em duas.

Nenhuma dessas diferenças foi decidida. Elas apareceram porque a segunda tela copiou a
primeira e mudou uma linha, e a sexta copiou a quarta.

### 🔀 `composes` em vez de componente compartilhado

A correção podia ser um conjunto de componentes React (`<Botao variante="principal">`).
Ficou em CSS: `ui/comum.module.css` define cada peça uma vez, e o módulo de cada tela
**compõe** dela.

```css
.botao {
  composes: botao from '../ui/comum.module.css';
  align-self: flex-end; /* só o que é desta tela */
}
```

O que decidiu: **o JSX das dez telas não muda**. Continua `estilo.botao`, a definição
passa a viver num lugar, e o que é particular de uma tela continua possível sem
`!important` e sem copiar o bloco para mudar uma linha. Um conjunto de componentes
obrigaria a reescrever cada tela — muito mais risco para o mesmo ganho.

Confirmado no navegador antes de migrar as outras nove: `composes` funciona no
Turbopack desta versão, o elemento sai com as duas classes, e o estilo composto vale.

Saldo: −903 linhas nos módulos das telas, +322 (quase todas linhas de `composes`), e
514 no módulo comum — que agora é onde se muda a aparência do sistema.

### 🔀 Três variantes de botão, e a razão de cada uma existir

- **`.botao`** preenchido, 44px: a ação principal, uma por formulário.
- **`.botaoSecundario`** de contorno, 44px: ação de apoio ao lado da principal.
- **`.botaoMiudo`** de contorno, compacto: dentro de linha de tabela. Não herda o alvo
  de toque de propósito — cem linhas com botão de 44px viram uma tabela de rolagem
  infinita, e esse botão nunca é a ação principal de nada.
- **`.botaoSim` / `.botaoNao` / `.botaoNeutro`**: as três respostas de uma fila de
  revisão, do mesmo tamanho e da mesma forma. Dar destaque a uma delas é empurrar a
  decisão de quem revisa.

### 🐛 O campo de 15px dava zoom no iPhone, e só a tela do leitor sabia disso

A tela do leitor tinha `font-size: 1rem` no campo com um comentário: abaixo de 16px o
Safari do iPhone dá zoom automático ao focar. As outras nove telas usavam `font: inherit`
— 15px do corpo — e tinham o problema sem saber.

O conserto foi mover os 16px para a entrada compartilhada. É o caso que justifica a
unificação inteira: um achado que uma tela tinha, agora todas têm.

### 🧹 Um literal de cor escapou, e a unificação achou

`#fff` no `.botaoSim` da tela de juntar iguais, onde a regra do ADR 0003 pede variável de
tema. Estava lá desde a fase 5 e ninguém viu porque a classe era uma entre dez cópias.
Trocado por `var(--cor-superficie)` ao consolidar.

### 🐛 `pgrep -f` mata o próprio shell — de novo, quatro horas depois de eu registrar isso

Escrevi a entrada sobre `pkill -f` casar a linha de comando do shell que o executa, e
duas horas depois usei `kill $(pgrep -f "next-server")` — mesmo erro, mesma causa, mesmo
código de saída 144.

Registrar não basta quando a forma errada é mais curta que a certa. O jeito que funciona
sem pensar: achar o PID pela porta, `ss -ltnp | grep -o 'pid=[0-9]*'`, que não tem como
casar o próprio comando porque não olha linha de comando nenhuma.

## 2026-09-15 — A tela inicial passou a responder a pergunta de quem abre o sistema

### 🔀 Nove cartões iguais não são um painel

A tela inicial listava as nove telas, todas do mesmo tamanho, em ordem de construção.
Para saber se havia trabalho era preciso abrir as nove — e descobrir que oito não tinham
nada. Agora ela mostra seis números, cada um ligado à tela que o resolve, ordenados por
urgência; as portas continuam abaixo, com a descrição, que é o que serve para aprender o
sistema e para ir a uma tela que ninguém está cobrando.

A decisão que vale registrar não é o layout: é **onde mora a regra de urgência**. Ela é
regra de negócio disfarçada de estilo — "pedido sem prazo conta como atrasado",
"consignação em risco é agora, não depois", "cadastro fiscal faltando com prazo dentro de
trinta dias não espera o fim de semana" são afirmações sobre o que custa dinheiro. Estão
em `inicio/apresentacao.ts`, funções puras com treze testes, e não dentro do JSX.

### 🔀 A porta de entrada é a única tela que não pode quebrar

As seis leituras vêm de seis repositórios, e cada uma falha sozinha: `tentar()` captura,
registra no log com o nome da leitura, e devolve `null`. A linha então mostra `—` e "não
deu para ler agora", e não zero — zero é uma afirmação sobre o banco, e aqui não se sabe.

O caso que obrigou a pensar: **quando nenhuma leitura volta**, a frase do alto não pode
ser "nada esperando por você". Seria o pior texto possível nesta tela — tranquilizar com
banco fora do ar. Tem um terceiro texto para isso, e um teste que o fixa.

Verificado no navegador, não suposto: com o Postgres parado, `/` responde 200, diz "Não
deu para ler o estado do sistema agora", mostra as seis linhas com `—` e mantém as nove
portas clicáveis.

### 🧹 Duas definições da mesma pergunta, e um teste para elas não divergirem

`RepositorioFiscal.resumo` carrega o catálogo inteiro para calcular o estado de cada
item; a tela inicial só quer a contagem. Escrevi `contarPendentes`, que é uma consulta de
agregação — e aí passaram a existir duas implementações da mesma pergunta, uma em SQL e
uma em TypeScript.

O custo foi aceito com duas salvaguardas: a condição em SQL é **derivada de
`OBRIGATORIOS_EM_2027`**, a mesma lista que `estadoFiscal` usa (acrescentar um campo
obrigatório muda os dois de uma vez), e um teste compara os dois resultados antes e depois
de preencher o cadastro. Sem esse teste, a divergência apareceria como um número errado na
tela inicial — o tipo de erro que ninguém confere.

### 🐛 O título do prazo fiscal não cabia na linha do painel

`PRAZOS` tem `titulo` de frase inteira — "NF-e sem os grupos de IBS/CBS passa a ser
rejeitada" —, e no fim de uma linha de painel, junto com a contagem de dias, isso empurra
o número para a segunda linha. Acrescentei `rotuloCurto` ao prazo, com limite declarado
(`LIMITE_DO_ROTULO_CURTO`) e teste que recusa rótulo comprido e rótulo terminado em "...".
Cortar o título no código daria um painel com frase truncada, que é pior que um rótulo
próprio.

## 2026-09-15 — `uptime` responde em um segundo o que eu ia investigar por meia hora

### 🐛 O Postgres não morre: o contêiner reinicia — e o relógio é a prova

Segunda queda do banco no mesmo dia, e desta vez com o log do Postgres **sem nenhuma
linha de desligamento** e o `postmaster.pid` do processo anterior ainda no lugar. Fui
atrás de assassino: OOM (16 GB livres), disco cheio (28 GB livres), algum `pkill` meu,
algum script do projeto que parasse o cluster. Nada.

O que respondeu foi `uptime`: **`up 13 min`**. A máquina tinha reiniciado. E o carimbo de
hora das execuções do `check` mostrava o mesmo de outro ângulo — 04:05, 07:19, 07:22,
07:35, e a seguinte às **17:33**. Dois saltos grandes de relógio de parede, duas quedas
do banco, na mesma ordem.

Então não há processo matando o Postgres. O contêiner reinicia (entre turnos, ou durante
uma pausa longa), o diretório de dados sobrevive porque está em disco, e o cluster não
sobe sozinho. É a mesma queda de sempre, com a causa finalmente no nome certo.

O diagnóstico em ordem, que passa a valer:

1. `uptime` — minutos de vida significam contêiner reiniciado, e aí não há o que
   investigar: `pg_ctlcluster 16 main start` e segue.
2. `pg_lsclusters` — separa "parado" de "sumiu" (bases recriadas ou não).
3. Só depois disso vale procurar culpado.

A lição é a de sempre, na terceira ocorrência: eu tinha uma hipótese boa ("alguma coisa
está matando o processo") e ela me fez ler o log do Postgres antes de perguntar à
máquina quanto tempo ela tinha de vida. O log conta o que o processo fez; não conta o
que aconteceu com a máquina embaixo dele.

### 🐛 `pkill -f <padrão>` mata o próprio shell que o executa

Duas vezes hoje um `pkill -f` devolveu código de saída 144 e a ferramenta reportou falha
estranha. O motivo: `-f` casa a **linha de comando inteira** de cada processo, e a linha
de comando do shell que está rodando o `pkill` contém o padrão. `pkill -f "next dev"`
mata o servidor e, no mesmo varrer, o `bash -c` que o chamou.

Não é teórico: foi o que interrompeu a execução em segundo plano do `check` na primeira
vez, e me fez desconfiar do ambiente. Para matar processo daqui em diante: `pgrep -x`
com nome exato, ou PID explícito — `kill 766 476`, que foi o que funcionou.

## 2026-09-15 — A barra passou a dizer onde você está

### 🔀 O único componente de cliente da casca existe para uma informação só

Marcar a tela aberta precisa do caminho da URL, e no App Router o caminho só existe no
cliente (`usePathname`). Um layout de servidor não o recebe.

A alternativa era cada `page.tsx` passar o seu caminho para o layout. Custaria zero
JavaScript e criaria um jeito silencioso de errar: a décima primeira tela esqueceria de
passar, ficaria sem marca nenhuma, e nada quebraria — o tipo de bug que só aparece
quando alguém repara. Um pedaço pequeno de JavaScript em toda página é o preço, e foi
pago de propósito.

### 🔀 No celular a barra não fica fixa, e é decisão de quem tem dez portas

Fixa no topo, a barra é ganho claro nas telas longas de trabalho em lista — importar,
fiscal, onde serve — onde rolar até o fim e ter de voltar para trocar de tela é atrito
em cima de atrito.

Em 390px, porém, as dez portas ocupam quatro linhas: 150px de menu fixo numa tela de
844px é um quinto da tela gasto em navegação. Então `position: sticky` vale de 40rem
para cima e a barra volta a rolar com a página abaixo disso. Medido no navegador, não
suposto.

O traço que separa os três grupos também sai no celular: numa linha quebrada ele aparece
no começo dela, onde não separa nada. Lá o agrupamento é dito pela quebra de linha.

### 🐛 Três colunas estreitas faziam os cartões da tela inicial saírem tortos

`minmax(15rem, 1fr)` dava três colunas em 56rem, e a descrição de cada porta quebrava em
até cinco linhas — cartões da mesma fileira com alturas muito diferentes. Com
`minmax(20rem, 1fr)` são duas colunas largas, a descrição cabe em duas ou três linhas, e
a fileira fica reta. Cartão largo é cartão baixo.

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
