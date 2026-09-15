import { describe, expect, it } from 'vitest';
import { reaisParaCentavos, pontosBase } from '@/lib/dinheiro';
import {
  JANELA_DE_AGRUPAMENTO_DIAS,
  MUDANCA_GRAVE_BP,
  MUDANCA_QUE_IMPORTA_BP,
  O_QUE_SIGNIFICA,
  TIPOS_DE_MUDANCA,
  agruparEventos,
  eventoDePreco,
  lerGrupo,
  severidadeDaMudanca,
  type Evento,
  type TipoDeMudanca,
} from './eventos';

const AGORA = new Date('2026-09-15T12:00:00-03:00');

const params = (id: string, sobre = 'Loja Concorrente', quando = AGORA) => ({
  id,
  sobre,
  entidadeTipo: 'produto_externo',
  entidadeId: null,
  detectadoEm: quando,
});

const evento = (campos: Partial<Evento> = {}): Evento => ({
  id: 'e1',
  tipo: 'preco_concorrente_caiu',
  sobre: 'Loja Concorrente',
  entidadeTipo: 'produto_externo',
  entidadeId: null,
  valorAntes: '10000',
  valorDepois: '9000',
  severidade: 'amarelo',
  detectadoEm: AGORA,
  variacaoBp: pontosBase(1000),
  ...campos,
});

describe('O_QUE_SIGNIFICA', () => {
  it('todo tipo de mudança explica o que fazer, porque a leitura por LLM pode não existir', () => {
    // Sem chave de LLM a pessoa ainda precisa de uma frase que explique o evento.
    for (const t of TIPOS_DE_MUDANCA) {
      expect(O_QUE_SIGNIFICA[t].length, t).toBeGreaterThan(60);
    }
  });
});

describe('severidadeDaMudanca', () => {
  it('queda de concorrente é mais grave que alta, e a assimetria é deliberada', () => {
    // Alta é oportunidade e pode esperar; queda come a sua venda hoje.
    expect(severidadeDaMudanca(pontosBase(MUDANCA_GRAVE_BP), true)).toBe('vermelho');
    expect(severidadeDaMudanca(pontosBase(MUDANCA_GRAVE_BP), false)).toBe('amarelo');
    expect(severidadeDaMudanca(pontosBase(MUDANCA_QUE_IMPORTA_BP), true)).toBe('amarelo');
    expect(severidadeDaMudanca(pontosBase(MUDANCA_QUE_IMPORTA_BP), false)).toBe('informativo');
  });

  it('mudança pequena é informativa, dos dois lados', () => {
    expect(severidadeDaMudanca(pontosBase(100), true)).toBe('informativo');
  });
});

describe('eventoDePreco', () => {
  it('oscilação de centavo não vira evento', () => {
    // Um monitor que avisa de tudo é um monitor desligado na segunda semana.
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(99.5) },
      params('e1'),
    );
    expect(e).toBeNull();
  });

  it('queda de 10% vira evento amarelo, com a variação medida', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(90) },
      params('e1'),
    );
    expect(e?.tipo).toBe('preco_concorrente_caiu');
    expect(e?.variacaoBp).toBe(1000);
    expect(e?.severidade).toBe('amarelo');
  });

  it('queda de 20% é vermelha', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(80) },
      params('e1'),
    );
    expect(e?.severidade).toBe('vermelho');
  });

  it('alta vira evento próprio, e não é vermelha', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(120) },
      params('e1'),
    );
    expect(e?.tipo).toBe('preco_concorrente_subiu');
    expect(e?.severidade).toBe('amarelo');
  });

  it('preço anterior zero não gera evento nem divide por zero', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(0), depois: reaisParaCentavos(90) },
      params('e1'),
    );
    expect(e).toBeNull();
  });

  it('aceita piso próprio, para SKU de margem apertada', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(99) },
      params('e1'),
      50,
    );
    expect(e).not.toBeNull();
  });

  it('a variação trunca, para não promover mudança abaixo do piso', () => {
    const e = eventoDePreco(
      { antes: reaisParaCentavos(100), depois: reaisParaCentavos(97.01) },
      params('e1'),
    );
    expect(e).toBeNull();
  });
});

describe('agruparEventos', () => {
  it('dez alertas do mesmo concorrente na mesma semana são uma história', () => {
    // É o que a especificação chama de agrupar antes de avisar: dez alertas soltos são
    // ruído, um evento explicado é informação.
    const grupos = agruparEventos([
      evento({ id: 'a' }),
      evento({ id: 'b', tipo: 'estoque_concorrente_subiu' }),
      evento({ id: 'c', tipo: 'preco_concorrente_subiu' }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.eventos).toHaveLength(3);
  });

  it('concorrentes diferentes não se misturam', () => {
    const grupos = agruparEventos([
      evento({ id: 'a', sobre: 'Loja A' }),
      evento({ id: 'b', sobre: 'Loja B' }),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it('o mesmo concorrente com caixa diferente é o mesmo concorrente', () => {
    const grupos = agruparEventos([
      evento({ id: 'a', sobre: 'Loja A' }),
      evento({ id: 'b', sobre: ' loja a ' }),
    ]);
    expect(grupos).toHaveLength(1);
  });

  it('semanas diferentes não se misturam', () => {
    const grupos = agruparEventos([
      evento({ id: 'a' }),
      evento({
        id: 'b',
        detectadoEm: new Date(AGORA.getTime() - (JANELA_DE_AGRUPAMENTO_DIAS + 1) * 86_400_000),
      }),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it('o grupo vale pelo pior evento dele', () => {
    const grupos = agruparEventos([
      evento({ id: 'a', severidade: 'informativo' }),
      evento({ id: 'b', severidade: 'vermelho' }),
      evento({ id: 'c', severidade: 'amarelo' }),
    ]);
    expect(grupos[0]?.severidade).toBe('vermelho');
    // E o pior vem primeiro dentro do grupo.
    expect(grupos[0]?.eventos[0]?.id).toBe('b');
  });

  it('grupos vêm em ordem de gravidade, e o empate é estável', () => {
    const grupos = agruparEventos([
      evento({ id: 'a', sobre: 'Zeta', severidade: 'informativo' }),
      evento({ id: 'b', sobre: 'Alfa', severidade: 'vermelho' }),
      evento({ id: 'c', sobre: 'Beta', severidade: 'vermelho' }),
    ]);
    expect(grupos.map((g) => g.sobre)).toEqual(['Alfa', 'Beta', 'Zeta']);
  });

  it('lista vazia devolve nada, sem quebrar', () => {
    expect(agruparEventos([])).toEqual([]);
  });

  it('o fuso decide a semana, como em todo lugar do sistema', () => {
    // 22h de domingo em São Paulo é segunda em UTC, e cairia no grupo seguinte.
    const domingoNoite = new Date('2026-09-14T01:00:00Z');
    const grupos = agruparEventos([
      evento({ id: 'a', detectadoEm: domingoNoite }),
      evento({ id: 'b' }),
    ]);
    expect(grupos).toHaveLength(1);
  });
});

describe('lerGrupo', () => {
  const de = (tipos: readonly TipoDeMudanca[]): readonly Evento[] =>
    tipos.map((tipo, i) => evento({ id: `e${String(i)}`, tipo }));

  it('preço caindo com estoque subindo é fornecedor novo, não queima de estoque', () => {
    // É o exemplo que a especificação usa para definir o módulo, e a razão é simples:
    // queima de estoque não vem com reposição.
    const leitura = lerGrupo(de(['preco_concorrente_caiu', 'estoque_concorrente_subiu']));
    expect(leitura).toContain('não vem com reposição');
    expect(leitura).toContain('permanente');
  });

  it('concorrente novo com queda de preço aponta para compra, não para preço', () => {
    const leitura = lerGrupo(de(['concorrente_novo', 'preco_concorrente_caiu']));
    expect(leitura).toContain('é de compra');
  });

  it('custo subindo com preço de concorrente caindo é a pior combinação', () => {
    const leitura = lerGrupo(de(['custo_fornecedor_subiu', 'preco_concorrente_caiu']));
    expect(leitura).toContain('dos dois lados');
  });

  it('evento único recebe a explicação do tipo dele', () => {
    expect(lerGrupo(de(['taxa_da_plataforma_mudou']))).toBe(
      O_QUE_SIGNIFICA.taxa_da_plataforma_mudou,
    );
  });

  it('combinação sem regra própria junta as explicações, sem inventar hipótese', () => {
    // Inventar uma causa que o sistema não tem como saber seria pior que somar o que
    // ele sabe de cada parte.
    const leitura = lerGrupo(de(['produto_parou_de_vender', 'taxa_da_plataforma_mudou']));
    expect(leitura).toContain('2 mudanças');
    expect(leitura).toContain(O_QUE_SIGNIFICA.produto_parou_de_vender);
  });

  it('lista vazia devolve texto vazio, não quebra', () => {
    expect(lerGrupo([])).toBe('');
  });
});
