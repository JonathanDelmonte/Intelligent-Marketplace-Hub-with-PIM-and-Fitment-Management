# ADR 0017 — Restaurar a cópia pela tela

**Estado:** Aceito · **Data:** 2026-09-26 · Decisão do dono · Substitui a parte do
[ADR 0016](./0016-computador-antes-da-nuvem.md) que deixava a restauração só no
computador

## Contexto

O ADR 0016 pôs a cópia do banco para baixar pela tela e deixou a restauração no
computador — `npm run copia:restaurar`, ou qualquer `psql` —, porque com o cadastro aberto
(ADR 0015) um botão de restaurar deixaria qualquer conta trocar os dados de todo mundo.

Levado o risco ao dono, ele decidiu o contrário: "Vamos fingir que ele está completamente
seguro, já está pronto — como é que funcionaria para um usuário? Quero que funcione dessa
forma, por mais que alguém possa invadir hoje e pegar os dados." O código de cadastro, que
fecharia o risco, fica para depois dos testes, também por decisão dele.

## Decisão

**A cópia volta pela mesma tela em que se baixa**, em três passos:

1. **Escolher o arquivo.** O navegador o confere no computador de quem usa, sem mandar
   nada: de quando é a cópia, de que versão, quantas tabelas e linhas, e se chegou
   inteira. Arquivo cortado é recusado ali. A leitura do formato é a mesma do servidor
   (`src/infra/banco/formato-da-copia.ts`, sem nada de servidor dentro).
2. **Confirmar.** O botão só acende depois de marcar "Entendo que todos os dados de agora
   serão trocados pelos desta cópia".
3. **Restaurar.** O arquivo sobe cru e é lido enquanto chega, numa transação só: ou volta
   tudo, ou nada muda. As contas de acesso continuam as mesmas, e quem restaurou continua
   dentro.

**A rota da restauração fica fora do porteiro, e confere a conta ela mesma.** Com o
porteiro na frente, o Next guarda o corpo do pedido na memória, para o porteiro também
poder lê-lo, e o corta em 10 MB — sem erro, só um aviso no log. A cópia de um banco de
verdade passa disso. A rota confere o cookie da sessão (401 sem ela) e um cabeçalho que só
a tela manda (403 sem ele: outra página não dispara a restauração com a sessão de quem a
visita). O que fica fora do porteiro está em `CAMINHOS_FORA_DO_PORTEIRO`
(`src/app/acesso/constantes.ts`), e o teste do porteiro confere o `matcher` contra a
lista.

**O perfil da loja é acertado depois de restaurar.** No computador, o `.env` costuma dar ao
perfil o nome da loja; na nuvem, sem configuração, ele é `principal` (ADR 0014). A cópia de
uma instalação restaurada na outra deixaria toda tela sem perfil. Com um perfil só na
cópia, ele passa a ter o nome que esta instalação procura; com vários, e nenhum com esse
nome, a tela avisa. Vale para a tela e para o comando.

O computador (`npm run copia:restaurar`) e o `psql` continuam restaurando o mesmo arquivo.

## Consequências

**A favor.**

- Restaurar é tão simples quanto baixar, sem computador com o sistema instalado — que é
  o que o dono pediu.
- Ensaiado no contêiner: uma cópia de 13,9 MB voltou pela tela em 2,4 s, com a memória
  nos 200 MB de sempre. A mesma imagem, sem a rota fora do porteiro, recebeu só os
  primeiros 10 MB e recusou a cópia — o corte é real, e não só documentado. A cópia de
  outra instalação voltou com o perfil acertado, e o arquivo cortado foi recusado no
  navegador, sem subir.

**Contra, e aceito pelo dono para a fase de teste.**

- Com o cadastro aberto, qualquer pessoa que criar conta troca os dados de todo mundo.
  Fechar o cadastro (`CADASTRO_CODIGO`) fecha isto também; quem pode restaurar — papéis —
  fica para quando escalar (ADR 0011).
- Uma rota fora do porteiro tem de conferir a conta por conta própria. É uma só, listada e
  testada.
- O limite de envio do Render não foi confirmado: a cópia de 13,9 MB foi ensaiada no
  contêiner, não no ar.

**Obrigação para quem mantém.**

- Rota nova fora do porteiro entra em `CAMINHOS_FORA_DO_PORTEIRO`, por ADR, e confere a
  sessão como a da restauração.
- Mudança no formato da cópia muda `formato-da-copia.ts`, que o navegador e o servidor
  leem — e `FORMATO_DA_COPIA`, se a leitura antiga não entender o arquivo novo.
