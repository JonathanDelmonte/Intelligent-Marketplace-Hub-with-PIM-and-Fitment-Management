import { describe, expect, it } from 'vitest';
import {
  diaNoFuso,
  FUSO_PADRAO,
  juntarFilas,
  montarFilaDoDia,
  resumoDaFila,
  ROTULO_DA_URGENCIA,
  URGENCIAS,
  urgenciaDe,
  type PedidoParaPostar,
} from './fila-do-dia';

/** Quinta-feira, 14/09/2026, 10h em São Paulo (13h UTC). */
const AGORA = new Date('2026-09-14T13:00:00.000Z');

let sequencia = 0;
const pedido = (campos: Partial<PedidoParaPostar> = {}): PedidoParaPostar => {
  sequencia += 1;
  return {
    id: `p${String(sequencia).padStart(3, '0')}`,
    idExterno: `MLB${String(sequencia)}`,
    plataforma: 'ml',
    qtd: 1,
    tituloDoProduto: 'Refil PA21G',
    prazoPostagemAte: null,
    postagemConfirmadaEm: null,
    rastreio: null,
    ...campos,
  };
};

describe('diaNoFuso', () => {
  it('usa o dia do vendedor, não o do servidor', () => {
    // 23h de quinta em São Paulo é 02h de sexta em UTC. Um cálculo em UTC diria
    // "amanhã" quando ainda dava para postar hoje.
    const noiteEmSaoPaulo = new Date('2026-09-15T02:00:00.000Z');
    expect(diaNoFuso(noiteEmSaoPaulo, FUSO_PADRAO)).toBe('2026-09-14');
    expect(diaNoFuso(noiteEmSaoPaulo, 'UTC')).toBe('2026-09-15');
  });
});

describe('urgenciaDe', () => {
  it('prazo que passou é atraso, não tarefa do dia', () => {
    const passou = new Date('2026-09-14T12:00:00.000Z');
    expect(urgenciaDe(passou, AGORA)).toBe('atrasado');
  });

  it('prazo de hoje ainda no futuro é hoje', () => {
    expect(urgenciaDe(new Date('2026-09-14T20:00:00.000Z'), AGORA)).toBe('hoje');
  });

  it('prazo de amanhã é amanhã', () => {
    expect(urgenciaDe(new Date('2026-09-15T15:00:00.000Z'), AGORA)).toBe('amanha');
  });

  it('depois de amanhã é depois', () => {
    expect(urgenciaDe(new Date('2026-09-20T15:00:00.000Z'), AGORA)).toBe('depois');
  });

  it('prazo do fim da noite, no fuso do vendedor, ainda é hoje', () => {
    // 23h de 14/09 em São Paulo = 02h de 15/09 em UTC.
    expect(urgenciaDe(new Date('2026-09-15T02:00:00.000Z'), AGORA, FUSO_PADRAO)).toBe('hoje');
    expect(urgenciaDe(new Date('2026-09-15T02:00:00.000Z'), AGORA, 'UTC')).toBe('amanha');
  });

  it('sem prazo tem urgência própria', () => {
    expect(urgenciaDe(null, AGORA)).toBe('sem_prazo');
  });
});

describe('montarFilaDoDia', () => {
  it('tira da fila o que já foi postado, e conta', () => {
    const fila = montarFilaDoDia(
      [
        pedido({ postagemConfirmadaEm: AGORA, prazoPostagemAte: AGORA }),
        pedido({ prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') }),
      ],
      AGORA,
    );
    expect(fila.itens).toHaveLength(1);
    expect(fila.jaPostados).toBe(1);
  });

  it('ordena por urgência, e "sem prazo" vem primeiro', () => {
    // Falta do prazo é o problema: esconder no fim viraria pedido esquecido.
    const fila = montarFilaDoDia(
      [
        pedido({ prazoPostagemAte: new Date('2026-09-20T15:00:00.000Z') }),
        pedido({ prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') }),
        pedido({ prazoPostagemAte: null }),
        pedido({ prazoPostagemAte: new Date('2026-09-14T11:00:00.000Z') }),
      ],
      AGORA,
    );
    expect(fila.itens.map((i) => i.urgencia)).toEqual(['sem_prazo', 'atrasado', 'hoje', 'depois']);
  });

  it('dentro da mesma urgência, prazo mais próximo primeiro', () => {
    const tarde = pedido({ prazoPostagemAte: new Date('2026-09-14T22:00:00.000Z') });
    const cedo = pedido({ prazoPostagemAte: new Date('2026-09-14T15:00:00.000Z') });
    const fila = montarFilaDoDia([tarde, cedo], AGORA);
    expect(fila.itens[0]?.id).toBe(cedo.id);
  });

  it('empate de prazo desempata por id, para a ordem não mudar entre carregamentos', () => {
    const prazo = new Date('2026-09-14T20:00:00.000Z');
    const a = pedido({ id: 'aaa', prazoPostagemAte: prazo });
    const b = pedido({ id: 'bbb', prazoPostagemAte: prazo });
    expect(montarFilaDoDia([b, a], AGORA).itens.map((i) => i.id)).toEqual(['aaa', 'bbb']);
  });

  it('conta horas restantes, negativo quando passou', () => {
    const fila = montarFilaDoDia(
      [
        pedido({ prazoPostagemAte: new Date('2026-09-14T16:00:00.000Z') }),
        pedido({ prazoPostagemAte: new Date('2026-09-14T11:00:00.000Z') }),
      ],
      AGORA,
    );
    const horas = fila.itens.map((i) => i.horasRestantes);
    expect(horas).toContain(3);
    expect(horas).toContain(-2);
  });

  it('sem prazo não inventa horas restantes', () => {
    const fila = montarFilaDoDia([pedido()], AGORA);
    expect(fila.itens[0]?.horasRestantes).toBeNull();
  });

  it('fila vazia é fila vazia', () => {
    const fila = montarFilaDoDia([], AGORA);
    expect(fila.itens).toEqual([]);
    expect(fila.jaPostados).toBe(0);
  });
});

describe('resumoDaFila', () => {
  const resumo = (pedidos: readonly PedidoParaPostar[]) =>
    resumoDaFila(montarFilaDoDia(pedidos, AGORA));

  it('manda começar pelos atrasados quando há atraso', () => {
    expect(resumo([pedido({ prazoPostagemAte: new Date('2026-09-14T11:00:00.000Z') })])).toContain(
      'Comece pelos atrasados',
    );
  });

  it('um pedido na fila não é "pedidos"', () => {
    // Sem prazo não entra em atrasado nem em hoje, que é o caminho da frase da fila.
    expect(resumo([pedido({ prazoPostagemAte: null })])).toContain('1 pedido na fila');
  });

  it('diz quantos para hoje quando não há atraso', () => {
    expect(resumo([pedido({ prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') })])).toContain(
      '1 para postar hoje',
    );
  });

  it('diz que nada vence hoje quando a fila é só de depois', () => {
    expect(resumo([pedido({ prazoPostagemAte: new Date('2026-09-25T15:00:00.000Z') })])).toContain(
      'Nada vence hoje',
    );
  });

  it('fila vazia sem nada postado diz que não há pedido', () => {
    expect(resumo([])).toContain('Nenhum pedido');
  });

  it('tudo postado é dito como conquista, com o número', () => {
    expect(resumo([pedido({ postagemConfirmadaEm: AGORA })])).toContain('Tudo postado: 1');
  });
});

describe('juntarFilas', () => {
  it('soma as contagens e mantém a ordem de uma fila única', () => {
    const shopee = montarFilaDoDia(
      [
        pedido({ plataforma: 'shopee', prazoPostagemAte: new Date('2026-09-14T20:00:00.000Z') }),
        pedido({ plataforma: 'shopee', postagemConfirmadaEm: AGORA }),
      ],
      AGORA,
    );
    const ml = montarFilaDoDia(
      [pedido({ prazoPostagemAte: new Date('2026-09-14T12:00:00.000Z') }), pedido()],
      AGORA,
    );

    const junta = juntarFilas([shopee, ml]);

    expect(junta.porUrgencia).toEqual({ sem_prazo: 1, atrasado: 1, hoje: 1, amanha: 0, depois: 0 });
    // O postado de uma loja continua contado: é o "3 de 8 feitos" da tela.
    expect(junta.jaPostados).toBe(1);
    expect(junta.itens.map((i) => i.urgencia)).toEqual(['sem_prazo', 'atrasado', 'hoje']);
  });

  it('nenhuma fila é a fila vazia', () => {
    expect(juntarFilas([])).toEqual({
      itens: [],
      porUrgencia: { sem_prazo: 0, atrasado: 0, hoje: 0, amanha: 0, depois: 0 },
      jaPostados: 0,
    });
  });
});

describe('rótulos', () => {
  it('toda urgência tem rótulo', () => {
    for (const u of URGENCIAS) expect(ROTULO_DA_URGENCIA[u], u).not.toBe('');
  });
});
