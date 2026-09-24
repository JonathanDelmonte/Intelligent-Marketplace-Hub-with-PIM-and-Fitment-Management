/**
 * CPF e CNPJ: ler o que a pessoa digitou e conferir o dígito verificador.
 *
 * Como o GTIN (`dominio/gtin`), o dígito verificador não é detalhe: um dígito trocado
 * na digitação produz um número com cara de documento e dono nenhum, e é esse o número
 * que iria para a nota fiscal ou para a consulta de fornecedor.
 *
 * ## O CNPJ com letras
 *
 * Desde julho de 2026 a Receita emite CNPJ alfanumérico: as doze primeiras posições
 * aceitam letra maiúscula, e os dois dígitos verificadores continuam numéricos. O cálculo
 * é o mesmo módulo 11 de sempre, com cada caractere valendo o código ASCII menos 48 — então
 * `0` a `9` valem o que sempre valeram, e o CNPJ só de números confere exatamente como
 * antes. Um MEI aberto agora pode ter um CNPJ com letras, e recusar esse formato seria um
 * defeito na primeira vez em que ele fosse digitado.
 */

export type Documento =
  | { readonly tipo: 'cpf'; readonly valor: string }
  | { readonly tipo: 'cnpj'; readonly valor: string };

export type LeituraDoDocumento =
  | { readonly tipo: 'ok'; readonly documento: Documento }
  | { readonly tipo: 'vazio' }
  | { readonly tipo: 'invalido'; readonly motivo: string };

/** Valor de um caractere no cálculo do CNPJ: código ASCII menos 48. */
function valorDoCaractere(caractere: string): number {
  return caractere.charCodeAt(0) - 48;
}

/** Módulo 11 com pesos de 2 a 9 da direita para a esquerda, recomeçando depois do 9. */
function digitoDoCnpj(corpo: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = corpo.length - 1; i >= 0; i -= 1) {
    soma += valorDoCaractere(corpo.charAt(i)) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function digitoDoCpf(corpo: string): number {
  let soma = 0;
  let peso = corpo.length + 1;
  for (const caractere of corpo) {
    soma += Number(caractere) * peso;
    peso -= 1;
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** Todos os caracteres iguais: passa no cálculo e não é documento de ninguém. */
function repetido(texto: string): boolean {
  return texto.split('').every((c) => c === texto.charAt(0));
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || repetido(cpf)) return false;
  const primeiro = digitoDoCpf(cpf.slice(0, 9));
  const segundo = digitoDoCpf(cpf.slice(0, 9) + String(primeiro));
  return cpf.slice(9) === `${String(primeiro)}${String(segundo)}`;
}

export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || repetido(cnpj)) return false;
  const primeiro = digitoDoCnpj(cnpj.slice(0, 12));
  const segundo = digitoDoCnpj(cnpj.slice(0, 12) + String(primeiro));
  return cnpj.slice(12) === `${String(primeiro)}${String(segundo)}`;
}

/**
 * Lê CPF ou CNPJ do jeito que se cola: com ponto, traço, barra, espaço, minúscula.
 *
 * Decide pelo tamanho depois de limpar — 11 é CPF, 14 é CNPJ —, e diz o motivo quando
 * recusa, porque "inválido" sozinho não ensina se faltou dígito ou se um estava trocado.
 */
export function lerDocumento(texto: string): LeituraDoDocumento {
  const limpo = texto.replace(/[\s.\-/]/g, '').toUpperCase();
  if (limpo === '') return { tipo: 'vazio' };

  if (limpo.length === 11) {
    return cpfValido(limpo)
      ? { tipo: 'ok', documento: { tipo: 'cpf', valor: limpo } }
      : { tipo: 'invalido', motivo: 'CPF com dígito verificador que não confere.' };
  }
  if (limpo.length === 14) {
    return cnpjValido(limpo)
      ? { tipo: 'ok', documento: { tipo: 'cnpj', valor: limpo } }
      : { tipo: 'invalido', motivo: 'CNPJ com dígito verificador que não confere.' };
  }
  return {
    tipo: 'invalido',
    motivo: `tem ${String(limpo.length)} caracteres; CPF tem 11 e CNPJ tem 14.`,
  };
}

/** `12345678000195` → `12.345.678/0001-95`; `12345678909` → `123.456.789-09`. */
export function formatarDocumento(documento: Documento): string {
  const v = documento.valor;
  return documento.tipo === 'cpf'
    ? `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`
    : `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}
