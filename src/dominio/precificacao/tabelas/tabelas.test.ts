import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { FONTES } from '@/dominio/procedencia';
import { MODOS_FRETE, PLATAFORMAS, REGIMES_FISCAIS, SEVERIDADES, TIPOS_ANUNCIO_ML } from '../tipos';
import type { Plataforma } from '../tipos';
import {
  TABELAS,
  TabelaDeTaxasAusente,
  freteEstimadoML,
  fretePrograma,
  tabelaVigente,
} from './index';

const r = reaisParaCentavos;

describe('tabelaVigente', () => {
  it('resolve as três plataformas na data de hoje', () => {
    for (const plataforma of PLATAFORMAS) {
      const tabela = tabelaVigente(plataforma, new Date('2026-09-12T00:00:00Z'));
      expect(tabela.plataforma).toBe(plataforma);
    }
  });

  it('lança para data anterior à vigência, em vez de devolver um padrão', () => {
    // Precificar com tabela errada é pior que não precificar: o resultado parece
    // válido.
    expect(() => tabelaVigente('ml', new Date('2020-01-01T00:00:00Z'))).toThrow(
      TabelaDeTaxasAusente,
    );
  });

  it('a mensagem do erro diz o que fazer', () => {
    try {
      tabelaVigente('ml', new Date('2020-01-01T00:00:00Z'));
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as Error).message).toContain('Cadastre a tabela');
    }
  });

  it('inclui o instante inicial da vigência', () => {
    const tabela = tabelaVigente('ml', new Date('2026-01-01T00:00:00Z'));
    expect(tabela.vigenteDe.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('usa a data de hoje quando nenhuma é passada', () => {
    expect(() => tabelaVigente('ml')).not.toThrow();
  });

  it('escolhe a mais recente quando há mais de uma vigente', () => {
    // Cadastro duplicado é erro, mas o cálculo não pode travar por causa dele —
    // a mais recente vence, e o rótulo na decomposição permite achar a duplicada.
    const original = [...TABELAS];
    const maisNova = {
      ...original[0]!,
      vigenteDe: new Date('2026-06-01T00:00:00Z'),
      rotulo: 'ML · duplicada mais recente',
    };
    const lista = [...original, maisNova];

    const vigentes = lista.filter(
      (t) =>
        t.plataforma === 'ml' &&
        t.vigenteDe.getTime() <= new Date('2026-09-12T00:00:00Z').getTime() &&
        (t.vigenteAte === null ||
          t.vigenteAte.getTime() > new Date('2026-09-12T00:00:00Z').getTime()),
    );
    expect(vigentes).toHaveLength(2);

    const escolhida = vigentes.reduce((melhor, atual) =>
      atual.vigenteDe.getTime() > melhor.vigenteDe.getTime() ? atual : melhor,
    );
    expect(escolhida.rotulo).toBe('ML · duplicada mais recente');
  });
});

describe('integridade das tabelas cadastradas', () => {
  it('cada plataforma tem exatamente uma tabela', () => {
    for (const plataforma of PLATAFORMAS) {
      expect(TABELAS.filter((t) => t.plataforma === plataforma)).toHaveLength(1);
    }
  });

  it('toda tabela declara origem conhecida e rótulo legível', () => {
    for (const tabela of TABELAS) {
      expect(FONTES).toContain(tabela.fonte);
      expect(tabela.rotulo.length).toBeGreaterThan(5);
    }
  });

  it('toda faixa de custo fixo termina com um catch-all', () => {
    // Sem a faixa de `ateExclusivo: null` haveria preço sem taxa definida, e o
    // cálculo cairia silenciosamente em zero.
    for (const tabela of TABELAS) {
      const ultima = tabela.custoFixoPorUnidade.at(-1);
      expect(ultima?.ateExclusivo, tabela.rotulo).toBeNull();
    }
  });

  it('as faixas de custo fixo estão em ordem crescente', () => {
    for (const tabela of TABELAS) {
      const limites = tabela.custoFixoPorUnidade
        .map((f) => f.ateExclusivo)
        .filter((v): v is NonNullable<typeof v> => v !== null);
      expect(
        [...limites].sort((a, b) => a - b),
        tabela.rotulo,
      ).toEqual(limites);
    }
  });

  it('toda comissão por faixa de preço termina com um catch-all', () => {
    for (const tabela of TABELAS) {
      if (tabela.comissao.tipo !== 'por_faixa_de_preco') continue;
      expect(tabela.comissao.faixas.at(-1)?.ateExclusivo, tabela.rotulo).toBeNull();
    }
  });

  it('a comissão por tipo de anúncio cobre os três tipos do ML', () => {
    const ml = TABELAS.find((t) => t.plataforma === 'ml');
    expect(ml?.comissao.tipo).toBe('por_tipo_anuncio');
    if (ml?.comissao.tipo === 'por_tipo_anuncio') {
      for (const tipo of TIPOS_ANUNCIO_ML) {
        expect(ml.comissao.porTipo[tipo]).toBeGreaterThan(0);
      }
    }
  });

  it('todo acréscimo tem código e rótulo distintos', () => {
    for (const tabela of TABELAS) {
      const codigos = tabela.acrescimos.map((a) => a.codigo);
      expect(new Set(codigos).size, tabela.rotulo).toBe(codigos.length);
      for (const a of tabela.acrescimos) {
        expect(a.rotulo.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('estimativa de frete', () => {
  it('cresce com o peso, sem degrau invertido', () => {
    const pesos = [100, 300, 400, 500, 800, 1000, 1500, 2000, 3000, 5000, 12_000];
    const valores = pesos.map((p) => freteEstimadoML(p));
    for (let i = 1; i < valores.length; i += 1) {
      expect(valores[i]!).toBeGreaterThanOrEqual(valores[i - 1]!);
    }
  });

  it('o item leve cai na primeira faixa e o muito pesado na última', () => {
    expect(freteEstimadoML(250)).toBe(r(18));
    expect(freteEstimadoML(50_000)).toBe(r(46));
  });

  it('peso zero cai na primeira faixa, não em erro', () => {
    expect(freteEstimadoML(0)).toBe(r(18));
  });

  it('o programa de frete da Shopee respeita a faixa de R$ 16 a R$ 28', () => {
    for (const peso of [100, 500, 1000, 2000, 10_000]) {
      const valor = fretePrograma(peso);
      expect(valor).toBeGreaterThanOrEqual(r(16));
      expect(valor).toBeLessThanOrEqual(r(28));
    }
  });

  it('o programa de frete também cresce com o peso', () => {
    expect(fretePrograma(2000)).toBeGreaterThan(fretePrograma(400));
  });
});

describe('enumerações do domínio', () => {
  it('não têm valor repetido', () => {
    const listas: Record<string, readonly string[]> = {
      PLATAFORMAS,
      TIPOS_ANUNCIO_ML,
      REGIMES_FISCAIS,
      MODOS_FRETE,
      SEVERIDADES,
    };
    for (const [nome, lista] of Object.entries(listas)) {
      expect(new Set(lista).size, nome).toBe(lista.length);
    }
  });

  it('PLATAFORMAS cobre toda plataforma com tabela cadastrada', () => {
    const comTabela = new Set<Plataforma>(TABELAS.map((t) => t.plataforma));
    expect([...comTabela].sort()).toEqual([...PLATAFORMAS].sort());
  });
});
