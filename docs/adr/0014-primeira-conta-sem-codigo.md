# ADR 0014 — Sem código de cadastro, a primeira conta entra direto

**Estado:** Em parte substituído pelo [ADR 0015](./0015-cadastro-aberto-sem-codigo.md) —
sem código, o cadastro fica aberto; continua valendo o perfil padrão (item 5) ·
**Data:** 2026-09-26 · Decisão do dono · Substitui a parte do
[ADR 0011](./0011-contas-de-acesso.md) que fechava o cadastro sem código

## Contexto

O ADR 0011 fechou o cadastro atrás de um código (`CADASTRO_CODIGO`): sem permissões,
toda conta vê tudo, e cadastro aberto num endereço público seria porta aberta. Sem código
configurado, o cadastro ficava fechado — e, com o login exigido, o sistema ficava sem
porta de entrada até alguém gerar um código e guardá-lo em algum lugar.

Na hora de pôr o sistema no Render (ADR 0013), o dono recusou isso: "eu quero que o
próprio navegador lide com isso. Eu vou lá, crio, e é isso". O código é segurança para
depois; agora o sistema é para testar. E recusou também configurar o perfil padrão
(`BANCADA_PERFIL_PADRAO`): "não existe isso".

## Decisão

**1. Sem código configurado, a primeira conta é criada sem pedir nada.** É o dono
chegando ao sistema novo. A tela de criar conta não mostra o campo do código.

**2. Depois da primeira conta, sem código, o cadastro fecha sozinho.** Quem achar o
endereço depois não cria conta — e não vê custos, margens e fornecedores. Para abrir
para mais gente, configura-se `CADASTRO_CODIGO` (no painel do Render, ou no `.env`), e aí
vale o ADR 0011: toda conta nova pede o código.

**3. A primeira conta é criada numa transação com a tabela travada**, então dois
cadastros ao mesmo tempo numa base vazia não viram duas "primeiras contas"
(`criarPrimeiraConta`, com teste).

**4. Nada gera código sozinho.** O atalho do Windows e o `preparar:env` deixaram de
criar `CADASTRO_CODIGO`. Quem quiser um: `node scripts/gerar-codigo.mjs`.

**5. O perfil padrão tem valor padrão.** Sem `BANCADA_PERFIL_PADRAO`, o slug é
`principal`: um perfil só, criado na primeira subida, e o nome que aparece se acerta na
tela do negócio. Configurado, vale o configurado — o `.env` de quem já usa segue igual.

## Consequências

**A favor.** Pôr o sistema no ar deixou de pedir dois valores que o dono não tinha
motivo para inventar, e a primeira entrada é só criar a conta.

**Contra.**

- **Entre subir e criar a conta, o cadastro está aberto.** Quem chegasse ao endereço
  antes do dono criaria a primeira conta. O endereço do Render é novo e não divulgado, e
  o dono cria a conta logo depois da primeira subida; se alguém chegar antes, a conta
  dele não serve de nada ao dono, que apaga o banco e recomeça (é a fase de teste).
- **Sem código, não há "esqueci a senha".** A troca de senha usa o código como prova
  (ADR 0011). Esqueceu? Configura o código e troca; ou, na fase de teste, recomeça.
- **Um segundo usuário pede o código.** É o preço de o cadastro não ficar aberto a quem
  achar o endereço.
