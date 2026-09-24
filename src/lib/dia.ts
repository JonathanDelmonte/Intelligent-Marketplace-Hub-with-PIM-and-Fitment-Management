/**
 * O dia do calendário, do jeito que o campo de data do formulário manda: `2026-09-24`.
 *
 * Data de certificado, de abertura de CNPJ, de prazo — tudo que é "dia", e não
 * "instante". A diferença importa na borda: o instante tem fuso, e um dia lido como
 * meia-noite UTC vira o dia anterior quando formatado no Brasil.
 */

/**
 * `2026-09-24` → a data, ao meio-dia UTC. `null` quando o dia não existe.
 *
 * Meio-dia, e não meia-noite, para nenhum fuso levar a data para o dia anterior na hora
 * de formatar. E o dia é conferido na volta: `new Date` aceita 31 de fevereiro e devolve
 * 3 de março sem reclamar, e a data gravada seria outra que a digitada.
 */
export function lerDia(texto: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const data = new Date(`${texto}T12:00:00Z`);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10) === texto ? data : null;
}

/** A data no formato do campo de data: `2026-09-24`. Vazio quando não há data. */
export function diaDoCampo(data: Date | null): string {
  return data === null ? '' : data.toISOString().slice(0, 10);
}
