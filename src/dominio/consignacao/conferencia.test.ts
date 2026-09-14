import { describe, expect, it } from 'vitest';
import {
  ESTADOS_DE_CONFERENCIA,
  INTERVALO_DE_CONFERENCIA_DIAS,
  diasCivisEntre,
  estadoDaLinha,
  montarQuadroDeConferencia,
  type LinhaDeConsignacao,
} from './conferencia';

const AGORA = new Date('2026-09-14T15:00:00Z');

const linha = (campos: Partial<LinhaDeConsignacao> = {}): LinhaDeConsignacao => ({
  id: 'c1',
  parceiroNome: 'Loja do Centro',
  skuId: 's1',
  tituloDoProduto: 'Refil PA21G',
  qtdDisponivel: 4,
  conferidoEm: new Date('2026-09-13T12:00:00Z'),
  ...campos,
});

/** `dias` dias antes de AGORA, no meio do dia para o fuso não confundir. */
const diasAtras = (dias: number): Date => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000);

describe('diasCivisEntre', () => {
  it('conta dia de calendário, não bloco de 24 horas', () => {
    // Conferido ontem às 23h e agora são 8h: a pessoa diz "ontem", que é um dia.
    // Uma conta de 24 horas diria zero, e o alerta discordaria de quem o lê.
    const ontemTarde = new Date('2026-09-13T23:00:00-03:00');
    const hojeCedo = new Date('2026-09-14T08:00:00-03:00');
    expect(diasCivisEntre(ontemTarde, hojeCedo)).toBe(1);
  });

  it('mesmo dia é zero', () => {
    expect(
      diasCivisEntre(new Date('2026-09-14T01:00:00-03:00'), new Date('2026-09-14T23:00:00-03:00')),
    ).toBe(0);
  });

  it('usa o fuso do vendedor, não o do servidor', () => {
    // 22h do dia 13 em São Paulo é 01h do dia 14 em UTC.
    const noite = new Date('2026-09-14T01:00:00Z');
    const manha = new Date('2026-09-14T13:00:00Z');
    expect(diasCivisEntre(noite, manha, 'America/Sao_Paulo')).toBe(1);
    expect(diasCivisEntre(noite, manha, 'UTC')).toBe(0);
  });

  it('atravessa virada de mês e de ano', () => {
    expect(
      diasCivisEntre(new Date('2026-12-31T12:00:00-03:00'), new Date('2027-01-02T12:00:00-03:00')),
    ).toBe(2);
  });
});

describe('estadoDaLinha', () => {
  it('nunca conferido é estado próprio, não conferência muito antiga', () => {
    const r = estadoDaLinha(linha({ conferidoEm: null }), { agora: AGORA });
    expect(r.estado).toBe('nunca');
    expect(r.diasDesde).toBeNull();
  });

  it('dentro do intervalo está em dia', () => {
    expect(estadoDaLinha(linha({ conferidoEm: diasAtras(2) }), { agora: AGORA }).estado).toBe(
      'em_dia',
    );
  });

  it('exatamente no intervalo é o dia de conferir', () => {
    const r = estadoDaLinha(linha({ conferidoEm: diasAtras(INTERVALO_DE_CONFERENCIA_DIAS) }), {
      agora: AGORA,
    });
    expect(r.estado).toBe('vence_hoje');
    expect(r.diasDesde).toBe(INTERVALO_DE_CONFERENCIA_DIAS);
  });

  it('passado o intervalo está vencida', () => {
    expect(
      estadoDaLinha(linha({ conferidoEm: diasAtras(INTERVALO_DE_CONFERENCIA_DIAS + 1) }), {
        agora: AGORA,
      }).estado,
    ).toBe('vencida');
  });

  it('aceita intervalo próprio, para parceiro de giro alto', () => {
    const tresDias = { agora: AGORA, intervaloDias: 3 };
    expect(estadoDaLinha(linha({ conferidoEm: diasAtras(4) }), tresDias).estado).toBe('vencida');
    expect(estadoDaLinha(linha({ conferidoEm: diasAtras(4) }), { agora: AGORA }).estado).toBe(
      'em_dia',
    );
  });
});

describe('montarQuadroDeConferencia', () => {
  it('o risco é unidade anunciada, não data vencida', () => {
    // A frase da especificação: o risco é a loja vender no balcão o que você tem
    // anunciado. Sem unidade não há o que vender errado.
    const vazia = montarQuadroDeConferencia(
      [linha({ qtdDisponivel: 0, conferidoEm: diasAtras(90) })],
      { agora: AGORA },
    );
    expect(vazia.itens[0]?.estado).toBe('vencida');
    expect(vazia.itens[0]?.emRisco).toBe(false);
    expect(vazia.unidadesEmRisco).toBe(0);
    expect(vazia.parceirosEmRisco).toEqual([]);
  });

  it('uma unidade já é risco, porque uma venda cancelada já custa reputação', () => {
    const q = montarQuadroDeConferencia([linha({ qtdDisponivel: 1, conferidoEm: diasAtras(30) })], {
      agora: AGORA,
    });
    expect(q.unidadesEmRisco).toBe(1);
  });

  it('linha em dia não entra no risco, mesmo com muita unidade', () => {
    const q = montarQuadroDeConferencia([linha({ qtdDisponivel: 50, conferidoEm: diasAtras(1) })], {
      agora: AGORA,
    });
    expect(q.unidadesEmRisco).toBe(0);
  });

  it('nunca conferido vem no topo, como pedido sem prazo na fila do dia', () => {
    const q = montarQuadroDeConferencia(
      [
        linha({ id: 'a', conferidoEm: diasAtras(1) }),
        linha({ id: 'b', conferidoEm: diasAtras(60) }),
        linha({ id: 'c', conferidoEm: null }),
      ],
      { agora: AGORA },
    );
    expect(q.itens.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('dentro do mesmo estado, mais unidade exposta vem primeiro', () => {
    // Duas linhas igualmente atrasadas não são igualmente urgentes.
    const q = montarQuadroDeConferencia(
      [
        linha({ id: 'pouco', qtdDisponivel: 2, conferidoEm: diasAtras(30) }),
        linha({ id: 'muito', qtdDisponivel: 30, conferidoEm: diasAtras(30) }),
      ],
      { agora: AGORA },
    );
    expect(q.itens.map((i) => i.id)).toEqual(['muito', 'pouco']);
  });

  it('empate de unidade cai no nome do parceiro, para a ordem ser estável', () => {
    const q = montarQuadroDeConferencia(
      [
        linha({ id: 'z', parceiroNome: 'Zé Peças', conferidoEm: null }),
        linha({ id: 'a', parceiroNome: 'Auto Center', conferidoEm: null }),
      ],
      { agora: AGORA },
    );
    expect(q.itens.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('soma unidades em risco e lista os parceiros sem repetir', () => {
    const q = montarQuadroDeConferencia(
      [
        linha({ parceiroNome: 'Loja A', qtdDisponivel: 3, conferidoEm: null }),
        linha({ parceiroNome: 'Loja A', qtdDisponivel: 2, conferidoEm: diasAtras(40) }),
        linha({ parceiroNome: 'Loja B', qtdDisponivel: 5, conferidoEm: diasAtras(40) }),
        linha({ parceiroNome: 'Loja C', qtdDisponivel: 9, conferidoEm: diasAtras(1) }),
      ],
      { agora: AGORA },
    );
    expect(q.unidadesEmRisco).toBe(10);
    expect(q.parceirosEmRisco).toEqual(['Loja A', 'Loja B']);
  });

  it('conta por estado, e a soma fecha com o total de linhas', () => {
    const linhas = [
      linha({ conferidoEm: null }),
      linha({ conferidoEm: diasAtras(40) }),
      linha({ conferidoEm: diasAtras(INTERVALO_DE_CONFERENCIA_DIAS) }),
      linha({ conferidoEm: diasAtras(1) }),
    ];
    const q = montarQuadroDeConferencia(linhas, { agora: AGORA });
    for (const estado of ESTADOS_DE_CONFERENCIA) expect(q.porEstado[estado]).toBe(1);
    expect(Object.values(q.porEstado).reduce((a, b) => a + b, 0)).toBe(linhas.length);
  });

  it('lista vazia devolve quadro vazio, não quebra', () => {
    const q = montarQuadroDeConferencia([], { agora: AGORA });
    expect(q.itens).toEqual([]);
    expect(q.unidadesEmRisco).toBe(0);
  });
});
