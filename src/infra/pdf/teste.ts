/** Apoio de teste: PDF montado à mão, sem arquivo guardado no repositório. */

/**
 * Um PDF de verdade, montado à mão: uma página, Helvetica, uma linha de texto por item.
 *
 * Os deslocamentos da tabela `xref` são calculados, e não inventados — o leitor tolera
 * tabela errada, mas o teste não deve depender dessa tolerância.
 */
export function pdfComLinhas(linhas: readonly string[]): Uint8Array<ArrayBuffer> {
  const escapar = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const conteudo = [
    'BT /F1 12 Tf 50 800 Td 16 TL',
    ...linhas.map((l) => `(${escapar(l)}) Tj T*`),
    'ET',
  ].join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(conteudo.length)} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const posicoes: number[] = [];
  objetos.forEach((objeto, i) => {
    posicoes.push(pdf.length);
    pdf += `${String(i + 1)} 0 obj\n${objeto}\nendobj\n`;
  });
  const inicioDaXref = pdf.length;
  pdf += `xref\n0 ${String(objetos.length + 1)}\n0000000000 65535 f \n`;
  for (const p of posicoes) pdf += `${String(p).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objetos.length + 1)} /Root 1 0 R >>\nstartxref\n${String(inicioDaXref)}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
