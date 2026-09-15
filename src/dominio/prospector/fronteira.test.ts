import { describe, expect, it } from 'vitest';
import {
  DEFINICOES,
  FAMILIAS_DE_HIPOTESE,
  definicaoDaFamilia,
  familiasPossiveis,
} from './hipoteses';
import type { Ferramenta } from './hipoteses';
import {
  CUSTO_MINIMO,
  ESTADO_INICIAL,
  MOTIVOS_DE_PARADA,
  SATURACAO_EM_PASSOS,
  aplicarInvestigacao,
  escolherDaFronteira,
  itemDaFamilia,
  proximoPasso,
  valorPorCusto,
  type Achado,
  type EstadoDaBusca,
  type ItemDaFronteira,
} from './fronteira';

const TODAS: readonly Ferramenta[] = [
  'busca_web',
  'ler_pagina',
  'visao',
  'cnpj',
  'pncp',
  'base_local',
];

const item = (campos: Partial<ItemDaFronteira> = {}): ItemDaFronteira => ({
  id: 'i1',
  familia: 'onde_e_mais_barato',
  alvo: 'refil PA21G atacado',
  valorEsperado: 100,
  custoEmPassos: 1,
  ferramenta: 'busca_web',
  ...campos,
});

const achado = (id: string): Achado => ({
  id,
  familia: 'onde_e_mais_barato',
  oQue: 'distribuidor a R$ 18 a unidade',
  origemUrl: 'https://distribuidor.invalid/refil',
  achadoEm: '2026-09-15T00:00:00.000Z',
});

const estado = (campos: Partial<EstadoDaBusca> = {}): EstadoDaBusca => ({
  ...ESTADO_INICIAL,
  ...campos,
});

describe('famílias de hipótese', () => {
  it('toda família da união tem definição', () => {
    // Família sem definição investigaria com valor zero em silêncio.
    for (const f of FAMILIAS_DE_HIPOTESE) {
      expect(() => definicaoDaFamilia(f), f).not.toThrow();
    }
    expect(DEFINICOES).toHaveLength(FAMILIAS_DE_HIPOTESE.length);
  });

  it('cada definição diz a pergunta e por que ela importa', () => {
    for (const d of DEFINICOES) {
      expect(d.pergunta.endsWith('?'), d.familia).toBe(true);
      expect(d.porQueImporta.length, d.familia).toBeGreaterThan(60);
      expect(d.ferramentas.length, d.familia).toBeGreaterThan(0);
      expect(d.valorBase, d.familia).toBeGreaterThan(0);
      expect(d.valorBase, d.familia).toBeLessThanOrEqual(100);
    }
  });

  it('o que muda preço de compra vale mais que o que só informa', () => {
    // É o critério da especificação, e é o que ordena a fronteira.
    const barato = definicaoDaFamilia('onde_e_mais_barato').valorBase;
    const concorrente = definicaoDaFamilia('quem_ja_vende').valorBase;
    expect(barato).toBeGreaterThan(concorrente);
  });

  it('sem rede, só sobra o que lê base local', () => {
    // O agente precisa saber disso antes de gastar passo, não no meio.
    const possiveis = familiasPossiveis(['base_local']);
    expect(possiveis).toContain('que_outras_pecas');
    expect(possiveis).not.toContain('demanda_publica');
    expect(possiveis).not.toContain('quem_fabrica');
  });

  it('família nova sem definição falha alto', () => {
    // @ts-expect-error — é o caso de alguém acrescentar à união e esquecer a tabela.
    expect(() => definicaoDaFamilia('inventada')).toThrow();
  });
});

describe('valorPorCusto', () => {
  it('escolhe a barata entre duas de valor igual', () => {
    // Duas hipóteses de valor 80: uma custa uma busca, a outra seis páginas.
    const barata = item({ valorEsperado: 80, custoEmPassos: 1 });
    const cara = item({ valorEsperado: 80, custoEmPassos: 6 });
    expect(valorPorCusto(barata)).toBeGreaterThan(valorPorCusto(cara));
  });

  it('custo zero não divide por zero', () => {
    expect(Number.isFinite(valorPorCusto(item({ custoEmPassos: 0 })))).toBe(true);
    expect(valorPorCusto(item({ custoEmPassos: 0 }))).toBe(
      valorPorCusto(item({ custoEmPassos: CUSTO_MINIMO })),
    );
  });

  it('é inteiro, para a ordenação não depender de float', () => {
    expect(Number.isInteger(valorPorCusto(item({ valorEsperado: 80, custoEmPassos: 3 })))).toBe(
      true,
    );
  });
});

describe('escolherDaFronteira', () => {
  it('escolhe o de maior valor por custo', () => {
    const escolhido = escolherDaFronteira(
      estado({
        fronteira: [
          item({ id: 'cara', valorEsperado: 100, custoEmPassos: 10 }),
          item({ id: 'barata', valorEsperado: 60, custoEmPassos: 1 }),
        ],
      }),
      TODAS,
    );
    expect(escolhido?.id).toBe('barata');
  });

  it('não repete o que já foi investigado', () => {
    // Sem isso o agente gira em falso no melhor item da fronteira.
    const escolhido = escolherDaFronteira(
      estado({ fronteira: [item({ id: 'i1' })], investigados: ['i1'] }),
      TODAS,
    );
    expect(escolhido).toBeNull();
  });

  it('ignora item cuja ferramenta não está disponível', () => {
    const escolhido = escolherDaFronteira(
      estado({
        fronteira: [
          item({ id: 'web', ferramenta: 'busca_web' }),
          item({ id: 'local', ferramenta: 'base_local', valorEsperado: 10 }),
        ],
      }),
      ['base_local'],
    );
    expect(escolhido?.id).toBe('local');
  });

  it('empate desempata pelo id, para a auditoria valer', () => {
    // Sem desempate estável, duas execuções do mesmo dossiê investigam em ordens
    // diferentes e o dossiê deixa de ser reproduzível.
    const a = item({ id: 'aaa', valorEsperado: 50, custoEmPassos: 1 });
    const z = item({ id: 'zzz', valorEsperado: 50, custoEmPassos: 1 });
    expect(escolherDaFronteira(estado({ fronteira: [z, a] }), TODAS)?.id).toBe('aaa');
    expect(escolherDaFronteira(estado({ fronteira: [a, z] }), TODAS)?.id).toBe('aaa');
  });

  it('fronteira vazia devolve nulo', () => {
    expect(escolherDaFronteira(estado(), TODAS)).toBeNull();
  });
});

describe('proximoPasso', () => {
  const limites = { passos: 10, ferramentas: TODAS };

  it('investiga quando há item e orçamento', () => {
    const passo = proximoPasso(estado({ fronteira: [item()] }), limites);
    expect(passo.tipo).toBe('investigar');
  });

  it('para por saturação, e diz que isso é ter terminado', () => {
    // Aumentar o orçamento não traria mais nada, e a mensagem precisa dizer isso —
    // senão o dono aumenta o teto para nada.
    const passo = proximoPasso(
      estado({ fronteira: [item()], passosSemAchado: SATURACAO_EM_PASSOS }),
      limites,
    );
    expect(passo.tipo).toBe('parar');
    if (passo.tipo !== 'parar') return;
    expect(passo.motivo).toBe('saturacao');
    expect(passo.explicacao).toContain('ter terminado');
  });

  it('saturação vence orçamento, porque ter terminado não é ter esbarrado no teto', () => {
    // A ordem das verificações é a ordem da honestidade.
    const passo = proximoPasso(
      estado({ fronteira: [item()], passosSemAchado: SATURACAO_EM_PASSOS, passosGastos: 99 }),
      limites,
    );
    if (passo.tipo !== 'parar') throw new Error('esperava parada');
    expect(passo.motivo).toBe('saturacao');
  });

  it('para por orçamento de passos, dizendo que o dossiê está salvo', () => {
    const passo = proximoPasso(estado({ fronteira: [item()], passosGastos: 10 }), limites);
    if (passo.tipo !== 'parar') throw new Error('esperava parada');
    expect(passo.motivo).toBe('orcamento_passos');
    expect(passo.explicacao).toContain('salvo');
  });

  it('para por fronteira vazia quando não há ferramenta para o que resta', () => {
    const passo = proximoPasso(estado({ fronteira: [item({ ferramenta: 'pncp' })] }), {
      passos: 10,
      ferramentas: ['base_local'],
    });
    if (passo.tipo !== 'parar') throw new Error('esperava parada');
    expect(passo.motivo).toBe('fronteira_vazia');
  });

  it('aceita saturação própria, para alvo que merece mais insistência', () => {
    const passo = proximoPasso(estado({ fronteira: [item()], passosSemAchado: 3 }), {
      ...limites,
      saturacaoEmPassos: 5,
    });
    expect(passo.tipo).toBe('investigar');
  });
});

describe('aplicarInvestigacao', () => {
  it('achado zera o contador de saturação', () => {
    const depois = aplicarInvestigacao(estado({ passosSemAchado: 2 }), item(), {
      achados: [achado('a1')],
    });
    expect(depois.passosSemAchado).toBe(0);
    expect(depois.achados).toHaveLength(1);
  });

  it('investigação sem achado faz o contador crescer', () => {
    const depois = aplicarInvestigacao(estado({ passosSemAchado: 1 }), item(), { achados: [] });
    expect(depois.passosSemAchado).toBe(2);
  });

  it('gasta o custo do item, não um passo fixo', () => {
    const depois = aplicarInvestigacao(estado(), item({ custoEmPassos: 6 }), { achados: [] });
    expect(depois.passosGastos).toBe(6);
  });

  it('marca o item como investigado, para não voltar', () => {
    const depois = aplicarInvestigacao(estado({ fronteira: [item()] }), item(), { achados: [] });
    expect(depois.investigados).toContain('i1');
    expect(escolherDaFronteira(depois, TODAS)).toBeNull();
  });

  it('a fronteira cresce sem duplicar', () => {
    // Ler duas páginas que citam o mesmo distribuidor não deve enfileirá-lo duas
    // vezes.
    const inicial = estado({ fronteira: [item({ id: 'ja-existe' })] });
    const depois = aplicarInvestigacao(inicial, item(), {
      achados: [],
      fronteira: [item({ id: 'ja-existe' }), item({ id: 'novo' })],
    });
    expect(depois.fronteira.map((i) => i.id)).toEqual(['ja-existe', 'novo']);
  });

  it('fecha hipótese confirmada e descartada, sem perder as abertas', () => {
    const inicial = estado({
      hipoteses: [
        { id: 'h1', familia: 'quem_distribui', enunciado: 'X distribui', estado: 'aberta' },
        { id: 'h2', familia: 'quem_fabrica', enunciado: 'Y fabrica', estado: 'aberta' },
        { id: 'h3', familia: 'quem_ja_vende', enunciado: 'Z vende', estado: 'aberta' },
      ],
    });
    const depois = aplicarInvestigacao(inicial, item(), {
      achados: [achado('a1')],
      confirmadas: ['h1'],
      descartadas: ['h2'],
    });

    expect(depois.hipoteses.find((h) => h.id === 'h1')?.estado).toBe('confirmada');
    expect(depois.hipoteses.find((h) => h.id === 'h2')?.estado).toBe('descartada');
    expect(depois.hipoteses.find((h) => h.id === 'h3')?.estado).toBe('aberta');
  });

  it('o estado é sempre novo, nunca mutado', () => {
    // O dossiê é salvo a cada passo; mutar o objeto anterior perderia a capacidade de
    // comparar antes e depois.
    const inicial = estado({ fronteira: [item()] });
    const depois = aplicarInvestigacao(inicial, item(), { achados: [achado('a1')] });
    expect(inicial.achados).toHaveLength(0);
    expect(depois.achados).toHaveLength(1);
  });
});

describe('itemDaFamilia', () => {
  it('sai com o valor base da família', () => {
    const i = itemDaFamilia({
      id: 'x',
      familia: 'onde_e_mais_barato',
      alvo: 'atacado',
      ferramenta: 'busca_web',
    });
    expect(i.valorEsperado).toBe(definicaoDaFamilia('onde_e_mais_barato').valorBase);
  });

  it('o ajuste é recortado em 0 a 100', () => {
    const acima = itemDaFamilia({
      id: 'x',
      familia: 'onde_e_mais_barato',
      alvo: 'a',
      ferramenta: 'busca_web',
      ajusteDeValor: 500,
    });
    const abaixo = itemDaFamilia({
      id: 'y',
      familia: 'quem_ja_vende',
      alvo: 'a',
      ferramenta: 'busca_web',
      ajusteDeValor: -500,
    });
    expect(acima.valorEsperado).toBe(100);
    expect(abaixo.valorEsperado).toBe(0);
  });

  it('custo abaixo do mínimo é elevado ao mínimo', () => {
    const i = itemDaFamilia({
      id: 'x',
      familia: 'quem_fabrica',
      alvo: 'a',
      ferramenta: 'visao',
      custoEmPassos: 0,
    });
    expect(i.custoEmPassos).toBe(CUSTO_MINIMO);
  });
});

describe('um laço inteiro, para provar que a máquina para', () => {
  it('investiga, satura e para sem gastar o orçamento todo', () => {
    // É o cenário que o módulo existe para garantir: o erro caro do prospector não é
    // escolher a hipótese errada, é não parar.
    let atual = estado({
      fronteira: [
        item({ id: 'a' }),
        item({ id: 'b' }),
        item({ id: 'c' }),
        item({ id: 'd' }),
        item({ id: 'e' }),
      ],
    });
    const limites = { passos: 100, ferramentas: TODAS };

    let passos = 0;
    let motivo = '';
    for (let i = 0; i < 50; i += 1) {
      const passo = proximoPasso(atual, limites);
      if (passo.tipo === 'parar') {
        motivo = passo.motivo;
        break;
      }
      passos += 1;
      atual = aplicarInvestigacao(atual, passo.item, { achados: [] });
    }

    expect(motivo).toBe('saturacao');
    expect(passos).toBe(SATURACAO_EM_PASSOS);
    expect(atual.passosGastos).toBeLessThan(limites.passos);
  });

  it('todo motivo de parada declarado é alcançável', () => {
    const vistos = new Set<string>();

    const saturado = proximoPasso(
      estado({ fronteira: [item()], passosSemAchado: SATURACAO_EM_PASSOS }),
      { passos: 10, ferramentas: TODAS },
    );
    if (saturado.tipo === 'parar') vistos.add(saturado.motivo);

    const estourado = proximoPasso(estado({ fronteira: [item()], passosGastos: 10 }), {
      passos: 10,
      ferramentas: TODAS,
    });
    if (estourado.tipo === 'parar') vistos.add(estourado.motivo);

    const vazio = proximoPasso(estado(), { passos: 10, ferramentas: TODAS });
    if (vazio.tipo === 'parar') vistos.add(vazio.motivo);

    // `orcamento_reais` e `concluido` são do executor, não da máquina de fronteira —
    // este teste fixa quais dos motivos esta função produz.
    expect([...MOTIVOS_DE_PARADA].filter((m) => !vistos.has(m))).toEqual([
      'orcamento_reais',
      'concluido',
    ]);
  });
});
