/**
 * Geração de CSV para os arquivos de importação.
 *
 * Escrito à mão em vez de por biblioteca porque o requisito é pequeno e
 * específico: as três plataformas aceitam CSV, e o que quebra na prática não é a
 * complexidade do formato — é o BOM que o Excel brasileiro espera, o separador
 * que muda com a localidade, e o campo com vírgula ou quebra de linha que vira
 * coluna extra silenciosamente.
 */

/** Separador. Painel brasileiro costuma esperar ponto e vírgula. */
export type Separador = ';' | ',';

/**
 * Escapa um campo conforme RFC 4180, com uma precaução extra.
 *
 * O caso que a maioria das implementações erra: um campo que **começa** com `=`,
 * `+`, `-` ou `@` é interpretado como fórmula pelo Excel e pelo Google Sheets. Num
 * arquivo gerado a partir de título de anúncio — que vem de página de terceiro —
 * isso é injeção de fórmula. Prefixar com apóstrofo neutraliza sem alterar o
 * texto visível.
 */
export function escaparCampo(valor: string, separador: Separador): string {
  const neutralizado = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  const precisaAspas =
    neutralizado.includes(separador) ||
    neutralizado.includes('"') ||
    neutralizado.includes('\n') ||
    neutralizado.includes('\r');

  return precisaAspas ? `"${neutralizado.replaceAll('"', '""')}"` : neutralizado;
}

/** Monta um CSV completo, com BOM e CRLF. */
export function montarCsv(params: {
  readonly cabecalho: readonly string[];
  readonly linhas: readonly (readonly string[])[];
  readonly separador?: Separador;
  /**
   * BOM UTF-8. Sem ele o Excel em pt-BR abre "Purificador de Água" como
   * "PurificaÃ§Ã£o", e o usuário conclui que o sistema está quebrado.
   */
  readonly comBom?: boolean;
}): Uint8Array {
  const separador = params.separador ?? ';';
  const comBom = params.comBom ?? true;

  for (const [i, linha] of params.linhas.entries()) {
    if (linha.length !== params.cabecalho.length) {
      throw new Error(
        `linha ${String(i + 1)} tem ${String(linha.length)} campos, o cabeçalho tem ${String(params.cabecalho.length)}`,
      );
    }
  }

  const corpo = [params.cabecalho, ...params.linhas]
    .map((linha) => linha.map((c) => escaparCampo(c, separador)).join(separador))
    // CRLF, que é o que planilha de Windows espera.
    .join('\r\n');

  const texto = `${corpo}\r\n`;
  const bytes = new TextEncoder().encode(texto);

  if (!comBom) return bytes;

  const comPrefixo = new Uint8Array(bytes.length + 3);
  comPrefixo.set([0xef, 0xbb, 0xbf], 0);
  comPrefixo.set(bytes, 3);
  return comPrefixo;
}

/** Formata centavos como decimal com vírgula, que é o que planilha pt-BR lê. */
export function centavosParaCampo(valor: number): string {
  const sinal = valor < 0 ? '-' : '';
  const modulo = Math.abs(valor);
  const reais = Math.trunc(modulo / 100);
  const centavos = modulo % 100;
  return `${sinal}${String(reais)},${String(centavos).padStart(2, '0')}`;
}
