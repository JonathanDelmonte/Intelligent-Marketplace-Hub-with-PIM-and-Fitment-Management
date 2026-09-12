# ADR 0008 — Extensão de navegador sob login (modo M4) fora de escopo

**Estado:** Aceito · **Data:** 2026-09-12 · Especificação, seções 2.1 e 10

## Contexto

O modo M4 — extensão de navegador lendo página logada sob a sessão do próprio
usuário — resolveria de uma vez todo dado que a API não entrega: anúncio de
terceiro, métrica de concorrente, relatório do painel. É tecnicamente simples e
tentador exatamente quando a API acabou de fechar, que é o estado atual do
`GET /sites/MLB/search`.

## Decisão

**Não construir M4. Não como contorno, não como experimento, não como flag
desligada.**

Automatizar navegação sob sessão autenticada própria é área cinzenta nos termos de
uso das três plataformas, e a punição possível é **suspensão de conta**. A conta é
o ativo do negócio: sem ela não há operação, não há reputação acumulada, e o
sistema todo perde o objeto.

O cálculo é assimétrico e é isso que decide:

- **Ganho:** marginal. Praticamente tudo que M4 entregaria está em **M1**
  (exportação de planilha do painel), que é oficial, documentado e sem risco.
- **Perda possível:** total, permanente, e não recuperável com código.

Um ganho marginal contra uma perda total não se aceita por conveniência de
implementação.

## Consequências

**A favor.** O sistema não tem superfície de risco de conta. A limitação empurra
o esforço para onde o retorno é maior de todo jeito: M1, e o fosso de
compatibilidade (M4 como módulo, não como modo de acesso — a coincidência de sigla
é infeliz e está registrada aqui para não confundir).

**Contra.** Dado de terceiro fica restrito a página pública (M0) e a planilha
(M1). Aceito, e a especificação é explícita: isso é suficiente para o painel ser
útil.

**Se algum dia entrar,** a única forma admissível é leitura de página **pública**,
nunca sob login — e mesmo aí seria M0 com outro transporte, não M4.

**Obrigação para quem mantém:** nenhuma issue, nenhum PR e nenhuma sugestão
reabre isso sem decisão explícita registrada em ADR que substitua este.
