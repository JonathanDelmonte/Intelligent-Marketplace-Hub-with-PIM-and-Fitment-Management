import { describe, expect, it } from 'vitest';
import {
  analisarModelo,
  descreverAnalise,
  descreverRecusa,
  familiaDe,
  type GramaticaDeMarca,
  type RegistroDeGramaticas,
} from './gramatica';
import { GRAMATICAS_SEMENTE } from './gramaticas';

/** Gramática de teste: não depende do conteúdo da semente. */
const MARCA_FICTICIA: GramaticaDeMarca = {
  marca: 'acme',
  prefixos: [{ prefixo: 'XP', tipo: 'cafeteira', significado: 'cafeteira' }],
  sufixos: { A: 'cor areia', B: null },
  sufixoMudaAPeca: false,
  origem: 'teste',
};

/** A mesma marca, mas onde o sufixo muda a peça. */
const MARCA_ESTRITA: GramaticaDeMarca = {
  ...MARCA_FICTICIA,
  marca: 'estrita',
  sufixoMudaAPeca: true,
};

const gramaticas: RegistroDeGramaticas = {
  acme: MARCA_FICTICIA,
  estrita: MARCA_ESTRITA,
};

const analisar = (marca: string, modelo: string) => {
  const r = analisarModelo(marca, modelo, gramaticas);
  if (!r.ok) throw new Error(`esperava análise, veio recusa: ${r.motivo}`);
  return r.analise;
};

describe('analisarModelo — forma', () => {
  it('separa prefixo, linha e sufixo', () => {
    const a = analisar('Acme', 'XP21A');
    expect(a.prefixo).toBe('XP');
    expect(a.linha).toBe('21');
    expect(a.sufixo).toBe('A');
  });

  it('aceita código sem sufixo', () => {
    const a = analisar('Acme', 'XP21');
    expect(a.sufixo).toBeNull();
    expect(a.segmentos).toHaveLength(2);
  });

  it('normaliza pontuação e caixa antes de analisar', () => {
    expect(analisar('Acme', 'xp-21-a').codigo).toBe('XP21A');
    expect(analisar('Acme', 'XP 21 A').codigo).toBe('XP21A');
  });

  it('aceita prefixo de uma letra com número longo, que é padrão de linha branca', () => {
    // `W10295370` é número de peça de Whirlpool. Recusar porque `W` é watt foi um
    // erro de uma versão anterior do reconhecedor de código, e o teste está aqui
    // para que ele não volte por outra porta.
    const a = analisar('Whirlpool', 'W10295370');
    expect(a.prefixo).toBe('W');
    expect(a.linha).toBe('10295370');
  });

  it('recusa modelo que não tem forma de código', () => {
    const r = analisarModelo('Acme', 'purificador de agua', gramaticas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('nao_e_codigo');
  });

  it('recusa código sem marca, porque código sozinho não identifica fabricante', () => {
    const r = analisarModelo('  ', 'XP21A', gramaticas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('sem_marca');
  });

  it('recusa modelo vazio', () => {
    const r = analisarModelo('Acme', '   ', gramaticas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('sem_modelo');
  });

  it('recusa forma com dois blocos de dígito em vez de chutar onde cortar', () => {
    const r = analisarModelo('Acme', 'XP21A30', gramaticas);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('forma_desconhecida');
  });

  it('todo motivo de recusa tem texto', () => {
    expect(descreverRecusa('forma_desconhecida')).toContain('forma');
    expect(descreverRecusa('sem_marca')).not.toBe('');
  });
});

describe('analisarModelo — significado', () => {
  it('usa a gramática da marca para nomear o prefixo', () => {
    const a = analisar('Acme', 'XP21A');
    expect(a.tipo).toBe('cafeteira');
    expect(a.regra).toBe('gramatica:teste/XP');
  });

  it('não inventa significado de sufixo que ninguém confirmou', () => {
    const a = analisar('Acme', 'XP21B');
    const sufixo = a.segmentos.find((s) => s.papel === 'sufixo');
    expect(sufixo?.significado).toBeNull();
  });

  it('nomeia o sufixo quando a gramática afirma', () => {
    const a = analisar('Acme', 'XP21A');
    expect(a.segmentos.find((s) => s.papel === 'sufixo')?.significado).toBe('cor areia');
  });

  it('marca sem gramática ainda recebe estrutura, com tipo nulo', () => {
    const a = analisar('Desconhecida', 'ZZ44K');
    expect(a.tipo).toBeNull();
    expect(a.regra).toBe('forma-generica');
    expect(a.prefixo).toBe('ZZ');
  });

  it('prefixo fora da gramática da marca cai na forma genérica', () => {
    const a = analisar('Acme', 'QQ10');
    expect(a.tipo).toBeNull();
    expect(a.regra).toBe('forma-generica');
  });
});

describe('família e linhagem', () => {
  it('sufixo que não muda a peça fica fora da família', () => {
    expect(analisar('Acme', 'XP21A').familia).toBe(analisar('Acme', 'XP21B').familia);
  });

  it('linha diferente é família diferente', () => {
    expect(analisar('Acme', 'XP21A').familia).not.toBe(analisar('Acme', 'XP26A').familia);
  });

  it('linha diferente continua sendo a mesma linhagem', () => {
    expect(analisar('Acme', 'XP21A').linhagem).toBe(analisar('Acme', 'XP26A').linhagem);
  });

  it('marca diferente nunca é a mesma família, mesmo com código igual', () => {
    expect(analisar('Acme', 'XP21A').familia).not.toBe(analisar('Estrita', 'XP21A').familia);
  });

  it('sufixo que muda a peça entra na família', () => {
    expect(analisar('Estrita', 'XP21A').familia).not.toBe(analisar('Estrita', 'XP21B').familia);
  });

  it('marca sem gramática não propaga por cima do sufixo, por precaução', () => {
    // Não saber é razão para não propagar, não para propagar.
    expect(analisar('Desconhecida', 'ZZ44K').familia).not.toBe(
      analisar('Desconhecida', 'ZZ44M').familia,
    );
  });

  it('familiaDe devolve nulo quando o código não se analisa', () => {
    expect(familiaDe('Acme', 'refil original', gramaticas)).toBeNull();
    expect(familiaDe('Acme', 'XP21A', gramaticas)).toBe('acme:xp21');
  });

  it('normaliza a razão social antes de formar a chave', () => {
    expect(familiaDe('Acme Comercio Ltda', 'XP21A', gramaticas)).toBe('acme:xp21');
  });
});

describe('descreverAnalise', () => {
  it('mostra cada parte e diz quando não identificou', () => {
    expect(descreverAnalise(analisar('Acme', 'XP21B'))).toBe(
      'XP21B: XP = cafeteira · 21 = linha · B (não identificado)',
    );
  });
});

describe('gramática semente', () => {
  it('reconhece o purificador de água que a especificação nomeia', () => {
    const r = analisarModelo('Electrolux', 'PA26G', GRAMATICAS_SEMENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analise.tipo).toBe('purificador de agua');
    expect(r.analise.familia).toBe('electrolux:pa26');
  });

  it('não afirma nada sobre o prefixo que a especificação não explica', () => {
    const r = analisarModelo('Electrolux', 'PE11B', GRAMATICAS_SEMENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.analise.tipo).toBeNull();
  });

  it('trata as variações de sufixo do purificador como a mesma família', () => {
    // É esta frase da especificação — "sufixo = variação de cor/voltagem" — que
    // autoriza a inferência de irmão. Sem ela, não se propaga.
    expect(familiaDe('Electrolux', 'PA21G', GRAMATICAS_SEMENTE)).toBe(
      familiaDe('Electrolux', 'PA21X', GRAMATICAS_SEMENTE),
    );
  });
});
