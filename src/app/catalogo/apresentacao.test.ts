import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  alvoEmPercentual,
  caminhoDoProduto,
  caminhoDoProdutoCriado,
  caminhoDoProdutoNovo,
  caminhoDoSimulador,
  CODIGOS_DE_AVISO,
  descreverAviso,
  detalheDoProduto,
  lerAlvo,
  lerParametros,
  lerProdutoNovo,
  ordemDaTabela,
  resumoDaTabela,
  textoDoCusto,
} from './apresentacao';
import { MARGEM_ALVO_PADRAO_BP } from './constantes';

const AGORA = new Date('2026-09-16T12:00:00Z');
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000);
const SKU = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('o alto da tabela', () => {
  it('diz quantos produtos, e lidera pelo custo que falta', () => {
    expect(resumoDaTabela({ total: 12, semCusto: 3, velhos: 2 })).toBe(
      '12 produtos. Falta o custo de 3. 2 custos têm mais de 30 dias.',
    );
    expect(resumoDaTabela({ total: 12, semCusto: 0, velhos: 1 })).toBe(
      '12 produtos. Um custo tem mais de 30 dias.',
    );
  });

  it('tudo com custo é uma frase só, e conjuga o singular', () => {
    expect(resumoDaTabela({ total: 12, semCusto: 0, velhos: 0 })).toBe(
      '12 produtos, todos com custo.',
    );
    expect(resumoDaTabela({ total: 1, semCusto: 0, velhos: 0 })).toBe('1 produto, com custo.');
  });

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
      velho: false,
    });
  });

  it('custo de mais de 30 dias fica marcado como velho, com a mesma frase', () => {
    expect(textoDoCusto(diasAtras(45), AGORA)).toEqual({
      texto: 'informado há 45 dias',
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
    expect(p.margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
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
    expect(p.margemAlvoBp).toBe(3_000);
  });

  it('o alvo da URL são os reais de cada R$ 100, na mesma unidade que o campo manda', () => {
    // A primeira versão lia ponto-base e o formulário mandava percentual: pedir 25
    // virava 0,25, e a tela respondia um preço baixo com cara de certo.
    expect(lerParametros({ alvo: '25' }).margemAlvoBp).toBe(2_500);
    expect(alvoEmPercentual(lerParametros({ alvo: '25' }).margemAlvoBp)).toBe('25');
  });

  it('parâmetro repetido usa o primeiro, e não quebra', () => {
    expect(lerParametros({ plataforma: ['amazon', 'ml'] }).plataforma).toBe('amazon');
  });

  it('alvo absurdo volta para o padrão', () => {
    expect(lerParametros({ alvo: '0' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
    expect(lerParametros({ alvo: '100' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
    expect(lerParametros({ alvo: 'muito' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
  });

  it('o alvo vai e volta entre o campo e os pontos-base', () => {
    expect(alvoEmPercentual(2_000)).toBe('20');
    expect(lerAlvo('20')).toBe(2_000);
    expect(lerAlvo('12,5')).toBe(1_250);
    expect(lerAlvo('0')).toBeNull();
    expect(lerAlvo('100')).toBeNull();
  });
});

describe('os caminhos para o produto', () => {
  it('a conta numa loja, que outras telas usam, abre no preço', () => {
    expect(caminhoDoSimulador(SKU, 'ml')).toBe(`/catalogo/${SKU}?plataforma=ml#preco-titulo`);
  });

  it('o alvo só vai na URL quando não é o padrão', () => {
    expect(caminhoDoProduto(SKU, { alvoBp: MARGEM_ALVO_PADRAO_BP })).toBe(`/catalogo/${SKU}`);
    expect(caminhoDoProduto(SKU, { alvoBp: 3_000, plataforma: 'shopee', ancora: 'x' })).toBe(
      `/catalogo/${SKU}?plataforma=shopee&alvo=30#x`,
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
