/**
 * O código de cadastro (ADR 0011): confere o que a pessoa digitou com o do servidor.
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
