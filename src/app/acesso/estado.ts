/**
 * O estado dos formulários de acesso, entre a ação e a tela.
 *
 * Mora fora de `acoes.ts` porque arquivo com `'use server'` só exporta função
 * assíncrona. O e-mail e o nome voltam para o formulário no erro: redigitar tudo por
 * causa de uma senha curta é o tipo de atrito que faz a pessoa desistir.
 */
export interface EstadoDoFormulario {
  readonly erro: string | null;
  readonly email: string;
  readonly nome: string;
}

export const ESTADO_INICIAL: EstadoDoFormulario = { erro: null, email: '', nome: '' };
