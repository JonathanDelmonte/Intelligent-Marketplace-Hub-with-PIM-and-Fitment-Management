import { describe, expect, it } from 'vitest';
import type { VereditoDeTriagem } from '@/dominio/fornecedores/triagem';
import { PERGUNTAS, VEREDITOS_DE_TRIAGEM } from '@/dominio/fornecedores/triagem';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  CODIGOS_DE_AVISO,
  descreverAviso,
  estadoDaBase,
  etiquetaDoVeredito,
  pedidoMinimoEmTexto,
  perguntasEmTexto,
  prazoEmTexto,
  respostaEmTexto,
  tomDoVeredito,
} from './apresentacao';

const contagem = (campos: Partial<Record<VereditoDeTriagem, number>> = {}) => ({
  aprovado: 0,
  ressalva: 0,
  perguntar: 0,
  descartar: 0,
  ...campos,
});

describe('respostaEmTexto', () => {
  it('distingue "não perguntei" de "não"', () => {
    expect(respostaEmTexto(null)).toBe('não perguntei');
    expect(respostaEmTexto(false)).toBe('não');
    expect(respostaEmTexto(true)).toBe('sim');
  });
});

describe('prazoEmTexto', () => {
  it('zero é resposta: posta no mesmo dia', () => {
    expect(prazoEmTexto(0)).toBe('no mesmo dia');
  });

  it('concorda o singular', () => {
    expect(prazoEmTexto(1)).toBe('1 dia útil');
    expect(prazoEmTexto(4)).toBe('4 dias úteis');
  });

  it('vazio é "não perguntei", não "zero dias"', () => {
    expect(prazoEmTexto(null)).toBe('não perguntei');
  });
});

describe('pedidoMinimoEmTexto', () => {
  it('mostra as duas formas quando há as duas', () => {
    expect(pedidoMinimoEmTexto(reaisParaCentavos(300), 12)).toContain('300,00');
    expect(pedidoMinimoEmTexto(reaisParaCentavos(300), 12)).toContain('12 un');
  });

  it('nada preenchido é "não perguntei"', () => {
    expect(pedidoMinimoEmTexto(null, null)).toBe('não perguntei');
  });

  it('zero é resposta: não tem pedido mínimo', () => {
    expect(pedidoMinimoEmTexto(null, 0)).toBe('não tem');
  });
});

describe('veredito na tela', () => {
  it('só o descarte tem tom de alerta', () => {
    expect(tomDoVeredito('descartar')).toBe('alerta');
    expect(tomDoVeredito('aprovado')).toBe('ok');
    expect(tomDoVeredito('perguntar')).toBe('atencao');
    expect(tomDoVeredito('ressalva')).toBe('atencao');
  });

  it('todo veredito tem etiqueta', () => {
    for (const v of VEREDITOS_DE_TRIAGEM) expect(etiquetaDoVeredito(v), v).not.toBe('');
  });

  it('a etiqueta é estado, não ordem — imperativo ali lê como botão', () => {
    expect(etiquetaDoVeredito('descartar')).toBe('descartado');
  });
});

describe('perguntasEmTexto', () => {
  it('devolve o texto de cada pendência, pronto para mandar', () => {
    const textos = perguntasEmTexto(PERGUNTAS);
    expect(textos).toHaveLength(PERGUNTAS.length);
    for (const t of textos) expect(t.endsWith('?')).toBe(true);
  });
});

describe('descreverAviso', () => {
  it('devolve nulo sem código e para código desconhecido', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código tem título e corpo', () => {
    for (const c of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(c);
      expect(aviso, c).not.toBeNull();
      expect(aviso?.titulo, c).not.toBe('');
      expect(aviso?.corpo, c).not.toBe('');
    }
  });

  it('o descarte explica por que, e diz que fica cadastrado', () => {
    const aviso = descreverAviso('descartado');
    expect(aviso?.corpo).toContain('preço de fábrica');
    expect(aviso?.corpo).toContain('Fica cadastrado');
  });
});

describe('estadoDaBase', () => {
  it('base vazia convida a cadastrar o primeiro', () => {
    expect(estadoDaBase(contagem())?.titulo).toContain('Nenhum fornecedor');
  });

  it('sem aprovado e com pendência, diz que é falta de resposta', () => {
    const aviso = estadoDaBase(contagem({ perguntar: 3 }));
    expect(aviso?.corpo).toContain('falta de resposta');
  });

  it('cala a boca quando há aprovado', () => {
    expect(estadoDaBase(contagem({ aprovado: 1, perguntar: 2 }))).toBeNull();
  });

  it('não reclama quando só há descartados e ressalvas', () => {
    expect(estadoDaBase(contagem({ descartar: 2, ressalva: 1 }))).toBeNull();
  });
});
