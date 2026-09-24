import { describe, expect, it } from 'vitest';
import type { Consulta } from './consulta';
import { entenderPorRegra, lojasCitadas, normalizarPergunta } from './entender';

/** A consulta que a regra entendeu, ou `null` quando não entendeu. */
function entendida(pergunta: string): Consulta | null {
  const r = entenderPorRegra(pergunta);
  return r.tipo === 'entendida' ? r.consulta : null;
}

describe('normalizarPergunta', () => {
  it('tira acento, maiúscula e pontuação', () => {
    // É também a chave do cache da IA: as duas formas não podem custar duas chamadas.
    expect(normalizarPergunta('  Quanto VENDI no mês?! ')).toBe('quanto vendi no mes');
    expect(normalizarPergunta('Quanto vendi no mes')).toBe('quanto vendi no mes');
  });
});

describe('lojasCitadas', () => {
  it('reconhece cada loja pelos jeitos comuns de escrever', () => {
    expect(lojasCitadas(normalizarPergunta('no Mercado Livre'))).toEqual(['ml']);
    expect(lojasCitadas(normalizarPergunta('no mercadolivre'))).toEqual(['ml']);
    expect(lojasCitadas(normalizarPergunta('no ML'))).toEqual(['ml']);
    expect(lojasCitadas(normalizarPergunta('na shoppe'))).toEqual(['shopee']);
    expect(lojasCitadas(normalizarPergunta('Amazon e Shopee'))).toEqual(['shopee', 'amazon']);
  });

  it('não acha loja dentro de outra palavra', () => {
    expect(lojasCitadas(normalizarPergunta('html e amazonas'))).toEqual([]);
  });
});

describe('entenderPorRegra', () => {
  it('entende a pergunta do dono: faturamento de uma loja', () => {
    expect(entendida('Qual foi meu faturamento na Shopee?')).toEqual({
      metrica: 'faturamento',
      lojas: ['shopee'],
      periodo: 'ultimos_30',
      porLoja: false,
    });
  });

  it('entende as quatro perguntas prontas', () => {
    expect(entendida('Qual foi o faturamento de cada loja nos últimos 30 dias?')).toEqual({
      metrica: 'faturamento',
      lojas: [],
      periodo: 'ultimos_30',
      porLoja: true,
    });
    expect(entendida('O que eu preciso postar hoje?')?.metrica).toBe('postar_hoje');
    expect(entendida('Qual loja me dá mais margem nos últimos 30 dias?')).toEqual({
      metrica: 'margem',
      lojas: [],
      periodo: 'ultimos_30',
      porLoja: true,
    });
    expect(entendida('O que mais vendeu nos últimos 30 dias?')?.metrica).toBe('mais_vendidos');
  });

  it.each([
    ['quanto vendi no ML este mês', 'faturamento', 'mes_atual'],
    ['vendas da semana', 'faturamento', 'ultimos_7'],
    ['quantos pedidos tive ontem', 'pedidos', 'ontem'],
    ['qual o ticket médio do mês passado', 'ticket_medio', 'mes_passado'],
    ['quanto lucrei nos últimos 3 meses', 'margem', 'ultimos_90'],
    ['tem pedido atrasado?', 'postar_hoje', 'ultimos_30'],
    ['a shopee repassou menos?', 'repasse_divergente', 'ultimos_30'],
    ['qual produto saiu mais hoje', 'mais_vendidos', 'hoje'],
    ['como foi o último mês', 'resumo', 'ultimos_30'],
    ['como estão as vendas?', 'resumo', 'ultimos_30'],
    ['como está a margem da shopee', 'margem', 'ultimos_30'],
  ] as const)('"%s" é %s, %s', (pergunta, metrica, periodo) => {
    expect(entendida(pergunta)).toMatchObject({ metrica, periodo });
  });

  it('a loja que vendeu mais é faturamento por loja, não produto campeão', () => {
    expect(entendida('qual loja vendeu mais?')).toMatchObject({
      metrica: 'faturamento',
      porLoja: true,
    });
  });

  it('pedido atrasado é fila, mesmo com "quantos pedidos" na frase', () => {
    expect(entendida('quantos pedidos atrasados eu tenho')?.metrica).toBe('postar_hoje');
  });

  it('duas lojas citadas é comparação', () => {
    expect(entendida('faturamento shopee ou mercado livre')).toMatchObject({
      lojas: ['ml', 'shopee'],
      porLoja: true,
    });
  });

  it('só a loja, sem métrica, é o resumo dela', () => {
    expect(entendida('e a Amazon?')).toEqual({
      metrica: 'resumo',
      lojas: ['amazon'],
      periodo: 'ultimos_30',
      porLoja: false,
    });
  });

  it('não chuta: sem métrica e sem loja, não entendeu', () => {
    // Palpite errado daqui seria resposta certa para a pergunta errada.
    expect(entenderPorRegra('qual o NCM de uma capa de celular?').tipo).toBe('nao_entendida');
    expect(entenderPorRegra('bom dia').tipo).toBe('nao_entendida');
    expect(entenderPorRegra('?!').tipo).toBe('nao_entendida');
  });
});
