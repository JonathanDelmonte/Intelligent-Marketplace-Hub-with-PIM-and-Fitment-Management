/**
 * Gramáticas de nomenclatura conhecidas — **dado versionado, não lógica.**
 *
 * Mesmo formato das tabelas de taxa em `precificacao/tabelas`: conhecimento sobre
 * o mundo que muda devagar, versionado em código com a data e a fonte do
 * levantamento, e nunca misturado com o parser que o consome.
 *
 * ## A disciplina deste arquivo
 *
 * **Só entra aqui o que a especificação afirma ou o que o dono confirmou.** A
 * especificação afirma, no texto de M4 e de M6, que `PA21G` / `PA26G` / `PA31G`
 * são purificadores de água Electrolux, que o número é a linha e que o sufixo é
 * variação de cor ou voltagem. Isso é o que está abaixo, e nada além:
 *
 * - `PE` aparece na especificação (`PE11B`) **sem** dizer o que é, então não tem
 *   regra aqui. O parser ainda reconhece a forma e devolve `tipo: null`, que é a
 *   resposta certa para "não sei".
 * - Nenhum sufixo tem significado individual registrado, porque ninguém conferiu
 *   qual letra é cor e qual é voltagem. `null` é a resposta honesta.
 *
 * Marca sem gramática não fica sem função: o parser devolve a estrutura, a família
 * inclui o sufixo por precaução, e a compatibilidade continua vindo de evidência.
 * O que se perde é só a inferência de irmão — que é hipótese, não fato.
 *
 * Quando o dono precisar acrescentar marca sem editar código, isto vira tabela.
 * Está anotado em `docs/pendencias.md`.
 */
import type { GramaticaDeMarca, RegistroDeGramaticas } from './gramatica';

/** Levantamento de 13/09/2026, derivado do texto da especificação. */
export const GRAMATICA_ELECTROLUX: GramaticaDeMarca = {
  marca: 'electrolux',
  prefixos: [
    {
      prefixo: 'PA',
      tipo: 'purificador de água',
      significado: 'purificador de água',
    },
  ],
  // Vazio de propósito: o sufixo existe e ninguém confirmou qual letra é qual
  // variação. O parser devolve `significado: null` e a tela mostra "não
  // identificado", que é informação — palpite não é.
  sufixos: {},
  // A especificação diz que o sufixo é variação de cor ou voltagem, e nenhuma das
  // duas muda o refil. Então `PA21G` e `PA21X` são a mesma família, e é
  // exatamente essa frase que autoriza a inferência de irmão.
  sufixoMudaAPeca: false,
  origem: 'especificacao/M4',
};

export const GRAMATICAS_SEMENTE: RegistroDeGramaticas = {
  [GRAMATICA_ELECTROLUX.marca]: GRAMATICA_ELECTROLUX,
};
