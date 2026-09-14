import { describe, expect, it } from 'vitest';
import { URGENCIAS } from '@/dominio/pedidos/fila-do-dia';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  CODIGOS_DE_AVISO,
  avisoDeConsignacao,
  descreverAviso,
  divergenciaEmTexto,
  rotuloDaUrgencia,
  tempoRestanteEmTexto,
  tomDaUrgencia,
} from './apresentacao';

describe('tomDaUrgencia', () => {
  it('só o atraso é alerta', () => {
    expect(tomDaUrgencia('atrasado')).toBe('alerta');
    expect(tomDaUrgencia('hoje')).toBe('atencao');
    expect(tomDaUrgencia('sem_prazo')).toBe('atencao');
    expect(tomDaUrgencia('amanha')).toBe('neutro');
    expect(tomDaUrgencia('depois')).toBe('neutro');
  });

  it('toda urgência tem rótulo', () => {
    for (const u of URGENCIAS) expect(rotuloDaUrgencia(u), u).not.toBe('');
  });
});

describe('tempoRestanteEmTexto', () => {
  it('hora é a unidade de quem vai postar agora', () => {
    expect(tempoRestanteEmTexto(5)).toBe('faltam 5h');
  });

  it('vence agora é dito assim, não "faltam 0h"', () => {
    expect(tempoRestanteEmTexto(0)).toBe('vence agora');
  });

  it('atraso em horas quando é do dia', () => {
    expect(tempoRestanteEmTexto(-3)).toBe('3h de atraso');
  });

  it('atraso em dias quando passou de um dia, com singular certo', () => {
    expect(tempoRestanteEmTexto(-30)).toBe('1 dia de atraso');
    expect(tempoRestanteEmTexto(-72)).toBe('3 dias de atraso');
  });

  it('acima de 48h vira dia, porque a hora exata deixou de importar', () => {
    expect(tempoRestanteEmTexto(47)).toBe('faltam 47h');
    expect(tempoRestanteEmTexto(72)).toBe('faltam 3 dias');
  });

  it('sem prazo não inventa número', () => {
    expect(tempoRestanteEmTexto(null)).toBe('sem prazo');
  });
});

describe('divergenciaEmTexto', () => {
  it('diz de que lado está a diferença', () => {
    expect(divergenciaEmTexto(centavos(0 - reaisParaCentavos(4)))).toContain('a menos');
    expect(divergenciaEmTexto(reaisParaCentavos(4))).toContain('a mais');
  });

  it('mostra o valor absoluto formatado', () => {
    expect(divergenciaEmTexto(centavos(0 - reaisParaCentavos(4)))).toContain('4,00');
  });
});

describe('avisoDeConsignacao', () => {
  it('sem unidade em risco não devolve texto, para a tela não ter caixa vazia', () => {
    expect(avisoDeConsignacao(0)).toBeNull();
    // Negativo não deveria acontecer, e mesmo assim não vira frase absurda.
    expect(avisoDeConsignacao(-1)).toBeNull();
  });

  it('com risco diz o número e o que fazer antes de vender', () => {
    const texto = avisoDeConsignacao(7);
    expect(texto).toContain('7 unidade(s)');
    expect(texto).toContain('antes de vender');
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

  it('"não encontrado" sugere a causa provável em vez de culpar', () => {
    expect(descreverAviso('nao_encontrado')?.corpo).toContain('outra aba');
  });
});
