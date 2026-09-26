# ADR 0016 — O computador de quem usa antes da nuvem

**Estado:** Aceito; a restauração pela tela entrou pelo
[ADR 0017](./0017-restaurar-pela-tela.md) · **Data:** 2026-09-26 · Decisão do dono ·
Substitui a decisão 6 do
[ADR 0013](./0013-hospedagem-gratuita-em-pecas.md) (sem cópia de segurança) e dá prazo
aos arquivos da decisão 2

## Contexto

Em 25/09, criando a conta do Supabase, o dono perguntou por que as planilhas enviadas iam
para a nuvem, "sendo que ela já mal tem espaço para isso", e não para o computador de
quem usa: "tudo que a gente puder utilizar, forçar, a usar o computador do usuário, tanto
seja para guardar dados e tudo, é melhor [...] para a gente economizar e poder usar o
plano gratuito com mais folga". Ficou combinado tratar depois de o sistema estar no ar, e
três pontos foram guardados nas pendências. Em 26/09, com o sistema no ar: "agora vamos
abordar os 3 pontos".

O plano gratuito do Supabase tem 1 GB de arquivos e 500 MB de banco, e não faz cópia de
segurança. Os arquivos iam para lá e ficavam para sempre. A cópia do banco não existia:
o ADR 0013 a deixou de fora, por decisão do dono, para a fase de teste.

A nota das pendências dizia que apagar o arquivo mudava o ADR 0002 ("nunca jogar a
entrada fora"), e a frase vinha de um comentário do `.env.example`. O ADR 0002 não diz
isso. A regra de não descartar é da especificação e do ADR 0005, e é sobre o registro —
a entrada que o sistema não soube tratar fica em revisão, com o motivo. Ela continua
valendo: o job e tudo o que saiu do arquivo ficam no banco. O que sai é a cópia do
original na nuvem.

## Decisão

**1. Na nuvem, o arquivo enviado é temporário.** Sai 7 dias depois do último uso
(`RETENCAO_NA_NUVEM_DIAS`), e "sem uso" são duas condições juntas: gravado há mais de 7
dias, e nenhum job que ainda vá rodar com ele, com o último movimento dos que o citam
também há mais de 7 dias. Job pendente guarda o arquivo pelo tempo que for. A limpeza é
uma tarefa da fila, a última da ordem, e roda a cada seis horas
(`src/infra/armazenamento/limpeza.ts`).

- **Só na nuvem.** Com o conteúdo em disco — o computador de quem usa, ou um servidor
  próprio —, nada sai: o espaço é de quem usa, e rodar de novo sem reenviar continua
  possível.
- **Rodar de novo o que já saiu pede o arquivo.** O job vai para revisão dizendo "envie o
  mesmo arquivo de novo na tela Importar", e guarda qual arquivo espera
  (`job.aguardando_conteudo`). Enviar o mesmo arquivo o devolve à fila sozinho — ninguém
  precisa achar o job.
- Antes, arquivo que faltava fazia o job gastar as tentativas e ir para "falhou" com
  "conteúdo não está no armazenamento". Agora vai direto para revisão, com o que fazer.

**2. A cópia do banco é baixada pelo navegador.** A tela **Cópia dos dados** gera um
arquivo `.sql.gz` com os dados de todas as tabelas, tirados de uma fotografia só do
banco, e o navegador o baixa (`src/infra/banco/copia.ts`). O formato é o do `pg_dump` em
texto, com um bloco `COPY` por tabela, na ordem das chaves estrangeiras: volta pelo
sistema (`npm run copia:restaurar`, que primeiro confere e só troca os dados com
`--sim`, numa transação só) e volta por qualquer `psql`, sem este código.

- **Contas e sessões ficam de fora.** Com o cadastro aberto (ADR 0015), qualquer conta
  baixa a cópia, e o hash da senha de uma pessoa não viaja num arquivo que outra pode
  ter. Quem restaura cria a conta de novo.
- **Os arquivos enviados também**: não estão no banco, e o original está com quem enviou.
- **Restaurar é pelo computador, não pela tela.** Com o cadastro aberto, um botão de
  restaurar deixaria qualquer conta trocar os dados de todo mundo.
- A restauração não executa o SQL do arquivo: lê o cabeçalho e os blocos, confere cada
  tabela e coluna contra o banco de destino, e recusa — antes de apagar qualquer coisa —
  cópia de um banco mais novo, linha que não é de cópia, e cópia sem a linha de
  fechamento, que é o download interrompido.

**3. O princípio vale para o que vier.** O que pode ficar no computador de quem usa fica
lá, e a nuvem guarda o que o sistema precisa para funcionar sem esse computador ligado —
o banco e a fila. O que o sistema gera — arquivo de importação, ficha, relatório, a cópia
— é baixado, e não guardado. Processar a planilha no próprio navegador foi avaliado e não
compensa agora: pouparia processamento do servidor, não o banco, que é o que enche
primeiro — os dados extraídos vão para ele de todo jeito. Reavaliar se a máquina do
Render ficar pequena.

## Consequências

**A favor.**

- O espaço de arquivos na nuvem fica do tamanho de uma semana de envios, e não do
  histórico inteiro.
- Cópia de segurança sem custo e sem serviço novo, e provada nos dois caminhos de volta:
  o teste de ida e volta compara tabela por tabela, e o ensaio restaurou a mesma cópia
  pelo comando e pelo `psql`, com o mesmo resultado da origem.
- Quem baixa a cópia consegue rodar o sistema no próprio computador com os dados da
  nuvem.

**Contra.**

- Rodar de novo um envio de mais de uma semana pede o arquivo. O original está com quem
  enviou, e reenviar resolve.
- A cópia depende de alguém lembrar de baixar: nada avisa que a última está velha.
- Com o cadastro aberto, qualquer conta baixa os dados do negócio. É o que qualquer conta
  já vê nas telas (ADR 0015); fechar o cadastro fecha isto também.
- Restaurar pede o computador com o sistema instalado, ou o `psql`.
- **Uma corrida aceita.** Quem envia de novo um arquivo que ainda está lá, no instante em
  que a limpeza decide apagá-lo, pode ficar sem ele. O job vai para revisão pedindo o
  arquivo, e reenviar resolve. Fechar isso pediria trava entre site e fila, para um caso
  de segundos a cada seis horas.
- Listar e apagar no S3 foram ensaiados contra imitação. A primeira limpeza no ar é a
  prova, e o log diz `conteudo.limpeza` ou `conteudo.limpeza_falhou`.

**Obrigação para quem mantém.**

- Tipo de job que guarde arquivo cita o hash no campo `hashConteudo` da entrada
  (`CAMPO_DO_CONTEUDO_NA_ENTRADA`). É por ele que a limpeza sabe que o arquivo ainda é
  preciso; com outro nome, o arquivo sai com o job pendente.
- Tabela nova entra na cópia sozinha. Tabela que não deve viajar num arquivo — conta,
  sessão, segredo — vai para `TABELAS_FORA_DA_COPIA`, e nenhuma tabela de fora pode
  apontar para uma de dentro (há teste).
- Chave estrangeira em ciclo entre tabelas não tem ordem de restaurar: o teste de ida e
  volta falha, e a migração que a criar precisa de outro desenho.
