import { describe, expect, it } from 'vitest';
import { indexarPorCodigo } from './casamento';
import {
  FORCA_SEM_O_PRODUTO_BP,
  codigosDoProduto,
  comoEstaNoTitulo,
  evidenciaDoAchado,
  lerFonte,
} from './fonte';

const APARELHOS = [
  { id: 'pa21g', marca: 'Electrolux', modelo: 'PA21G' },
  { id: 'pa26g', marca: 'Electrolux', modelo: 'PA26G' },
  { id: 'pe11b', marca: 'Electrolux', modelo: 'PE11B' },
];
const indice = indexarPorCodigo(APARELHOS);
// Código de peça no padrão do sistema: corrida de letras de até cinco (`canonico.ts`).
const REFIL = 'Refil Electrolux EF-ELX-21';

describe('codigosDoProduto', () => {
  it('são os códigos do título que não são de aparelho', () => {
    expect(codigosDoProduto('Refil EF-ELX-21 para PA21G', indice)).toEqual(['EFELX21']);
    expect(codigosDoProduto('Refil para PA21G', indice)).toEqual([]);
  });

  it('a tela mostra o código como está escrito no título', () => {
    expect(comoEstaNoTitulo(REFIL, 'EFELX21')).toBe('EF-ELX-21');
    expect(comoEstaNoTitulo('Refil PA 21 G', 'PA21G')).toBe('PA21G');
  });
});

describe('lerFonte', () => {
  it('manual que cita o produto: os aparelhos entram com a força do tipo', () => {
    const texto = [
      'Manual de instruções — Purificadores Electrolux PA21G e PA26G',
      'Limpeza',
      'Troque o refil EF-ELX-21 a cada seis meses.',
    ].join('\n');
    const leitura = lerFonte({ texto, tipo: 'manual_fabricante', tituloDoProduto: REFIL, indice });

    expect(leitura.citaOProduto).toBe(true);
    expect(leitura.achados.map((a) => [a.aparelhoId, a.citaOProduto])).toEqual([
      ['pa21g', true],
      ['pa26g', true],
    ]);
    expect(leitura.achados[0]?.trecho).toContain('Purificadores Electrolux PA21G');
  });

  it('manual que não cita o produto: entra abaixo do corte, para conferir', () => {
    const leitura = lerFonte({
      texto: 'Manual do purificador Electrolux PA21G',
      tipo: 'manual_fabricante',
      tituloDoProduto: REFIL,
      indice,
    });
    expect(leitura.achados).toMatchObject([{ aparelhoId: 'pa21g', citaOProduto: false }]);

    const evidencia = evidenciaDoAchado({
      achado: leitura.achados[0] ?? {
        aparelhoId: '',
        codigo: '',
        trecho: null,
        citaOProduto: false,
      },
      tipo: 'manual_fabricante',
      url: null,
      origem: 'manual-pa21g.pdf',
      em: new Date('2026-09-24T12:00:00Z'),
    });
    expect(evidencia).toMatchObject({
      tipo: 'manual_fabricante',
      forcaBp: FORCA_SEM_O_PRODUTO_BP,
      trecho: 'manual-pa21g.pdf: Manual do purificador Electrolux PA21G',
    });
  });

  it('catálogo: só o aparelho citado perto do produto; o resto da tabela é de outra peça', () => {
    const texto = [
      'Tabela de refis — Distribuidora Água Boa',
      'EF-ELX-21 | serve em PA21G, PA26G | R$ 38,00',
      'EF-ELX-30 | serve em PE11B | R$ 42,00',
    ].join('\n');
    const leitura = lerFonte({
      texto,
      tipo: 'catalogo_distribuidor',
      tituloDoProduto: REFIL,
      indice,
    });
    expect(leitura.achados.map((a) => a.aparelhoId)).toEqual(['pa21g', 'pa26g']);
    expect(leitura.achados.every((a) => a.citaOProduto)).toBe(true);
    expect(leitura.longeDoProduto).toBe(1);
  });

  it('lista embaixo do código do produto é dele, até outra peça começar', () => {
    const texto = ['EF-ELX-21:', 'PA21G', 'PA26G', 'EF-ELX-30:', 'PE11B'].join('\n');
    const leitura = lerFonte({
      texto,
      tipo: 'catalogo_distribuidor',
      tituloDoProduto: REFIL,
      indice,
    });
    expect(leitura.achados.map((a) => a.aparelhoId)).toEqual(['pa21g', 'pa26g']);
    expect(leitura.longeDoProduto).toBe(1);
  });

  it('fórum: a resposta embaixo da pergunta é da peça perguntada', () => {
    const texto = ['Alguém sabe se o EF-ELX-21 serve?', 'Serviu no meu PE11B, sem vazar.'].join(
      '\n',
    );
    const leitura = lerFonte({ texto, tipo: 'forum', tituloDoProduto: REFIL, indice });
    expect(leitura.achados).toMatchObject([
      { aparelhoId: 'pe11b', citaOProduto: true, trecho: 'Serviu no meu PE11B, sem vazar.' },
    ]);
  });

  it('produto sem código próprio: catálogo não reconhece nada, manual vai para a fila', () => {
    const texto = 'EF-ELX-21 | serve em PA21G';
    const semCodigo = 'Refil compatível para PA21G';
    expect(
      lerFonte({ texto, tipo: 'catalogo_distribuidor', tituloDoProduto: semCodigo, indice }),
    ).toMatchObject({ achados: [], longeDoProduto: 1, codigosDoProduto: [] });
    expect(
      lerFonte({ texto, tipo: 'pagina_oficial', tituloDoProduto: semCodigo, indice }).achados,
    ).toMatchObject([{ aparelhoId: 'pa21g', citaOProduto: false }]);
  });

  it('código de duas marcas sem a marca no texto fica ambíguo, e não entra', () => {
    const duasMarcas = indexarPorCodigo([
      ...APARELHOS,
      { id: 'outra-pa21g', marca: 'Outra', modelo: 'PA21G' },
    ]);
    const leitura = lerFonte({
      texto: 'O refil EF-ELX-21 serve no PA21G.',
      tipo: 'pagina_oficial',
      tituloDoProduto: REFIL,
      indice: duasMarcas,
    });
    expect(leitura.achados).toEqual([]);
    expect(leitura.ambiguos).toEqual(['PA21G']);
  });
});
