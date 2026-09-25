import { describe, expect, it } from 'vitest';
import { descreverVersao } from './versao';

const HASH = '3f9c2a1b7e4d5c6a8b9f0e1d2c3b4a5f6e7d8c9b';

describe('versão no rodapé', () => {
  it('diz a hora do commit no fuso de quem vende, e o começo do hash', () => {
    // 02:33 em UTC é 23:33 do dia anterior em São Paulo.
    expect(descreverVersao(HASH, '2026-09-25T02:33:10Z')).toBe(
      'atualizado em 24/09/2026 às 23:33 (3f9c2a1)',
    );
    expect(descreverVersao(HASH, '2026-09-25T14:05:00-03:00')).toBe(
      'atualizado em 25/09/2026 às 14:05 (3f9c2a1)',
    );
  });

  it('sem a hora, só o hash', () => {
    expect(descreverVersao(HASH, undefined)).toBe('versão 3f9c2a1');
    expect(descreverVersao(HASH, 'ontem')).toBe('versão 3f9c2a1');
  });

  it('no computador, sem versão publicada, não diz nada', () => {
    expect(descreverVersao(undefined, '2026-09-25T02:33:10Z')).toBeNull();
    expect(descreverVersao('', undefined)).toBeNull();
  });
});
