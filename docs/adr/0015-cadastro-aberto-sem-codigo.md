# ADR 0015 — Sem código de cadastro, o cadastro fica aberto

**Estado:** Aceito · **Data:** 2026-09-26 · Decisão do dono · Substitui a parte do
[ADR 0014](./0014-primeira-conta-sem-codigo.md) sobre o cadastro, e a do
[ADR 0011](./0011-contas-de-acesso.md) sobre a troca de senha sem código

## Contexto

O ADR 0014 tirou o código da frente da primeira conta, como o dono pediu, mas fechou o
cadastro em seguida: foi decisão minha, tomada sem perguntar, para quem achasse o
endereço não entrar. O dono não queria isso, e disse: "pode abrir para quem é de fora do
sistema e encontra o endereço". Nesta fase o sistema é só de teste, sem dado de verdade,
e o que ele quer é que funcione sem nada para configurar e sem ter de voltar ao painel
do Render.

## Decisão

**Uma chave só: o código de cadastro (`CADASTRO_CODIGO`).**

- **Sem código** (o de hoje): qualquer um cria conta, quantas quiser, e troca a senha
  esquecida sem prova. Nenhuma tela pede código.
- **Com código** (quando o sistema for usado de verdade): criar conta e trocar a senha
  pedem o código, como no ADR 0011. Fechar é só pôr o código no painel do Render.

A trava da "primeira conta" do ADR 0014 saiu, com o que ela precisava (a contagem de
contas na tela e a criação numa transação travada). Segue do ADR 0014 o perfil padrão
(`principal`) e o atalho do Windows sem gerar código.

## Consequências

**A favor.** Nada para configurar nem para lembrar: o sistema funciona como o dono pediu,
e a regra cabe numa frase.

**Contra, e aceito pelo dono para a fase de teste.**

- Quem achar o endereço cria conta e vê tudo o que estiver no sistema.
- Quem souber o e-mail de uma conta troca a senha dela, e as sessões dela caem.
- Antes de pôr dado de verdade, o código tem de estar configurado. O guia da hospedagem
  diz como, e as pendências registram.
