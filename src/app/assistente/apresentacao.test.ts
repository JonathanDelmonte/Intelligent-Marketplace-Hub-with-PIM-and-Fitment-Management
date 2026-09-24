import { describe, expect, it } from 'vitest';
import { janelasDoPeriodo, lojasDaConsulta, type Consulta } from '@/dominio/assistente/consulta';
import type { FrescorDaLoja, Levantamento, PainelDaLoja } from '@/dominio/assistente/levantar';
import { estadoDaLoja } from '@/dominio/lojas/estado';
import { PAINEL_VAZIO, somarPainel, type Painel } from '@/dominio/lojas/painel';
import type { MaisVendido } from '@/dominio/lojas/repositorio';
import { montarFilaDoDia, type PedidoParaPostar } from '@/dominio/pedidos/fila-do-dia';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { centavos, pontosBase } from '@/lib/dinheiro';
import {
  anteriorNaFrase,
  avisoSemResposta,
  comparacao,
  descreverConsulta,
  periodoCurto,
  periodoNaFrase,
  redigirResposta,
  textoDeComoEntendi,
} from './apresentacao';

/** Quinta, 24/09/2026, 12h em São Paulo. */
const AGORA = new Date('2026-09-24T15:00:00.000Z');

const consulta = (campos: Partial<Consulta> = {}): Consulta => ({
  metrica: 'faturamento',
  lojas: [],
  periodo: 'ultimos_30',
  porLoja: false,
  ...campos,
});

/** Um painel a partir do que interessa: faturamento, pedidos e margem. */
function painel(faturamento: number, pedidos: number, margem?: number, semMargem = 0): Painel {
  return somarPainel([
    {
      plataforma: 'ml',
      pedidos,
      faturamento: centavos(faturamento),
      faturamentoComMargem: centavos(margem === undefined ? 0 : faturamento),
      margem: centavos(margem ?? 0),
      pedidosSemMargem: margem === undefined ? pedidos : semMargem,
      repasse: centavos(0),
    },
  ]);
}

/** Loja por planilha até 24/09 (em dia), ou sem pedido nenhum. */
function frescor(plataforma: Plataforma, ultimo: string | null = '2026-09-24'): FrescorDaLoja {
  const ultimoPedidoEm = ultimo === null ? null : new Date(`${ultimo}T15:00:00.000Z`);
  return {
    plataforma,
    ultimoPedidoEm,
    estado: estadoDaLoja({
      plataforma,
      pedidos: ultimo === null ? 0 : 5,
      ultimoPedidoEm,
      conectada: false,
    }),
  };
}

function levantamentoDePainel(
  c: Consulta,
  porLoja: readonly PainelDaLoja[],
  frescores?: readonly FrescorDaLoja[],
): Levantamento {
  const lojas = lojasDaConsulta(c);
  return {
    tipo: 'painel',
    consulta: c,
    lojas,
    frescor: frescores ?? lojas.map((p) => frescor(p)),
    janelas: janelasDoPeriodo(c.periodo, AGORA),
    porLoja,
    total: somarPainelDe(porLoja.map((l) => l.atual)),
    totalAnterior: somarPainelDe(porLoja.map((l) => l.anterior)),
  };
}

/** Soma painéis já prontos — o suficiente para o teste, que usa margem conhecida ou nenhuma. */
function somarPainelDe(paineis: readonly Painel[]): Painel {
  let faturamento = 0;
  let pedidos = 0;
  let margem = 0;
  let base = 0;
  let semMargem = 0;
  for (const p of paineis) {
    faturamento += p.faturamento;
    pedidos += p.pedidos;
    semMargem += p.pedidosSemMargem;
    if (p.margemBp !== null) {
      const comMargem = p.faturamento;
      base += comMargem;
      margem += Math.round((p.margemBp * comMargem) / 10_000);
    }
  }
  return somarPainel([
    {
      plataforma: 'ml',
      pedidos,
      faturamento: centavos(faturamento),
      faturamentoComMargem: centavos(base),
      margem: centavos(margem),
      pedidosSemMargem: semMargem,
      repasse: centavos(0),
    },
  ]);
}

describe('o período na frase', () => {
  it('diz cada período como se fala, e com as datas no "entendi assim"', () => {
    const trinta = janelasDoPeriodo('ultimos_30', AGORA);
    expect(periodoNaFrase('ultimos_30', trinta)).toBe('nos últimos 30 dias');
    expect(anteriorNaFrase('ultimos_30', trinta)).toBe('nos 30 dias anteriores');
    expect(periodoCurto('ultimos_30', trinta)).toBe('últimos 30 dias (26/08 a 24/09)');

    const hoje = janelasDoPeriodo('hoje', AGORA);
    expect(periodoCurto('hoje', hoje)).toBe('hoje (24/09)');
    expect(anteriorNaFrase('hoje', hoje)).toBe('ontem');

    const passado = janelasDoPeriodo('mes_passado', AGORA);
    expect(periodoNaFrase('mes_passado', passado)).toBe('em agosto');
    expect(anteriorNaFrase('mes_passado', passado)).toBe('em julho');
    expect(periodoCurto('mes_passado', passado)).toBe('agosto (01/08 a 31/08)');

    const mes = janelasDoPeriodo('mes_atual', AGORA);
    expect(periodoNaFrase('mes_atual', mes)).toBe('neste mês');
    expect(anteriorNaFrase('mes_atual', mes)).toBe('no mesmo trecho do mês passado');
  });
});

describe('comparacao', () => {
  const reais = (v: number) => `R$ ${String(v / 100)}`;

  it('diz quanto a mais ou a menos, com o número de antes', () => {
    expect(comparacao(12_000, 10_000, reais, 'ontem')).toBe('20% a mais que ontem (R$ 100).');
    expect(comparacao(9_000, 10_000, reais, 'em julho')).toBe('10% a menos que em julho (R$ 100).');
    expect(comparacao(10_000, 10_000, reais, 'ontem')).toBe('O mesmo que ontem.');
  });

  it('sem base, diz que não houve venda antes; zero contra zero não é comparação', () => {
    expect(comparacao(5_000, 0, reais, 'ontem')).toBe('Não houve venda ontem para comparar.');
    expect(comparacao(0, 0, reais, 'ontem')).toBeNull();
  });
});

describe('redigirResposta — painel de uma loja', () => {
  it('responde a pergunta do dono: o faturamento da Shopee, com a comparação', () => {
    const c = consulta({ lojas: ['shopee'] });
    const r = redigirResposta(
      levantamentoDePainel(c, [
        { plataforma: 'shopee', atual: painel(432_100, 38), anterior: painel(390_000, 30) },
      ]),
      AGORA,
    );

    expect(r.entendido).toBe('Faturamento · Shopee · últimos 30 dias (26/08 a 24/09)');
    expect(r.lead).toBe(
      'Faturamento da Shopee nos últimos 30 dias: R$\u00a04.321,00, em 38 pedidos.',
    );
    // +10,79%, que se lê "11%": o mesmo arredondamento do painel da loja, lado a lado.
    expect(r.complemento).toBe('11% a mais que nos 30 dias anteriores (R$\u00a03.900,00).');
    expect(r.notas).toEqual([]);
  });

  it('todas somadas não citam loja, e dia sem venda é dito, não zerado', () => {
    const c = consulta({ periodo: 'hoje' });
    const r = redigirResposta(
      levantamentoDePainel(c, [
        { plataforma: 'ml', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
        { plataforma: 'shopee', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
        { plataforma: 'amazon', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
      ]),
      AGORA,
    );
    expect(r.lead).toBe('Nenhuma venda hoje.');
  });

  it('margem com pedido sem custo diz quantos ficaram de fora, e leva ao catálogo', () => {
    const c = consulta({ metrica: 'margem', lojas: ['ml'] });
    const r = redigirResposta(
      levantamentoDePainel(c, [
        { plataforma: 'ml', atual: painel(100_000, 10, 23_000, 2), anterior: PAINEL_VAZIO },
      ]),
      AGORA,
    );
    expect(r.lead).toBe('Margem do Mercado Livre nos últimos 30 dias: 23%.');
    expect(r.notas).toEqual([
      'A margem é sobre 8 dos 10 pedidos: 2 pedidos sem custo ficaram de fora. Informe o custo no catálogo para a conta ficar inteira.',
    ]);
    expect(r.acao?.href).toBe('/catalogo');
  });

  it('a planilha que para antes do fim do período é dita, com a data', () => {
    // "R$ 0 hoje" de uma loja por planilha pareceria dia sem venda, e é dia não importado.
    const c = consulta({ lojas: ['shopee'] });
    const r = redigirResposta(
      levantamentoDePainel(
        c,
        [{ plataforma: 'shopee', atual: painel(10_000, 1), anterior: PAINEL_VAZIO }],
        [frescor('shopee', '2026-09-20')],
      ),
      AGORA,
    );
    expect(r.notas).toEqual([
      'Os pedidos da Shopee vão até 20/09, a planilha mais recente: o que vendeu depois ainda não está na conta.',
    ]);
  });

  it('loja sem pedido nenhum leva a importar a planilha dela', () => {
    const c = consulta({ lojas: ['amazon'] });
    const r = redigirResposta(
      levantamentoDePainel(
        c,
        [{ plataforma: 'amazon', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO }],
        [frescor('amazon', null)],
      ),
      AGORA,
    );
    expect(r.lead).toBe('Nenhuma venda na Amazon nos últimos 30 dias.');
    expect(r.notas[0]).toContain('A Amazon ainda não tem pedido importado.');
    expect(r.acao).toEqual({
      rotulo: 'Importar planilha da Amazon',
      href: '/importar?loja=amazon',
    });
  });
});

describe('redigirResposta — comparando lojas', () => {
  it('diz quem faturou mais, com a fatia, e lista da maior para a menor', () => {
    const c = consulta({ porLoja: true });
    const r = redigirResposta(
      levantamentoDePainel(
        c,
        [
          { plataforma: 'ml', atual: painel(30_000, 3), anterior: painel(20_000, 2) },
          { plataforma: 'shopee', atual: painel(70_000, 7), anterior: painel(30_000, 3) },
          { plataforma: 'amazon', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
        ],
        [frescor('ml'), frescor('shopee'), frescor('amazon', null)],
      ),
      AGORA,
    );

    expect(r.entendido).toBe('Faturamento · cada loja · últimos 30 dias (26/08 a 24/09)');
    expect(r.lead).toBe(
      'A Shopee faturou mais nos últimos 30 dias: R$\u00a0700,00, 70% do total de R$\u00a01.000,00.',
    );
    expect(r.complemento).toBe(
      'No total, 100% a mais que nos 30 dias anteriores (R$\u00a0500,00).',
    );
    expect(r.secoes[0]?.linhas.map((l) => [l.rotulo, l.valor, l.nota])).toEqual([
      ['Shopee', 'R$\u00a0700,00', '7 pedidos · 70% do total'],
      ['Mercado Livre', 'R$\u00a0300,00', '3 pedidos · 30% do total'],
      // Traço, e não "R$ 0,00": zero seria "não vendeu", e dela ainda não entrou dado.
      ['Amazon', '—', 'nenhum pedido importado ainda'],
    ]);
    expect(r.notas).toEqual(['A Amazon ainda não tem pedido importado, e não entra na conta.']);
  });

  it('a loja que dá mais margem é a de maior margem, não a de maior faturamento', () => {
    const c = consulta({ metrica: 'margem', porLoja: true });
    const r = redigirResposta(
      levantamentoDePainel(c, [
        { plataforma: 'ml', atual: painel(30_000, 3, 9_000), anterior: PAINEL_VAZIO },
        { plataforma: 'shopee', atual: painel(70_000, 7, 7_000), anterior: PAINEL_VAZIO },
        { plataforma: 'amazon', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
      ]),
      AGORA,
    );
    expect(r.lead).toBe('O Mercado Livre deu mais margem nos últimos 30 dias: 30%.');
    expect(r.secoes[0]?.linhas.map((l) => [l.rotulo, l.valor])).toEqual([
      ['Mercado Livre', '30%'],
      ['Shopee', '10%'],
      ['Amazon', '—'],
    ]);
  });

  it('sem custo em loja nenhuma, não há margem para comparar — e diz onde resolver', () => {
    const c = consulta({ metrica: 'margem', porLoja: true });
    const r = redigirResposta(
      levantamentoDePainel(c, [
        { plataforma: 'ml', atual: painel(30_000, 3), anterior: PAINEL_VAZIO },
        { plataforma: 'shopee', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
        { plataforma: 'amazon', atual: PAINEL_VAZIO, anterior: PAINEL_VAZIO },
      ]),
      AGORA,
    );
    expect(r.lead).toBe(
      'Nenhuma loja tem pedido com custo informado nos últimos 30 dias, então não há margem para comparar.',
    );
    expect(r.acao?.href).toBe('/catalogo');
  });
});

describe('redigirResposta — mais vendidos', () => {
  const produto = (
    skuId: string | null,
    faturamento: number,
    pedidos = 1,
    margemBp: number | null = null,
  ): MaisVendido => ({
    skuId,
    titulo: skuId,
    pedidos,
    faturamento: centavos(faturamento),
    margemBp: margemBp === null ? null : pontosBase(margemBp),
  });

  const levantamento = (
    grupos: readonly { plataforma: Plataforma | null; produtos: readonly MaisVendido[] }[],
    c: Consulta = consulta({ metrica: 'mais_vendidos' }),
  ): Levantamento => ({
    tipo: 'mais_vendidos',
    consulta: c,
    lojas: lojasDaConsulta(c),
    frescor: lojasDaConsulta(c).map((p) => frescor(p)),
    janelas: janelasDoPeriodo(c.periodo, AGORA),
    grupos,
  });

  it('o campeão é produto do catálogo: o balde sem produto não lidera a frase', () => {
    const r = redigirResposta(
      levantamento([
        {
          plataforma: null,
          produtos: [produto(null, 90_000, 9), produto('Capa X', 30_000, 3, 2_500)],
        },
      ]),
      AGORA,
    );
    expect(r.lead).toBe(
      'O que mais faturou nos últimos 30 dias foi Capa X: R$\u00a0300,00 em 3 pedidos.',
    );
    expect(r.secoes[0]?.linhas.map((l) => [l.rotulo, l.nota])).toEqual([
      ['Sem produto do catálogo', '9 pedidos · sem custo'],
      ['Capa X', '3 pedidos · margem 25%'],
    ]);
    expect(r.notas[0]).toContain('não casaram com nenhum produto cadastrado');
  });

  it('comparando lojas, uma lista por loja e o campeão com a loja dele', () => {
    const c = consulta({ metrica: 'mais_vendidos', porLoja: true });
    const r = redigirResposta(
      levantamento(
        [
          { plataforma: 'ml', produtos: [produto('Refil', 20_000, 2)] },
          { plataforma: 'shopee', produtos: [produto('Capa X', 30_000, 3)] },
          { plataforma: 'amazon', produtos: [] },
        ],
        c,
      ),
      AGORA,
    );
    expect(r.lead).toBe(
      'O que mais faturou nos últimos 30 dias foi Capa X, na Shopee: R$\u00a0300,00 em 3 pedidos.',
    );
    expect(r.secoes.map((s) => s.titulo)).toEqual(['Mercado Livre', 'Shopee', 'Amazon']);
    expect(r.secoes[2]?.linhas[0]?.rotulo).toBe('Nenhuma venda no período');
  });
});

describe('redigirResposta — fila e repasse', () => {
  let n = 0;
  const pedido = (plataforma: string, prazo: string | null): PedidoParaPostar => {
    n += 1;
    return {
      id: `p${String(n)}`,
      idExterno: `X${String(n)}`,
      plataforma,
      qtd: 1,
      tituloDoProduto: 'Refil PA21G',
      prazoPostagemAte: prazo === null ? null : new Date(prazo),
      postagemConfirmadaEm: null,
      rastreio: null,
    };
  };

  it('a fila de uma loja leva aos pedidos dela', () => {
    const c = consulta({ metrica: 'postar_hoje', lojas: ['shopee'] });
    const r = redigirResposta(
      {
        tipo: 'fila',
        consulta: c,
        lojas: ['shopee'],
        frescor: [frescor('shopee')],
        porLoja: [
          {
            plataforma: 'shopee',
            fila: montarFilaDoDia(
              [
                pedido('shopee', '2026-09-24T12:00:00.000Z'),
                pedido('shopee', '2026-09-24T22:00:00.000Z'),
              ],
              AGORA,
            ),
          },
        ],
      },
      AGORA,
    );
    expect(r.entendido).toBe('O que postar hoje · Shopee');
    expect(r.lead).toBe('1 atrasado e 1 para hoje. Comece pelos atrasados.');
    expect(r.secoes.map((s) => s.titulo)).toEqual(['Por onde começar']);
    expect(r.acao).toEqual({
      rotulo: 'Abrir os pedidos da Shopee',
      href: '/lojas/shopee?aba=pedidos',
    });
  });

  it('a fila de todas separa por loja, e a planilha velha é dita', () => {
    const c = consulta({ metrica: 'postar_hoje' });
    const r = redigirResposta(
      {
        tipo: 'fila',
        consulta: c,
        lojas: ['ml', 'shopee', 'amazon'],
        frescor: [frescor('ml', '2026-09-22'), frescor('shopee'), frescor('amazon', null)],
        porLoja: [
          { plataforma: 'ml', fila: montarFilaDoDia([pedido('ml', null)], AGORA) },
          { plataforma: 'shopee', fila: montarFilaDoDia([], AGORA) },
          { plataforma: 'amazon', fila: montarFilaDoDia([], AGORA) },
        ],
      },
      AGORA,
    );
    expect(r.secoes[0]?.linhas.map((l) => [l.rotulo, l.valor, l.nota])).toEqual([
      ['Mercado Livre', '1', '1 sem prazo'],
      ['Shopee', '0', 'nada na fila'],
      ['Amazon', '0', 'nada na fila'],
    ]);
    expect(r.notas).toEqual([
      'A fila do Mercado Livre vem da planilha, que vai até 22/09: pedido feito depois disso ainda não aparece.',
    ]);
    expect(r.acao?.href).toBe('/postagem');
  });

  it('o repasse soma a diferença e leva à loja com mais divergência', () => {
    const c = consulta({ metrica: 'repasse_divergente' });
    const r = redigirResposta(
      {
        tipo: 'repasse',
        consulta: c,
        lojas: ['ml', 'shopee', 'amazon'],
        frescor: [frescor('ml'), frescor('shopee'), frescor('amazon')],
        porLoja: [
          { plataforma: 'ml', divergentes: [{ idExterno: 'M1', divergencia: centavos(200) }] },
          {
            plataforma: 'shopee',
            divergentes: [
              { idExterno: 'S1', divergencia: centavos(-500) },
              { idExterno: 'S2', divergencia: centavos(-940) },
            ],
          },
          { plataforma: 'amazon', divergentes: [] },
        ],
      },
      AGORA,
    );
    expect(r.lead).toBe(
      '3 pedidos com repasse diferente do esperado, somando R$\u00a012,40 a menos do que as taxas explicam.',
    );
    expect(r.secoes.at(-1)?.linhas.map((l) => [l.rotulo, l.valor])).toEqual([
      ['Pedido S2', '−R$\u00a09,40'],
      ['Pedido S1', '−R$\u00a05,00'],
      ['Pedido M1', '+R$\u00a02,00'],
    ]);
    expect(r.acao).toEqual({
      rotulo: 'Conferir o repasse da Shopee',
      href: '/lojas/shopee?aba=repasse',
    });
  });
});

describe('descreverConsulta', () => {
  it('fila e repasse não têm período', () => {
    const c = consulta({ metrica: 'repasse_divergente', lojas: ['ml', 'amazon'], porLoja: true });
    expect(
      descreverConsulta({
        tipo: 'repasse',
        consulta: c,
        lojas: ['ml', 'amazon'],
        frescor: [],
        porLoja: [],
      }),
    ).toBe('Repasse diferente do esperado · Mercado Livre e Amazon');
  });
});

describe('como entendi e sem resposta', () => {
  it('o rodapé diz quem entendeu, e que a IA não calcula', () => {
    expect(textoDeComoEntendi({ tipo: 'pronta' })).toContain('sem IA');
    expect(textoDeComoEntendi({ tipo: 'regra' })).toContain('pelas palavras');
    expect(textoDeComoEntendi({ tipo: 'ia', deCache: true })).toContain('não gastou cota');
    expect(textoDeComoEntendi({ tipo: 'ia', deCache: false })).toContain('não vê nem calcula');
  });

  it('a cota diz quando volta, no fuso do vendedor', () => {
    // 23h59 UTC de 24/09 é 20h59 em São Paulo: mesmo dia.
    const hoje = avisoSemResposta(
      { tipo: 'cota', ate: new Date('2026-09-24T23:59:00.000Z') },
      AGORA,
    );
    expect(hoje.corpo).toContain('Ela volta às 20:59.');

    const amanha = avisoSemResposta(
      { tipo: 'cota', ate: new Date('2026-09-25T12:00:00.000Z') },
      AGORA,
    );
    expect(amanha.corpo).toContain('Ela volta em 25/09 às 09:00.');
  });

  it('fora do alcance diz o que se sabe responder', () => {
    const aviso = avisoSemResposta({ tipo: 'fora_do_alcance' }, AGORA);
    expect(aviso.corpo).toMatch(/^Hoje eu respondo sobre faturamento, pedidos/);
  });
});
