# ADR 0002 — Toda fonte de dados é opcional e substituível

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seções 2.3 e 6

## Contexto

As duas conversas que antecederam a especificação partiram do princípio de que a
API de busca do Mercado Livre era aberta e gratuita, e colocaram
`GET /sites/MLB/search` como base do scanner de oportunidade. O endpoint passou a
responder 403. Um sistema construído sobre aquela premissa estaria morto.

A lição não é "o ML é instável". É que **um sistema que depende de uma fonte que
pode fechar sem aviso é um sistema que morre sozinho**, e a defesa não é escolher
fontes melhores — é remover a dependência de qualquer fonte específica.

## Decisão

Três regras, sem exceção.

**1. Nenhuma tela depende de uma plataforma estar conectada.** Plataforma não
conectada aparece como coluna vazia com a etiqueta "sem conexão — importe a
planilha". Não há tela bloqueada, modal de conexão obrigatória, nem rota que
redireciona para OAuth.

**2. Todo dado tem origem registrada.** Cada registro carrega `fonte`
(`m0_link` | `m1_planilha` | `m2_publico` | `m3_api` | `manual`) e `coletado_em`.
As origens são ordenadas por força, e **dado de origem fraca nunca sobrescreve
dado de origem forte automaticamente** — a tentativa vira conflito para revisão,
não uma escrita silenciosa. A função que decide isso é pura e testada
(`src/dominio/procedencia`).

**3. Escrita é sempre opcional.** O caminho padrão de publicação é gerar o
**arquivo de importação** da plataforma, que as três aceitam, e o usuário sobe.
Publicação por API é atalho, nunca requisito.

## Consequências

**A favor.** O sistema funciona 100% com zero credencial — colando link e
importando planilha. A metade de inteligência, que é a que tem valor defensável,
não toca em nenhuma API de marketplace: das treze fontes mapeadas na seção 6, dez
não exigem credencial nenhuma. O 403 do ML custa uma linha na matriz de
capacidades, não um redesenho.

**Contra.** Mais trabalho manual no fluxo de publicação, e um importador de
planilha por plataforma para manter. Aceito, e a regra 3 é justamente o que dá
liberdade: o pior caso do sistema é "funciona, com mais cliques", nunca "não
funciona".

**Consequência de teste.** Existe um teste de arquitetura que falha se alguma rota
ou componente exigir credencial para renderizar.
