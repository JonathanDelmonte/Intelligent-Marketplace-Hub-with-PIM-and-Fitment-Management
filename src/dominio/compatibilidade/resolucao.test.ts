import { describe, expect, it } from 'vitest';
import { FORCA_DA_EVIDENCIA, type Evidencia, type TipoDeEvidencia } from './evidencia';
import { combinar, LIMIAR_PUBLICACAO_BP, resolverCompatibilidade, TOTAL_BP } from './resolucao';

let sequencia = 0;

/** Evidência de teste. URL distinta por padrão, que é o caso de fonte independente. */
const ev = (tipo: TipoDeEvidencia, extra: Partial<Evidencia> = {}): Evidencia => {
  sequencia += 1;
  return {
    tipo,
    url: `https://exemplo.invalid/${sequencia}`,
    trecho: null,
    em: '2026-09-01T00:00:00.000Z',
    negativa: false,
    forcaBp: null,
    ...extra,
  };
};

describe('combinar', () => {
  it('uma fonte vale a própria força', () => {
    expect(combinar([4_000])).toBe(4_000);
  });

  it('lista vazia é zero', () => {
    expect(combinar([])).toBe(0);
  });

  it('nunca passa do total, por quantas fontes que sejam', () => {
    expect(combinar(Array.from({ length: 50 }, () => 4_000))).toBeLessThanOrEqual(TOTAL_BP);
  });

  it('é monótona: acrescentar fonte nunca reduz', () => {
    const uma = combinar([4_000]);
    const duas = combinar([4_000, 4_000]);
    expect(duas).toBeGreaterThan(uma);
  });

  it('não depende da ordem de leitura', () => {
    expect(combinar([9_000, 4_000, 6_000])).toBe(combinar([4_000, 6_000, 9_000]));
  });

  it('fonte de força total satura e encerra', () => {
    expect(combinar([TOTAL_BP, 4_000])).toBe(TOTAL_BP);
  });
});

describe('âncoras da especificação', () => {
  it('afirmação do fabricante vale 1,0', () => {
    expect(FORCA_DA_EVIDENCIA.manual_fabricante).toBe(TOTAL_BP);
    expect(resolverCompatibilidade([ev('manual_fabricante')]).confiancaBp).toBe(TOTAL_BP);
  });

  it('três concorrentes concordando chegam a 0,80', () => {
    const r = resolverCompatibilidade([ev('concorrente'), ev('concorrente'), ev('concorrente')]);
    // A âncora da especificação é "0,8"; a conta inteira dá 8 001, e o teste fixa o
    // valor exato para que uma mudança de calibragem apareça aqui.
    expect(r.confiancaBp).toBe(8_001);
    expect(r.publicavel).toBe(true);
  });

  it('um fórum vale 0,40', () => {
    expect(resolverCompatibilidade([ev('forum')]).confiancaBp).toBe(4_000);
  });

  it('dois concorrentes ainda não publicam — a âncora é três', () => {
    const r = resolverCompatibilidade([ev('concorrente'), ev('concorrente')]);
    expect(r.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);
    expect(r.publicavel).toBe(false);
  });
});

describe('corte de publicação', () => {
  it('publica acima do corte', () => {
    expect(resolverCompatibilidade([ev('pagina_oficial')]).publicavel).toBe(true);
  });

  it('não publica abaixo do corte, e diz por quê', () => {
    const r = resolverCompatibilidade([ev('forum')]);
    expect(r.publicavel).toBe(false);
    expect(r.motivo).toContain('abaixo do corte');
  });

  it('fórum nunca publica sozinho, por quantidade nenhuma', () => {
    const muitos = Array.from({ length: 20 }, () => ev('forum'));
    const r = resolverCompatibilidade(muitos);
    expect(r.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);
  });

  it('catálogo de distribuidor sozinho não publica; dois publicam', () => {
    expect(resolverCompatibilidade([ev('catalogo_distribuidor')]).publicavel).toBe(false);
    expect(
      resolverCompatibilidade([ev('catalogo_distribuidor'), ev('catalogo_distribuidor')])
        .publicavel,
    ).toBe(true);
  });

  it('nunca publica decisão de "não serve"', () => {
    const r = resolverCompatibilidade([ev('manual_fabricante', { negativa: true })]);
    expect(r.decisao).toBe('nao_serve');
    expect(r.publicavel).toBe(false);
  });
});

describe('fontes independentes', () => {
  it('a mesma URL contada duas vezes vale uma', () => {
    const url = 'https://exemplo.invalid/mesmo';
    const r = resolverCompatibilidade([
      ev('concorrente', { url }),
      ev('concorrente', { url }),
      ev('concorrente', { url }),
    ]);
    expect(r.confiancaBp).toBe(FORCA_DA_EVIDENCIA.concorrente);
    expect(r.publicavel).toBe(false);
  });

  it('evidência sem URL conta uma vez por tipo, porque não se distingue duplicata', () => {
    const r = resolverCompatibilidade([
      ev('concorrente', { url: null }),
      ev('concorrente', { url: null }),
      ev('concorrente', { url: null }),
    ]);
    expect(r.confiancaBp).toBe(FORCA_DA_EVIDENCIA.concorrente);
  });

  it('relata a evidência descartada em vez de sumir com ela', () => {
    const url = 'https://exemplo.invalid/mesmo';
    const r = resolverCompatibilidade([ev('concorrente', { url }), ev('concorrente', { url })]);
    expect(r.contribuicoes).toHaveLength(2);
    expect(r.contribuicoes.filter((c) => c.contada)).toHaveLength(1);
  });

  it('o mesmo endereço afirmando os dois lados conta nos dois, porque é contradição real', () => {
    const url = 'https://exemplo.invalid/mesmo';
    const r = resolverCompatibilidade([
      ev('concorrente', { url }),
      ev('concorrente', { url, negativa: true }),
    ]);
    expect(r.conflito).not.toBeNull();
  });
});

describe('conflito', () => {
  it('qualquer objeção derruba o par abaixo do corte', () => {
    const r = resolverCompatibilidade([ev('manual_fabricante'), ev('forum', { negativa: true })]);
    expect(r.decisao).toBe('serve');
    expect(r.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);
    expect(r.publicavel).toBe(false);
  });

  it('sinaliza o conflito nomeando as duas fontes', () => {
    const r = resolverCompatibilidade([ev('manual_fabricante'), ev('forum', { negativa: true })]);
    expect(r.conflito).toBe(
      'manual do fabricante afirma que serve e fórum ou grupo de assistência afirma que não serve',
    );
  });

  it('nunca publica linha com conflito aberto', () => {
    const r = resolverCompatibilidade([
      ev('manual_fabricante'),
      ev('pagina_oficial'),
      ev('concorrente', { negativa: true }),
    ]);
    expect(r.conflito).not.toBeNull();
    expect(r.publicavel).toBe(false);
  });

  it('fontes de mesma força discordando ficam indefinidas em vez de escolher um lado', () => {
    const r = resolverCompatibilidade([ev('forum'), ev('forum', { negativa: true })]);
    expect(r.decisao).toBe('indefinido');
    expect(r.motivo).toContain('mesma força');
  });

  it('objeção mais forte inverte a decisão, e ainda sinaliza', () => {
    const r = resolverCompatibilidade([ev('forum'), ev('manual_fabricante', { negativa: true })]);
    expect(r.decisao).toBe('nao_serve');
    expect(r.conflito).not.toBeNull();
  });
});

describe('decisão humana', () => {
  it('vence e fica com confiança total', () => {
    const r = resolverCompatibilidade([ev('forum', { negativa: true }), ev('humano')]);
    expect(r.decisao).toBe('serve');
    expect(r.confiancaBp).toBe(TOTAL_BP);
    expect(r.conflito).toBeNull();
    expect(r.verificadoPor).toBe('humano');
  });

  it('fonte fraca que chega depois não reabre a revisão', () => {
    const r = resolverCompatibilidade([
      ev('humano', { em: '2026-09-01T00:00:00.000Z' }),
      ev('concorrente', { negativa: true, em: '2026-09-10T00:00:00.000Z' }),
    ]);
    expect(r.decisao).toBe('serve');
    expect(r.conflito).toBeNull();
  });

  it('fabricante que aparece depois da revisão reabre o caso', () => {
    const r = resolverCompatibilidade([
      ev('humano', { em: '2026-09-01T00:00:00.000Z' }),
      ev('manual_fabricante', { negativa: true, em: '2026-09-10T00:00:00.000Z' }),
    ]);
    expect(r.decisao).toBe('indefinido');
    expect(r.conflito).toContain('depois');
    expect(r.publicavel).toBe(false);
  });

  it('fabricante que já existia antes da revisão não reabre — a pessoa já viu', () => {
    // Sem a regra temporal, a pessoa que revisa depois de ler o manual nunca
    // conseguiria fechar o caso: a revisão reabriria a si mesma para sempre.
    const r = resolverCompatibilidade([
      ev('manual_fabricante', { negativa: true, em: '2026-09-01T00:00:00.000Z' }),
      ev('humano', { em: '2026-09-10T00:00:00.000Z' }),
    ]);
    expect(r.decisao).toBe('serve');
    expect(r.conflito).toBeNull();
  });

  it('a revisão mais recente é a que vale', () => {
    const r = resolverCompatibilidade([
      ev('humano', { em: '2026-09-01T00:00:00.000Z', url: null }),
      ev('humano', {
        em: '2026-09-10T00:00:00.000Z',
        negativa: true,
        url: 'https://exemplo.invalid/revisao-2',
      }),
    ]);
    expect(r.decisao).toBe('nao_serve');
  });

  it('data ilegível não derruba a resolução', () => {
    const r = resolverCompatibilidade([ev('humano', { em: 'ontem' })]);
    expect(r.decisao).toBe('serve');
  });
});

describe('sem evidência', () => {
  it('é indefinido, não "não serve"', () => {
    const r = resolverCompatibilidade([]);
    expect(r.decisao).toBe('indefinido');
    expect(r.publicavel).toBe(false);
    expect(r.motivo).toContain('nenhuma evidência');
  });
});

describe('força declarada pela própria evidência', () => {
  it('substitui a força do tipo', () => {
    const r = resolverCompatibilidade([ev('inferencia_familia', { forcaBp: 3_000 })]);
    expect(r.confiancaBp).toBe(3_000);
  });

  it('é limitada pelo teto do tipo, para inferência não se declarar mais forte que o manual', () => {
    const r = resolverCompatibilidade([ev('inferencia_familia', { forcaBp: TOTAL_BP })]);
    expect(r.confiancaBp).toBe(6_900);
    expect(r.publicavel).toBe(false);
  });

  it('inferência sozinha nunca publica', () => {
    expect(resolverCompatibilidade([ev('inferencia_familia')]).publicavel).toBe(false);
    expect(resolverCompatibilidade([ev('inferencia_linhagem')]).publicavel).toBe(false);
  });

  it('inferência mais um concorrente confirmando publica', () => {
    // A propriedade que vale: a gramática levanta a hipótese e uma fonte do mundo
    // a confirma. Nenhuma das duas publicaria sozinha.
    const r = resolverCompatibilidade([ev('inferencia_familia'), ev('concorrente')]);
    expect(r.confiancaBp).toBeGreaterThanOrEqual(LIMIAR_PUBLICACAO_BP);
    expect(r.publicavel).toBe(true);
  });
});

describe('quem chancelou', () => {
  it('fabricante quando o fabricante afirmou', () => {
    expect(resolverCompatibilidade([ev('pagina_oficial')]).verificadoPor).toBe('fabricante');
  });

  it('ia quando só há fonte secundária', () => {
    expect(resolverCompatibilidade([ev('concorrente')]).verificadoPor).toBe('ia');
  });
});
