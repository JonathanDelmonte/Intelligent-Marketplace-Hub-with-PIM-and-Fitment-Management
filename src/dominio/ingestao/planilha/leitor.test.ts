import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  MAX_LINHAS,
  PlanilhaIlegivel,
  detectarSeparador,
  formatoPorNome,
  lerCsv,
  lerPlanilha,
  lerXlsx,
} from './leitor';

describe('detectarSeparador', () => {
  it('reconhece ponto e vírgula, vírgula, tabulação e barra vertical', () => {
    expect(detectarSeparador('a;b;c\n1;2;3')).toBe(';');
    expect(detectarSeparador('a,b,c\n1,2,3')).toBe(',');
    expect(detectarSeparador('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectarSeparador('a|b|c\n1|2|3')).toBe('|');
  });

  it('não se engana com vírgula decimal dentro de campo entre aspas', () => {
    // O caso real: planilha pt-BR com separador `;` e preço `69,90`. Contar
    // vírgulas ingenuamente escolheria `,` e a planilha inteira deslocaria.
    expect(detectarSeparador('"Produto";"Preço";"Estoque"\n"Refil";"69,90";"10"')).toBe(';');
  });

  it('respeita aspas com quebra de linha dentro do campo', () => {
    const texto = '"Título";"Descrição"\n"Refil";"linha 1\nlinha 2, com vírgula"';
    expect(detectarSeparador(texto)).toBe(';');
  });

  it('cai no padrão quando não há separador nenhum', () => {
    expect(detectarSeparador('umacolunaso')).toBe(';');
  });

  /**
   * Regressão do defeito mais consequente deste arquivo.
   *
   * A versão anterior olhava só a primeira linha útil. Exportação de painel quase
   * sempre começa com linha de título ("Relatório de anúncios", "Gerado em ..."),
   * que não tem separador — então toda contagem dava zero e a função devolvia o
   * padrão `;`. Arquivo separado por vírgula era lido como uma coluna só, e o
   * sintoma aparecia três camadas depois como "nenhuma linha parece um cabeçalho".
   *
   * O bug ficou escondido porque a planilha de teste era do Mercado Livre, que usa
   * exatamente o `;` do padrão.
   */
  describe('linha de título antes do cabeçalho', () => {
    it('acha a vírgula mesmo com título sem separador na primeira linha', () => {
      const texto = [
        'Relatorio de anuncios',
        'ID do produto,Nome do produto,Preco,Estoque',
        'SP1,Refil Consul CPB35,"59,90",7',
        'SP2,Vedacao Consul,"14,90",3',
      ].join('\n');

      expect(detectarSeparador(texto)).toBe(',');
      expect(lerCsv(texto)[1]).toEqual(['ID do produto', 'Nome do produto', 'Preco', 'Estoque']);
    });

    it('acha a tabulação com duas linhas de preâmbulo', () => {
      const texto = ['Exportacao', 'Gerado em 12/09/2026', 'a\tb\tc', '1\t2\t3'].join('\n');
      expect(detectarSeparador(texto)).toBe('\t');
    });

    it('não se deixa levar por vírgula que só aparece no título', () => {
      // "Gerado em 12/09/2026, 09:14" tem uma vírgula; as linhas de dados têm
      // quatro `;` cada. Consistência decide, não primeira ocorrência.
      const texto = [
        'Relatorio de anuncios, Mercado Livre',
        'Gerado em 12/09/2026, 09:14',
        'MLB;Titulo;Preco;Estoque',
        'MLB1;Refil;69,90;10',
        'MLB2;Vedacao;19,90;20',
      ].join('\n');

      expect(detectarSeparador(texto)).toBe(';');
    });

    it('ignora linha vazia entre o título e o cabeçalho', () => {
      const texto = ['Relatorio', '', '', 'a,b,c', '1,2,3'].join('\n');
      expect(detectarSeparador(texto)).toBe(',');
    });

    it('funciona com fim de linha do Windows', () => {
      const texto = ['Relatorio de anuncios', 'a,b,c', '1,2,3'].join(String.fromCharCode(13, 10));
      expect(detectarSeparador(texto)).toBe(',');
    });
  });
});

describe('lerCsv', () => {
  it('lê o caso trivial', () => {
    expect(lerCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('trata campo entre aspas contendo o separador', () => {
    expect(lerCsv('a;b\n"um;dois";3')).toEqual([
      ['a', 'b'],
      ['um;dois', '3'],
    ]);
  });

  it('trata aspas escapadas por duplicação', () => {
    expect(lerCsv('a\n"diz ""oi"""')).toEqual([['a'], ['diz "oi"']]);
  });

  it('trata quebra de linha DENTRO de campo entre aspas', () => {
    // É o erro que mais desloca planilha: descrição de anúncio tem parágrafo.
    const grade = lerCsv('titulo;descricao\n"Refil";"linha 1\nlinha 2\nlinha 3"');
    expect(grade).toHaveLength(2);
    expect(grade[1]?.[1]).toBe('linha 1\nlinha 2\nlinha 3');
  });

  it('remove o BOM UTF-8 que o Excel escreve', () => {
    // O BOM entra por escape; como byte, tornaria este arquivo binario.
    const grade = lerCsv('\uFEFFtitulo;preco\nRefil de Água;69,90');
    expect(grade[0]?.[0]).toBe('titulo');
    expect(grade[1]?.[0]).toBe('Refil de Água');
  });

  it('aceita CRLF, LF e CR solto', () => {
    expect(lerCsv('a;b\r\n1;2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(lerCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(lerCsv('a;b\r1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('lê o último campo sem quebra de linha no fim', () => {
    expect(lerCsv('a;b\n1;2')[1]).toEqual(['1', '2']);
  });

  it('preserva campo vazio, porque posição de coluna importa', () => {
    expect(lerCsv('a;b;c\n1;;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('descarta linha totalmente vazia', () => {
    // Exportação de painel traz linha em branco entre título e cabeçalho.
    const grade = lerCsv('titulo;preco\n\n\nRefil;69,90\n\n');
    expect(grade).toEqual([
      ['titulo', 'preco'],
      ['Refil', '69,90'],
    ]);
  });

  it('não descarta linha cujo único conteúdo é um zero', () => {
    expect(lerCsv('a;b\n0;')).toEqual([
      ['a', 'b'],
      ['0', ''],
    ]);
  });

  it('aceita separador explícito', () => {
    expect(lerCsv('a,b;c\n1,2;3', { separador: ';' })).toEqual([
      ['a,b', 'c'],
      ['1,2', '3'],
    ]);
  });

  it('recusa separador de mais de um caractere', () => {
    expect(() => lerCsv('a;;b', { separador: ';;' })).toThrow(PlanilhaIlegivel);
  });

  it('respeita o limite de linhas', () => {
    const texto = Array.from({ length: 50 }, (_, i) => `linha${String(i)};x`).join('\n');
    expect(lerCsv(texto, { maxLinhas: 10 })).toHaveLength(10);
  });

  it('tem limite padrão, para arquivo gigante não derrubar o processo', () => {
    expect(MAX_LINHAS).toBeGreaterThan(1000);
    expect(MAX_LINHAS).toBeLessThanOrEqual(100_000);
  });

  it('devolve grade vazia para texto vazio', () => {
    expect(lerCsv('')).toEqual([]);
    expect(lerCsv('\n\n')).toEqual([]);
  });

  it('aspa no meio do campo, sem abrir o campo, é literal', () => {
    // `a"b` sem aspas ao redor: a aspa é conteúdo, não delimitador.
    expect(lerCsv('x\na"b')).toEqual([['x'], ['a"b']]);
  });

  it('lê TSV real, como a Amazon exporta', () => {
    const tsv = 'item_name\tstandard_price\tquantity\nRefil PA21G\t69.90\t10';
    expect(lerCsv(tsv)).toEqual([
      ['item_name', 'standard_price', 'quantity'],
      ['Refil PA21G', '69.90', '10'],
    ]);
  });
});

// ─── XLSX ────────────────────────────────────────────────────────────────────

/** Gera um XLSX de verdade em memória, para o teste não depender de fixture. */
async function montarXlsx(
  abas: readonly { readonly nome: string; readonly linhas: readonly unknown[][] }[],
): Promise<Uint8Array> {
  const pasta = new ExcelJS.Workbook();
  for (const aba of abas) {
    const planilha = pasta.addWorksheet(aba.nome);
    for (const linha of aba.linhas) planilha.addRow([...linha]);
  }
  const buffer = await pasta.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

describe('lerXlsx', () => {
  it('lê a primeira aba como texto', async () => {
    const bytes = await montarXlsx([
      {
        nome: 'Anúncios',
        linhas: [
          ['titulo', 'preco'],
          ['Refil PA21G', 69.9],
        ],
      },
    ]);
    expect(await lerXlsx(bytes)).toEqual([
      ['titulo', 'preco'],
      ['Refil PA21G', '69.9'],
    ]);
  });

  it('converte número e booleano para texto', async () => {
    // O mapeador recebe texto e decide como interpretar, igual ao caminho do CSV.
    // Dois caminhos de tipo faria o de CSV ser o menos testado.
    const bytes = await montarXlsx([
      {
        nome: 'a',
        linhas: [
          ['n', 'b'],
          [1234, true],
        ],
      },
    ]);
    const grade = await lerXlsx(bytes);
    expect(grade[1]?.[0]).toBe('1234');
    expect(grade[1]?.[1]).toBe('true');
  });

  it('converte data para ISO, não para formato local ambíguo', async () => {
    const bytes = await montarXlsx([
      { nome: 'a', linhas: [['data'], [new Date('2026-09-12T00:00:00Z')]] },
    ]);
    expect(await lerXlsx(bytes).then((g) => g[1]?.[0])).toContain('2026-09-12');
  });

  it('preserva a posição da coluna quando há célula vazia no meio', async () => {
    // `eachCell` do exceljs pula célula vazia, o que deslocaria tudo à direita.
    const bytes = await montarXlsx([
      {
        nome: 'a',
        linhas: [
          ['a', 'b', 'c'],
          ['1', null, '3'],
        ],
      },
    ]);
    const grade = await lerXlsx(bytes);
    expect(grade[1]?.[0]).toBe('1');
    expect(grade[1]?.[1]).toBe('');
    expect(grade[1]?.[2]).toBe('3');
  });

  it('escolhe a aba por nome quando pedido', async () => {
    const bytes = await montarXlsx([
      { nome: 'Primeira', linhas: [['x'], ['1']] },
      { nome: 'Pedidos', linhas: [['y'], ['2']] },
    ]);
    expect(await lerXlsx(bytes, { nomeDaAba: 'Pedidos' })).toEqual([['y'], ['2']]);
  });

  it('lança com as abas disponíveis quando o nome não existe', async () => {
    const bytes = await montarXlsx([{ nome: 'Primeira', linhas: [['x'], ['1']] }]);
    await expect(lerXlsx(bytes, { nomeDaAba: 'Inexistente' })).rejects.toThrow(/Primeira/);
  });

  it('lança PlanilhaIlegivel para conteúdo que não é XLSX', async () => {
    const naoEhZip = new TextEncoder().encode('isto e um texto, nao um xlsx');
    await expect(lerXlsx(naoEhZip)).rejects.toThrow(PlanilhaIlegivel);
  });

  it('respeita o limite de linhas', async () => {
    const linhas = Array.from({ length: 40 }, (_, i) => [`linha${String(i)}`]);
    const bytes = await montarXlsx([{ nome: 'a', linhas }]);
    expect(await lerXlsx(bytes, { maxLinhas: 5 })).toHaveLength(5);
  });

  it('descarta linha totalmente vazia', async () => {
    const bytes = await montarXlsx([{ nome: 'a', linhas: [['titulo'], [null], [''], ['Refil']] }]);
    expect(await lerXlsx(bytes)).toEqual([['titulo'], ['Refil']]);
  });
});

describe('lerPlanilha', () => {
  it('roteia CSV e XLSX pelo formato declarado', async () => {
    expect(await lerPlanilha({ formato: 'csv', texto: 'a;b\n1;2' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);

    const bytes = await montarXlsx([
      {
        nome: 'a',
        linhas: [
          ['a', 'b'],
          ['1', '2'],
        ],
      },
    ]);
    expect(await lerPlanilha({ formato: 'xlsx', bytes })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('repassa o limite de linhas', async () => {
    const texto = Array.from({ length: 20 }, (_, i) => `l${String(i)};x`).join('\n');
    expect(await lerPlanilha({ formato: 'csv', texto }, { maxLinhas: 3 })).toHaveLength(3);
  });
});

describe('formatoPorNome', () => {
  it('reconhece as extensões que as plataformas exportam', () => {
    expect(formatoPorNome('meus-anuncios.xlsx')).toBe('xlsx');
    expect(formatoPorNome('relatorio.XLSM')).toBe('xlsx');
    expect(formatoPorNome('vendas.csv')).toBe('csv');
    expect(formatoPorNome('vendas.tsv')).toBe('csv');
    // A Amazon exporta .txt separado por tabulação.
    expect(formatoPorNome('amazon-report.txt')).toBe('csv');
  });

  it('devolve null para o que não sabe ler', () => {
    expect(formatoPorNome('tabela.pdf')).toBeNull();
    expect(formatoPorNome('foto.jpg')).toBeNull();
    expect(formatoPorNome('semextensao')).toBeNull();
  });
});
