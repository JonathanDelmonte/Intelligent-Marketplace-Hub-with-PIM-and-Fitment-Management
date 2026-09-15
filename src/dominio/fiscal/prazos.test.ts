import { describe, expect, it } from 'vitest';
import {
  DIAS_DO_HORIZONTE,
  DIAS_QUE_JA_SAO_AGORA,
  LIMITE_DO_ROTULO_CURTO,
  PRAZOS,
  URGENCIAS_DO_PRAZO,
  avaliarPrazos,
  prazoQueImporta,
  urgenciaDoPrazo,
} from './prazos';

/** Um dia antes da virada, do lado brasileiro do fuso. */
const EM_2026 = new Date('2026-09-15T12:00:00-03:00');

describe('PRAZOS', () => {
  it('cada prazo diz a consequência, o que fazer e de onde veio a data', () => {
    // Prazo sem "o que fazer" é informação; com, é tarefa. E sem a base legal
    // ninguém consegue conferir se a data ainda vale.
    for (const p of PRAZOS) {
      expect(p.dia, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.consequencia.length, p.id).toBeGreaterThan(40);
      expect(p.oQueFazer.length, p.id).toBeGreaterThan(40);
      expect(p.base.length, p.id).toBeGreaterThan(5);
      expect(p.regimes.length, p.id).toBeGreaterThan(0);
    }
  });

  it('o rótulo curto cabe numa linha, e não é o título cortado', () => {
    // A tela inicial mostra o rótulo no fim de uma linha, com a contagem de dias. Um
    // título inteiro ali empurra o número para a segunda linha.
    for (const p of PRAZOS) {
      expect(p.rotuloCurto.length, p.id).toBeGreaterThan(3);
      expect(p.rotuloCurto.length, p.id).toBeLessThanOrEqual(LIMITE_DO_ROTULO_CURTO);
      expect(p.rotuloCurto.endsWith('...'), p.id).toBe(false);
    }
  });

  it('cobre as duas datas da especificação', () => {
    expect(PRAZOS.map((p) => p.dia)).toEqual(['2027-01-01', '2027-01-04']);
  });

  it('o prazo do CNPJ é de quem é CPF, e o da NF-e é de MEI e Simples', () => {
    // Prazo de outro regime na sua tela é ruído, e ruído faz parar de ler a tela.
    expect(PRAZOS.find((p) => p.id === 'cnpj_pf_cbs')?.regimes).toEqual(['cpf']);
    expect(PRAZOS.find((p) => p.id === 'nfe_ibs_cbs')?.regimes).toEqual(['mei', 'simples']);
  });
});

describe('urgenciaDoPrazo', () => {
  it('passa de "tem tempo" a "agora" pelo trabalho que o prazo exige', () => {
    expect(urgenciaDoPrazo(DIAS_DO_HORIZONTE + 1)).toBe('tem_tempo');
    expect(urgenciaDoPrazo(DIAS_DO_HORIZONTE)).toBe('este_mes');
    expect(urgenciaDoPrazo(DIAS_QUE_JA_SAO_AGORA + 1)).toBe('este_mes');
    expect(urgenciaDoPrazo(DIAS_QUE_JA_SAO_AGORA)).toBe('agora');
    expect(urgenciaDoPrazo(0)).toBe('agora');
    expect(urgenciaDoPrazo(-1)).toBe('passou');
  });

  it('toda urgência declarada é alcançável', () => {
    const vistas = new Set([
      urgenciaDoPrazo(-5),
      urgenciaDoPrazo(1),
      urgenciaDoPrazo(60),
      urgenciaDoPrazo(400),
    ]);
    expect([...URGENCIAS_DO_PRAZO].filter((u) => !vistas.has(u))).toEqual([]);
  });
});

describe('avaliarPrazos', () => {
  it('conta os dias até a data, no fuso do vendedor', () => {
    const avaliados = avaliarPrazos({ agora: EM_2026 });
    const cnpj = avaliados.find((p) => p.id === 'cnpj_pf_cbs');
    expect(cnpj?.diasRestantes).toBe(108);
    expect(cnpj?.urgencia).toBe('tem_tempo');
  });

  it('a virada do dia no fuso não muda a contagem para o dia seguinte', () => {
    // 22h de 15/09 em São Paulo é 01h de 16/09 em UTC. Contar em UTC daria um dia
    // menos de prazo — e num painel de prazo isso é errar para o lado errado.
    const noite = new Date('2026-09-16T01:00:00Z');
    const sp = avaliarPrazos({ agora: noite })[0]?.diasRestantes;
    const utc = avaliarPrazos({ agora: noite, fuso: 'UTC' })[0]?.diasRestantes;
    expect(sp).toBe(108);
    expect(utc).toBe(107);
  });

  it('marca o que atinge o regime, e não esconde o resto', () => {
    // O regime muda: quem é CPF hoje pode ser MEI em dezembro, e o prazo que era
    // "de outro" passa a ser o dele.
    const comoMei = avaliarPrazos({ agora: EM_2026, regime: 'mei' });
    expect(comoMei).toHaveLength(PRAZOS.length);
    expect(comoMei[0]?.id).toBe('nfe_ibs_cbs');
    expect(comoMei[0]?.meAtinge).toBe(true);
    expect(comoMei[1]?.meAtinge).toBe(false);
  });

  it('sem regime informado tudo atinge, porque não se sabe o contrário', () => {
    for (const p of avaliarPrazos({ agora: EM_2026 })) expect(p.meAtinge).toBe(true);
  });

  it('ordena o meu primeiro e, dentro disso, por data', () => {
    const comoCpf = avaliarPrazos({ agora: EM_2026, regime: 'cpf' });
    expect(comoCpf.map((p) => p.id)).toEqual(['cnpj_pf_cbs', 'nfe_ibs_cbs']);
  });

  it('depois da data o prazo fica como passou, e não desaparece', () => {
    // Desaparecer faria parecer que estava tudo bem.
    const depois = avaliarPrazos({ agora: new Date('2027-02-01T12:00:00-03:00') });
    expect(depois.every((p) => p.urgencia === 'passou')).toBe(true);
    expect(depois[0]?.diasRestantes).toBeLessThan(0);
  });
});

describe('prazoQueImporta', () => {
  it('é o mais próximo que ainda não passou e é meu', () => {
    const avaliados = avaliarPrazos({ agora: EM_2026, regime: 'mei' });
    expect(prazoQueImporta(avaliados)?.id).toBe('nfe_ibs_cbs');
  });

  it('ignora prazo de outro regime, que não é decisão desta semana', () => {
    const avaliados = avaliarPrazos({ agora: EM_2026, regime: 'simples' });
    expect(prazoQueImporta(avaliados)?.id).toBe('nfe_ibs_cbs');
  });

  it('todos passados devolve nulo, para a tela não mostrar caixa vazia', () => {
    const avaliados = avaliarPrazos({ agora: new Date('2030-01-01T12:00:00-03:00') });
    expect(prazoQueImporta(avaliados)).toBeNull();
  });
});
