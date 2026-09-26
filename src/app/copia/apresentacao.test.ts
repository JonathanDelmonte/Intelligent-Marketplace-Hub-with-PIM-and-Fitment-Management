import { describe, expect, it } from 'vitest';
import {
  avisoDaRestauracao,
  descreverCopia,
  formatarTamanho,
  nomeDoArquivoDaCopia,
} from './apresentacao';

describe('nomeDoArquivoDaCopia', () => {
  it('diz o que é e quando, na hora de São Paulo', () => {
    // 02h10 em UTC ainda é o dia anterior em São Paulo.
    expect(nomeDoArquivoDaCopia(new Date('2026-09-27T02:10:00Z'))).toBe(
      'copia-dos-dados-2026-09-26-2310.sql.gz',
    );
  });

  it('meia-noite é 00, e não 24', () => {
    expect(nomeDoArquivoDaCopia(new Date('2026-09-26T03:05:00Z'))).toBe(
      'copia-dos-dados-2026-09-26-0005.sql.gz',
    );
  });
});

describe('formatarTamanho', () => {
  it('em potências de mil, com vírgula', () => {
    expect(formatarTamanho(512)).toBe('512 bytes');
    expect(formatarTamanho(840_000)).toBe('840 KB');
    expect(formatarTamanho(12_345_678)).toBe('12 MB');
    expect(formatarTamanho(1_250_000)).toBe('1,3 MB');
    expect(formatarTamanho(2_500_000_000)).toBe('2,5 GB');
  });

  it('o que não é número vira zero, e não "NaN bytes"', () => {
    expect(formatarTamanho(Number.NaN)).toBe('0 bytes');
    expect(formatarTamanho(-3)).toBe('0 bytes');
  });
});

describe('descreverCopia', () => {
  it('diz de quando, de que versão — curta, como no rodapé — e o tamanho', () => {
    expect(
      descreverCopia({
        geradaEm: '2026-09-26T15:30:00.000Z',
        versao: '09dd7271129c6a352cae006c656c791bb64671e1',
        tabelas: 25,
        linhas: 1234,
      }),
    ).toBe('Cópia de 26/09/2026 às 12:30 · versão 09dd727 · 25 tabelas, 1.234 linhas');
  });

  it('sem data e sem versão conhecida, diz o que sabe', () => {
    expect(descreverCopia({ geradaEm: null, versao: 'desconhecida', tabelas: 1, linhas: 1 })).toBe(
      'Cópia sem data · 1 tabela, 1 linha',
    );
  });
});

describe('avisoDaRestauracao', () => {
  const restaurada = {
    situacao: 'restaurada',
    geradaEm: '2026-09-26T15:30:00.000Z',
    versao: 'teste',
    tabelas: 25,
    linhas: 9,
  } as const;

  it('restaurada: diz de quando é o que voltou, e que as contas continuam', () => {
    const aviso = avisoDaRestauracao({ ...restaurada, perfil: 'existia' });
    expect(aviso.tipo).toBe('ok');
    expect(aviso.titulo).toBe('A cópia voltou');
    expect(aviso.corpo).toBe(
      'Os dados agora são os da cópia de 26/09/2026 às 12:30: 25 tabelas, 9 linhas. As contas de acesso continuam as mesmas.',
    );
  });

  it('o perfil renomeado é dito; o ausente é atenção, com o que fazer', () => {
    expect(avisoDaRestauracao({ ...restaurada, perfil: 'renomeado' }).corpo).toContain(
      'passou a usar o deste sistema',
    );
    const ausente = avisoDaRestauracao({ ...restaurada, perfil: 'ausente' });
    expect(ausente.tipo).toBe('atencao');
    expect(ausente.corpo).toContain('Reiniciar o sistema cria um perfil novo');
  });

  it('recusada: o motivo com maiúscula e ponto, e que nada mudou — sem repetir', () => {
    expect(avisoDaRestauracao({ situacao: 'recusada', motivo: 'a sessão acabou' })).toEqual({
      tipo: 'erro',
      titulo: 'A cópia não voltou',
      corpo: 'A sessão acabou. Nada foi mudado.',
    });
    expect(
      avisoDaRestauracao({
        situacao: 'recusada',
        motivo: 'a cópia está incompleta. Nada foi mudado: baixe a cópia de novo.',
      }).corpo,
    ).toBe('A cópia está incompleta. Nada foi mudado: baixe a cópia de novo.');
  });

  it('resposta que não é a esperada não promete que nada mudou', () => {
    const aviso = avisoDaRestauracao('<html>502 Bad Gateway</html>');
    expect(aviso.tipo).toBe('erro');
    expect(aviso.corpo).not.toContain('Nada foi mudado');
  });
});
