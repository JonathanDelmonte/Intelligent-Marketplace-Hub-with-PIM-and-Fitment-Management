import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  caminhoDoProduto,
  caminhoDoProdutoCriado,
  caminhoDoProdutoNovo,
  caminhoDoSimulador,
  CODIGOS_DE_AVISO,
  descreverAviso,
  detalheDoProduto,
  lerMeta,
  lerParametros,
  lerProdutoNovo,
  metaNaUrl,
  ordemDaTabela,
  textoDoCusto,
} from './apresentacao';
import { META_PADRAO } from './conta';

const AGORA = new Date('2026-09-16T12:00:00Z');
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000);
const SKU = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('o nome do produto na tabela', () => {
  it('marca e código de barras juntos, ou nada', () => {
    expect(detalheDoProduto('Electrolux', '7896541200909')).toBe('Electrolux · 7896541200909');
    expect(detalheDoProduto(null, '7896541200909')).toBe('7896541200909');
    expect(detalheDoProduto('  ', null)).toBeNull();
  });
});

describe('a idade do custo', () => {
  it('custo recente diz quando foi informado', () => {
    expect(textoDoCusto(diasAtras(10), AGORA)).toEqual({
      texto: 'informado há 10 dias',
      quando: 'há 10 dias',
      velho: false,
    });
  });

  it('custo de mais de 30 dias fica marcado como velho, com a mesma frase', () => {
    expect(textoDoCusto(diasAtras(45), AGORA)).toEqual({
      texto: 'informado há 45 dias',
      quando: 'há 45 dias',
      velho: true,
    });
  });

  it('custo nunca informado não tem idade', () => {
    expect(textoDoCusto(null, AGORA)).toBeNull();
  });
});

describe('a ordem da tabela', () => {
  const produto = (nome: string, semCusto: boolean, unidades: number) => ({
    nome,
    semCusto,
    unidades,
  });

  it('sem custo no alto, depois o que mais vende, depois o nome', () => {
    const ordenados = [
      produto('Capa X9', false, 0),
      produto('Refil PA21G', false, 19),
      produto('Filtro CPC30', true, 0),
      produto('Anel de vedação', false, 0),
      produto('Refil PA31G', false, 4),
    ]
      .sort(ordemDaTabela)
      .map((p) => p.nome);
    expect(ordenados).toEqual([
      'Filtro CPC30',
      'Refil PA21G',
      'Refil PA31G',
      'Anel de vedação',
      'Capa X9',
    ]);
  });
});

describe('lerParametros', () => {
  it('sem nada na URL, os padrões são os do vendedor típico', () => {
    const p = lerParametros({});
    expect(p.plataforma).toBe('ml');
    expect(p.tipoAnuncioML).toBe('classico');
    expect(p.modoFrete).toBe('comprador_paga');
    expect(p.preco).toBeNull();
    expect(p.meta).toEqual(META_PADRAO);
  });

  it('valor inventado na URL cai no padrão em vez de derrubar a página', () => {
    const p = lerParametros({ plataforma: 'mercadolivre', tipo: 'ouro', frete: 'gratis' });
    expect(p.plataforma).toBe('ml');
    expect(p.tipoAnuncioML).toBe('classico');
    expect(p.modoFrete).toBe('comprador_paga');
  });

  it('lê o que veio, inclusive preço com vírgula', () => {
    const p = lerParametros({ plataforma: 'shopee', preco: '79,90', alvo: '30' });
    expect(p.plataforma).toBe('shopee');
    expect(p.preco).toBe(reaisParaCentavos(79.9));
    expect(p.meta).toEqual({ tipo: 'percentual', bp: 3_000 });
  });

  it('parâmetro repetido usa o primeiro, e não quebra', () => {
    expect(lerParametros({ plataforma: ['amazon', 'ml'] }).plataforma).toBe('amazon');
  });
});

describe('a meta na URL', () => {
  it('alvo é percentual do preço, com casa decimal, na unidade que o campo mostra', () => {
    // A primeira versão lia ponto-base e o formulário mandava percentual: pedir 25
    // virava 0,25, e a tela respondia um preço baixo com cara de certo.
    expect(lerMeta({ alvo: '25' })).toEqual({ tipo: 'percentual', bp: 2_500 });
    expect(lerMeta({ alvo: '22,5' })).toEqual({ tipo: 'percentual', bp: 2_250 });
    expect(lerMeta({ alvo: '22.5' })).toEqual({ tipo: 'percentual', bp: 2_250 });
  });

  it('lucro é o valor fixo por venda, em reais', () => {
    expect(lerMeta({ lucro: '12,50' })).toEqual({ tipo: 'reais', centavos: 1_250 });
    // As duas juntas: vale o lucro, que é o que o campo em reais manda.
    expect(lerMeta({ lucro: '8', alvo: '30' })).toEqual({ tipo: 'reais', centavos: 800 });
  });

  it('meta absurda volta para o padrão', () => {
    expect(lerMeta({ alvo: '0' })).toEqual(META_PADRAO);
    expect(lerMeta({ alvo: '100' })).toEqual(META_PADRAO);
    expect(lerMeta({ alvo: 'muito' })).toEqual(META_PADRAO);
    expect(lerMeta({ lucro: '0' })).toEqual(META_PADRAO);
    expect(lerMeta({ lucro: 'abc' })).toEqual(META_PADRAO);
  });

  it('vai e volta pela URL sem mudar, e a padrão nem vai', () => {
    const metas = [
      { tipo: 'percentual', bp: 3_000 },
      { tipo: 'percentual', bp: 2_250 },
      { tipo: 'reais', centavos: 1_250 },
      { tipo: 'reais', centavos: 800 },
    ] as const;
    for (const meta of metas) {
      const naUrl = metaNaUrl(meta);
      expect(naUrl).not.toBeNull();
      if (naUrl === null) continue;
      expect(lerMeta({ [naUrl[0]]: naUrl[1] })).toEqual(meta);
    }
    expect(metaNaUrl(META_PADRAO)).toBeNull();
  });
});

describe('os caminhos para o produto', () => {
  it('a conta numa loja, que outras telas usam, abre no preço', () => {
    expect(caminhoDoSimulador(SKU, 'ml')).toBe(`/catalogo/${SKU}?plataforma=ml#preco-titulo`);
  });

  it('a meta só vai na URL quando não é a padrão', () => {
    expect(caminhoDoProduto(SKU, { meta: META_PADRAO })).toBe(`/catalogo/${SKU}`);
    expect(
      caminhoDoProduto(SKU, {
        meta: { tipo: 'percentual', bp: 3_000 },
        plataforma: 'shopee',
        ancora: 'x',
      }),
    ).toBe(`/catalogo/${SKU}?plataforma=shopee&alvo=30#x`);
    expect(caminhoDoProduto(SKU, { meta: { tipo: 'reais', centavos: 1_250 } })).toBe(
      `/catalogo/${SKU}?lucro=12%2C50`,
    );
  });
});

describe('os avisos depois de uma ação', () => {
  it('código desconhecido não vira aviso', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('são curtos, e sem travessão', () => {
    for (const codigo of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(codigo);
      expect(aviso).not.toBeNull();
      const texto = `${aviso?.titulo ?? ''} ${aviso?.corpo ?? ''}`;
      expect(texto).not.toMatch(/[—–]/);
      expect(texto.length).toBeLessThan(200);
    }
  });

  it('produto recusado fala do nome e do código de barras, e não de peso', () => {
    // A primeira versão reaproveitava o aviso da ficha, e dizia "peso em gramas e
    // medida em milímetros" para um código de barras torto.
    const corpo = descreverAviso('produto_invalido')?.corpo ?? '';
    expect(corpo).toContain('nome');
    expect(corpo).toContain('código de barras');
    expect(corpo).not.toContain('milímetros');
  });

  it('custo que não deu para ler mostra como se escreve', () => {
    expect(descreverAviso('custo_invalido')?.corpo).toContain('18,40');
  });

  it('ficha recusada nomeia os três números que ela confere', () => {
    const corpo = descreverAviso('ficha_invalida')?.corpo ?? '';
    expect(corpo).toContain('gramas');
    expect(corpo).toContain('milímetros');
    expect(corpo).toContain('inteiro');
  });
});

describe('produto novo pedido por outra tela', () => {
  it('o caminho abre o cadastro com o nome e a loja, e a leitura devolve os dois', () => {
    const caminho = caminhoDoProdutoNovo('refil de purificador PA21G', 'shopee');
    expect(caminho).toBe('/catalogo/novo?novo=refil+de+purificador+PA21G&plataforma=shopee');

    const busca = Object.fromEntries(new URL(caminho, 'http://x').searchParams);
    expect(lerProdutoNovo(busca)).toEqual({
      titulo: 'refil de purificador PA21G',
      plataforma: 'shopee',
    });
  });

  it('nome curto não é pedido, e loja que não existe é ignorada', () => {
    expect(lerProdutoNovo({ novo: 'x' })).toBeNull();
    expect(lerProdutoNovo({})).toBeNull();
    expect(lerProdutoNovo({ novo: '  capa   X9  ', plataforma: 'orkut' })).toEqual({
      titulo: 'capa X9',
      plataforma: undefined,
    });
  });

  it('o produto criado abre na conta da loja pedida, ou no produto sem loja', () => {
    expect(caminhoDoProdutoCriado(SKU, 'amazon', 'criado')).toBe(
      `/catalogo/${SKU}?plataforma=amazon&r=criado#publicar-titulo`,
    );
    expect(caminhoDoProdutoCriado(SKU, undefined, 'criado')).toBe(`/catalogo/${SKU}?r=criado`);
  });
});
