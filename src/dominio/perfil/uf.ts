/**
 * As 27 unidades da federação, em sigla.
 *
 * Módulo à parte, sem banco, porque o formulário de "Meu negócio" roda no navegador e
 * precisa da lista — e importar o repositório para pegar uma constante levaria o driver
 * do banco junto para o cliente.
 */
export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;
export type Uf = (typeof UFS)[number];

export function ehUf(texto: string): texto is Uf {
  return (UFS as readonly string[]).includes(texto);
}
