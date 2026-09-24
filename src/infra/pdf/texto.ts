/**
 * O texto de um PDF, para a ingestão ler tabela de preços (M1, etapa 3.5).
 *
 * Pela `unpdf`, gratuita (CLAUDE.md, 3.7): a leitura de texto do pdf.js num pacote que
 * roda no Node sem navegador. O que ela devolve é o texto que o PDF **tem** — tabela
 * gerada por planilha ou por sistema de fornecedor. PDF que é foto escaneada não tem
 * texto, e sai vazio: ler imagem é outra etapa (3.6).
 */
import { extractText, getDocumentProxy } from 'unpdf';

export class PdfIlegivel extends Error {
  override readonly name = 'PdfIlegivel';
}

/** O texto de todas as páginas, uma depois da outra. Lança `PdfIlegivel` com o motivo. */
export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  let paginas: readonly string[];
  try {
    // Cópia: o pdf.js toma posse do buffer, e o chamador pode querer o seu de volta.
    const documento = await getDocumentProxy(new Uint8Array(bytes));
    const lido = await extractText(documento, { mergePages: false });
    paginas = lido.text;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    throw new PdfIlegivel(`não deu para ler o PDF: ${motivo.slice(0, 200)}`);
  }
  return paginas.join('\n');
}
