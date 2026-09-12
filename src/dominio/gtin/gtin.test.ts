/**
 * Testes do GTIN.
 *
 * O núcleo é o dígito verificador, e o que se verifica não é "a função calcula":
 * é que ela **recusa** o que um leitor de código de barras erra na prática —
 * dígito trocado e dígitos transpostos.
 */
import { describe, expect, it } from 'vitest';
import {
  GtinInvalido,
  NIVEIS_DE_EMBALAGEM,
  ROTULO_DO_TIPO,
  TIPOS_DE_GTIN,
  digitoVerificadorDeGtin,
  ehGtinValido,
  formatarGtin,
  normalizarGtin,
  prefixoGs1,
} from './index';

// GTINs reais, com verificador conferido à mão pelo algoritmo do GS1.
const EAN13 = '7896541200121';
const EAN13_OUTRO = '7891000315507';
const UPC_A = '036000291452';
const EAN8 = '96385074';
const GTIN14_UNIDADE = '07896541200121';
const GTIN14_CAIXA = '17896541200128';

describe('dígito verificador', () => {
  it('confere os GTINs conhecidos', () => {
    expect(digitoVerificadorDeGtin(EAN13.slice(0, 12))).toBe(1);
    expect(digitoVerificadorDeGtin(UPC_A.slice(0, 11))).toBe(2);
    expect(digitoVerificadorDeGtin(EAN8.slice(0, 7))).toBe(4);
    expect(ehGtinValido(EAN13)).toBe(true);
    expect(ehGtinValido(EAN13_OUTRO)).toBe(true);
    expect(ehGtinValido(UPC_A)).toBe(true);
    expect(ehGtinValido(EAN8)).toBe(true);
  });

  it('recusa qualquer troca de um dígito — o erro típico de leitura', () => {
    for (let posicao = 0; posicao < EAN13.length; posicao += 1) {
      const original = Number(EAN13[posicao]);
      for (let novo = 0; novo <= 9; novo += 1) {
        if (novo === original) continue;
        const alterado = EAN13.slice(0, posicao) + String(novo) + EAN13.slice(posicao + 1);
        expect(ehGtinValido(alterado), `posição ${String(posicao)} para ${String(novo)}`).toBe(
          false,
        );
      }
    }
  });

  it('detecta transposição de dígitos vizinhos, menos quando diferem de 5', () => {
    // Limitação conhecida do mod 10, e documentada de propósito: pesos 3 e 1
    // alternados fazem a troca de vizinhos com diferença 5 passar. Não é bug do
    // código, é propriedade do algoritmo — e o teste existe para ninguém
    // "corrigir" isso depois achando que é defeito.
    const naoDetectadas: string[] = [];

    for (let i = 0; i < EAN13.length - 2; i += 1) {
      const a = Number(EAN13[i]);
      const b = Number(EAN13[i + 1]);
      if (a === b) continue;

      const trocado = EAN13.slice(0, i) + String(b) + String(a) + EAN13.slice(i + 2);
      if (ehGtinValido(trocado)) naoDetectadas.push(`${String(a)}${String(b)}`);
    }

    for (const par of naoDetectadas) {
      const [x, y] = [Number(par[0]), Number(par[1])];
      expect(Math.abs(x - y), `par ${par} passou sem diferir de 5`).toBe(5);
    }
  });

  it('lança para corpo que não é numérico, em vez de devolver número sem sentido', () => {
    expect(() => digitoVerificadorDeGtin('789abc')).toThrow(GtinInvalido);
    expect(() => digitoVerificadorDeGtin('')).toThrow(GtinInvalido);
  });
});

describe('normalização', () => {
  it('reconhece os quatro tipos', () => {
    expect(normalizarGtin(EAN8)?.tipo).toBe('gtin8');
    expect(normalizarGtin(UPC_A)?.tipo).toBe('upc_a');
    expect(normalizarGtin(EAN13)?.tipo).toBe('gtin13');
    expect(normalizarGtin(GTIN14_UNIDADE)?.tipo).toBe('gtin14');
  });

  it('tolera separador de planilha e de etiqueta', () => {
    for (const escrito of [
      '789 6541 20012 1',
      '789-6541-20012-1',
      ' 7896541200121 ',
      '789.6541.20012.1',
    ]) {
      expect(normalizarGtin(escrito)?.digitos, escrito).toBe(EAN13);
    }
  });

  it('recusa célula que o Excel converteu para notação científica', () => {
    // Aqui já se perderam dígitos. Adivinhar quais seria inventar dado.
    expect(normalizarGtin('7,89654E+12')).toBeNull();
    expect(normalizarGtin('7.89654e+12')).toBeNull();
  });

  it('recusa quantidade de dígitos que não é de GTIN', () => {
    for (const ruim of [
      '1',
      '1234567',
      '123456789',
      '1234567890',
      '12345678901',
      '123456789012345',
    ]) {
      expect(normalizarGtin(ruim), ruim).toBeNull();
    }
  });

  it('recusa verificador errado, mesmo com a quantidade certa de dígitos', () => {
    expect(normalizarGtin('7896541200123')).toBeNull();
    expect(normalizarGtin('96385075')).toBeNull();
  });

  it('recusa vazio, nulo e texto', () => {
    expect(normalizarGtin(null)).toBeNull();
    expect(normalizarGtin(undefined)).toBeNull();
    expect(normalizarGtin('')).toBeNull();
    expect(normalizarGtin('   ')).toBeNull();
    expect(normalizarGtin('sem numero')).toBeNull();
  });
});

describe('forma canônica de 13 dígitos', () => {
  it('UPC-A e EAN-8 viram EAN-13 por zero à esquerda, e seguem válidos', () => {
    const upc = normalizarGtin(UPC_A);
    expect(upc?.ean13).toBe('0036000291452');
    expect(ehGtinValido(upc?.ean13 ?? '')).toBe(true);

    const ean8 = normalizarGtin(EAN8);
    expect(ean8?.ean13).toBe('0000096385074');
    expect(ehGtinValido(ean8?.ean13 ?? '')).toBe(true);
  });

  it('o mesmo item em UPC e em EAN-13 colapsa na mesma chave', () => {
    const comoUpc = normalizarGtin(UPC_A);
    const comoEan = normalizarGtin(`0${UPC_A}`);
    expect(comoEan?.tipo).toBe('gtin13');
    expect(comoUpc?.ean13).toBe(comoEan?.ean13);
  });
});

describe('nível de embalagem — onde o veredito perde dinheiro', () => {
  it('GTIN-14 com indicador zero é a unidade, e vira o EAN-13 correspondente', () => {
    const g = normalizarGtin(GTIN14_UNIDADE);
    expect(g?.nivelDeEmbalagem).toBe('unidade');
    expect(g?.ean13).toBe(EAN13);
    expect(g?.digitoIndicador).toBe(0);
  });

  it('GTIN-14 com indicador de 1 a 8 é caixa, e NÃO tem forma de unidade', () => {
    const caixa = normalizarGtin(GTIN14_CAIXA);
    expect(caixa?.nivelDeEmbalagem).toBe('agrupamento');
    expect(caixa?.digitoIndicador).toBe(1);
    // `null` de propósito: comparar custo de caixa com preço de peça é o erro
    // que faz o veredito sair doze vezes otimista.
    expect(caixa?.ean13).toBeNull();
  });

  it('indicador 9 — quantidade variável — também não é unidade comparável', () => {
    // Corpo qualquer com indicador 9, verificador calculado.
    const corpo = '9789654120012';
    const completo = corpo + String(digitoVerificadorDeGtin(corpo));
    const g = normalizarGtin(completo);
    expect(g?.nivelDeEmbalagem).toBe('agrupamento');
    expect(g?.ean13).toBeNull();
  });
});

describe('prefixo GS1', () => {
  it('reconhece o Brasil', () => {
    expect(prefixoGs1(normalizarGtin(EAN13)!)?.rotulo).toBe('Brasil');
  });

  it('avisa quando o código é de uso interno de loja', () => {
    const corpo = '200123456789';
    const completo = corpo + String(digitoVerificadorDeGtin(corpo));
    const aviso = prefixoGs1(normalizarGtin(completo)!);
    expect(aviso?.rotulo).toContain('uso interno');
  });

  it('devolve null para agrupamento, que não tem forma de 13 dígitos', () => {
    expect(prefixoGs1(normalizarGtin(GTIN14_CAIXA)!)).toBeNull();
  });

  it('devolve null para prefixo que não é reconhecido', () => {
    const corpo = '500123456789';
    const completo = corpo + String(digitoVerificadorDeGtin(corpo));
    expect(prefixoGs1(normalizarGtin(completo)!)).toBeNull();
  });
});

describe('exibição e completude', () => {
  it('formata cada tamanho de forma legível', () => {
    expect(formatarGtin(normalizarGtin(EAN13)!)).toBe('789 6541 20012 1');
    expect(formatarGtin(normalizarGtin(EAN8)!)).toBe('9638 5074');
    expect(formatarGtin(normalizarGtin(UPC_A)!)).toBe('0 36000 29145 2');
    expect(formatarGtin(normalizarGtin(GTIN14_CAIXA)!)).toBe('1 789 6541 20012 8');
  });

  it('todo tipo tem rótulo e todo nível está declarado', () => {
    for (const tipo of TIPOS_DE_GTIN) expect(ROTULO_DO_TIPO[tipo]).not.toBe('');
    expect(NIVEIS_DE_EMBALAGEM).toEqual(['unidade', 'agrupamento']);
  });
});
