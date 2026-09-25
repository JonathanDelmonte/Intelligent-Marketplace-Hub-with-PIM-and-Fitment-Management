import { describe, expect, it } from 'vitest';
import {
  CUSTO_PADRAO,
  conferirSenha,
  criarHashDeSenha,
  problemasDaSenhaNova,
  type CustoDoScrypt,
} from './senha';

/** Custo baixo só para o teste andar rápido. O formato e a conferência são os mesmos. */
const BARATO: CustoDoScrypt = { N: 2 ** 10, r: 8, p: 1 };

describe('criarHashDeSenha e conferirSenha', () => {
  it('a senha certa confere, a errada não, e a senha nunca aparece no hash', async () => {
    const hash = await criarHashDeSenha('uma frase longa de senha', BARATO);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain('frase');
    expect(await conferirSenha('uma frase longa de senha', hash)).toBe(true);
    expect(await conferirSenha('uma frase longa de senhA', hash)).toBe(false);
  });

  it('cada hash tem sal próprio: a mesma senha gera hashes diferentes', async () => {
    const a = await criarHashDeSenha('mesma senha de teste', BARATO);
    const b = await criarHashDeSenha('mesma senha de teste', BARATO);
    expect(a).not.toBe(b);
  });

  it('o custo vai gravado, e a conferência usa o do hash', async () => {
    // Subir o custo padrão no futuro não pode invalidar a senha de quem já tem conta.
    const hash = await criarHashDeSenha('senha com custo antigo', BARATO);
    expect(await conferirSenha('senha com custo antigo', hash)).toBe(true);
    expect(CUSTO_PADRAO.N).toBeGreaterThan(BARATO.N);
  });

  it('a mesma senha em formas Unicode diferentes confere', async () => {
    // "é" composto (U+00E9) e "e" + acento (U+0065 U+0301): o celular manda um, o
    // computador manda o outro.
    const hash = await criarHashDeSenha('café com leite quente', BARATO);
    expect(await conferirSenha('cafe\u0301 com leite quente', hash)).toBe(true);
  });

  it('hash que não é deste formato não confere, em vez de lançar', async () => {
    expect(await conferirSenha('qualquer', 'md5$abc')).toBe(false);
    expect(await conferirSenha('qualquer', 'scrypt$x$8$1$abc$def')).toBe(false);
    expect(await conferirSenha('qualquer', '')).toBe(false);
  });
});

describe('problemasDaSenhaNova', () => {
  it('pede tamanho, e não regra de composição', () => {
    expect(problemasDaSenhaNova('curta', 'eu@loja.com')).toEqual([
      'a senha precisa de pelo menos 10 caracteres',
    ]);
    expect(problemasDaSenhaNova('uma frase qualquer sem símbolo', 'eu@loja.com')).toEqual([]);
  });

  it('recusa o próprio e-mail como senha', () => {
    expect(problemasDaSenhaNova(' Fulano@Loja.com ', 'fulano@loja.com')).toContain(
      'a senha não pode ser o próprio e-mail',
    );
  });

  it('recusa colagem gigante', () => {
    expect(problemasDaSenhaNova('x'.repeat(201), 'eu@loja.com')).toEqual([
      'a senha pode ter no máximo 200 caracteres',
    ]);
  });
});
