import { describe, expect, it } from 'vitest';
import {
  CONFIANCA,
  casarDeterministicamente,
  valeJulgamento,
  type LadoDoCasamento,
} from './casamento';
import { esquemaRegistroDeProduto } from './registro';

function lado(ean: string | null, campos: Record<string, unknown> = {}): LadoDoCasamento {
  return { ean, registro: esquemaRegistroDeProduto.parse(campos) };
}

const EAN_A = '7896541200121';
const EAN_B = '7896541200138';

describe('casarDeterministicamente — GTIN', () => {
  it('mesmo GTIN é o único caso definitivo do sistema', () => {
    const r = casarDeterministicamente(lado(EAN_A), lado(EAN_A));
    expect(r.decisao).toBe('mesmo');
    expect(r.nivel).toBe('gtin');
    expect(r.confiancaBp).toBe(CONFIANCA.GTIN_IGUAL);
  });

  it('GTIN diferente separa, mas não com certeza total', () => {
    const r = casarDeterministicamente(lado(EAN_A), lado(EAN_B));
    expect(r.decisao).toBe('diferente');
    expect(r.confiancaBp).toBeLessThan(CONFIANCA.GTIN_IGUAL);
  });

  it('GTIN de um lado só não decide nada — cai para o nível seguinte', () => {
    const r = casarDeterministicamente(
      lado(EAN_A, { marca: 'Electrolux', modeloPeca: 'PA21G' }),
      lado(null, { marca: 'Electrolux', modeloPeca: 'pa-21-g' }),
    );
    expect(r.decisao).toBe('mesmo');
    expect(r.nivel).toBe('marca_modelo');
  });

  it('mesmo GTIN vence a quantidade divergente, e anota a inconsistência', () => {
    const r = casarDeterministicamente(
      lado(EAN_A, { quantidadeEmbalagem: 1 }),
      lado(EAN_A, { quantidadeEmbalagem: 3 }),
    );
    expect(r.decisao).toBe('mesmo');
    expect(r.inconsistencias).toHaveLength(1);
    expect(r.inconsistencias[0]).toContain('quantidade');
  });
});

describe('casarDeterministicamente — marca e modelo', () => {
  it('liga o código do distribuidor ao código do anúncio quando a marca e o modelo batem', () => {
    const anuncio = lado(null, {
      tipoProduto: 'refil de filtro',
      marca: 'Electrolux',
      modeloPeca: 'PA21G',
    });
    const distribuidor = lado(null, { marca: 'electrolux do brasil s/a', modeloPeca: 'pa 21 g' });
    const r = casarDeterministicamente(anuncio, distribuidor);
    expect(r.decisao).toBe('mesmo');
    expect(r.nivel).toBe('marca_modelo');
    expect(r.confiancaBp).toBe(CONFIANCA.MARCA_MODELO_IGUAL);
  });

  it('mesma marca e código diferente são produtos diferentes', () => {
    const r = casarDeterministicamente(
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G' }),
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA26G' }),
    );
    expect(r.decisao).toBe('diferente');
    expect(r.nivel).toBe('marca_modelo');
    expect(r.motivo).toContain('pa21g');
  });

  it('marca diferente separa o original do genérico', () => {
    const r = casarDeterministicamente(
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G' }),
      lado(null, { marca: 'Acquaclean', modeloPeca: 'AC21' }),
    );
    expect(r.decisao).toBe('diferente');
    expect(r.nivel).toBe('marca');
  });

  it('sem GTIN, quantidade divergente manda o par para revisão em vez de fundir', () => {
    // "refil avulso" e "kit de três" com a mesma marca e código são produtos de
    // venda diferentes, e sem GTIN não há árbitro.
    const r = casarDeterministicamente(
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G', quantidadeEmbalagem: 1 }),
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G', quantidadeEmbalagem: 3 }),
    );
    expect(r.decisao).toBe('indeciso');
    expect(r.motivo).toContain('quantidade');
  });

  it('quantidade ausente de um lado não é conflito', () => {
    const r = casarDeterministicamente(
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G', quantidadeEmbalagem: 3 }),
      lado(null, { marca: 'Electrolux', modeloPeca: 'PA21G' }),
    );
    expect(r.decisao).toBe('mesmo');
  });
});

describe('casarDeterministicamente — indeciso', () => {
  it('sem código de peça dos dois lados, o LLM decide', () => {
    const r = casarDeterministicamente(
      lado(null, { tipoProduto: 'refil de filtro', marca: 'Electrolux' }),
      lado(null, { tipoProduto: 'elemento filtrante', marca: 'Electrolux' }),
    );
    expect(r.decisao).toBe('indeciso');
    expect(r.nivel).toBe('nenhum');
    expect(r.confiancaBp).toBe(0);
  });

  it('marca diferente já separa mesmo sem código', () => {
    const r = casarDeterministicamente(
      lado(null, { tipoProduto: 'refil', marca: 'Electrolux' }),
      lado(null, { tipoProduto: 'refil', marca: 'Consul' }),
    );
    expect(r.decisao).toBe('diferente');
  });

  it('dois registros sem nada são indecisos, não iguais — é a armadilha que apaga a base', () => {
    const r = casarDeterministicamente(lado(null), lado(null));
    expect(r.decisao).toBe('indeciso');
  });

  it('quantidade divergente separa mesmo sem marca nem modelo', () => {
    const r = casarDeterministicamente(
      lado(null, { tipoProduto: 'refil', quantidadeEmbalagem: 1 }),
      lado(null, { tipoProduto: 'refil', quantidadeEmbalagem: 3 }),
    );
    expect(r.decisao).toBe('diferente');
  });
});

describe('valeJulgamento', () => {
  it('não paga LLM para confirmar o que o GTIN já disse', () => {
    const a = lado(EAN_A);
    const r = casarDeterministicamente(a, a);
    expect(valeJulgamento(r, a, a)).toBe(false);
  });

  it('não paga LLM para julgar dois registros vazios', () => {
    const a = lado(null);
    const r = casarDeterministicamente(a, a);
    expect(r.decisao).toBe('indeciso');
    expect(valeJulgamento(r, a, a)).toBe(false);
  });

  it('paga quando há sinal dos dois lados e a decisão não saiu', () => {
    const a = lado(null, { tipoProduto: 'refil de filtro', marca: 'Electrolux' });
    const b = lado(null, { tipoProduto: 'elemento filtrante', marca: 'Electrolux' });
    const r = casarDeterministicamente(a, b);
    expect(valeJulgamento(r, a, b)).toBe(true);
  });

  it('não paga quando um dos lados não tem sinal', () => {
    const a = lado(null, { tipoProduto: 'refil de filtro', marca: 'Electrolux' });
    const b = lado(null, { material: 'polipropileno' });
    const r = casarDeterministicamente(a, b);
    expect(r.decisao).toBe('indeciso');
    expect(valeJulgamento(r, a, b)).toBe(false);
  });
});
