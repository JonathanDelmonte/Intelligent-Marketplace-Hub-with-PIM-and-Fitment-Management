import { describe, expect, it } from 'vitest';
import {
  ETIQUETA_DA_FONTE,
  FONTES,
  type Fonte,
  type Procedencia,
  decidirEscrita,
  exigeCredencial,
  forcaDe,
  leituraMaisConfiavel,
  maisForteQue,
} from './index';

const em = (iso: string, fonte: Fonte): Procedencia => ({
  fonte,
  coletadoEm: new Date(iso),
});

describe('ordem de força das fontes', () => {
  it('manual é a mais forte e m0_link a mais fraca', () => {
    expect(maisForteQue('manual', 'm3_api')).toBe(true);
    expect(maisForteQue('m3_api', 'm1_planilha')).toBe(true);
    expect(maisForteQue('m1_planilha', 'm2_publico')).toBe(true);
    expect(maisForteQue('m2_publico', 'm0_link')).toBe(true);
    expect(maisForteQue('m0_link', 'manual')).toBe(false);
  });

  it('a ordem é total — nenhuma fonte empata com outra', () => {
    const forcas = FONTES.map(forcaDe);
    expect(new Set(forcas).size).toBe(FONTES.length);
  });

  it('toda fonte tem etiqueta legível, para a UI não inventar string', () => {
    for (const fonte of FONTES) {
      expect(ETIQUETA_DA_FONTE[fonte]).toBeTruthy();
    }
  });

  it('só m3_api exige credencial — é o que faz o sistema rodar sem conectar conta', () => {
    expect(exigeCredencial('m3_api')).toBe(true);
    for (const fonte of FONTES.filter((f) => f !== 'm3_api')) {
      expect(exigeCredencial(fonte)).toBe(false);
    }
  });
});

describe('decidirEscrita', () => {
  it('escreve em campo vazio', () => {
    const d = decidirEscrita({
      existente: null,
      novo: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
    });
    expect(d.tipo).toBe('escrever');
  });

  it('origem mais forte sobrescreve', () => {
    const d = decidirEscrita({
      existente: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      novo: { valor: 8150, procedencia: em('2026-09-02T10:00:00Z', 'm3_api') },
    });
    expect(d.tipo).toBe('escrever');
    expect(d.motivo).toContain('API oficial');
  });

  it('origem mais fraca NÃO sobrescreve, mesmo sendo mais recente', () => {
    // A regra central do ADR 0002. Página extraída hoje não apaga o que a API
    // oficial disse ontem.
    const d = decidirEscrita({
      existente: { valor: 8150, procedencia: em('2026-09-01T10:00:00Z', 'm3_api') },
      novo: { valor: 7890, procedencia: em('2026-09-30T10:00:00Z', 'm0_link') },
    });
    expect(d.tipo).toBe('ignorar');
    expect(d.motivo).toContain('não sobrescreve');
  });

  it('nem a extração mais recente vence um valor informado à mão', () => {
    const d = decidirEscrita({
      existente: { valor: 'EF-ELX-21', procedencia: em('2026-01-01T00:00:00Z', 'manual') },
      novo: { valor: 'EF ELX 21', procedencia: em('2026-09-30T10:00:00Z', 'm3_api') },
    });
    expect(d.tipo).toBe('ignorar');
  });

  it('valor idêntico é ignorado sem ruído, venha de onde vier', () => {
    for (const fonte of FONTES) {
      const d = decidirEscrita({
        existente: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm3_api') },
        novo: { valor: 7890, procedencia: em('2026-09-02T10:00:00Z', fonte) },
      });
      expect(d.tipo).toBe('ignorar');
      expect(d.motivo).toContain('idêntico');
    }
  });

  it('mesma origem com valores diferentes é CONFLITO, não atualização', () => {
    const d = decidirEscrita({
      existente: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      novo: { valor: 8150, procedencia: em('2026-09-02T10:00:00Z', 'm0_link') },
    });
    expect(d.tipo).toBe('conflito');
    expect(d.motivo).toContain('discordam');
  });

  it('campo volátil aceita leitura mais recente da mesma origem', () => {
    const d = decidirEscrita({
      existente: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      novo: { valor: 8150, procedencia: em('2026-09-02T10:00:00Z', 'm0_link') },
      volatil: true,
    });
    expect(d.tipo).toBe('escrever');
    expect(d.motivo).toContain('volátil');
  });

  it('campo volátil ignora leitura mais antiga da mesma origem', () => {
    const d = decidirEscrita({
      existente: { valor: 8150, procedencia: em('2026-09-02T10:00:00Z', 'm0_link') },
      novo: { valor: 7890, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      volatil: true,
    });
    expect(d.tipo).toBe('ignorar');
  });

  it('campo volátil não relaxa a regra de força — fraco ainda não vence forte', () => {
    const d = decidirEscrita({
      existente: { valor: 8150, procedencia: em('2026-09-01T10:00:00Z', 'm3_api') },
      novo: { valor: 7890, procedencia: em('2026-09-30T10:00:00Z', 'm0_link') },
      volatil: true,
    });
    expect(d.tipo).toBe('ignorar');
  });

  it('usa comparação customizada para valor estruturado', () => {
    const d = decidirEscrita({
      existente: { valor: { ean: '789' }, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      novo: { valor: { ean: '789' }, procedencia: em('2026-09-02T10:00:00Z', 'm0_link') },
      iguais: (a, b) => a.ean === b.ean,
    });
    expect(d.tipo).toBe('ignorar');
  });

  it('sem comparação customizada, objeto estruturado igual cai em conflito', () => {
    // Documenta a pegadinha: `Object.is` compara referência. Quem grava valor
    // estruturado precisa passar `iguais`.
    const d = decidirEscrita({
      existente: { valor: { ean: '789' }, procedencia: em('2026-09-01T10:00:00Z', 'm0_link') },
      novo: { valor: { ean: '789' }, procedencia: em('2026-09-02T10:00:00Z', 'm0_link') },
    });
    expect(d.tipo).toBe('conflito');
  });
});

describe('leituraMaisConfiavel', () => {
  it('devolve null para lista vazia — SKU sem coleta é caso normal', () => {
    expect(leituraMaisConfiavel([])).toBeNull();
  });

  it('escolhe a de maior força, ignorando a ordem da lista', () => {
    const escolhida = leituraMaisConfiavel([
      { id: 'a', procedencia: em('2026-09-10T00:00:00Z', 'm0_link') },
      { id: 'b', procedencia: em('2026-09-01T00:00:00Z', 'm3_api') },
      { id: 'c', procedencia: em('2026-09-05T00:00:00Z', 'm2_publico') },
    ]);
    expect(escolhida?.id).toBe('b');
  });

  it('em empate de força, escolhe a mais recente', () => {
    const escolhida = leituraMaisConfiavel([
      { id: 'a', procedencia: em('2026-09-01T00:00:00Z', 'm0_link') },
      { id: 'b', procedencia: em('2026-09-20T00:00:00Z', 'm0_link') },
      { id: 'c', procedencia: em('2026-09-10T00:00:00Z', 'm0_link') },
    ]);
    expect(escolhida?.id).toBe('b');
  });

  it('é estável: primeira leitura ganha quando força e data empatam', () => {
    const escolhida = leituraMaisConfiavel([
      { id: 'a', procedencia: em('2026-09-01T00:00:00Z', 'm1_planilha') },
      { id: 'b', procedencia: em('2026-09-01T00:00:00Z', 'm1_planilha') },
    ]);
    expect(escolhida?.id).toBe('a');
  });

  it('com uma leitura só, devolve ela', () => {
    const escolhida = leituraMaisConfiavel([
      { id: 'única', procedencia: em('2026-09-01T00:00:00Z', 'm0_link') },
    ]);
    expect(escolhida?.id).toBe('única');
  });
});
