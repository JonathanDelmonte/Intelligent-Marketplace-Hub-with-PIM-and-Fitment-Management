import { describe, expect, it } from 'vitest';
import { formatarTamanho, nomeDoArquivoDaCopia } from './apresentacao';

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
