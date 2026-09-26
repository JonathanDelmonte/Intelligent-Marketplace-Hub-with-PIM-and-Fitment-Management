import { describe, expect, it } from 'vitest';
import { codigoConfere, codigoExigido } from './codigo';

describe('código de cadastro', () => {
  const CONFIGURADO = 'ABCD-EFGH-JKMN';

  it('o código certo confere', () => {
    expect(codigoConfere('ABCD-EFGH-JKMN', CONFIGURADO)).toBe(true);
  });

  it('perdoa o que é só forma: minúscula, espaço, sem hífen', () => {
    expect(codigoConfere('abcd efgh jkmn', CONFIGURADO)).toBe(true);
    expect(codigoConfere('  abcdefghjkmn ', CONFIGURADO)).toBe(true);
    expect(codigoConfere('ABCD–EFGH—JKMN', CONFIGURADO)).toBe(true);
  });

  it('uma letra trocada não confere', () => {
    expect(codigoConfere('ABCD-EFGH-JKMP', CONFIGURADO)).toBe(false);
    expect(codigoConfere('ABCD-EFGH', CONFIGURADO)).toBe(false);
  });

  it('sem código configurado, nada confere — nem vazio com vazio', () => {
    expect(codigoConfere('ABCD-EFGH-JKMN', undefined)).toBe(false);
    expect(codigoConfere('', undefined)).toBe(false);
    expect(codigoConfere('', '')).toBe(false);
    expect(codigoConfere('---', '- -')).toBe(false);
  });

  it('digitar nada não confere com código nenhum', () => {
    expect(codigoConfere('', CONFIGURADO)).toBe(false);
    expect(codigoConfere('  - ', CONFIGURADO)).toBe(false);
  });
});

describe('código exigido (ADR 0015)', () => {
  it('com código configurado, criar conta e trocar a senha o pedem', () => {
    expect(codigoExigido('ABCD-EFGH-JKMN')).toBe(true);
  });

  it('sem código, nada pede código', () => {
    expect(codigoExigido(undefined)).toBe(false);
  });

  it('código só de pontuação conta como nenhum', () => {
    expect(codigoExigido('- -')).toBe(false);
  });
});
