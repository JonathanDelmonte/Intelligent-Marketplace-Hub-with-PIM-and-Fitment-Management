import { describe, expect, it } from 'vitest';
import { aLoja, daLoja, naLoja } from './rotulos';

describe('artigo da loja', () => {
  it('o Mercado Livre é masculino; Shopee e Amazon, femininos', () => {
    expect(aLoja('ml')).toBe('o Mercado Livre');
    expect(daLoja('ml')).toBe('do Mercado Livre');
    expect(naLoja('shopee')).toBe('na Shopee');
    expect(daLoja('amazon')).toBe('da Amazon');
  });
});
