import { describe, expect, it } from 'vitest';
import { pdfComLinhas } from './teste';
import { PdfIlegivel, textoDoPdf } from './texto';

describe('textoDoPdf', () => {
  it('lê o texto de um PDF gerado, linha por linha', async () => {
    const texto = await textoDoPdf(pdfComLinhas(['Refil PA21G - 38,00', 'Refil PE11B - 42,50']));
    expect(texto).toContain('Refil PA21G - 38,00');
    expect(texto).toContain('Refil PE11B - 42,50');
  });

  it('o que não é PDF lança com o motivo', async () => {
    await expect(textoDoPdf(new TextEncoder().encode('não sou PDF'))).rejects.toThrow(PdfIlegivel);
  });
});
