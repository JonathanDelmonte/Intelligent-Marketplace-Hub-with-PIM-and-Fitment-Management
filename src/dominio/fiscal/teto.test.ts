import { describe, expect, it } from 'vitest';
import { reaisParaCentavos, type Centavos } from '@/lib/dinheiro';
import {
  AVISO_AMARELO_BP,
  AVISO_VERMELHO_BP,
  SITUACOES_DO_TETO,
  TETO_MEI_ANUAL,
  avaliarTeto,
  mesNoFuso,
  tetoProporcional,
  type EntradaDoTeto,
} from './teto';

const reais = (v: number): Centavos => reaisParaCentavos(v);

/** 15 de setembro: nove meses corridos, três faltando. */
const SETEMBRO = new Date('2026-09-15T12:00:00-03:00');

const entrada = (campos: Partial<EntradaDoTeto> = {}): EntradaDoTeto => ({
  receitaBruta: reais(0),
  receitaExterna: reais(0),
  ...campos,
});

describe('mesNoFuso', () => {
  it('usa o fuso do vendedor para decidir o mês', () => {
    // 21h de 30/09 em São Paulo é 00h de 01/10 em UTC — e a projeção divide pelo
    // número de meses corridos, então errar o mês erra o número inteiro.
    const virada = new Date('2026-10-01T00:00:00Z');
    expect(mesNoFuso(virada, 'America/Sao_Paulo')).toBe(9);
    expect(mesNoFuso(virada, 'UTC')).toBe(10);
  });
});

describe('tetoProporcional', () => {
  it('CNPJ de ano anterior tem o teto cheio', () => {
    expect(tetoProporcional(TETO_MEI_ANUAL, null)).toBe(TETO_MEI_ANUAL);
    expect(tetoProporcional(TETO_MEI_ANUAL, 1)).toBe(TETO_MEI_ANUAL);
  });

  it('quem abriu em julho tem metade, contando julho inteiro', () => {
    // Seis doze avos: julho a dezembro.
    expect(tetoProporcional(TETO_MEI_ANUAL, 7)).toBe(reais(40_500));
  });

  it('quem abriu em dezembro tem um doze avos', () => {
    expect(tetoProporcional(TETO_MEI_ANUAL, 12)).toBe(reais(6750));
  });

  it('trunca em vez de arredondar para cima', () => {
    // Arredondar para cima daria ao vendedor um teto que ele não tem.
    const teto = tetoProporcional(reaisParaCentavos(100), 8);
    expect(teto).toBe(reaisParaCentavos('41.66'));
  });

  it('mês fora da faixa devolve zero em vez de número absurdo', () => {
    expect(tetoProporcional(TETO_MEI_ANUAL, 13)).toBe(0);
  });
});

describe('avaliarTeto', () => {
  it('soma a receita das plataformas com a informada à mão', () => {
    // O teto considera receita bruta do regime, que inclui venda fora das
    // plataformas integradas.
    const r = avaliarTeto(entrada({ receitaBruta: reais(30_000), receitaExterna: reais(10_000) }), {
      agora: SETEMBRO,
    });
    expect(r.acumulado).toBe(reais(40_000));
    expect(r.restante).toBe(reais(41_000));
  });

  it('avisa em setenta por cento, que é o primeiro número da especificação', () => {
    const abaixo = avaliarTeto(entrada({ receitaBruta: reais(56_699) }), { agora: SETEMBRO });
    const em = avaliarTeto(entrada({ receitaBruta: reais(56_700) }), { agora: SETEMBRO });
    expect(abaixo.situacao).toBe('tranquilo');
    expect(em.situacao).toBe('atencao');
    expect(em.usadoBp).toBeGreaterThanOrEqual(AVISO_AMARELO_BP);
  });

  it('avisa em oitenta e cinco por cento, que é o segundo', () => {
    const r = avaliarTeto(entrada({ receitaBruta: reais(68_850) }), { agora: SETEMBRO });
    expect(r.situacao).toBe('perto');
    expect(r.usadoBp).toBeGreaterThanOrEqual(AVISO_VERMELHO_BP);
  });

  it('passar do teto é desenquadramento, e a mensagem diz isso', () => {
    // Não é multa: é mudança de regime retroativa ao início do ano.
    const r = avaliarTeto(entrada({ receitaBruta: reais(90_000) }), { agora: SETEMBRO });
    expect(r.situacao).toBe('estourou');
    expect(r.restante).toBe(0);
    expect(r.mensagem).toContain('desenquadramento');
    expect(r.mediaMensalQueCabe).toBeNull();
  });

  it('o uso trunca: 99,99% não vira 100%', () => {
    // Arredondar para cima diria "estourou" para quem não estourou.
    const r = avaliarTeto(entrada({ receitaBruta: reais(80_999) }), { agora: SETEMBRO });
    expect(r.usadoBp).toBe(9999);
    expect(r.situacao).toBe('perto');
  });

  it('a projeção é o número que avisa cedo, e o acumulado não', () => {
    // 40% do teto em abril projeta estouro; 40% em novembro não. O acumulado é o
    // mesmo nos dois casos, e é por isso que ele sozinho avisa tarde.
    const abril = avaliarTeto(entrada({ receitaBruta: reais(32_400) }), {
      agora: new Date('2026-04-15T12:00:00-03:00'),
    });
    const novembro = avaliarTeto(entrada({ receitaBruta: reais(32_400) }), {
      agora: new Date('2026-11-15T12:00:00-03:00'),
    });

    expect(abril.situacao).toBe('tranquilo');
    expect(abril.projecaoEstoura).toBe(true);
    expect(abril.projecaoAnual).toBe(reais(97_200));

    expect(novembro.situacao).toBe('tranquilo');
    expect(novembro.projecaoEstoura).toBe(false);
  });

  it('a projeção é declarada como hipótese, não como previsão', () => {
    const r = avaliarTeto(entrada({ receitaBruta: reais(32_400) }), {
      agora: new Date('2026-04-15T12:00:00-03:00'),
    });
    expect(r.mensagem).toContain('hipótese');
    expect(r.mensagem).toContain('linha reta');
  });

  it('em janeiro não divide por zero', () => {
    // O mês corrente conta inteiro: em janeiro são um mês corrido, não zero.
    const r = avaliarTeto(entrada({ receitaBruta: reais(5000) }), {
      agora: new Date('2026-01-10T12:00:00-03:00'),
    });
    expect(Number.isFinite(r.projecaoAnual)).toBe(true);
    expect(r.projecaoAnual).toBe(reais(60_000));
  });

  it('diz quanto cabe por mês no que resta do ano', () => {
    // Em setembro faltam três meses; R$ 41.000 restantes dão pouco mais de 13 mil.
    const r = avaliarTeto(entrada({ receitaBruta: reais(40_000) }), { agora: SETEMBRO });
    expect(r.mediaMensalQueCabe).toBe(reaisParaCentavos('13666.66'));
  });

  it('em dezembro não há mês seguinte, então não há média a sugerir', () => {
    const r = avaliarTeto(entrada({ receitaBruta: reais(40_000) }), {
      agora: new Date('2026-12-15T12:00:00-03:00'),
    });
    expect(r.mediaMensalQueCabe).toBeNull();
  });

  it('teto proporcional muda a situação de quem abriu no meio do ano', () => {
    // R$ 40.000 é metade do teto cheio e quase todo o teto de quem abriu em julho.
    const cheio = avaliarTeto(entrada({ receitaBruta: reais(40_000) }), { agora: SETEMBRO });
    const proporcional = avaliarTeto(entrada({ receitaBruta: reais(40_000), mesDeAbertura: 7 }), {
      agora: SETEMBRO,
    });
    expect(cheio.situacao).toBe('tranquilo');
    expect(proporcional.situacao).toBe('perto');
  });

  it('teto próprio do perfil vence o teto padrão', () => {
    // R$ 50.000 é 61% do teto cheio e 83% de um teto de R$ 60.000 — mesma receita,
    // situações diferentes.
    const r = avaliarTeto(entrada({ receitaBruta: reais(50_000), tetoAnual: reais(60_000) }), {
      agora: SETEMBRO,
    });
    expect(r.teto).toBe(reais(60_000));
    expect(r.situacao).toBe('atencao');
    expect(
      avaliarTeto(entrada({ receitaBruta: reais(50_000) }), { agora: SETEMBRO }).situacao,
    ).toBe('tranquilo');
  });

  it('receita zero não quebra e não alarma', () => {
    const r = avaliarTeto(entrada(), { agora: SETEMBRO });
    expect(r.usadoBp).toBe(0);
    expect(r.situacao).toBe('tranquilo');
    expect(r.projecaoEstoura).toBe(false);
  });

  it('toda situação declarada é alcançável', () => {
    const vistas = new Set(
      [0, 57_000, 69_000, 90_000].map(
        (v) => avaliarTeto(entrada({ receitaBruta: reais(v) }), { agora: SETEMBRO }).situacao,
      ),
    );
    expect([...SITUACOES_DO_TETO].filter((s) => !vistas.has(s))).toEqual([]);
  });
});
