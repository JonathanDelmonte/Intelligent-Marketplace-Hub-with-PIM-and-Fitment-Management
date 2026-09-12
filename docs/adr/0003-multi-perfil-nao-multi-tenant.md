# ADR 0003 — Multi-perfil sim, multi-tenant não

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seções 1.2, 3 e risco 5

## Contexto

Hoje há um vendedor operando: o perfil "Essencial Emporium", regime CPF. Amanhã
pode haver um segundo perfil ("Bolthz"), que é outro negócio, com outros
fornecedores e outro catálogo. E se o grafo de compatibilidade funcionar, o
sistema é vendável para outros vendedores de peça de reposição.

Há duas formas de se preparar para isso, e elas custam ordens de grandeza
diferentes. Confundir as duas é o erro que este ADR existe para impedir.

- **Multi-perfil:** uma coluna `perfil_id`, um filtro em toda query operacional,
  e nenhuma string de marca no código. Custa cerca de uma hora.
- **Multi-tenant:** isolamento de dados, convite de usuário, papéis e permissões,
  cobrança, onboarding, suporte. Custa semanas e não vende nada hoje.

## Decisão

**Fazer multi-perfil. Não fazer multi-tenant.**

O corte do modelo de dados é a decisão de modelagem mais importante do projeto:

**Carrega `perfil_id`** — é operação, é de alguém:
`sku`, `anuncio`, `pedido`, `consignacao`, `credencial`, e tudo fiscal.

**Não carrega `perfil_id`** — é conhecimento sobre o mundo, é base compartilhada:
`produto_externo`, `fornecedor`, `aparelho`, `compatibilidade`, `oportunidade`.

E a regra que sustenta isso: **nada de marca entra no código.** Nome do sistema,
logo, cores, nome do vendedor, CNPJ, regime fiscal e credenciais vêm de
configuração e de banco. O dia em que houver um segundo perfil deve ser um
`INSERT`, não um branch.

## Consequências

**A favor.** O segundo perfil é uma linha. A base compartilhada faz o sistema
ficar **mais valioso a cada perfil que entra**: o grafo de identidade e o de
compatibilidade que o perfil A construiu servem ao perfil B no dia zero. É essa
separação que permite operar dois negócios no mesmo painel, e é ela que permite
vender o sistema depois.

**Contra.** `perfil_id` em toda query operacional é disciplina permanente, e o
esquecimento é silencioso — a query funciona e retorna dado do perfil errado.
Mitigação: toda leitura operacional passa por um repositório que exige
`perfil_id` no tipo, e o compilador recusa a chamada sem ele. Um teste de
arquitetura recusa SQL operacional sem o filtro.

**Explicitamente não construído:** convite de usuário, papéis, permissões,
cobrança, onboarding, isolamento por tenant, API pública.
