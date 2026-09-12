# ADR 0004 — Dinheiro em centavos inteiros

**Estado:** Aceito · **Data:** 2026-09-12

## Contexto

O núcleo do sistema é uma calculadora de margem. Ela soma comissão percentual,
taxa fixa, frete, custo, embalagem, tributo e provisão de devolução, e a saída
decide se um anúncio é publicado ou não.

`0.1 + 0.2 !== 0.3` em IEEE-754. Num cálculo com sete parcelas e dois
percentuais, o erro acumulado chega à terceira casa, e a terceira casa é
exatamente onde mora a diferença entre margem de 2% e margem de 0%.

Pior: erro de ponto flutuante em dinheiro não aparece em teste com número redondo.
Aparece em produção, num SKU de R$ 78,90, seis meses depois.

## Decisão

**Todo valor monetário é `number` inteiro em centavos**, com o tipo nominal
`Centavos` declarado em `src/lib/dinheiro.ts`.

- Nenhum `float` representa dinheiro em nenhum ponto do sistema, incluindo o
  banco: as colunas monetárias são `bigint` de centavos, nunca `numeric` e nunca
  `double precision`.
- A conversão para reais acontece **só na borda de apresentação e de entrada**
  (`formatarBRL`, `reaisParaCentavos`), e as duas são funções testadas.
- Percentual é representado em **pontos-base** (`PontosBase`, 1 bp = 0,01%), pelo
  mesmo motivo: `0.145` não é representável, `1450` é.
- Toda divisão declara o modo de arredondamento. Não existe arredondamento
  implícito: `ratear()` distribui centavos com o resto explicitamente alocado, de
  forma que a soma das partes é sempre igual ao todo.
- O tipo `Centavos` é nominal (marca de tipo), então um `number` cru não é
  aceito onde se espera dinheiro. O compilador pega a confusão entre reais e
  centavos, que é o erro mais comum desta abordagem.

## Consequências

**A favor.** O cálculo de margem é exato e reproduzível. `ratear()` resolve de uma
vez o rateio do DAS do MEI por unidade prevista no mês, que é a operação mais
propensa a erro de um centavo no sistema.

**Contra.** Verbosidade na borda, e a disciplina de nunca escrever `preco * 0.145`.
Aceito: o construtor `centavos()` e os helpers de percentual tornam o caminho
correto mais curto que o errado.
