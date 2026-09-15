import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { QUANTIDADE_PADRAO } from './constantes';
import { comoQueryString, lerParametros } from './parametros';

const SKU = '346e84ef-0228-4031-80f2-211011796f7f';

const ler = (bruto: Record<string, string | string[] | undefined>) => lerParametros(bruto);

describe('lerParametros', () => {
  it('sem SKU é primeira visita, não erro', () => {
    // A distinção que faz a tela abrir limpa em vez de com aviso vermelho.
    expect(ler({}).tipo).toBe('ausente');
    expect(ler({ sku: '' }).tipo).toBe('ausente');
  });

  it('lê a escolha completa', () => {
    const r = ler({ sku: SKU, plataforma: 'ml', preco: '89,90', qtd: '5' });
    expect(r.tipo).toBe('ok');
    if (r.tipo !== 'ok') return;
    expect(r.parametros.skuId).toBe(SKU);
    expect(r.parametros.plataforma).toBe('ml');
    expect(r.parametros.preco).toBe(reaisParaCentavos('89.90'));
    expect(r.parametros.quantidade).toBe(5);
    expect(r.parametros.tipoProduto).toBeNull();
  });

  it('aceita o preço com vírgula e com ponto, porque a pessoa digita os dois', () => {
    const virgula = ler({ sku: SKU, plataforma: 'ml', preco: '89,90' });
    const ponto = ler({ sku: SKU, plataforma: 'ml', preco: '89.90' });
    if (virgula.tipo !== 'ok' || ponto.tipo !== 'ok') throw new Error('esperava ok');
    expect(virgula.parametros.preco).toBe(ponto.parametros.preco);
  });

  it('recusa preço com mais de duas casas em vez de arredondar', () => {
    // Fração de centavo na borda é erro de digitação, e adivinhar é pior que reclamar.
    const r = ler({ sku: SKU, plataforma: 'ml', preco: '89,905' });
    expect(r.tipo).toBe('invalido');
    if (r.tipo !== 'invalido') return;
    expect(r.campos).toContain('preco');
  });

  it('recusa preço negativo e preço em texto', () => {
    expect(ler({ sku: SKU, plataforma: 'ml', preco: '-5' }).tipo).toBe('invalido');
    expect(ler({ sku: SKU, plataforma: 'ml', preco: 'barato' }).tipo).toBe('invalido');
  });

  it('recusa plataforma inventada', () => {
    const r = ler({ sku: SKU, plataforma: 'olx', preco: '10' });
    expect(r.tipo).toBe('invalido');
    if (r.tipo !== 'invalido') return;
    expect(r.campos).toContain('plataforma');
  });

  it('recusa SKU que não é uuid, antes de chegar ao banco', () => {
    const r = ler({ sku: 'abc', plataforma: 'ml', preco: '10' });
    expect(r.tipo).toBe('invalido');
    if (r.tipo !== 'invalido') return;
    expect(r.campos).toContain('sku');
  });

  it('quantidade ausente cai no padrão, e quantidade zero é recusada', () => {
    const semQtd = ler({ sku: SKU, plataforma: 'ml', preco: '10' });
    if (semQtd.tipo !== 'ok') throw new Error('esperava ok');
    expect(semQtd.parametros.quantidade).toBe(QUANTIDADE_PADRAO);

    // Zero anunciaria pausado sem a pessoa pedir; é escolha, não padrão.
    expect(ler({ sku: SKU, plataforma: 'ml', preco: '10', qtd: '0' }).tipo).toBe('invalido');
    expect(ler({ sku: SKU, plataforma: 'ml', preco: '10', qtd: '1.5' }).tipo).toBe('invalido');
  });

  it('valor repetido na query usa o primeiro', () => {
    // Acontece com link colado duas vezes, e o navegador manda os dois.
    const r = ler({ sku: [SKU, 'outro'], plataforma: ['ml', 'shopee'], preco: ['10', '99'] });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.parametros.skuId).toBe(SKU);
    expect(r.parametros.plataforma).toBe('ml');
  });

  it('lista os campos errados de uma vez, para a tela não pedir um por vez', () => {
    const r = ler({ sku: 'abc', plataforma: 'olx', preco: 'x' });
    if (r.tipo !== 'invalido') throw new Error('esperava invalido');
    expect(r.campos).toHaveLength(3);
  });

  it('tipo do produto vazio é nulo, não string vazia', () => {
    const r = ler({ sku: SKU, plataforma: 'ml', preco: '10', tipo: '  ' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.parametros.tipoProduto).toBeNull();
  });
});

describe('comoQueryString', () => {
  it('sobrevive à ida e à volta, para o link de baixar não divergir da tela', () => {
    // É a propriedade que o arquivo depende: a rota monta o mesmo anúncio porque
    // recebe os mesmos parâmetros.
    const original = ler({
      sku: SKU,
      plataforma: 'shopee',
      preco: '129,50',
      qtd: '3',
      tipo: 'refil de purificador',
    });
    if (original.tipo !== 'ok') throw new Error('esperava ok');

    const volta = lerParametros(
      Object.fromEntries(new URLSearchParams(comoQueryString(original.parametros)).entries()),
    );
    expect(volta).toEqual(original);
  });

  it('omite o tipo quando não há, em vez de mandar vazio', () => {
    const r = ler({ sku: SKU, plataforma: 'ml', preco: '10' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(comoQueryString(r.parametros)).not.toContain('tipo=');
  });

  it('preserva o preço como a pessoa digitou', () => {
    // Reescrever "89,90" como "8990" faria o campo voltar diferente do digitado.
    const r = ler({ sku: SKU, plataforma: 'ml', preco: '89,90' });
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(comoQueryString(r.parametros)).toContain('preco=89%2C90');
  });
});
