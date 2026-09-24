import { describe, expect, it } from 'vitest';
import { PAINEL_VAZIO, type Painel } from '@/dominio/lojas/painel';
import { centavos, pontosBase } from '@/lib/dinheiro';
import { AdaptadorMercadoLivre } from '@/plataformas/ml/adaptador';
import { MATRIZ_INICIAL } from '@/plataformas/matriz';
import {
  capacidadesNaTela,
  diaCurto,
  faltasDoProduto,
  margemEmTexto,
  resumoDaSerie,
  numerosDoPainel,
  pendenciasDaLoja,
  variacaoEmTexto,
  type LeiturasDaLoja,
} from './apresentacao';

const painel = (parciais: Partial<Painel>): Painel => ({ ...PAINEL_VAZIO, ...parciais });

describe('variacaoEmTexto', () => {
  it('diz o sentido e o tamanho da mudança, com o sinal tipográfico', () => {
    expect(variacaoEmTexto(11_100, 10_000, 30)).toBe('+11% sobre os 30 dias anteriores');
    expect(variacaoEmTexto(9_000, 10_000, 30)).toBe('−10% sobre os 30 dias anteriores');
    expect(variacaoEmTexto(10_000, 10_000, 30)).toBe('igual aos 30 dias anteriores');
  });

  it('sem base, não inventa percentual', () => {
    expect(variacaoEmTexto(5_000, 0, 30)).toBe('nenhuma venda nos 30 dias anteriores');
    expect(variacaoEmTexto(0, 0, 30)).toBe('sem venda nos 30 dias anteriores');
  });
});

describe('margemEmTexto', () => {
  it('traço quando não se sabe, e negativo com o sinal de menos', () => {
    expect(margemEmTexto(null)).toBe('—');
    expect(margemEmTexto(pontosBase(2300))).toBe('23%');
    expect(margemEmTexto(pontosBase(-300))).toBe('−3%');
  });
});

describe('numerosDoPainel', () => {
  it('faturamento, pedidos com ticket, margem e repasse', () => {
    const numeros = numerosDoPainel(
      painel({
        pedidos: 121,
        faturamento: centavos(823_010),
        ticketMedio: centavos(6_802),
        margemBp: pontosBase(2300),
        repasse: centavos(650_000),
      }),
      painel({ pedidos: 100, faturamento: centavos(741_450) }),
      30,
    );
    expect(numeros.map((n) => [n.rotulo, n.valor])).toEqual([
      ['Faturamento', 'R$\u00a08.230,10'],
      ['Pedidos', '121'],
      ['Margem', '23%'],
      ['Repasse informado', 'R$\u00a06.500,00'],
    ]);
    expect(numeros[0]?.nota).toBe('+11% sobre os 30 dias anteriores');
    expect(numeros[0]?.tom).toBe('alta');
    expect(numeros[1]?.nota).toBe('ticket médio R$\u00a068,02');
  });

  it('a margem diz quantos pedidos ficaram de fora por falta de custo', () => {
    const [, , margem] = numerosDoPainel(
      painel({ pedidos: 10, margemBp: pontosBase(2000), pedidosSemMargem: 3 }),
      PAINEL_VAZIO,
      30,
    );
    expect(margem?.nota).toBe('3 pedidos sem custo ficaram de fora');

    const [, , semNenhum] = numerosDoPainel(
      painel({ pedidos: 2, pedidosSemMargem: 2 }),
      PAINEL_VAZIO,
      30,
    );
    expect(semNenhum?.valor).toBe('—');
    expect(semNenhum?.nota).toBe('nenhum pedido tem custo: informe no catálogo');
  });

  it('pedido sem repasse informado é a planilha que não trouxe, e não repasse zero', () => {
    const [, , , repasse] = numerosDoPainel(painel({ pedidos: 3 }), PAINEL_VAZIO, 30);
    expect(repasse?.nota).toBe('a planilha não trouxe o repasse');
  });
});

describe('pendenciasDaLoja', () => {
  const calma: LeiturasDaLoja = {
    postagem: { atrasados: 0, hoje: 0, semPrazo: 0 },
    divergenciasDeRepasse: 0,
    pedidosSemCusto: 0,
    duvidasRecorrentes: 0,
  };

  it('loja calma não tem pendência nenhuma', () => {
    expect(pendenciasDaLoja('shopee', calma)).toEqual([]);
  });

  it('atraso é agora; cada pendência leva à aba que resolve', () => {
    const itens = pendenciasDaLoja('shopee', {
      postagem: { atrasados: 1, hoje: 2, semPrazo: 0 },
      divergenciasDeRepasse: 1,
      pedidosSemCusto: 4,
      duvidasRecorrentes: 2,
    });
    expect(itens.map((i) => [i.chave, i.tom, i.href])).toEqual([
      ['postagem', 'agora', '/lojas/shopee?aba=pedidos'],
      ['repasse', 'atencao', '/lojas/shopee?aba=repasse'],
      ['perguntas', 'atencao', '/lojas/shopee?aba=perguntas'],
      ['custo', 'atencao', '/catalogo'],
    ]);
    expect(itens[0]?.texto).toBe('3 pedidos para postar: 1 atrasado, 2 para hoje.');
  });

  it('só "para hoje" é atenção, e não agora', () => {
    const [item] = pendenciasDaLoja('ml', {
      ...calma,
      postagem: { atrasados: 0, hoje: 2, semPrazo: 0 },
    });
    expect(item?.tom).toBe('atencao');
  });
});

describe('capacidadesNaTela', () => {
  it('lê o que o adaptador declarou, sem perguntar o nome da loja', () => {
    const shopee = capacidadesNaTela(MATRIZ_INICIAL.shopee);
    const porCapacidade = new Map(shopee.map((c) => [c.capacidade, c]));
    expect(porCapacidade.get('ler_pedidos')?.situacao).toBe('previsto');
    expect(porCapacidade.get('ler_pedidos')?.como).toContain('Pela planilha do painel da loja');
    expect(porCapacidade.get('responder_pergunta')?.situacao).toBe('nao_oferece');
    expect(porCapacidade.get('responder_pergunta')?.como).toContain('responda no aplicativo');
    expect(porCapacidade.get('exportar_para_importacao')?.situacao).toBe('funciona');
  });

  it('Mercado Livre sem conexão diz "sem conexão", e a busca de terceiros continua bloqueada', async () => {
    const mapa = await new AdaptadorMercadoLivre({ temCredencial: false }).capacidades();
    const porCapacidade = new Map(capacidadesNaTela(mapa).map((c) => [c.capacidade, c]));
    expect(porCapacidade.get('ler_pedidos')?.situacao).toBe('sem_conexao');
    expect(porCapacidade.get('ler_pedidos')?.como).toBe('Sem conexão — importe a planilha');
    expect(porCapacidade.get('buscar_terceiros')?.situacao).toBe('bloqueado');
  });
});

describe('resumoDaSerie', () => {
  const ponto = (dia: string, faturamento: number, pedidos: number) => ({
    dia,
    faturamento: centavos(faturamento),
    pedidos,
  });

  it('diz o melhor dia e quantos ficaram sem venda', () => {
    expect(
      resumoDaSerie([
        ponto('2026-09-22', 0, 0),
        ponto('2026-09-23', 9_000, 2),
        ponto('2026-09-24', 500, 1),
      ]),
    ).toBe('Melhor dia: 23/09, R$\u00a090,00. 1 dia sem venda.');
  });

  it('janela sem venda nenhuma diz isso, e não "melhor dia: zero"', () => {
    expect(resumoDaSerie([ponto('2026-09-24', 0, 0)])).toBe('Nenhuma venda nestes dias.');
  });

  it('diaCurto é dia e mês', () => {
    expect(diaCurto('2026-09-04')).toBe('04/09');
  });
});

describe('faltasDoProduto', () => {
  it('custo primeiro; vazio é pronto', () => {
    expect(
      faltasDoProduto({ temCusto: false, temEan: false, compatibilidadesPublicaveis: 0 }),
    ).toEqual(['custo', 'código de barras', 'onde serve']);
    expect(
      faltasDoProduto({ temCusto: true, temEan: true, compatibilidadesPublicaveis: 3 }),
    ).toEqual([]);
  });
});
