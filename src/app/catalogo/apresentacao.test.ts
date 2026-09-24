import { describe, expect, it } from 'vitest';
import type { SkuGravado } from '@/dominio/catalogo/sku';
import { entradaParaMargem } from '@/dominio/precificacao/entrada';
import { calcularMargem } from '@/dominio/precificacao/margem';
import type { ContextoDoVendedor } from '@/dominio/precificacao/tipos';
import { pontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import {
  alvoEmPercentual,
  descreverAviso,
  estadoDoProduto,
  etiquetaDoProduto,
  lerAlvo,
  lerParametros,
  linhasDaDecomposicao,
  margemLegivel,
  ordenarAvisos,
  resumoDoCatalogo,
  textoDasPresuncoes,
  textoDoPrecoMinimo,
  caminhoDoProdutoCriado,
  caminhoDoProdutoNovo,
  lerProdutoNovo,
  lojasParaPublicar,
} from './apresentacao';
import { MARGEM_ALVO_PADRAO_BP } from './constantes';

const AGORA = new Date('2026-09-16T12:00:00Z');
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000);

const produto = (campos: Partial<SkuGravado> = {}): SkuGravado => ({
  id: 'a3f1',
  perfilId: 'p1',
  tituloInterno: 'Refil PA21G',
  ean: null,
  marca: null,
  custoAtual: reaisParaCentavos(18.4),
  custoAtualizadoEm: diasAtras(2),
  pesoG: 420,
  dimMm: null,
  voltagem: null,
  medida: null,
  quantidadeEmbalagem: null,
  taxaDevolucaoEsperadaBp: 300,
  categoriaMl: null,
  tipo: 'revenda',
  ncm: null,
  cst: null,
  cclasstrib: null,
  ativo: true,
  ...campos,
});

describe('etiquetaDoProduto', () => {
  it('sem custo vem antes de tudo: é a única falta que impede a margem de existir', () => {
    const e = etiquetaDoProduto(
      estadoDoProduto(produto({ custoAtual: null, custoAtualizadoEm: null, pesoG: null }), AGORA),
    );
    expect(e.texto).toBe('sem custo');
    expect(e.tom).toBe('alerta');
  });

  it('custo velho mostra a idade, porque é ela que decide se vale conferir', () => {
    const e = etiquetaDoProduto(
      estadoDoProduto(produto({ custoAtualizadoEm: diasAtras(95) }), AGORA),
    );
    expect(e.texto).toBe('custo de 95 dias');
    expect(e.tom).toBe('atencao');
  });

  it('com custo fresco, a falta seguinte é o peso', () => {
    const e = etiquetaDoProduto(estadoDoProduto(produto({ pesoG: null }), AGORA));
    expect(e.texto).toBe('sem peso');
  });

  it('ficha completa é etiqueta boa, e não ausência de etiqueta', () => {
    const e = etiquetaDoProduto(estadoDoProduto(produto(), AGORA));
    expect(e.texto).toBe('ficha completa');
    expect(e.tom).toBe('ok');
  });

  it('uma etiqueta só, mesmo faltando tudo', () => {
    // Linha com quatro etiquetas é linha que ninguém lê.
    const estado = estadoDoProduto(
      produto({
        custoAtual: null,
        custoAtualizadoEm: null,
        pesoG: null,
        taxaDevolucaoEsperadaBp: null,
      }),
      AGORA,
    );
    expect(estado.semCusto && estado.semPeso && estado.semDevolucao).toBe(true);
    expect(etiquetaDoProduto(estado).texto).toBe('sem custo');
  });
});

describe('resumoDoCatalogo', () => {
  it('catálogo vazio explica de onde vem produto', () => {
    expect(resumoDoCatalogo({ total: 0, semCusto: 0, defasados: 0 })).toContain('juntar iguais');
  });

  it('tudo com custo recente afirma que a margem é a real', () => {
    const r = resumoDoCatalogo({ total: 12, semCusto: 0, defasados: 0 });
    expect(r).toContain('12 produtos');
    expect(r).toContain('é a real');
  });

  it('lidera pelo que falta, e diz o que isso custa', () => {
    const r = resumoDoCatalogo({ total: 12, semCusto: 3, defasados: 2 });
    expect(r).toContain('3 sem custo');
    expect(r).toContain('2 com custo velho');
    expect(r).toContain('é o teto');
  });

  it('conjuga o singular', () => {
    expect(resumoDoCatalogo({ total: 1, semCusto: 1, defasados: 0 })).toContain('1 produto,');
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
    // URL é texto que qualquer um digita.
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

  it('o alvo da URL é percentual, na mesma unidade que o campo manda', () => {
    // A primeira versão lia ponto-base e o formulário mandava percentual: pedir 25%
    // virava 0,25%, e a tela respondia um preço mínimo baixo com cara de certo.
    expect(lerParametros({ alvo: '25' }).margemAlvoBp).toBe(2_500);
    expect(alvoEmPercentual(lerParametros({ alvo: '25' }).margemAlvoBp)).toBe('25');
  });

  it('parâmetro repetido usa o primeiro, e não quebra', () => {
    expect(lerParametros({ plataforma: ['amazon', 'ml'] }).plataforma).toBe('amazon');
  });

  it('margem alvo absurda volta para o padrão', () => {
    expect(lerParametros({ alvo: '0' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
    expect(lerParametros({ alvo: '100' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
    expect(lerParametros({ alvo: 'muito' }).margemAlvoBp).toBe(MARGEM_ALVO_PADRAO_BP);
  });
});

describe('alvo em percentual', () => {
  it('vai e volta entre o campo e os pontos-base', () => {
    expect(alvoEmPercentual(2_000)).toBe('20');
    expect(lerAlvo('20')).toBe(2_000);
    expect(lerAlvo('12,5')).toBe(1_250);
  });

  it('recusa o que não é percentual de margem', () => {
    expect(lerAlvo('0')).toBeNull();
    expect(lerAlvo('100')).toBeNull();
    expect(lerAlvo('muito')).toBeNull();
  });
});

describe('textoDoPrecoMinimo', () => {
  it('com preço, diz o número', () => {
    const t = textoDoPrecoMinimo({
      preco: reaisParaCentavos(79.9),
      margemAlvoBp: 2_000,
      deReais: 10,
      ateReais: 500,
    });
    expect(t).toContain('20%');
    expect(t).toContain('79,90');
  });

  it('sem preço na faixa, explica que a margem pode não existir a nenhum preço', () => {
    // Saber isso antes de anunciar é o ponto da fase 1.
    const t = textoDoPrecoMinimo({ preco: null, margemAlvoBp: 4_000, deReais: 10, ateReais: 500 });
    expect(t).toContain('Nenhum preço');
    expect(t).toContain('custo está alto');
  });
});

describe('linhasDaDecomposicao', () => {
  const VENDEDOR: ContextoDoVendedor = { regimeFiscal: 'cpf', temCnpj: false };

  const resultado = () => {
    const montada = entradaParaMargem({
      ficha: {
        custoAtual: reaisParaCentavos(18.4),
        pesoG: 420,
        taxaDevolucaoEsperadaBp: pontosBase(300),
      },
      plataforma: 'ml',
      vendedor: VENDEDOR,
      modoFrete: 'comprador_paga',
      tipoAnuncioML: 'classico',
    });
    return calcularMargem({ ...montada.base, preco: reaisParaCentavos(79.9) });
  };

  it('vai do preço até a sobra, na ordem em que o dinheiro sai', () => {
    const linhas = linhasDaDecomposicao(resultado());
    expect(linhas[0]?.rotulo).toBe('Preço de venda');
    expect(linhas[0]?.subtrai).toBe(false);
    expect(linhas.at(-1)?.rotulo).toBe('Sobra');
    expect(linhas.at(-1)?.subtrai).toBe(false);
  });

  it('linha de saída zerada não aparece, para a conta não virar lista de zeros', () => {
    const linhas = linhasDaDecomposicao(resultado());
    expect(linhas.filter((l) => l.subtrai && l.valor === 0)).toEqual([]);
  });

  it('a comissão da plataforma está entre as saídas', () => {
    const linhas = linhasDaDecomposicao(resultado());
    const comissao = linhas.find((l) => l.rotulo === 'Comissão da plataforma');
    expect(comissao?.subtrai).toBe(true);
    expect(comissao?.valor).toBeGreaterThan(0);
  });
});

describe('ordenarAvisos', () => {
  it('vermelho primeiro, informativo por último', () => {
    const ordenados = ordenarAvisos([
      { codigo: 'tabela_presumida', severidade: 'informativo', mensagem: 'a' },
      { codigo: 'margem_negativa', severidade: 'vermelho', mensagem: 'b' },
      { codigo: 'margem_apertada', severidade: 'amarelo', mensagem: 'c' },
    ]);
    expect(ordenados.map((a) => a.severidade)).toEqual(['vermelho', 'amarelo', 'informativo']);
  });
});

describe('margemLegivel', () => {
  it('uma casa abaixo de 10%, nenhuma acima', () => {
    expect(margemLegivel(830)).toBe('8,3%');
    expect(margemLegivel(2_340)).toBe('23%');
  });

  it('margem negativa mostra o sinal', () => {
    expect(margemLegivel(-1_200)).toBe('-12%');
  });
});

describe('textoDasPresuncoes', () => {
  it('traduz os campos presumidos em frases que dizem o custo do erro', () => {
    const textos = textoDasPresuncoes(['peso', 'devolucao']);
    expect(textos).toHaveLength(2);
    expect(textos[0]).toContain('frete');
  });

  it('nada presumido é lista vazia, e a tela não mostra o bloco', () => {
    expect(textoDasPresuncoes([])).toEqual([]);
  });
});

describe('descreverAviso', () => {
  it('código desconhecido não vira aviso', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('custo salvo explica por que a data importa', () => {
    expect(descreverAviso('custo')?.corpo).toContain('envelhecer');
  });

  it('produto recusado fala do nome e do código de barras, e não de peso', () => {
    // A primeira versão reaproveitava o aviso da ficha, e a lista dizia "peso em gramas
    // e medida em milímetros são positivos" para um código de barras torto.
    const aviso = descreverAviso('produto_invalido');
    expect(aviso?.corpo).toContain('dígito verificador');
    expect(aviso?.corpo).not.toContain('milímetros');
  });

  it('custo inválido separa zero de ausente', () => {
    expect(descreverAviso('custo_invalido')?.corpo).toContain('não informado');
  });

  it('ficha recusada nomeia os três números que ela confere', () => {
    // Um aviso para três conferências diferentes só serve se disser as três: peso,
    // dimensão e quantidade inteira caem no mesmo código.
    const corpo = descreverAviso('ficha_invalida')?.corpo ?? '';
    expect(corpo).toContain('gramas');
    expect(corpo).toContain('milímetros');
    expect(corpo).toContain('inteiro');
  });
});

describe('publicar em (ADR 0009)', () => {
  const SKU = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('uma linha por loja; o preço simulado vai só para a loja simulada', () => {
    const lojas = lojasParaPublicar(SKU, {
      plataforma: 'shopee',
      preco: reaisParaCentavos('89.90'),
    });
    expect(lojas.map((l) => l.plataforma)).toEqual(['ml', 'shopee', 'amazon']);

    const shopee = lojas.find((l) => l.plataforma === 'shopee');
    expect(shopee?.montar).toBe(`/anuncios?sku=${SKU}&plataforma=shopee&preco=89%2C90`);
    expect(shopee?.nota).toBe('leva o preço simulado acima: R$\u00a089,90');

    // O preço da Shopee não vai para o Mercado Livre: a comissão é outra.
    const ml = lojas.find((l) => l.plataforma === 'ml');
    expect(ml?.montar).toBe(`/anuncios?sku=${SKU}&plataforma=ml`);
    expect(ml?.simular).toBe(`/catalogo/${SKU}?plataforma=ml#preco-titulo`);
  });

  it('sem preço no simulador, nenhuma loja leva preço', () => {
    const lojas = lojasParaPublicar(SKU, { plataforma: 'ml', preco: null });
    expect(lojas.every((l) => !l.montar.includes('preco='))).toBe(true);
    expect(lojas[0]?.nota).toContain('o simulador acima está nesta loja');
  });
});

describe('produto novo pedido por outra tela', () => {
  it('o caminho abre o formulário com o nome e a loja, e a leitura devolve os dois', () => {
    const caminho = caminhoDoProdutoNovo('refil de purificador PA21G', 'shopee');
    expect(caminho).toBe('/catalogo?novo=refil+de+purificador+PA21G&plataforma=shopee#novo-titulo');

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

  it('o produto criado abre no simulador da loja pedida, ou na ficha sem loja', () => {
    expect(caminhoDoProdutoCriado('0f8fad5b-d9cb-469f-a165-70867728950e', 'amazon', 'criado')).toBe(
      '/catalogo/0f8fad5b-d9cb-469f-a165-70867728950e?plataforma=amazon&r=criado#publicar-titulo',
    );
    expect(
      caminhoDoProdutoCriado('0f8fad5b-d9cb-469f-a165-70867728950e', undefined, 'criado'),
    ).toBe('/catalogo/0f8fad5b-d9cb-469f-a165-70867728950e?r=criado');
  });
});
