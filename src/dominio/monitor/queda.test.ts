import { describe, expect, it } from 'vitest';
import { reaisParaCentavos, type Centavos } from '@/lib/dinheiro';
import {
  DESCONTO_QUE_VALE_BP,
  JANELA_DE_REFERENCIA_DIAS,
  OBSERVACOES_MINIMAS,
  VEREDITOS_DE_QUEDA,
  avaliarQueda,
  medianaDePrecos,
  type PrecoObservado,
} from './queda';

const AGORA = new Date('2026-09-15T12:00:00-03:00');
const reais = (v: number): Centavos => reaisParaCentavos(v);

/** Uma observação `dias` atrás. */
const atras = (dias: number, preco: number): PrecoObservado => ({
  preco: reais(preco),
  em: new Date(AGORA.getTime() - dias * 86_400_000),
});

const avaliar = (atual: number, historico: readonly PrecoObservado[]) =>
  avaliarQueda(reais(atual), historico, { agora: AGORA });

describe('medianaDePrecos', () => {
  it('não se move por causa de uma semana caro', () => {
    // É a diferença entre "está barato" e "está anunciado como barato".
    const precos = [100, 102, 101, 103, 900].map((v) => reais(v));
    expect(medianaDePrecos(precos)).toBe(reais(102));
  });

  it('com quantidade par devolve o menor dos centrais, sem meio centavo', () => {
    // E errar para o menor erra para o lado conservador: a referência fica mais
    // barata, e o desconto calculado contra ela fica menor.
    expect(medianaDePrecos([reais(100), reais(110)])).toBe(reais(100));
  });

  it('lista vazia devolve nulo, não zero', () => {
    expect(medianaDePrecos([])).toBeNull();
  });
});

describe('avaliarQueda', () => {
  const noventaDias = [atras(80, 100), atras(60, 100), atras(30, 100), atras(10, 100)];

  it('queda de 20% contra a mediana é queda real e vale publicar', () => {
    const r = avaliar(80, noventaDias);
    expect(r.veredito).toBe('queda_real');
    expect(r.medianaJanela).toBe(reais(100));
    expect(r.descontoBp).toBe(2000);
    expect(r.valePublicar).toBe(true);
  });

  it('desconto abaixo do corte não publica, e não é engano de ninguém', () => {
    // Grupo que publica queda de 5% é grupo que os membros silenciam.
    const r = avaliar(95, noventaDias);
    expect(r.veredito).toBe('desconto_fraco');
    expect(r.descontoBp).toBe(500);
    expect(r.valePublicar).toBe(false);
    expect(r.mensagem).toContain('silenciam');
  });

  it('exatamente no corte publica', () => {
    const r = avaliar(85, noventaDias);
    expect(r.descontoBp).toBe(DESCONTO_QUE_VALE_BP);
    expect(r.valePublicar).toBe(true);
  });

  it('preço no nível da mediana é preço inflado, e o motivo aparece escrito', () => {
    // É o truque que o módulo existe para furar: subir para depois "baixar".
    const r = avaliar(100, noventaDias);
    expect(r.veredito).toBe('preco_inflado');
    expect(r.valePublicar).toBe(false);
    expect(r.mensagem).toContain('ninguém pagou');
  });

  it('preço acima da mediana também é inflado, com desconto negativo', () => {
    const r = avaliar(120, noventaDias);
    expect(r.veredito).toBe('preco_inflado');
    expect(r.descontoBp).toBeLessThan(0);
  });

  it('menos de três observações é sem referência, não "não está barato"', () => {
    // As duas leituras levam a ações diferentes, e colapsá-las esconderia a falta de
    // dado atrás de um veredito de preço.
    const r = avaliar(50, [atras(10, 100), atras(20, 100)]);
    expect(r.veredito).toBe('sem_referencia');
    expect(r.observacoes).toBe(2);
    expect(r.valePublicar).toBe(false);
    expect(r.mensagem).toContain('diferente de');
  });

  it('observação fora da janela não conta', () => {
    // Uma janela de trinta dias confundiria "voltou ao normal depois da Black Friday"
    // com "caiu de verdade"; noventa pega mais de um ciclo.
    const antiga = [
      atras(JANELA_DE_REFERENCIA_DIAS + 1, 100),
      atras(JANELA_DE_REFERENCIA_DIAS + 2, 100),
      atras(JANELA_DE_REFERENCIA_DIAS + 3, 100),
      atras(10, 100),
    ];
    const r = avaliar(80, antiga);
    expect(r.observacoes).toBe(1);
    expect(r.veredito).toBe('sem_referencia');
  });

  it('observação com data futura não conta', () => {
    const futura: PrecoObservado = {
      preco: reais(100),
      em: new Date(AGORA.getTime() + 86_400_000),
    };
    const r = avaliar(80, [...noventaDias, futura]);
    expect(r.observacoes).toBe(noventaDias.length);
  });

  it('aceita janela e corte próprios, para nicho de giro rápido', () => {
    const r = avaliarQueda(reais(95), noventaDias, {
      agora: AGORA,
      descontoMinimoBp: 300,
    });
    expect(r.valePublicar).toBe(true);
  });

  it('janela curta pode zerar a referência, e isso é dito', () => {
    const r = avaliarQueda(reais(80), noventaDias, { agora: AGORA, janelaDias: 5 });
    expect(r.veredito).toBe('sem_referencia');
    expect(r.mensagem).toContain('5 dias');
  });

  it('o desconto trunca: não arredonda para cima até o corte', () => {
    // Arredondar para cima publicaria oferta que não alcançou o corte.
    const r = avaliar(8501, [atras(1, 100), atras(2, 100), atras(3, 100)]);
    expect(r.descontoBp).toBeLessThan(DESCONTO_QUE_VALE_BP);
  });

  it('todo veredito declarado é alcançável', () => {
    const vistos = new Set([
      avaliar(80, noventaDias).veredito,
      avaliar(95, noventaDias).veredito,
      avaliar(120, noventaDias).veredito,
      avaliar(80, []).veredito,
    ]);
    expect([...VEREDITOS_DE_QUEDA].filter((v) => !vistos.has(v))).toEqual([]);
  });

  it('o mínimo de observações é o que dá autoridade à mediana', () => {
    // Com duas, "mediana" é só o menor dos dois.
    const tres = [atras(1, 100), atras(2, 100), atras(3, 100)];
    expect(tres).toHaveLength(OBSERVACOES_MINIMAS);
    expect(avaliar(80, tres).veredito).toBe('queda_real');
  });
});
