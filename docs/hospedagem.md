# Hospedagem: o sistema no ar, de graça

Este é o passo a passo para pôr o sistema na internet com três serviços gratuitos, com
endereço `https://` e atualização automática: toda mudança que entra no `main` vai para o
ar sozinha, depois que o CI passa, sem você ligar nada no seu computador. O porquê de
cada peça, e do que ficou de fora, está no [ADR 0013](./adr/0013-hospedagem-gratuita-em-pecas.md).

Você faz isto **uma vez**. Leva uns 30 minutos, quase todos esperando a primeira
montagem.

É um arranjo para testar, e foi escolhido assim: tudo de graça, sem cópia de segurança, e
quando o banco encher, apaga e recomeça. Quando o sistema for usado de verdade, o caminho
é pagar — um servidor próprio ([hospedagem-servidor.md](./hospedagem-servidor.md)) ou os
planos pagos destes mesmos serviços.

Os nomes dos menus abaixo são os dos painéis em inglês, como estavam em setembro de 2026.
Se algum tiver mudado de lugar, a busca do painel acha pelo nome.

## Como funciona

```
push no main ─► GitHub verifica (tipos, testes, e o contêiner sobe) ─► Render monta ─► no ar

UptimeRobot ─► /saude a cada 5 minutos ─► o Render não dorme, e o banco não para
```

- **Render** (render.com) roda o sistema: o site e a fila, num contêiner só, com o
  endereço `https://…onrender.com`. O plano gratuito tem 512 MB de memória e dorme depois
  de 15 minutos sem visita.
- **Supabase** (supabase.com) guarda os dados: o banco (Postgres) e os arquivos enviados
  (planilhas, PDFs). O plano gratuito tem 500 MB de banco e 1 GB de arquivos.
- **UptimeRobot** (uptimerobot.com) visita o sistema a cada 5 minutos. É isso que não
  deixa o Render dormir — e, se o sistema cair, ele manda e-mail.
- **A publicação**: a cada push no `main`, o GitHub verifica tudo, inclusive se o
  contêiner sobe e responde; o Render espera essa verificação, monta a versão nova e só
  a põe no ar quando ela responde. Se algo der errado, a anterior continua.

## O que você vai precisar

- A conta do GitHub, que você já tem, com acesso de administrador a este repositório.
- Um e-mail.
- O Bloco de Notas aberto, para guardar os valores que o Supabase vai dar.

Nenhum passo deste guia precisa de cartão. Se algum painel pedir cartão para continuar,
pare: é sinal de que o plano mudou, e vale reavaliar antes de cadastrar.

---

## Passo 1 — O banco e os arquivos, no Supabase

1. Entre em <https://supabase.com> e crie a conta (dá para entrar com o GitHub).
2. **New project**:
   - **Name**: `hub`.
   - **Database Password**: clique em **Generate a password** e copie para o Bloco de
     Notas. Use senha só de letras e números: `@`, `#`, `/`, `?` e `%` quebram o endereço
     do banco.
   - **Region**: **East US (North Virginia)** — a mesma região do Render. Banco longe do
     site deixa toda tela lenta. Duas armadilhas: "Americas" é um grupo, e o Supabase
     escolhe por você (escolheu Oregon); e São Paulo parece melhor para quem está no
     Brasil, mas o banco não conversa com você, conversa com o site — e o Render não tem
     servidor no Brasil. Depois de criado, o card do projeto tem de dizer `us-east-1`: a
     região não muda depois.
   - Se o formulário oferecer desligar a **Data API**, pode desligar: o sistema não a usa
     (e fecha as tabelas para ela de todo jeito).
   - **Create new project**, e espere uns dois minutos.
3. **O lugar dos arquivos.** No menu da esquerda, **Storage → New bucket**: nome
   `conteudo`, com **Public bucket** desligado. **Create**.
4. **A chave dos arquivos.** Ainda em **Storage**, abra **S3 Configuration**:
   - Em **Connection**, copie o **Endpoint** (`https://….supabase.co/storage/v1/s3`).
   - Em **Access keys**, **New access key**, com qualquer descrição. Copie o **Access key
     ID** e o **Secret access key** — o segredo aparece **só agora**.
5. **O endereço do banco.** No topo da página do projeto, **Connect**. Escolha a aba de
   _connection string_, tipo **URI**, e o **Session pooler** — o endereço que termina em
   `pooler.supabase.com:5432/postgres`. Copie e, no Bloco de Notas, troque
   `[YOUR-PASSWORD]` pela senha do item 2, **sem os colchetes**.

   O _Session pooler_ é o endereço que funciona do Render. O _Direct connection_ não
   serve: no plano gratuito ele só atende por IPv6.

No Bloco de Notas ficam quatro valores: o endereço do banco (com a senha dentro), o
Endpoint, o Access key ID e o Secret access key.

## Passo 2 — O sistema, no Render

1. Entre em <https://render.com> com a conta do GitHub (**Get Started → GitHub**).
2. **New → Blueprint**. Na primeira vez, o Render pede acesso ao GitHub: escolha **Only
   select repositories**, marque este repositório e confirme.
3. Escolha o repositório. O Render lê o arquivo `render.yaml` e mostra o serviço `hub`,
   no plano **Free**, pedindo estes valores:

   | Campo                       | O que colar                                                                                         |
   | --------------------------- | --------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`              | O endereço do banco do passo 1, com a senha no lugar de `[YOUR-PASSWORD]`.                          |
   | `LLM_API_KEY`               | A chave do OpenRouter, a mesma do seu `.env`. Sem ela, o sistema funciona e só a IA fica desligada. |
   | `ARMAZENAMENTO_S3_ENDPOINT` | O Endpoint do passo 1.                                                                              |
   | `ARMAZENAMENTO_S3_CHAVE`    | O Access key ID.                                                                                    |
   | `ARMAZENAMENTO_S3_SEGREDO`  | O Secret access key.                                                                                |

   O resto vem pronto do `render.yaml`. A `CREDENCIAL_CHAVE_MESTRA`, que protege as
   sessões e as credenciais guardadas, o Render gera sozinho. Não há código de cadastro
   nem perfil a configurar (ADR 0014).

4. **Deploy Blueprint**. A primeira montagem leva uns dez minutos. Quando terminar, o
   serviço `hub` aparece como **Live**, com o endereço no topo — algo como
   `https://hub-xxxx.onrender.com`. Guarde: é o endereço do sistema.

Os valores ficam só no painel do Render (em **hub → Environment**, onde dá para trocar
depois). Nada disso vai para o repositório.

## Passo 3 — Criar a sua conta

Abra o endereço, clique em **Criar conta** e preencha nome, e-mail e uma senha de dez
caracteres ou mais — a primeira conta não pede código. Faça isso logo depois da primeira
subida: depois da primeira conta o cadastro fecha sozinho, e só entra quem tem conta.

O nome da loja que aparece no sistema se acerta na tela **Meu negócio**.

No celular, o menu do navegador tem **Adicionar à tela inicial**: o leitor de código de
barras vira um ícone, como um aplicativo.

## Passo 4 — O UptimeRobot, para o sistema não dormir

1. Crie a conta em <https://uptimerobot.com> (plano Free).
2. **New monitor**:
   - **Monitor type**: HTTP(s).
   - **URL**: o endereço do passo 2 com `/saude` no fim —
     `https://hub-xxxx.onrender.com/saude`.
   - **Monitoring interval**: 5 minutes.
   - Avisos: o seu e-mail.
3. **Create monitor**. Em alguns minutos ele mostra **Up**.

Sem este passo o sistema funciona, mas dorme depois de 15 minutos sem visita: a primeira
tela depois disso leva quase um minuto, e a fila para até alguém abrir o sistema. A visita
do UptimeRobot também mantém o banco em uso, e o Supabase gratuito pausa o banco que passa
uma semana parado.

## Passo 5 (opcional) — Abrir o cadastro para mais gente

Sem código, o cadastro fecha depois da primeira conta, e não há "esqueci a senha". Para
outra pessoa criar conta, ou para poder trocar uma senha esquecida, crie um código de
cadastro — `node scripts/gerar-codigo.mjs` gera um, ou invente 12 letras e números — e,
no Render, em **hub → Environment**, acrescente `CADASTRO_CODIGO` com ele e salve. O
sistema reinicia, e a tela de criar conta passa a pedir o código.

---

## No dia a dia

- **Mudança**: entrou no `main`, o CI verifica (uns quatro minutos), e o Render monta e
  troca a versão (uns dez). O rodapé de toda tela diz a versão no ar — "atualizado em
  25/09/2026 às 14:05 (3f9c2a1)" —, então dá para saber se a mudança já chegou.
- **Mudança só em documento ou em teste** não vai para o Render: não muda nada no ar, e
  poupa os minutos de montagem do mês (ver [Quanto custa](#quanto-custa)).
- **Publicação que falhou**: o Render manda e-mail, e a versão anterior continua no ar. O
  motivo está em **hub → Events**, no deploy que falhou.
- **O que o sistema está dizendo**: **hub → Logs**. Só você vê.
- **Voltar uma versão**: **hub → Events**, no deploy que funcionava, **Rollback**.
- **Reiniciar**: **hub → Manual Deploy → Restart service**.

## Quanto custa

| Peça                         | Custo | O limite do plano gratuito                                                     |
| ---------------------------- | ----- | ------------------------------------------------------------------------------ |
| Site e fila (Render)         | R$ 0  | 512 MB de memória; 750 horas por mês; 500 minutos de montagem por mês          |
| Banco e arquivos (Supabase)  | R$ 0  | 500 MB de banco; 1 GB de arquivos; 5 GB de tráfego; **sem cópia de segurança** |
| Vigia (UptimeRobot)          | R$ 0  | uma visita a cada 5 minutos                                                    |
| Verificação (GitHub Actions) | R$ 0  | repositório público não paga minuto                                            |

As 750 horas são por conta, não por serviço: um serviço ligado o mês inteiro usa até 744,
e cabe — um segundo serviço ligado, não. **Mais tarde, se quiser**: um domínio `.com.br`
custa uns R$ 40 por ano, e o Render o aceita de graça (**hub → Settings → Custom
Domains**).

Passar do limite **para, não cobra** — é o que acontece sem cartão cadastrado. Se os
minutos de montagem do mês acabarem, o sistema continua no ar com a última versão, e as
mudanças voltam a subir no mês seguinte. Se o banco encher, ele passa a só ler: é a hora
de apagar e recomeçar (abaixo).

**Sobre o repositório ser público**: qualquer pessoa pode ler o código — é isso que deixa
o GitHub Actions de graça sem limite de minutos. Nenhum segredo e nenhum dado estão no
repositório: os segredos ficam no painel do Render, os dados no Supabase. O log do CI
também é público, e por isso ele nunca imprime dado.

## Quando o banco encher

A decisão para esta fase é apagar tudo e recomeçar. O Supabase avisa por e-mail quando o
banco chega perto do limite, e o uso fica na página **Usage** da organização.

1. No Supabase, **SQL Editor**, cole e rode (**Run**):

   ```sql
   do $$
   declare t record;
   begin
     for t in select tablename from pg_tables where schemaname = 'public' loop
       execute format('truncate table public.%I restart identity cascade', t.tablename);
     end loop;
   end $$;
   ```

   Isso esvazia todas as tabelas do sistema e mantém a estrutura. Não tem volta.

2. No Render, **hub → Manual Deploy → Restart service**: na subida, o sistema recria o
   perfil da loja.
3. Crie a sua conta de novo (passo 3): com o banco vazio, a primeira conta volta a não
   pedir código.
4. _(Opcional)_ Os arquivos enviados continuam no Storage, ocupando espaço: em **Storage →
   conteudo**, selecione tudo e apague.

## Quando algo dá errado

**A publicação falhou, e o log diz `Ambiente inválido`.** A mensagem lista o que falta ou
está errado, pelo nome da variável. Corrija em **hub → Environment** e salve: o Render
tenta de novo.

**O log diz que a `CREDENCIAL_CHAVE_MESTRA` não tem 32 bytes.** Gere uma no seu
computador e cole no lugar, em **Environment**:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Depois que o sistema estiver no ar, **nunca troque nem apague essa chave**: trocada, todo
mundo sai da conta, e as credenciais guardadas deixam de abrir.

**O log diz `password authentication failed` ou `Tenant or user not found`.** O endereço
do banco está errado. Confira se a senha entrou sem os colchetes, se é o endereço do
_Session pooler_ (porta 5432) e se o usuário é `postgres.` seguido do código do projeto,
como o painel deu. Esqueceu a senha? **Project Settings → Database → Reset database
password**, e troque no `DATABASE_URL`.

**O log diz `Max client connections reached`.** O banco gratuito atende umas quinze
conexões de uma vez, e o sistema usa até dez. Acontece quando outro programa usa o mesmo
banco — o seu computador com o mesmo `DATABASE_URL`, por exemplo. Feche o outro, ou baixe
o `BANCO_CONEXOES` para `4` em **Environment**.

**O UptimeRobot diz Down, e o site não abre.**

- No Render, veja se o serviço está **Live**. Se a última publicação falhou, o motivo está
  em **Events**.
- No Supabase, veja se o projeto está pausado (**Paused**). Se estiver, **Restore
  project**; em alguns minutos o sistema volta sozinho.
- Se o Render mostrar o serviço suspenso, é limite do mês (tráfego ou horas): ele volta no
  mês seguinte.

**Enviar planilha dá erro no armazenamento.** Confira os três `ARMAZENAMENTO_S3_…`: o
Endpoint termina em `/storage/v1/s3`, e a chave e o segredo são do mesmo par. O bucket
tem de se chamar `conteudo`.

**A mudança não chegou.** Confira no GitHub se o CI do commit passou — o Render só
publica commit verde. Mudança só em documento ou teste não vai para o ar, de propósito. E
se os minutos de montagem do mês acabaram, o painel do Render mostra em **Billing**.
