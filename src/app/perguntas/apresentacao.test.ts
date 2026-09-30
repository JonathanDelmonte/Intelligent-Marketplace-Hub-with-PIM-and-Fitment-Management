import { describe, expect, it } from 'vitest';
import {
  duvidasRecorrentes,
  type DuvidaRecorrente,
  type PerguntaRecebida,
} from '@/dominio/posvenda/recorrente';
import {
  MAXIMO_POR_LOTE,
  MINIMO_DE_CARACTERES,
  descreverAviso,
  inteiroDaUrl,
  lerPerguntas,
  resumoDasDuvidas,
  numerosDasPerguntas,
  ROTULO_DO_TEMA,
} from './apresentacao';

describe('lerPerguntas', () => {
  it('uma pergunta por linha, sem formato a decorar', () => {
    const r = lerPerguntas('Serve na PA26G?\nÉ 110 ou 220?\n');
    expect(r.perguntas).toEqual(['Serve na PA26G?', 'É 110 ou 220?']);
  });

  it('linha em branco e espaço em volta não contam como pergunta', () => {
    // É o que sai de um copiar e colar de painel.
    const r = lerPerguntas('\n  Serve na PA26G?  \n\n\n');
    expect(r.perguntas).toEqual(['Serve na PA26G?']);
    expect(r.curtas).toBe(0);
  });

  it('descarta linha curta demais para ser pergunta, e conta quantas', () => {
    // "ok" e "obg" é o que sobra quando alguém cola a conversa inteira.
    const r = lerPerguntas('ok\nobg\nServe na PA26G?');
    expect(r.perguntas).toHaveLength(1);
    expect(r.curtas).toBe(2);
    expect(MINIMO_DE_CARACTERES).toBe(4);
  });

  it('duplicata dentro do mesmo lote sai, para a contagem da tela não mentir', () => {
    const r = lerPerguntas('Serve na PA26G?\nserve  NA pa26g?\nÉ bivolt?');
    expect(r.perguntas).toHaveLength(2);
    expect(r.repetidasNoLote).toBe(1);
  });

  it('acima do teto do lote, o resto é contado em vez de silenciosamente perdido', () => {
    const muitas = Array.from({ length: MAXIMO_POR_LOTE + 3 }, (_, i) => `pergunta ${String(i)}`);
    const r = lerPerguntas(muitas.join('\n'));
    expect(r.perguntas).toHaveLength(MAXIMO_POR_LOTE);
    expect(r.sobraram).toBe(3);
  });

  it('texto vazio devolve lista vazia, e não uma pergunta em branco', () => {
    expect(lerPerguntas('   \n\n').perguntas).toEqual([]);
  });
});

describe('resumoDasDuvidas', () => {
  const pergunta = (id: string, texto: string): PerguntaRecebida => ({
    id,
    texto,
    em: new Date('2026-09-15T12:00:00Z'),
    anuncioId: 'MLB-1',
  });

  it('sem pergunta guardada, explica que a conta precisa de histórico', () => {
    expect(resumoDasDuvidas({ duvidas: [], perguntasNaJanela: 0 })).toContain(
      'precisa de histórico',
    );
  });

  it('com pergunta e sem dúvida repetida, diz quantas e que nenhuma bateu o corte', () => {
    const resumo = resumoDasDuvidas({ duvidas: [], perguntasNaJanela: 3 });
    expect(resumo).toContain('3 perguntas guardadas');
    expect(resumo).toContain('5 vezes');
  });

  it('com dúvida acusando, conta as dúvidas e os anúncios', () => {
    const duvidas = duvidasRecorrentes(
      Array.from({ length: 5 }, (_, i) => pergunta(String(i), `Serve na PA26G? ${String(i)}`)),
    );
    const resumo = resumoDasDuvidas({ duvidas, perguntasNaJanela: 5 });
    expect(resumo).toContain('1 dúvida está acusando');
    expect(resumo).toContain('1 anúncio');
  });
});

describe('descreverAviso', () => {
  it('devolve null para código desconhecido', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('conjuga o plural e explica o corte', () => {
    expect(descreverAviso('gravado', 1)?.titulo).toBe('1 pergunta guardada');
    expect(descreverAviso('gravado', 4)?.titulo).toBe('4 perguntas guardadas');
    expect(descreverAviso('gravado', 4)?.corpo).toContain('quinta vez');
  });

  it('lote inteiro repetido não é erro, e o texto diz que é uso normal', () => {
    const aviso = descreverAviso('so_repetidas');
    expect(aviso?.tom).toBe('atencao');
    expect(aviso?.corpo).toContain('uso normal');
  });

  it('quantidade inválida na URL não vira texto estranho', () => {
    expect(descreverAviso('gravado', -1)?.titulo).toBe('0 perguntas guardadas');
    expect(inteiroDaUrl('x')).toBeNull();
    expect(inteiroDaUrl('7')).toBe(7);
  });
});

describe('numerosDasPerguntas', () => {
  const duvida = (vezes: number, anuncios: readonly string[]): DuvidaRecorrente => ({
    chave: `voltagem-${String(vezes)}`,
    tema: 'voltagem',
    codigo: null,
    vezes,
    anuncios,
    exemplos: [],
    oQueAcrescentar: 'Diga a voltagem.',
  });

  it('conta os anúncios acusados sem repetir o mesmo anúncio', () => {
    const numeros = numerosDasPerguntas({
      duvidas: [duvida(5, ['MLB-1', 'MLB-2']), duvida(7, ['MLB-2'])],
      perguntasNaJanela: 30,
      dias: 90,
    });
    expect(numeros.map((n) => [n.chave, n.valor])).toEqual([
      ['guardadas', '30'],
      ['duvidas', '2'],
      ['anuncios', '2'],
      ['maior', '7'],
    ]);
    expect(numeros[0]?.nota).toBe('nos últimos 90 dias');
    expect(numeros[3]).toMatchObject({ resto: 'vezes', nota: ROTULO_DO_TEMA.voltagem });
  });

  it('sem dúvida repetida, nenhum anúncio acusado é dito em verde', () => {
    const numeros = numerosDasPerguntas({ duvidas: [], perguntasNaJanela: 4, dias: 90 });
    expect(numeros[2]).toMatchObject({ valor: '0', tom: 'alta', nota: 'nenhum por enquanto' });
    expect(numeros[3]).toMatchObject({ valor: '0', resto: null, nota: 'nenhuma dúvida repetida' });
  });
});
