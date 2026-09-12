/**
 * Leitura de planilha para uma grade de células de texto.
 *
 * Entrega o mínimo que o mapeador precisa — uma matriz de strings — e nada mais.
 * Nenhuma interpretação de significado acontece aqui: descobrir qual coluna é
 * preço é trabalho do mapeador, e separar as duas coisas é o que permite testar
 * parsing de CSV sem saber nada de Mercado Livre.
 *
 * **CSV/TSV é parsing próprio; XLSX é biblioteca.** CSV é formato pequeno e o que
 * quebra na prática é conhecido — aspas escapadas, quebra de linha dentro de
 * campo, BOM, separador que varia com a localidade — então escrever custa pouco,
 * fica testável célula por célula e evita uma dependência. XLSX é ZIP com XML e
 * tabela de strings compartilhadas; fazer à mão seria irresponsável.
 */
import ExcelJS from 'exceljs';

/** Grade de células, já como texto. Linha 0 é a primeira linha do arquivo. */
export type Grade = readonly (readonly string[])[];

export class PlanilhaIlegivel extends Error {
  override readonly name = 'PlanilhaIlegivel';
}

/** Limite de linhas lidas, para um arquivo gigante não derrubar o processo. */
export const MAX_LINHAS = 50_000;

// ─── CSV e TSV ───────────────────────────────────────────────────────────────

/**
 * Detecta o separador contando ocorrências fora de aspas na primeira linha útil.
 *
 * Necessário porque planilha exportada de painel brasileiro usa `;` e a de painel
 * em inglês usa `,` — e o mesmo arquivo pode ter vírgula decimal dentro dos
 * campos, o que faz a contagem ingênua escolher errado. Contar **fora de aspas**
 * é o que resolve.
 */
export function detectarSeparador(texto: string): string {
  const candidatos = ['\t', ';', ',', '|'];
  const primeiraLinha = primeiraLinhaUtil(texto);

  let melhor = ';';
  let maisOcorrencias = 0;

  for (const separador of candidatos) {
    const n = contarForaDeAspas(primeiraLinha, separador);
    if (n > maisOcorrencias) {
      maisOcorrencias = n;
      melhor = separador;
    }
  }

  return melhor;
}

function primeiraLinhaUtil(texto: string): string {
  let dentroDeAspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '"') {
      dentroDeAspas = !dentroDeAspas;
    } else if (!dentroDeAspas && (c === '\n' || c === '\r')) {
      return texto.slice(0, i);
    }
  }
  return texto;
}

function contarForaDeAspas(linha: string, separador: string): number {
  let n = 0;
  let dentroDeAspas = false;
  for (const c of linha) {
    if (c === '"') dentroDeAspas = !dentroDeAspas;
    else if (!dentroDeAspas && c === separador) n += 1;
  }
  return n;
}

/**
 * Parser de CSV conforme RFC 4180, com as tolerâncias que a realidade exige.
 *
 * O que ele trata, e que uma implementação por `split` erra:
 *
 * - campo entre aspas contendo o separador
 * - aspas escapadas por duplicação (`""`)
 * - **quebra de linha dentro de campo entre aspas** — descrição de anúncio tem
 *   isso com frequência, e é o erro que mais desloca planilha
 * - BOM UTF-8 no início, que o Excel escreve
 * - CRLF e LF misturados
 */
export function lerCsv(
  texto: string,
  opcoes: { readonly separador?: string; readonly maxLinhas?: number } = {},
): Grade {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const separador = opcoes.separador ?? detectarSeparador(semBom);
  const maxLinhas = opcoes.maxLinhas ?? MAX_LINHAS;

  if (separador.length !== 1) {
    throw new PlanilhaIlegivel(`separador precisa ser um caractere, recebeu ${separador.length}`);
  }

  const linhas: string[][] = [];
  let campoAtual = '';
  let linhaAtual: string[] = [];
  let dentroDeAspas = false;

  const fecharCampo = () => {
    linhaAtual.push(campoAtual);
    campoAtual = '';
  };
  const fecharLinha = () => {
    fecharCampo();
    linhas.push(linhaAtual);
    linhaAtual = [];
  };

  for (let i = 0; i < semBom.length; i += 1) {
    const c = semBom[i]!;

    if (dentroDeAspas) {
      if (c === '"') {
        // Aspas duplicadas dentro de campo entre aspas são uma aspa literal.
        if (semBom[i + 1] === '"') {
          campoAtual += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campoAtual += c;
      }
      continue;
    }

    if (c === '"' && campoAtual === '') {
      dentroDeAspas = true;
    } else if (c === separador) {
      fecharCampo();
    } else if (c === '\n') {
      fecharLinha();
      if (linhas.length >= maxLinhas) break;
    } else if (c === '\r') {
      // CRLF: o \n seguinte fecha a linha. CR solto também fecha.
      if (semBom[i + 1] !== '\n') {
        fecharLinha();
        if (linhas.length >= maxLinhas) break;
      }
    } else {
      campoAtual += c;
    }
  }

  // Último campo sem quebra de linha no fim do arquivo.
  if (campoAtual !== '' || linhaAtual.length > 0) fecharLinha();

  return descartarLinhasVazias(linhas);
}

/**
 * Descarta linha totalmente vazia.
 *
 * Exportação de painel costuma trazer linha em branco entre o título e o
 * cabeçalho, e no fim do arquivo. Manter faria a busca de cabeçalho e a contagem
 * de registros ficarem erradas.
 */
function descartarLinhasVazias(linhas: readonly (readonly string[])[]): Grade {
  return linhas.filter((linha) => linha.some((celula) => celula.trim() !== ''));
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

/**
 * Lê a primeira aba de um XLSX como grade de texto.
 *
 * Toda célula é convertida para string, inclusive número e data. É deliberado: o
 * mapeador recebe texto e decide como interpretar, do mesmo jeito que faz com
 * CSV. Se o leitor entregasse `number` para preço e `string` para outro, o
 * mapeador precisaria de dois caminhos — e o de CSV seria o menos testado.
 */
export async function lerXlsx(
  conteudo: Uint8Array | ArrayBuffer,
  opcoes: { readonly nomeDaAba?: string; readonly maxLinhas?: number } = {},
): Promise<Grade> {
  const maxLinhas = opcoes.maxLinhas ?? MAX_LINHAS;
  const pasta = new ExcelJS.Workbook();

  try {
    const buffer = conteudo instanceof Uint8Array ? conteudo : new Uint8Array(conteudo);
    // O tipo do exceljs pede o Buffer do Node; a conversão é só de tipo.
    await pasta.xlsx.load(Buffer.from(buffer) as unknown as ArrayBuffer);
  } catch (erro) {
    throw new PlanilhaIlegivel(
      `não foi possível abrir o arquivo como XLSX: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  const aba =
    opcoes.nomeDaAba === undefined
      ? pasta.worksheets[0]
      : pasta.worksheets.find((w) => w.name === opcoes.nomeDaAba);

  if (aba === undefined) {
    const disponiveis = pasta.worksheets.map((w) => w.name).join(', ');
    throw new PlanilhaIlegivel(
      opcoes.nomeDaAba === undefined
        ? 'a planilha não tem nenhuma aba'
        : `aba "${opcoes.nomeDaAba}" não existe. Abas disponíveis: ${disponiveis}`,
    );
  }

  const linhas: string[][] = [];

  aba.eachRow({ includeEmpty: false }, (linha) => {
    if (linhas.length >= maxLinhas) return;

    const celulas: string[] = [];
    // `linha.eachCell` pula célula vazia, o que deslocaria as colunas. Percorrer
    // por índice até a largura da aba preserva a posição.
    const largura = Math.max(aba.columnCount, linha.cellCount);
    for (let c = 1; c <= largura; c += 1) {
      celulas.push(paraTexto(linha.getCell(c).value));
    }
    linhas.push(celulas);
  });

  return descartarLinhasVazias(linhas);
}

/**
 * Converte valor de célula do exceljs para texto.
 *
 * Data vira ISO e não o formato local: o mapeador precisa de algo parseável, e o
 * formato local de data é ambíguo entre dia e mês.
 */
function paraTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString();

  if (typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;

    // Célula com fórmula: interessa o resultado, não a fórmula.
    if ('result' in obj) return paraTexto(obj['result']);
    // Hyperlink: interessa o texto, não a URL.
    if ('text' in obj) return paraTexto(obj['text']);
    // Texto rico: concatenar os pedaços.
    if ('richText' in obj && Array.isArray(obj['richText'])) {
      return (obj['richText'] as { text?: unknown }[]).map((p) => paraTexto(p.text)).join('');
    }
    // Erro de célula (#N/A, #REF!) vira vazio: não é dado.
    if ('error' in obj) return '';

    // Forma de célula que não conheço. Devolver vazio em vez de
    // `String(objeto)`, que daria "[object Object]" e viraria título de produto.
    // Vazio faz a linha cair em `pendente_revisao`, que é onde ela deve estar.
    return '';
  }

  // Sobra symbol, bigint e function. `bigint` é dado; os outros não são valor de
  // célula, e `String()` neles produziria texto que viraria título de produto.
  return typeof valor === 'bigint' ? valor.toString() : '';
}

// ─── Entrada unificada ───────────────────────────────────────────────────────

export type ConteudoDePlanilha =
  | { readonly formato: 'csv'; readonly texto: string; readonly separador?: string }
  | { readonly formato: 'xlsx'; readonly bytes: Uint8Array; readonly nomeDaAba?: string };

/** Lê qualquer formato suportado para grade. */
export async function lerPlanilha(
  conteudo: ConteudoDePlanilha,
  opcoes: { readonly maxLinhas?: number } = {},
): Promise<Grade> {
  if (conteudo.formato === 'csv') {
    return lerCsv(conteudo.texto, {
      ...(conteudo.separador === undefined ? {} : { separador: conteudo.separador }),
      ...(opcoes.maxLinhas === undefined ? {} : { maxLinhas: opcoes.maxLinhas }),
    });
  }

  return lerXlsx(conteudo.bytes, {
    ...(conteudo.nomeDaAba === undefined ? {} : { nomeDaAba: conteudo.nomeDaAba }),
    ...(opcoes.maxLinhas === undefined ? {} : { maxLinhas: opcoes.maxLinhas }),
  });
}

/** Decide o formato pela extensão do nome do arquivo. */
export function formatoPorNome(nome: string): 'csv' | 'xlsx' | null {
  const minusculo = nome.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(minusculo)) return 'csv';
  if (/\.(xlsx|xlsm)$/.test(minusculo)) return 'xlsx';
  return null;
}
