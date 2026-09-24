import { describe, expect, it } from 'vitest';
import {
  diasUteisEntre,
  medirConfiabilidade,
  notaDaFracao,
  postadoNoPrazo,
  type PedidoParaMedir,
} from './confiabilidade';

// 2026-09-25 é uma sexta-feira.
const SEXTA = new Date('2026-09-25T14:00:00-03:00');

describe('diasUteisEntre', () => {
  it('conta os dias úteis depois do primeiro, sem fim de semana', () => {
    expect(diasUteisEntre('2026-09-25', '2026-09-25')).toBe(0);
    expect(diasUteisEntre('2026-09-25', '2026-09-26')).toBe(0); // sábado
    expect(diasUteisEntre('2026-09-25', '2026-09-28')).toBe(1); // segunda
    expect(diasUteisEntre('2026-09-25', '2026-10-02')).toBe(5);
    expect(diasUteisEntre('2026-09-28', '2026-09-25')).toBe(0);
  });
});

describe('postadoNoPrazo', () => {
  it('com o prazo da plataforma, compara o instante', () => {
    const prazo = new Date('2026-09-26T12:00:00-03:00');
    expect(
      postadoNoPrazo({ data: SEXTA, prazoPostagemAte: prazo, postagemConfirmadaEm: prazo }, null),
    ).toBe(true);
    expect(
      postadoNoPrazo(
        {
          data: SEXTA,
          prazoPostagemAte: prazo,
          postagemConfirmadaEm: new Date('2026-09-26T12:00:01-03:00'),
        },
        // A promessa do fornecedor não salva quem perdeu o prazo da plataforma.
        5,
      ),
    ).toBe(false);
  });

  it('sem ele, compara com a promessa em dias úteis, no fuso do vendedor', () => {
    const venda = { data: SEXTA, prazoPostagemAte: null };
    // Prometeu 1 dia útil: postar na segunda à noite ainda é cumprir.
    const segundaANoite = new Date('2026-09-28T23:30:00-03:00');
    expect(postadoNoPrazo({ ...venda, postagemConfirmadaEm: segundaANoite }, 1)).toBe(true);
    // Em UTC já é terça; no fuso do vendedor, não.
    expect(segundaANoite.toISOString().startsWith('2026-09-29')).toBe(true);
    expect(
      postadoNoPrazo({ ...venda, postagemConfirmadaEm: new Date('2026-09-29T09:00:00-03:00') }, 1),
    ).toBe(false);
  });

  it('sem prazo e sem promessa, não mede', () => {
    expect(
      postadoNoPrazo({ data: SEXTA, prazoPostagemAte: null, postagemConfirmadaEm: SEXTA }, null),
    ).toBeNull();
  });
});

describe('notaDaFracao', () => {
  it('5 é quase nunca atrasar, e nenhum no prazo é 0', () => {
    expect(notaDaFracao(20, 20)).toBe(5);
    expect(notaDaFracao(19, 20)).toBe(5); // 95%
    expect(notaDaFracao(18, 20)).toBe(4); // 90%
    expect(notaDaFracao(14, 20)).toBe(3); // 70%
    expect(notaDaFracao(10, 20)).toBe(2); // 50%
    expect(notaDaFracao(1, 20)).toBe(1);
    expect(notaDaFracao(0, 20)).toBe(0);
  });
});

describe('medirConfiabilidade', () => {
  const postado = (diasDepois: number): PedidoParaMedir => ({
    data: SEXTA,
    prazoPostagemAte: null,
    postagemConfirmadaEm: new Date(SEXTA.getTime() + diasDepois * 24 * 60 * 60 * 1000),
  });

  it('com menos de cinco pedidos medidos, não dá nota', () => {
    expect(medirConfiabilidade([postado(0), postado(3)], 1)).toEqual({
      tipo: 'poucos',
      medidos: 2,
    });
    expect(medirConfiabilidade([], 1)).toEqual({ tipo: 'sem_pedidos' });
    // Pedido sem referência não conta como medido.
    expect(medirConfiabilidade([postado(0), postado(0)], null)).toEqual({ tipo: 'sem_pedidos' });
  });

  it('mede a fração no prazo contra o que o fornecedor prometeu', () => {
    // Sexta + 3 dias corridos é segunda: 1 dia útil, dentro da promessa de 1.
    // Sexta + 4 é terça: 2 dias úteis, fora.
    const pedidos = [postado(0), postado(3), postado(3), postado(3), postado(4)];
    expect(medirConfiabilidade(pedidos, 1)).toEqual({
      tipo: 'medida',
      nota: 3,
      medidos: 5,
      noPrazo: 4,
    });
  });
});
