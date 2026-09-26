import { describe, expect, it } from 'vitest';
import { codigoConfere, modoDoCadastro } from './codigo';

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

describe('modo do cadastro (ADR 0014)', () => {
  it('com código configurado, toda conta nova pede o código — até a primeira', () => {
    expect(modoDoCadastro('ABCD-EFGH-JKMN', 0)).toBe('com_codigo');
    expect(modoDoCadastro('ABCD-EFGH-JKMN', 3)).toBe('com_codigo');
  });

  it('sem código, a primeira conta entra sem pedir nada', () => {
    expect(modoDoCadastro(undefined, 0)).toBe('primeira_conta');
  });

  it('sem código, depois da primeira conta o cadastro fecha', () => {
    expect(modoDoCadastro(undefined, 1)).toBe('fechado');
  });

  it('código só de pontuação conta como nenhum', () => {
    expect(modoDoCadastro('- -', 0)).toBe('primeira_conta');
  });
});
