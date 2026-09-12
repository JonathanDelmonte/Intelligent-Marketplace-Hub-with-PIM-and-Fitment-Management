import { describe, expect, it } from 'vitest';
import {
  ehAusencia,
  esquemaRegistroDeProduto,
  lerRegistro,
  REGISTRO_VAZIO,
  riquezaDoRegistro,
} from './registro';

describe('ehAusencia', () => {
  it('reconhece as formas que um modelo usa em vez de null', () => {
    for (const texto of [
      'N/A',
      'n.a.',
      ' NA ',
      '-',
      '--',
      '?',
      'não informado',
      'DESCONHECIDO',
      'null',
      'none',
      'unknown',
      'não se aplica',
    ]) {
      expect(ehAusencia(texto), texto).toBe(true);
    }
  });

  it('não confunde afirmação verdadeira com ausência', () => {
    // "sem marca" é uma afirmação sobre o produto: genérico. Apagar perde dado.
    for (const texto of ['sem marca', 'genérico', 'nacional', 'Nissan', 'NA-12', 'Nord']) {
      expect(ehAusencia(texto), texto).toBe(false);
    }
  });
});

describe('esquemaRegistroDeProduto', () => {
  it('aceita registro vazio, porque distribuidor publica só um código interno', () => {
    const r = esquemaRegistroDeProduto.parse({});
    expect(r.marca).toBeNull();
    expect(r.modelosCompativeis).toEqual([]);
  });

  it('transforma marca de ausência em null em vez de guardar o texto', () => {
    const r = esquemaRegistroDeProduto.parse({ marca: 'N/A', modeloPeca: 'não informado' });
    expect(r.marca).toBeNull();
    expect(r.modeloPeca).toBeNull();
  });

  it('descarta item de ausência dentro de lista', () => {
    const r = esquemaRegistroDeProduto.parse({ modelosCompativeis: ['PA21G', 'N/A', '', 'PA26G'] });
    expect(r.modelosCompativeis).toEqual(['PA21G', 'PA26G']);
  });

  it('aceita lista vinda como texto separado, que é como planilha entrega', () => {
    const r = esquemaRegistroDeProduto.parse({ modelosCompativeis: 'PA21G; PA26G, PE11B' });
    expect(r.modelosCompativeis).toEqual(['PA21G', 'PA26G', 'PE11B']);
  });

  it('não repete modelo compatível escrito duas vezes', () => {
    const r = esquemaRegistroDeProduto.parse({ modelosCompativeis: ['PA21G', 'pa21g', 'PA 21 G'] });
    expect(r.modelosCompativeis).toEqual(['PA21G']);
  });

  it('aceita quantidade como número em texto, que é como LLM emite', () => {
    expect(esquemaRegistroDeProduto.parse({ quantidadeEmbalagem: '3' }).quantidadeEmbalagem).toBe(
      3,
    );
  });

  it('recusa quantidade por extenso em vez de virar NaN', () => {
    const r = esquemaRegistroDeProduto.safeParse({ quantidadeEmbalagem: 'três' });
    expect(r.success).toBe(false);
  });

  it('recusa quantidade fracionária e zero', () => {
    expect(esquemaRegistroDeProduto.safeParse({ quantidadeEmbalagem: 1.5 }).success).toBe(false);
    expect(esquemaRegistroDeProduto.safeParse({ quantidadeEmbalagem: 0 }).success).toBe(false);
  });

  it('trata quantidade ausente como null, não como 1', () => {
    // Presumir 1 seria inventar: "não sei quantos vêm" e "vem um" decidem
    // diferente no casamento, e a diferença é o kit de três.
    expect(REGISTRO_VAZIO.quantidadeEmbalagem).toBeNull();
  });

  it('colapsa espaço interno do texto', () => {
    expect(esquemaRegistroDeProduto.parse({ marca: '  Electro   lux ' }).marca).toBe('Electro lux');
  });
});

describe('riquezaDoRegistro', () => {
  it('conta zero no registro vazio', () => {
    expect(riquezaDoRegistro(REGISTRO_VAZIO)).toBe(0);
  });

  it('conta um campo por sinal de identidade', () => {
    const r = esquemaRegistroDeProduto.parse({
      tipoProduto: 'refil',
      marca: 'Electrolux',
      modeloPeca: 'PA21G',
    });
    expect(riquezaDoRegistro(r)).toBe(3);
  });

  it('não conta campo que chegou como marca de ausência', () => {
    const r = esquemaRegistroDeProduto.parse({ tipoProduto: 'refil', marca: 'N/A' });
    expect(riquezaDoRegistro(r)).toBe(1);
  });
});

describe('lerRegistro', () => {
  it('lê null e undefined como registro vazio', () => {
    expect(lerRegistro(null)).toEqual({ tipo: 'ok', registro: REGISTRO_VAZIO });
    expect(lerRegistro(undefined)).toEqual({ tipo: 'ok', registro: REGISTRO_VAZIO });
  });

  it('devolve invalido com o bruto preservado, nunca lança', () => {
    const bruto = { quantidadeEmbalagem: 'duas' };
    const r = lerRegistro(bruto);
    expect(r.tipo).toBe('invalido');
    if (r.tipo !== 'invalido') throw new Error('esperava invalido');
    expect(r.bruto).toBe(bruto);
    expect(r.problemas[0]).toContain('quantidadeEmbalagem');
  });

  it('ignora campo desconhecido em vez de recusar o registro', () => {
    // `atributos_extraidos` de uma versão anterior do extrator tem campos a mais.
    const r = lerRegistro({ marca: 'Electrolux', campoDeOutraEra: 'x' });
    expect(r.tipo).toBe('ok');
  });
});
