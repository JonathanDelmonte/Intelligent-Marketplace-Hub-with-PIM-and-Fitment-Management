# ADR 0013 — Hospedagem gratuita em peças: Render, Supabase e UptimeRobot

**Estado:** Aceito; o filtro de montagem da decisão 4 saiu (diário, 26/09) ·
**Data:** 2026-09-25 · Decisão do dono · Substitui o
[ADR 0012](./0012-conta-oracle-sem-upgrade.md) e a parte de hospedagem do
[ADR 0010](./0010-hospedagem-gratuita.md)

## Contexto

O ADR 0010 pôs o sistema num servidor Oracle Always Free, e o 0012 manteve a conta da
Oracle no plano gratuito. A conta e a rede saíram; a máquina, não. O painel respondeu
"Out of capacity" em toda tentativa, ao longo de horas e em horários diferentes: a
máquina ARM gratuita de São Paulo é disputada por programas que a pedem a cada minuto. E
em julho de 2026 a Oracle cortou pela metade o Always Free das contas gratuitas (de 4
núcleos e 24 GB para 2 e 12); quem é Pay As You Go ficou com o antigo, e com a prioridade
na fila — justamente o que o ADR 0012 recusou.

O dono desistiu da Oracle em 25/09 e pediu outra proposta, com três condições: de graça
agora ("depois que escalar, eu começo a pagar"); sem risco de cobrança; e só para testar,
com pouco dado — "quando encher, apaga, apaga tudo, volta do zero". Sem cópia de
segurança nesta fase, por decisão dele.

O que foi avaliado, pelo que cada um oferecia em setembro de 2026:

- **Vercel (Hobby):** só para uso não comercial, e o sistema é de uma loja.
- **Netlify:** plano por créditos; função com 10 segundos e uns 6 MB por pedido — o envio
  de planilha de 8 MB não passa — e nada que rode sem parar, como a fila.
- **Cloudflare Workers:** 10 ms de processador por pedido no plano gratuito, e o sistema
  precisa de Node com conexão TCP ao banco.
- **Koyeb:** o plano gratuito fechou em fevereiro de 2026. **Fly.io** e **Railway**: sem
  plano gratuito para conta nova, só crédito de avaliação. **Northflank**: a sandbox é
  declarada "não para produção", com máquina mínima.
- **Neon (banco):** 100 horas de computação por mês, e a fila, que consulta o banco a cada
  dois segundos, o mantém acordado o mês inteiro.
- **Postgres gratuito do Render:** expira em 30 dias.
- **Servidor pago** (para quando escalar): uma VPS da Hostinger com 1 núcleo e 4 GB saía a
  uns R$ 28–30 por mês no plano de 24 meses, renovando a R$ 60; com 2 núcleos e 8 GB, uns
  R$ 39. A Magalu Cloud, uns R$ 83 por 2 núcleos e 4 GB.

Nenhuma peça gratuita sozinha roda o sistema inteiro. Três juntas rodam:

- **Render**, serviço web gratuito com Docker: 512 MB de memória e 0,1 de processador;
  750 horas por mês por conta; dorme depois de 15 minutos sem visita e acorda em cerca de
  um minuto; disco que se perde a cada reinício; 500 minutos de montagem por mês; HTTPS e
  endereço `onrender.com`.
- **Supabase**, projeto gratuito: Postgres 17 com `pgvector`, 500 MB de banco, 1 GB de
  arquivos com API compatível com S3, 5 GB de tráfego; sem cópia de segurança; pausa
  depois de uma semana sem uso. O endereço do banco que o Render alcança é o do _Session
  pooler_ (o direto só atende por IPv6 no plano gratuito), e nele cabem umas quinze
  conexões de uma vez.
- **UptimeRobot**, gratuito: visita um endereço a cada 5 minutos e avisa por e-mail quando
  ele cai.

## Decisão

**1. Site e fila num contêiner só, no Render gratuito.** A imagem é a do ADR 0010; sem
comando, ela migra o banco, semeia o primeiro perfil e sobe o site e a fila, cada um no
seu processo e com teto de memória, e repassa a eles o pedido de parar
(`scripts/conteiner.ts`). Se um dos dois cai sozinho, o contêiner sai com erro e o Render
sobe tudo de novo; a fila retoma o que fazia. O serviço está descrito em `render.yaml`
(um _Blueprint_), na região Virginia.

**2. Banco e arquivos no Supabase gratuito**, na mesma região (East US, North Virginia):
uma tela faz dezenas de consultas, e banco longe do site soma a demora de cada uma.

- O banco entra pelo _Session pooler_, com TLS acrescentado na subida
  (`src/infra/conteiner/ambiente.ts`). Cada processo abre no máximo cinco conexões
  (`BANCO_CONEXOES`), e a conexão parada fecha em um minuto: na troca de versão, a velha
  e a nova rodam juntas, e as quinze vagas do pooler têm de dar para as duas.
- O Supabase publica o schema `public` pela API REST dele, para quem tiver a chave
  pública do projeto. O sistema não usa essa API, e fecha a porta: toda migração termina
  ligando o RLS, sem política nenhuma, em toda tabela do `public`
  (`src/infra/banco/fechar-tabelas.ts`). O sistema entra como dono das tabelas, e o dono
  não passa pelo RLS.
- Os arquivos (planilhas, PDFs) vão para o Supabase Storage pela API S3
  (`src/infra/armazenamento/deposito-s3.ts`), porque o disco do Render se perde a cada
  reinício. Sem endereço S3 configurado, ficam em disco, como antes — é o caso do
  computador de quem desenvolve e do servidor próprio.

**3. O UptimeRobot visita `/saude` a cada 5 minutos.** A visita não deixa o Render dormir
— dormindo, a fila também para —, mantém o banco em uso, e é quem avisa por e-mail quando
o sistema cai: a saúde responde "sem banco" (503) quando o banco não atende.

**4. Cada push no `main` vai para o ar depois do CI** (`autoDeployTrigger: checksPass`).
O CI passou a subir a própria imagem do jeito que o Render sobe, contra um Postgres 17 —
a versão do Supabase —, e a pedir que ela pare; o Render monta a versão nova e só a põe
no ar quando `/saude` responde. Mudança só em documento, em teste ou no que não entra na
imagem não gasta montagem (`buildFilter`): são 500 minutos por mês.

**5. Os segredos ficam no painel do Render.** O `render.yaml` lista as variáveis; os
valores dos segredos (`sync: false`) são digitados uma vez, na criação, e a chave mestra é
gerada pelo próprio Render (`generateValue`). O repositório continua sem segredo nenhum.

**6. Sem cópia de segurança nesta fase**, por decisão do dono. Quando o banco encher, o
guia ensina a esvaziar e recomeçar.

**7. O caminho do servidor próprio fica guardado, parado.** A composição (`servidor/`), os
jobs `preparar` e `publicar` do CI — que só rodam com a variável `SERVIDOR_ENDERECO` —, a
manutenção e o guia, agora em `docs/hospedagem-servidor.md`: é o caminho para quando
valer pagar um servidor. Saíram o que era só da Oracle: o pedido automático da máquina
(`criar-maquina.py` e o workflow **criar máquina**) e a reserva de memória do ADR 0012
(`reserva.mjs`). Ficam no histórico do git.

## Consequências

**A favor.**

- Custo zero, e sem risco de cobrança: sem cartão cadastrado, o que passa do limite
  para, não cobra.
- Nada de fila por vaga, nem máquina para manter: HTTPS, endereço, reinício e troca de
  versão são do Render.
- O sistema não mudou: a mesma imagem, o mesmo código, o mesmo Postgres. No computador,
  tudo segue como estava — banco local e arquivos em disco.
- O caminho completo foi ensaiado antes de existir conta: a imagem sem comando contra um
  banco vazio, com um S3 de imitação — conta criada, planilha enviada e processada, o
  arquivo no S3 e nenhum no disco, RLS em todas as tabelas, 200 MB de memória, e parada
  limpa em menos de um décimo de segundo. O ensaio pegou um erro no arranque, corrigido
  (ver o diário).

**Contra.**

- **Pouca máquina.** 0,1 de processador e 512 MB para site e fila: as telas são mais
  lentas que no computador, e uma planilha muito grande pode passar do teto de memória
  da fila — o contêiner reinicia, e a tarefa tenta de novo até esgotar as tentativas.
  Serve para testar; não para várias pessoas usando.
- **Sem cópia de segurança.** Se o projeto do Supabase se perder, os dados vão junto.
  Aceito para testar; dado de verdade traz a cópia de volta ao plano.
- **Limites que param o serviço.** 750 horas cabem num serviço só; os 500 minutos de
  montagem acabam com muitos pushes num mês, e aí o sistema fica na última versão até o
  mês virar; o banco cheio passa a só ler.
- **Três empresas, e plano gratuito muda** — a Oracle cortou o dela este ano, e a Koyeb
  fechou o seu. A saída está pronta: a imagem é a mesma do servidor próprio, o banco é
  Postgres comum e os arquivos são S3.
- **O S3 do Supabase foi ensaiado contra imitações**, não contra o Supabase — o ambiente
  de desenvolvimento não alcança o serviço. A primeira planilha enviada no ar é a prova, e
  o erro, se houver, aparece na tela Importar e no log do Render.
- **Se o Render executar o comando do serviço por um shell**, o pedido de parar não chega
  ao Node. Por isso o contêiner não usa o campo de comando do Render: o comando é o
  padrão da imagem, na forma de lista.

**Obrigação para quem mantém.**

- Migração só acrescenta: na troca, a versão velha roda com o banco já migrado.
- Tabela nova sai fechada sozinha; **view** no `public` passaria por cima do RLS — se
  precisar de uma, com `security_invoker`.
- Variável nova que o sistema precisa no ar entra no `render.yaml`; se for segredo, com
  `sync: false`, e o valor é posto à mão no painel do Render.
- Cada push que muda a imagem gasta minutos de montagem: commit pequeno, sim, mas push
  por tarefa terminada, não por commit.
