# ADR 0010 — Um servidor gratuito, e cada push no ar em cinco minutos

**Estado:** Aceito — a passagem da conta para Pay As You Go foi substituída pelo
[ADR 0012](./0012-conta-oracle-sem-upgrade.md) · **Data:** 2026-09-25 · Pedido e aprovação do dono

## Contexto

O dono pediu, em 25/09, o sistema na internet: usar de qualquer computador, e toda
mudança ir para o ar sozinha, "sem eu ter que ficar iniciando aqui no meu próprio
computador". Com três condições: de graça agora ("depois, quando for escalar, paga"),
endereço gratuito, e a mesma experiência de outros projetos dele, em que uma mudança
leva de segundos a poucos minutos para aparecer.

O sistema tem quatro partes que precisam rodar juntas: o site (Next.js), a fila (o
poller, um processo contínuo), o Postgres com `pgvector`, e o armazenamento de conteúdo
— planilhas e PDFs guardados por hash **em disco**, que o site grava e a fila lê
(pendências, 3.3).

As alternativas, pelo que cada uma custa neste sistema:

- **Site sem servidor (Vercel e parecidos) com banco gerenciado (Neon).** O disco dessas
  plataformas some entre um pedido e outro, então o armazenamento teria de ir para um
  object storage, e o poller para uma tarefa agendada. E o Neon gratuito não aguenta o
  banco principal: o poller e as conexões persistentes do `postgres.js` o mantêm
  acordado o dia inteiro, cerca de 180 horas de computação por mês contra 100 do plano.
- **Plataformas com processo e disco (Railway, Render, Fly).** Resolveriam tudo, mas não
  têm plano gratuito que sirva: ou cobram, ou dormem o serviço sem uso — e o poller não
  pode dormir.
- **O computador de casa, com um túnel.** Contraria o pedido: o computador teria de ficar
  ligado.
- **Um servidor virtual gratuito da Oracle Cloud (Always Free).** Uma máquina ARM com 2
  núcleos e 12 GB, disco, em São Paulo, onde as quatro partes rodam como no computador.
  Os riscos são da Oracle: recolher máquina ociosa, faltar capacidade na hora de criar,
  mudar o plano.

## Decisão

**1. Tudo num servidor Oracle Always Free**, em São Paulo, com Docker Compose
(`servidor/compose.yaml`): banco (Postgres 18 com `pgvector`, a mesma imagem do CI e do
computador), site (a imagem do `Dockerfile`, com o Next em modo `standalone`), fila (a
mesma imagem, outro comando), Caddy (HTTPS automático, com Let's Encrypt e ZeroSSL de
reserva) e backup. A conta passa a Pay As You Go, com alerta de gasto em US$ 1: os
recursos Always Free continuam de graça, e a máquina deixa de ser recolhida por
ociosidade.

**2. O endereço é o IP pelo sslip.io** (`129-151-10-20.sslip.io`), de graça e sem
cadastro. A variável `SITE_ENDERECO` troca por um nome (DuckDNS, grátis; domínio próprio
quando houver).

**3. Cada push no `main` vai para o ar pelo GitHub Actions**, em dois jobs:

- `preparar`, em paralelo com a verificação: entra no servidor por SSH, roda
  `servidor/instalar.sh` — que deixa uma máquina Ubuntu nova pronta e não mexe na que
  já está — e monta a imagem ali mesmo, a partir do `git archive` do commit. Sem
  registro de imagem no meio, e na arquitetura do servidor (ARM).
- `publicar`, depois da verificação, da imagem e do preparo: se ainda for o commit mais
  novo, envia a configuração e chama `servidor/publicar.sh`, que migra, troca a versão e
  confere a saúde (`/saude`) esperando o commit novo. Se a versão nova não responder em
  dois minutos, a anterior volta e o job falha — o que faz o GitHub mandar e-mail. Por
  fim, confere o endereço de fora, em `https`.

Uma mudança comum leva cerca de cinco minutos do push ao ar. O rodapé de toda tela diz
a versão no ar e a hora dela.

**4. O segredo mora onde é usado.** A senha do banco e a chave mestra nascem no servidor
na primeira publicação e nunca saem dele. O GitHub guarda a chave SSH, o código de
cadastro (ADR 0011), a chave da IA e o endereço do Neon. O resto da configuração vem das
variáveis do GitHub e, na falta delas, do `.env.example` (`servidor/montar-config.sh`).

**5. Cópia todo dia, e conferida toda semana.** Às 03:00, o banco num arquivo (sete dias
guardados), o conteúdo espelhado, e — com `BACKUP_NEON_URL` — o banco restaurado no Neon,
fora do servidor. Toda segunda, o teste da cópia roda sozinho. O workflow "manutenção"
tem os botões de diagnóstico, reiniciar, copiar, testar e restaurar.

**6. O repositório é público, e o log das publicações também.** O servidor nunca devolve
log da aplicação para o GitHub — pode ter nome e endereço de comprador, de planilha de
pedidos —, só estado, contagem e o erro de arranque de uma versão que não subiu.

## Consequências

**A favor.** Custo zero. O servidor roda a mesma imagem que o CI monta e testa a cada
push, e o ciclo inteiro — primeira publicação numa máquina vazia, versão quebrada que
volta sozinha, os cinco botões da manutenção — foi ensaiado antes de existir servidor,
contra uma máquina falsa com SSH e Docker. Nada depende de SDK de provedor: mudar de
servidor é outra máquina com Docker, as mesmas variáveis, e uma restauração.

**Contra.**

- **Um servidor só.** Se a máquina se perde, o sistema fica fora do ar até outra ser
  criada (o guia ensina), e o que entrou desde a última cópia no Neon — até um dia —
  pode se perder com ela. As sete cópias locais protegem de erro, não de perder o disco.
- **O conteúdo enviado (planilhas, PDFs) não tem cópia fora do servidor.** O Neon guarda
  o banco, não arquivos. O banco guarda o que foi extraído deles; o original serve para
  reprocessar.
- **Alguns segundos fora do ar a cada publicação**, enquanto o contêiner novo sobe no
  lugar do velho. Troca sem interrupção pediria dois sites e o Caddy alternando entre
  eles; não vale ainda.
- **A montagem da imagem divide o processador com o site** durante um ou dois minutos
  por publicação.
- **O sslip.io divide com o mundo inteiro o limite semanal do Let's Encrypt**: ele não
  está na Public Suffix List (conferido). O projeto tem limite ampliado e o Caddy tenta o
  ZeroSSL quando o Let's Encrypt recusa; se ainda assim o certificado não sair, o DuckDNS
  está na lista, e cada nome dele tem limite próprio.
- **A Oracle pode mudar o plano gratuito**, e a máquina ARM às vezes está sem capacidade
  na hora de criar. A conta Pay As You Go dá prioridade.
- **O GitHub Actions é de graça porque o repositório é público.** Privado, os 2.000
  minutos por mês do plano gratuito cobrem umas duzentas publicações.

**Obrigação para quem mantém.** Migração só acrescenta — nunca apaga nem renomeia coluna
ou tabela que a versão no ar usa (CLAUDE.md): a versão anterior roda com o banco já
migrado, na troca e na volta. Variável nova que o servidor precisa entra em
`servidor/montar-config.sh` e no job `publicar`. Nada que seja dado vai para o log do
GitHub. E os scripts do servidor passam pelo `shellcheck` do CI.
