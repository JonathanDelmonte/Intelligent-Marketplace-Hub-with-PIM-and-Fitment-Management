/**
 * O código de cadastro (ADR 0011 e 0014): quando ele é pedido, e se o que a pessoa
 * digitou confere com o do servidor.
 *
 * Digitado por gente, então a comparação perdoa o que é só forma — maiúscula, espaço,
 * hífen: "abcd efgh jkmn" é o mesmo código que "ABCD-EFGH-JKMN". E compara em tempo
 * constante, sobre o hash dos dois, para o tempo de resposta não ensinar quantas letras
 * acertaram.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

function forma(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function resumo(codigo: string): Buffer {
  return createHash('sha256').update(forma(codigo), 'utf8').digest();
}

/** O código digitado confere com o configurado? Sem código configurado, nada confere. */
export function codigoConfere(informado: string, configurado: string | undefined): boolean {
  if (configurado === undefined || forma(configurado) === '' || forma(informado) === '')
    return false;
  return timingSafeEqual(resumo(informado), resumo(configurado));
}

/**
 * Como a tela de criar conta está (ADR 0014):
 *
 * - `com_codigo`: há código configurado, e toda conta nova o pede;
 * - `primeira_conta`: sem código e sem conta nenhuma — a primeira entra sem pedir nada;
 * - `fechado`: sem código, e a primeira conta já existe.
 *
 * Sem código, o cadastro não fica aberto para sempre: toda conta vê os mesmos dados, e
 * quem achasse o endereço depois veria custos, margens e fornecedores.
 */
export type ModoDoCadastro = 'com_codigo' | 'primeira_conta' | 'fechado';

export function modoDoCadastro(
  configurado: string | undefined,
  contasExistentes: number,
): ModoDoCadastro {
  if (configurado !== undefined && forma(configurado) !== '') return 'com_codigo';
  return contasExistentes === 0 ? 'primeira_conta' : 'fechado';
}
