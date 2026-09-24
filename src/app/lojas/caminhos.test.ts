import { describe, expect, it } from 'vitest';
import { caminhoDaAba, destinoComAviso, lerAba, lerVolta } from './caminhos';

describe('lerAba', () => {
  it('lê a aba conhecida, e o resto abre o resumo', () => {
    expect(lerAba('repasse')).toBe('repasse');
    expect(lerAba(['pedidos', 'repasse'])).toBe('pedidos');
    expect(lerAba('inventada')).toBe('resumo');
    expect(lerAba(undefined)).toBe('resumo');
  });
});

describe('caminhoDaAba', () => {
  it('o resumo é a própria área; as outras abas vão no parâmetro', () => {
    expect(caminhoDaAba('shopee', 'resumo')).toBe('/lojas/shopee');
    expect(caminhoDaAba('shopee', 'repasse')).toBe('/lojas/shopee?aba=repasse');
  });
});

describe('lerVolta', () => {
  it('aceita a área de uma loja, com ou sem aba', () => {
    expect(lerVolta('/lojas/ml')).toEqual({ plataforma: 'ml', aba: 'resumo' });
    expect(lerVolta('/lojas/amazon?aba=pedidos')).toEqual({ plataforma: 'amazon', aba: 'pedidos' });
  });

  it('recusa tudo que levaria para fora da área de uma loja', () => {
    // Redirecionamento aberto é o risco: o campo vem do navegador.
    expect(lerVolta('https://outro.site/lojas/ml')).toBeNull();
    expect(lerVolta('//outro.site/lojas/ml')).toBeNull();
    expect(lerVolta('/\\outro.site/lojas/ml')).toBeNull();
    expect(lerVolta('/postagem')).toBeNull();
    expect(lerVolta('/lojas/orkut')).toBeNull();
    expect(lerVolta('/lojas/ml/extra')).toBeNull();
    expect(lerVolta('/lojas/ml?aba=inventada')).toBeNull();
    expect(lerVolta(null)).toBeNull();
    expect(lerVolta('')).toBeNull();
  });
});

describe('destinoComAviso', () => {
  it('volta para a aba com o aviso junto, ou vai para o padrão', () => {
    expect(destinoComAviso({ plataforma: 'ml', aba: 'repasse' }, '/postagem', { r: 'ok' })).toBe(
      '/lojas/ml?aba=repasse&r=ok',
    );
    expect(destinoComAviso({ plataforma: 'ml', aba: 'resumo' }, '/postagem', { r: 'ok' })).toBe(
      '/lojas/ml?r=ok',
    );
    expect(destinoComAviso(null, '/postagem', { r: 'ok', n: '2' })).toBe('/postagem?r=ok&n=2');
  });
});
