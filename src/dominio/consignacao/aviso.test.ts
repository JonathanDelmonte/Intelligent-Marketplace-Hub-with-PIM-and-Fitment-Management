import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { avisoDeVenda, dataEHoraNoFuso, linhaDeFechamento, pedidoDeConferencia } from './aviso';

const VENDEDOR = 'Perfil de Teste';
const PRAZO = new Date('2026-09-16T13:00:00Z');

describe('dataEHoraNoFuso', () => {
  it('escreve dia e hora no fuso do vendedor', () => {
    // 13h UTC é 10h em São Paulo, e é o parceiro que vai ler.
    expect(dataEHoraNoFuso(PRAZO)).toBe('16/09/2026 às 10:00');
  });

  it('leva o fuso a sério: o mesmo instante muda de hora e pode mudar de dia', () => {
    const virada = new Date('2026-09-17T02:00:00Z');
    expect(dataEHoraNoFuso(virada)).toContain('16/09/2026');
    expect(dataEHoraNoFuso(virada, 'UTC')).toContain('17/09/2026');
  });
});

describe('avisoDeVenda', () => {
  it('diz o que separar, até quando, e pede confirmação', () => {
    const texto = avisoDeVenda({
      vendedor: VENDEDOR,
      parceiro: 'Loja do Centro',
      item: { descricao: 'refil de purificador PA21G', qtd: 2, codigo: 'EF-ELX-21' },
      prazoPostagemAte: PRAZO,
    });

    expect(texto).toContain('Loja do Centro');
    expect(texto).toContain('2 × refil de purificador PA21G');
    expect(texto).toContain('código EF-ELX-21');
    expect(texto).toContain('16/09/2026 às 10:00');
    // Sem pedir confirmação a mensagem não é combinado, e a descoberta de que a
    // peça não foi separada viria pelo comprador reclamando.
    expect(texto).toContain('confirma');
    expect(texto.trimEnd().endsWith(VENDEDOR)).toBe(true);
  });

  it('sem prazo informado pede pressa em vez de omitir o assunto', () => {
    const texto = avisoDeVenda({
      vendedor: VENDEDOR,
      parceiro: 'Loja do Centro',
      item: { descricao: 'refil', qtd: 1 },
      prazoPostagemAte: null,
    });
    expect(texto).toContain('assim que possível');
    expect(texto).not.toContain('undefined');
    expect(texto).not.toContain('null');
  });

  it('sem nome de parceiro cumprimenta sem inventar nome', () => {
    const texto = avisoDeVenda({
      vendedor: VENDEDOR,
      parceiro: null,
      item: { descricao: 'refil', qtd: 1 },
      prazoPostagemAte: PRAZO,
    });
    expect(texto.startsWith('Olá!')).toBe(true);
  });

  it('sem código não deixa parêntese vazio na frase', () => {
    const texto = avisoDeVenda({
      vendedor: VENDEDOR,
      item: { descricao: 'refil', qtd: 1, codigo: '  ' },
      prazoPostagemAte: PRAZO,
    });
    expect(texto).not.toContain('()');
    expect(texto).not.toContain('código )');
  });

  it('não menciona marca do sistema em lugar nenhum', () => {
    // O nome de quem fala vem por parâmetro, de configuração (ADR 0003).
    const texto = avisoDeVenda({
      vendedor: VENDEDOR,
      item: { descricao: 'refil', qtd: 1 },
      prazoPostagemAte: PRAZO,
    });
    expect(texto.toLowerCase()).not.toContain('bancada');
  });
});

describe('pedidoDeConferencia', () => {
  it('manda a contagem do sistema, para a resposta ser um número e não um palpite', () => {
    // "Quantos você tem?" recebe "acho que uns cinco". "Tenho cinco anotados,
    // confere?" recebe sim ou o número certo.
    const texto = pedidoDeConferencia({
      vendedor: VENDEDOR,
      parceiro: 'Loja do Centro',
      itens: [
        { descricao: 'refil PA21G', qtdNoSistema: 5, codigo: 'EF-ELX-21' },
        { descricao: 'vedação da tampa', qtdNoSistema: 2 },
      ],
      diasDesdeAUltima: 9,
    });

    expect(texto).toContain('há 9 dias');
    expect(texto).toContain('tenho 5 anotados');
    expect(texto).toContain('tenho 2 anotados');
    expect(texto).toContain('código EF-ELX-21');
  });

  it('conferência de hoje não diz "há 0 dias", e a de ontem não diz "dias"', () => {
    // O plural com "(s)" escondia as duas: zero dia não é um intervalo, é agora.
    const pedido = (dias: number) =>
      pedidoDeConferencia({
        vendedor: VENDEDOR,
        parceiro: 'Loja',
        itens: [{ descricao: 'refil', qtdNoSistema: 1 }],
        diasDesdeAUltima: dias,
      });

    expect(pedido(0)).toContain('A última conferência foi hoje.');
    expect(pedido(1)).toContain('há 1 dia.');
    expect(pedido(1)).toContain('tenho 1 anotado');
  });

  it('explica por que está perguntando, que é o que faz o parceiro responder', () => {
    const texto = pedidoDeConferencia({
      vendedor: VENDEDOR,
      itens: [{ descricao: 'refil', qtdNoSistema: 1 }],
      diasDesdeAUltima: 8,
    });
    expect(texto).toContain('cancelar');
  });

  it('nunca conferido diz isso, em vez de "há null dias"', () => {
    const texto = pedidoDeConferencia({
      vendedor: VENDEDOR,
      itens: [{ descricao: 'refil', qtdNoSistema: 1 }],
      diasDesdeAUltima: null,
    });
    expect(texto).toContain('nenhuma vez');
    expect(texto).not.toContain('null');
  });
});

describe('linhaDeFechamento', () => {
  it('mostra a conta inteira, não só o total', () => {
    // O parceiro confere a conta; total sozinho é número para acreditar.
    //
    // Comparado por conteúdo e não por literal: o `Intl` de pt-BR separa "R$" do
    // número com espaço não separável (U+00A0), e a string literal deste arquivo
    // tem espaço comum — as duas parecem iguais na tela do editor e não são. Mesma
    // razão do teste de `formatarBRL` em `lib/dinheiro.test.ts`.
    const linha = linhaDeFechamento('Refil PA21G', 3, reaisParaCentavos(40));
    expect(linha.startsWith('Refil PA21G: 3 ×')).toBe(true);
    expect(linha).toContain('40,00');
    expect(linha).toContain('= R');
    expect(linha).toContain('120,00');
  });
});
