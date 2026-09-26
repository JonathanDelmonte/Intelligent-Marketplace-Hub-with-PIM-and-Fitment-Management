import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  CopiaInvalida,
  MOTIVO_DE_COPIA_CORTADA,
  MOTIVO_DE_COPIA_INCOMPLETA,
  MOTIVO_DE_NAO_SER_COPIA,
  conferirCopia,
  linhasDoArquivo,
  percorrerCopia,
  type BlocoDaCopia,
  type CabecalhoDaCopia,
} from './formato-da-copia';

/** Uma cópia pequena, escrita como `gerarCopia` escreve. */
const COPIA = [
  '-- Cópia dos dados: Sistema de teste',
  '-- copia-formato: 1',
  '-- gerada-em: 2026-09-26T15:30:00.000Z',
  '-- versao: 09dd7271129c6a352cae006c656c791bb64671e1',
  '-- migracao: 1790394110460',
  '-- tabelas: perfil_vendedor sku',
  '--',
  '-- Restaurar substitui os dados destas tabelas pelos da cópia.',
  '',
  "SET client_encoding = 'UTF8';",
  'SET standard_conforming_strings = on;',
  'BEGIN;',
  'TRUNCATE TABLE public."perfil_vendedor", public."sku";',
  '',
  'COPY public."perfil_vendedor" ("id", "slug", "nome") FROM stdin;',
  'p1\tprincipal\tLoja\\tcom tab',
  '\\.',
  '-- perfil_vendedor: 1 linha',
  '',
  'COPY public."sku" ("id", "perfil_id", "titulo_interno") FROM stdin;',
  's1\tp1\tRefil PA21G',
  's2\tp1\tVela \\N',
  '\\.',
  '-- sku: 2 linhas',
  '',
  'COMMIT;',
  '-- fim-da-copia: tabelas=2 linhas=3',
  '',
].join('\n');

async function* linhasDe(texto: string): AsyncGenerator<string> {
  await Promise.resolve();
  for (const linha of texto.split('\n')) yield linha;
}

/** Um fluxo de bytes entregue nos pedaços pedidos — para cortar no meio da linha e do acento. */
function fluxoEmPedacos(
  bytes: Uint8Array,
  tamanho: number,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  let posicao = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controle) {
      if (posicao >= bytes.byteLength) {
        controle.close();
        return;
      }
      controle.enqueue(new Uint8Array(bytes.slice(posicao, posicao + tamanho)));
      posicao += tamanho;
    },
  });
}

async function todas(linhas: AsyncIterable<string>): Promise<string[]> {
  const lidas: string[] = [];
  for await (const linha of linhas) lidas.push(linha);
  return lidas;
}

const bytes = (texto: string) => new TextEncoder().encode(texto);

describe('conferirCopia', () => {
  it('diz de quando é a cópia, de que versão, e quantas tabelas e linhas tem', async () => {
    expect(await conferirCopia(linhasDe(COPIA))).toEqual({
      geradaEm: '2026-09-26T15:30:00.000Z',
      versao: '09dd7271129c6a352cae006c656c791bb64671e1',
      tabelas: 2,
      linhas: 3,
    });
  });

  it('arquivo que não é cópia é recusado', async () => {
    await expect(conferirCopia(linhasDe('id;nome\n1;planilha\n'))).rejects.toThrow(
      MOTIVO_DE_NAO_SER_COPIA,
    );
  });

  it('cópia cortada no meio de uma tabela é recusada', async () => {
    const cortada = COPIA.slice(0, COPIA.indexOf('s2\t'));
    await expect(conferirCopia(linhasDe(cortada))).rejects.toThrow(MOTIVO_DE_COPIA_CORTADA);
  });

  it('cópia sem a linha de fechamento, ou com a conta errada, está incompleta', async () => {
    const semFim = COPIA.slice(0, COPIA.indexOf('-- fim-da-copia'));
    await expect(conferirCopia(linhasDe(semFim))).rejects.toThrow(MOTIVO_DE_COPIA_INCOMPLETA);

    const contaErrada = COPIA.replace('linhas=3', 'linhas=4');
    await expect(conferirCopia(linhasDe(contaErrada))).rejects.toThrow(MOTIVO_DE_COPIA_INCOMPLETA);
  });

  it('linha que não é de cópia recusa o arquivo inteiro', async () => {
    const comComando = COPIA.replace('BEGIN;\n', 'BEGIN;\nDROP TABLE sku;\n');
    await expect(conferirCopia(linhasDe(comComando))).rejects.toThrow(
      'linha que não é de uma cópia: DROP TABLE sku;',
    );
  });

  it('bloco de tabela que não está na lista do cabeçalho é recusado', async () => {
    const foraDaLista = COPIA.replace(
      '-- tabelas: perfil_vendedor sku',
      '-- tabelas: perfil_vendedor',
    );
    await expect(conferirCopia(linhasDe(foraDaLista))).rejects.toThrow(
      'a tabela sku não está na lista da cópia',
    );
  });
});

describe('percorrerCopia', () => {
  it('entrega o cabeçalho antes dos blocos, e cada bloco com as linhas dele', async () => {
    const vistos: string[] = [];
    let cabecalhoLido: CabecalhoDaCopia | null = null;
    const blocos: { bloco: BlocoDaCopia; dados: string }[] = [];

    await percorrerCopia(linhasDe(COPIA), {
      aoLerCabecalho: (cabecalho) => {
        vistos.push('cabecalho');
        cabecalhoLido = cabecalho;
        return Promise.resolve();
      },
      aoLerBloco: async (bloco, lotes) => {
        vistos.push(bloco.tabela);
        let dados = '';
        for await (const lote of lotes) dados += lote;
        blocos.push({ bloco, dados });
      },
    });

    expect(vistos).toEqual(['cabecalho', 'perfil_vendedor', 'sku']);
    expect(cabecalhoLido).toEqual({
      geradaEm: '2026-09-26T15:30:00.000Z',
      versao: '09dd7271129c6a352cae006c656c791bb64671e1',
      migracao: 1790394110460,
      tabelas: ['perfil_vendedor', 'sku'],
    });
    expect(blocos[1]).toEqual({
      bloco: { tabela: 'sku', colunas: ['id', 'perfil_id', 'titulo_interno'] },
      dados: 's1\tp1\tRefil PA21G\ns2\tp1\tVela \\N\n',
    });
  });

  it('recusa de quem lê o cabeçalho para antes do primeiro bloco', async () => {
    let blocosLidos = 0;
    await expect(
      percorrerCopia(linhasDe(COPIA), {
        aoLerCabecalho: () => Promise.reject(new CopiaInvalida('banco mais velho que a cópia')),
        aoLerBloco: async (_bloco, lotes) => {
          blocosLidos += 1;
          for await (const lote of lotes) void lote;
        },
      }),
    ).rejects.toThrow('banco mais velho que a cópia');
    expect(blocosLidos).toBe(0);
  });

  it('quem lê o bloco e para no meio é erro, e não dado lido como comando', async () => {
    await expect(
      percorrerCopia(linhasDe(COPIA), {
        aoLerBloco: () => Promise.resolve(),
      }),
    ).rejects.toThrow('o bloco da tabela perfil_vendedor não foi lido até o fim');
  });
});

describe('linhasDoArquivo', () => {
  it('lê a cópia comprimida e a descomprimida, e as duas dão as mesmas linhas', async () => {
    const esperadas = COPIA.split('\n').slice(0, -1);
    expect(await todas(linhasDoArquivo(fluxoEmPedacos(gzipSync(COPIA), 7)))).toEqual(esperadas);
    expect(await todas(linhasDoArquivo(fluxoEmPedacos(bytes(COPIA), 7)))).toEqual(esperadas);
  });

  it('pedaço que corta a linha e o acento no meio não estraga o texto', async () => {
    const texto = 'ação\nsegunda linha\núltima sem quebra';
    // Um byte por vez: todo "ç" e todo "ã" chegam partidos em dois pedaços.
    expect(await todas(linhasDoArquivo(fluxoEmPedacos(bytes(texto), 1)))).toEqual([
      'ação',
      'segunda linha',
      'última sem quebra',
    ]);
  });

  it('quebra de linha do Windows vira quebra comum', async () => {
    expect(await todas(linhasDoArquivo(fluxoEmPedacos(bytes('a\r\nb\r\n'), 3)))).toEqual([
      'a',
      'b',
    ]);
  });

  it('arquivo vazio não tem linha nenhuma', async () => {
    expect(await todas(linhasDoArquivo(fluxoEmPedacos(new Uint8Array(0), 4)))).toEqual([]);
  });

  it('gzip corrompido vira cópia inválida, e não erro solto', async () => {
    const comprimido = gzipSync(COPIA);
    const estragado = comprimido.slice(0, comprimido.byteLength - 20);
    estragado[20] = (estragado[20] ?? 0) ^ 0xff;
    await expect(todas(linhasDoArquivo(fluxoEmPedacos(estragado, 64)))).rejects.toBeInstanceOf(
      CopiaInvalida,
    );
  });

  it('a cópia comprimida passa inteira pela conferência', async () => {
    expect((await conferirCopia(linhasDoArquivo(fluxoEmPedacos(gzipSync(COPIA), 5)))).linhas).toBe(
      3,
    );
  });
});
