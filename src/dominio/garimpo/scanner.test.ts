import { describe, expect, it } from 'vitest';
import { CORTE_MARKUP_MINIMO, CORTE_TICKET_MINIMO } from '@/dominio/precificacao/margem';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  avaliarNicho,
  CORTES,
  CRITERIOS_PADRAO,
  ETIQUETA_DO_VEREDITO_DO_SCANNER,
  markupBpDe,
  NichoInvalido,
  NOME_DO_CORTE,
  VEREDITOS_DO_SCANNER,
  type MedidasDoNicho,
} from './scanner';

/** Nicho que passa nos sete cortes. Cada teste estraga uma medida. */
const BOM: MedidasDoNicho = {
  nicho: 'correia de secadora Brastemp',
  markupBp: 35_000,
  shareDosTresBp: 3_000,
  volumeMes: 60,
  ticketMedio: reaisParaCentavos(120),
  substituibilidadeBp: 2_000,
  recorrenciaBp: 8_000,
  fracaoEmCatalogoBp: 1_000,
};

const avaliar = (campos: Partial<MedidasDoNicho> = {}) => avaliarNicho({ ...BOM, ...campos });

describe('nicho', () => {
  it('exige o nome do nicho, porque o corte é por subcategoria', () => {
    expect(() => avaliar({ nicho: '   ' })).toThrow(NichoInvalido);
  });

  it('devolve o nicho aparado, para o veredito dizer sobre o que é', () => {
    expect(avaliar({ nicho: '  refil de purificador  ' }).nicho).toBe('refil de purificador');
  });
});

describe('garimpar', () => {
  it('passa nos sete', () => {
    const r = avaliar();
    expect(r.veredito).toBe('garimpar');
    expect(r.reprovados).toEqual([]);
    expect(r.semMedida).toEqual([]);
    expect(r.cortes).toHaveLength(CORTES.length);
  });

  it('todo corte vem com valor, limite e motivo', () => {
    for (const corte of avaliar().cortes) {
      expect(corte.valor, corte.corte).not.toBeNull();
      expect(corte.limite, corte.corte).not.toBe('');
      expect(corte.motivo, corte.corte).not.toBe('');
    }
  });
});

describe('descartar', () => {
  it('um corte reprovado descarta, mesmo com os outros seis passando', () => {
    const r = avaliar({ markupBp: 20_000 });
    expect(r.veredito).toBe('descartar');
    expect(r.reprovados).toEqual(['markup']);
    expect(r.resumo).toContain('Um corte é um corte');
  });

  it('cada corte reprova pelo seu lado', () => {
    const casos: readonly (readonly [Partial<MedidasDoNicho>, string])[] = [
      [{ markupBp: 29_999 }, 'markup'],
      [{ shareDosTresBp: 4_500 }, 'share_dos_tres_maiores'],
      [{ volumeMes: 29 }, 'volume_do_nicho'],
      [{ ticketMedio: CORTE_TICKET_MINIMO }, 'ticket_medio'],
      [{ substituibilidadeBp: 4_001 }, 'substituibilidade'],
      [{ recorrenciaBp: 5_999 }, 'recorrencia'],
      [{ fracaoEmCatalogoBp: 3_001 }, 'fracao_em_catalogo'],
    ];
    for (const [campos, esperado] of casos) {
      expect(avaliar(campos).reprovados, esperado).toEqual([esperado]);
    }
  });

  it('a fronteira de cada corte é a da especificação', () => {
    // Markup é "≥ 3x", então 3x exato passa. Share é "< 45%", então 45% reprova.
    expect(avaliar({ markupBp: CORTE_MARKUP_MINIMO * 10_000 }).veredito).toBe('garimpar');
    expect(avaliar({ shareDosTresBp: 4_499 }).veredito).toBe('garimpar');
    // Ticket é "> R$ 80", então R$ 80 exato reprova.
    expect(avaliar({ ticketMedio: centavos(CORTE_TICKET_MINIMO + 1) }).veredito).toBe('garimpar');
  });

  it('reprovação vence falta de medida', () => {
    const r = avaliar({ markupBp: 10_000, volumeMes: null });
    expect(r.veredito).toBe('descartar');
    expect(r.semMedida).toEqual(['volume_do_nicho']);
  });
});

describe('medir', () => {
  it('número que falta é medição, não reprovação', () => {
    const r = avaliar({ volumeMes: null });
    expect(r.veredito).toBe('medir');
    expect(r.semMedida).toEqual(['volume_do_nicho']);
    expect(r.resumo).toContain('não é reprovação');
  });

  it('nada medido ainda é "medir", com os sete pendentes', () => {
    const r = avaliarNicho({
      nicho: 'nicho novo',
      markupBp: null,
      shareDosTresBp: null,
      volumeMes: null,
      ticketMedio: null,
      substituibilidadeBp: null,
      recorrenciaBp: null,
      fracaoEmCatalogoBp: null,
    });
    expect(r.veredito).toBe('medir');
    expect(r.semMedida).toHaveLength(CORTES.length);
  });

  it('o corte sem medida não finge valor', () => {
    const corte = avaliar({ volumeMes: null }).cortes.find((c) => c.corte === 'volume_do_nicho');
    expect(corte?.passou).toBeNull();
    expect(corte?.valor).toBeNull();
  });
});

describe('critérios configuráveis', () => {
  it('afrouxar o corte muda o veredito, sem mexer na medida', () => {
    const medidas = { ...BOM, markupBp: 20_000 };
    expect(avaliarNicho(medidas).veredito).toBe('descartar');
    expect(avaliarNicho(medidas, { ...CRITERIOS_PADRAO, markupMinimoBp: 20_000 }).veredito).toBe(
      'garimpar',
    );
  });

  it('o corte de ticket e de markup vêm do módulo de margem, não repetidos aqui', () => {
    expect(CRITERIOS_PADRAO.ticketMinimo).toBe(CORTE_TICKET_MINIMO);
    expect(CRITERIOS_PADRAO.markupMinimoBp).toBe(CORTE_MARKUP_MINIMO * 10_000);
  });
});

describe('markupBpDe', () => {
  it('3x custo é 30 000 pontos-base', () => {
    expect(markupBpDe(reaisParaCentavos(30), reaisParaCentavos(90))).toBe(30_000);
  });

  it('trunca para baixo, que é o lado seguro num corte', () => {
    expect(markupBpDe(centavos(3), centavos(10))).toBe(33_333);
  });

  it('custo zero devolve nulo, porque infinito passaria em qualquer corte', () => {
    expect(markupBpDe(centavos(0), reaisParaCentavos(90))).toBeNull();
  });

  it('custo negativo devolve nulo', () => {
    expect(markupBpDe(centavos(-100), reaisParaCentavos(90))).toBeNull();
  });
});

describe('textos', () => {
  it('todo veredito tem etiqueta', () => {
    for (const v of VEREDITOS_DO_SCANNER) {
      expect(ETIQUETA_DO_VEREDITO_DO_SCANNER[v], v).not.toBe('');
    }
  });

  it('todo corte tem nome legível', () => {
    for (const c of CORTES) expect(NOME_DO_CORTE[c], c).not.toBe('');
  });

  it('mostra markup em vezes e fração em porcento', () => {
    const cortes = avaliar().cortes;
    expect(cortes.find((c) => c.corte === 'markup')?.valor).toBe('3.5x');
    expect(cortes.find((c) => c.corte === 'share_dos_tres_maiores')?.valor).toBe('30%');
  });
});
