# ADR 0011 — Conta com senha, cadastro fechado por código, permissões depois

**Estado:** Aceito · **Data:** 2026-09-25 · Pedido e aprovação do dono

## Contexto

Até aqui o sistema rodava no computador do dono e nada perguntava quem estava usando.
Ele vai para a internet (ADR 0010), num endereço público, e aí qualquer um com o
endereço veria vendas, margens e fornecedores — e poderia importar planilha e montar
anúncio.

O dono pediu, em 25/09, tela de cadastro e de login: "inicialmente eu quero usar para
uso pessoal. Depois eu escalo, e aí para escalar provavelmente vai ter conta que vai
ter certos tipos de permissões e outras não, mas isso é só para frente."

Duas regras já valiam. O ADR 0003 proíbe construir multi-tenant — convite, papéis,
cobrança, onboarding —, e login não contradiz isso: é porta, não isolamento; toda
conta vê os mesmos perfis. E a regra de gratuito primeiro (CLAUDE.md, 3.7) tira da mesa
serviço pago de autenticação e serviço de e-mail. O Node já traz o que é preciso
(scrypt, HMAC, HKDF), então nenhuma dependência entra.

## Decisão

**1. A conta é nome, e-mail e senha.** Tabelas `usuario` e `sessao`, de
infraestrutura, sem `perfil_id`: quem entra não é um perfil de vendedor. A senha é
guardada com scrypt (N=2¹⁷, r=8, p=1: 128 MiB e cerca de 0,3 s por conferência), e os
parâmetros vão junto no texto gravado — subir o custo depois não invalida senha antiga.
Mínimo de 10 caracteres e nenhuma regra de símbolo, como recomenda o NIST (SP 800-63B):
frase longa é mais forte que símbolo, e regra de símbolo produz `Senha@123`.

**2. O cadastro é fechado por um código** (`CADASTRO_CODIGO`). Sem permissões, toda
conta vê tudo; cadastro aberto num endereço público seria porta aberta. O código é
gerado pelo atalho (`Atalhos/Iniciar.bat`, ou `npm run preparar:env`) no `.env` do
computador, e fica nos segredos do GitHub para o servidor.
Sem código configurado, o cadastro fica **fechado**, nunca aberto.

**3. A sessão mora no banco, e o cookie só aponta para ela.** O cookie `sessao` é
`id.vencimento.assinatura` (HMAC com chave derivada por HKDF de
`CREDENCIAL_CHAVE_MESTRA`), `HttpOnly`, `SameSite=Lax`, `Secure` fora do próprio
computador, e vale 30 dias. A linha no banco é o que permite encerrar: "Sair" encerra a
sessão, e trocar a senha encerra todas as da conta.

**4. Um porteiro confere todo pedido** (`src/proxy.ts`): a assinatura primeiro, que não
custa banco, e depois a sessão no banco. Só quatro caminhos abrem sem conta — `/entrar`,
`/cadastro`, `/recuperar` e `/saude` —, e arquivo estático (ícone, `sw.js`, wasm) passa
direto. Sem sessão, a leitura vai para `/entrar?volta=…`, a ação de servidor recebe o
mesmo destino no cabeçalho que o cliente do Next entende, e o resto recebe 401. Sem
banco, 503: na dúvida a porta fica fechada. A conta segue para as telas no cabeçalho
`x-conta`, que o porteiro sempre apaga do que chega de fora.

**5. Tentativas têm limite.** Cinco falhas em 15 minutos bloqueiam o e-mail e o
endereço, no login; e o endereço, no código de cadastro. O limite fica em memória: o
sistema roda num processo só por servidor (ADR 0010).

**6. A tela não conta segredo.** O login diz sempre "E-mail ou senha não conferem", e
confere a senha mesmo quando o e-mail não tem conta — contra um hash de mentira, com o
mesmo custo —, para o tempo de resposta não dizer quais e-mails existem.

**7. Senha esquecida se troca com o código de cadastro.** Não há serviço de e-mail. O
código é a prova, e a troca encerra as outras sessões da conta.

**8. Permissões ficam para depois, e o lugar delas está marcado.** Quando houver
permissões, `usuario` ganha a tabela de papéis, o porteiro (ou a tela) confere o papel,
e a troca de senha passa a ser por e-mail — porque, com mais de uma pessoa, quem tem o
código trocaria a senha de qualquer conta. Essa mudança pede ADR novo.

## Consequências

**A favor.** Nenhum serviço de fora, nenhuma dependência nova, nenhum custo. Funciona
igual no computador e no servidor. Sessão encerrada vale na hora, em todo aparelho.

**Contra.**

- Uma consulta ao banco por pedido. É por chave primária, e o banco está no mesmo
  servidor: cerca de um milissegundo.
- O limite de tentativas zera quando o processo reinicia; com mais de um processo, ele
  tem de ir para o banco.
- Quem tem o código de cadastro pode trocar a senha de qualquer conta. Aceitável com
  uma pessoa; tem de mudar antes de a segunda pessoa ganhar conta.
- O service worker do leitor guarda as telas visitadas para funcionar sem rede, e elas
  continuam no aparelho depois de "Sair". O aparelho é do dono; com mais pessoas, sair
  passa a limpar esse cache.
- Instalação que já existia pede cadastro no primeiro acesso depois desta mudança. O
  atalho gera o código no `.env` e diz onde ele está.

**Obrigação para quem mantém:** caminho público novo é decisão, entra aqui e no teste
de `caminhos.test.ts`, que confere a lista exata. Tela lê a conta só por `contaAtual()`,
nunca pelo cookie. Senha, código e cookie nunca vão para log.
