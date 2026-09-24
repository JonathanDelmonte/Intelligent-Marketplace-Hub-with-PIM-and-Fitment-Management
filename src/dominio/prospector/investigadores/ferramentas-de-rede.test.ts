/**
 * As ferramentas do garimpo que saem para a internet, com respostas falsas.
 *
 * A rede deste ambiente recusa o buscador, a BrasilAPI e o PNCP, então cada ferramenta
 * é exercitada com o que o serviço devolve — no formato conferido contra a
 * documentação e contra o código de quem já consome cada um. A primeira execução com
 * rede de verdade é o teste que falta, e está anotada no diário.
 */
import { describe, expect, it } from 'vitest';
import { formatarBRL, reaisParaCentavos } from '@/lib/dinheiro';
import { itemDaFamilia } from '../fronteira';
import type { FamiliaDeHipotese, Ferramenta } from '../hipoteses';
import type { PedidoDeInvestigacao } from '../motor';
import type { SensorDePncp } from '../pncp';
import {
  InvestigadorDeBuscaWeb,
  lerResultadosDoDuckDuckGo,
  CONSULTA_DA_FAMILIA,
} from './busca-web';
import { InvestigadorDeCnpj, lerCadastro } from './cnpj';
import { InvestigadorDeDemandaPublica, SensorDePncpHttp } from './demanda-publica';
import { InvestigadorDePagina } from './leitor-de-pagina';
import { cnpjsNoTexto, ofertasDaPagina, precosNoTexto, tituloDaPagina } from './pagina';
import { FalhaDeRede } from './rede';

const AGORA = () => new Date('2026-09-24T12:00:00Z');

function pedido(
  familia: FamiliaDeHipotese,
  ferramenta: Ferramenta,
  alvo: string,
  alvoDoDossie = 'refil PA21G',
): PedidoDeInvestigacao {
  return {
    item: itemDaFamilia({ id: `${familia}:${alvo}`, familia, alvo, ferramenta }),
    alvoDoDossie,
    restanteCentavos: reaisParaCentavos(5),
  };
}

/** Um `fetch` que responde por endereço, e grava o que foi pedido. */
function rede(responder: (url: string) => Response) {
  const pedidos: string[] = [];
  const buscar: typeof fetch = (entrada) => {
    const url =
      typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    pedidos.push(url);
    return Promise.resolve(responder(url));
  };
  return { buscar, pedidos };
}

/** O real como a tela escreve — com o espaço inseparável que o `Intl` põe depois do R$. */
const brl = (reais: number) => formatarBRL(reaisParaCentavos(reais));

const html = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

// ─── Página ─────────────────────────────────────────────────────────────────

const PAGINA_DE_LOJA = `<!doctype html><html><head>
<title>Refil PA21G Electrolux &amp; compatíveis | Loja Filtros</title>
<script type="application/ld+json">{ quebrado </script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Refil Purificador PA21G",
 "brand":{"@type":"Brand","name":"Electrolux"},"gtin13":"7896541200909",
 "offers":[{"@type":"Offer","price":"72.50","priceCurrency":"BRL","availability":"https://schema.org/InStock","seller":{"name":"Loja Filtros"}},
           {"@type":"Offer","price":"69.90","priceCurrency":"BRL","availability":"https://schema.org/InStock","seller":{"name":"Loja Filtros"}}]}]}
</script></head><body>
<p>Serve nos modelos PA21G, PA26G e PE11B.</p>
<footer>Loja Filtros LTDA — CNPJ 11.222.333/0001-81 — CNPJ falso 11.222.333/0001-82</footer>
</body></html>`;

describe('leitura de página', () => {
  it('lê título, dado estruturado com o menor preço, e CNPJ que confere', () => {
    expect(tituloDaPagina(PAGINA_DE_LOJA)).toBe(
      'Refil PA21G Electrolux & compatíveis | Loja Filtros',
    );
    const [oferta] = ofertasDaPagina(PAGINA_DE_LOJA);
    expect(oferta).toMatchObject({
      nome: 'Refil Purificador PA21G',
      marca: 'Electrolux',
      gtin: '7896541200909',
      preco: reaisParaCentavos(69.9),
      disponibilidade: 'em estoque',
    });
    expect(cnpjsNoTexto(PAGINA_DE_LOJA)).toEqual(['11222333000181']);
  });

  it('preço do texto: com milhar e vírgula, só na forma sem ambiguidade', () => {
    expect(precosNoTexto('De R$ 1.299,00 por R$ 999,90 ou 12x de R$ 83,33')).toEqual([
      reaisParaCentavos(1299),
      reaisParaCentavos(999.9),
      reaisParaCentavos(83.33),
    ]);
    expect(precosNoTexto('R$ 12 ou 1.299 reais')).toEqual([]);
  });

  it('o investigador responde a várias perguntas com uma página, e ramifica o CNPJ', async () => {
    const { buscar } = rede(() => html(PAGINA_DE_LOJA));
    const r = await new InvestigadorDePagina({ buscar, agora: AGORA }).investigar(
      pedido('onde_e_mais_barato', 'ler_pagina', 'https://lojafiltros.com.br/refil-pa21g'),
    );

    const porFamilia = (f: FamiliaDeHipotese) => r.achados.filter((a) => a.familia === f);
    expect(porFamilia('onde_e_mais_barato')[0]?.oQue).toContain(
      `${brl(69.9)} em lojafiltros.com.br, em estoque`,
    );
    expect(porFamilia('quem_ja_vende')[0]?.oQue).toContain('GTIN 7896541200909');
    expect(porFamilia('em_que_mais_serve').map((a) => a.oQue.split(' ')[0])).toEqual([
      'PA26G',
      'PE11B',
    ]);
    expect(r.fronteira?.map((i) => [i.ferramenta, i.alvo])).toEqual([['cnpj', '11222333000181']]);
    expect(r.achados.every((a) => a.origemUrl.startsWith('https://lojafiltros.com.br'))).toBe(true);
  });

  it('página que não abre é passo sem achado, e não derruba o dossiê', async () => {
    const { buscar } = rede(() => html('não achei', 404));
    const r = await new InvestigadorDePagina({ buscar }).investigar(
      pedido('onde_e_mais_barato', 'ler_pagina', 'https://sumiu.com.br/x'),
    );
    expect(r.achados).toEqual([]);
  });
});

// ─── Busca ──────────────────────────────────────────────────────────────────

const RESULTADOS_DDG = `<div class="results">
<div class="result results_links web-result"><div class="links_main">
 <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.distribuidoraagua.com.br%2Frefis&amp;rut=abc">Distribuidora Água Pura — refis <b>PA21G</b></a></h2>
 <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Distribuidor atacado de refis. CNPJ 11.222.333/0001-81. A partir de R$ 38,00.</a>
</div></div>
<div class="result results_links web-result result--ad"><div class="links_main">
 <h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=anuncio.com">Anúncio</a></h2>
</div></div>
<div class="result results_links web-result"><div class="links_main">
 <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.mercadolivre.com.br%2Frefil-pa21g">Refil PA21G | Mercado Livre</a></h2>
 <a class="result__snippet">Refil PA21G original por R$ 69,90</a>
</div></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F192.168.0.1%2F">Roteador</a></div>
</div>`;

describe('busca na web', () => {
  it('lê os resultados, tira o endereço real do uddg, e deixa anúncio e rede local de fora', () => {
    expect(lerResultadosDoDuckDuckGo(RESULTADOS_DDG)).toEqual([
      {
        titulo: 'Distribuidora Água Pura — refis PA21G',
        url: 'https://www.distribuidoraagua.com.br/refis',
        trecho: 'Distribuidor atacado de refis. CNPJ 11.222.333/0001-81. A partir de R$ 38,00.',
      },
      {
        titulo: 'Refil PA21G | Mercado Livre',
        url: 'https://www.mercadolivre.com.br/refil-pa21g',
        trecho: 'Refil PA21G original por R$ 69,90',
      },
    ]);
  });

  it('busca com a palavra de quem vende, e ramifica para ler as páginas e conferir o CNPJ', async () => {
    const { buscar, pedidos } = rede(() => html(RESULTADOS_DDG));
    const r = await new InvestigadorDeBuscaWeb({ buscar, agora: AGORA }).investigar(
      pedido('quem_distribui', 'busca_web', 'refil PA21G'),
    );

    expect(new URL(pedidos[0] ?? '').searchParams.get('q')).toBe(
      CONSULTA_DA_FAMILIA.quem_distribui('refil PA21G'),
    );
    // Só o que se diz distribuidor vira achado; a loja do marketplace só ramifica.
    expect(r.achados.map((a) => a.origemUrl)).toEqual([
      'https://www.distribuidoraagua.com.br/refis',
    ]);
    expect(r.fronteira?.map((i) => i.ferramenta)).toEqual(['ler_pagina', 'ler_pagina', 'cnpj']);
    expect(r.fronteira?.[0]?.id).toBe('ler:https://www.distribuidoraagua.com.br/refis');
  });

  it('para "onde é mais barato", o preço do trecho é o achado', async () => {
    const { buscar } = rede(() => html(RESULTADOS_DDG));
    const r = await new InvestigadorDeBuscaWeb({ buscar, agora: AGORA }).investigar(
      pedido('onde_e_mais_barato', 'busca_web', 'refil PA21G'),
    );
    expect(r.achados.map((a) => a.oQue.split(' em ')[0])).toEqual([brl(38), brl(69.9)]);
  });

  it('buscador que pede pausa não é "procurei e não achei": o passo não aconteceu', async () => {
    const { buscar } = rede(() => html('', 202));
    await expect(
      new InvestigadorDeBuscaWeb({ buscar }).investigar(
        pedido('quem_fabrica', 'busca_web', 'refil'),
      ),
    ).rejects.toThrow(FalhaDeRede);
  });
});

// ─── CNPJ ───────────────────────────────────────────────────────────────────

const CADASTRO = {
  cnpj: '11222333000181',
  razao_social: 'AGUA PURA DISTRIBUIDORA LTDA',
  nome_fantasia: 'AGUA PURA',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2015-03-12',
  cnae_fiscal: 4649499,
  cnae_fiscal_descricao:
    'Comércio atacadista de outros equipamentos e artigos de uso pessoal e doméstico',
  cnaes_secundarios: [{ codigo: 4759899, descricao: 'Comércio varejista de outros artigos' }],
  municipio: 'CURITIBA',
  uf: 'PR',
};

describe('consulta de CNPJ', () => {
  it('atacadista ativo confirma "quem distribui", com a fonte da consulta', async () => {
    const { buscar, pedidos } = rede(() => Response.json(CADASTRO));
    const r = await new InvestigadorDeCnpj({ buscar, agora: AGORA }).investigar(
      pedido('quem_distribui', 'cnpj', '11222333000181'),
    );
    expect(pedidos).toEqual(['https://brasilapi.com.br/api/cnpj/v1/11222333000181']);
    expect(r.confirmadas).toEqual(['quem_distribui']);
    expect(r.achados[0]?.oQue).toContain(
      'AGUA PURA DISTRIBUIDORA LTDA (AGUA PURA), CNPJ 11.222.333/0001-81, ativo desde 12/03/2015, CURITIBA/PR.',
    );
    expect(r.achados[0]?.oQue).toContain('é distribuidor de fato');
  });

  it('CNPJ baixado é achado — e o mais útil: descarta o fornecedor', () => {
    const { frase, confirma } = lerCadastro('11222333000181', {
      ...CADASTRO,
      descricao_situacao_cadastral: 'BAIXADA',
    });
    expect(frase).toContain('situação baixada');
    expect(confirma).toEqual([]);
  });

  it('CNPJ que a Receita não conhece também é achado', async () => {
    const { buscar } = rede(() =>
      Response.json({ message: 'CNPJ não encontrado' }, { status: 404 }),
    );
    const r = await new InvestigadorDeCnpj({ buscar }).investigar(
      pedido('quem_distribui', 'cnpj', '11.222.333/0001-81'),
    );
    expect(r.achados[0]?.oQue).toContain('não consta no cadastro da Receita');
  });

  it('item sem CNPJ não consulta nada, e serviço fora do ar espera', async () => {
    const { buscar, pedidos } = rede(() => Response.json({}, { status: 503 }));
    const investigador = new InvestigadorDeCnpj({ buscar });
    expect(
      (await investigador.investigar(pedido('quem_distribui', 'cnpj', 'refil PA21G'))).achados,
    ).toEqual([]);
    expect(pedidos).toEqual([]);
    await expect(
      investigador.investigar(pedido('quem_distribui', 'cnpj', '11222333000181')),
    ).rejects.toThrow(FalhaDeRede);
  });
});

// ─── PNCP ───────────────────────────────────────────────────────────────────

describe('demanda pública', () => {
  const busca = {
    items: [
      {
        orgao_cnpj: '00.394.460/0058-87',
        ano: 2026,
        numero_sequencial: 12,
        orgao_nome: 'Universidade Federal Tal',
        data_publicacao_pncp: '2026-05-10T14:03:00',
      },
    ],
  };
  const itens = [
    {
      descricao: 'Refil para purificador de água PA21G',
      quantidade: 40,
      valorUnitarioEstimado: 55.9,
      valorUnitarioHomologado: 49.5,
    },
    { descricao: 'Galão de água 20 litros', quantidade: 100, valorUnitarioEstimado: 12 },
  ];

  it('busca os editais, lê os itens, e monta a referência de preço com a fonte', async () => {
    const { buscar, pedidos } = rede((url) =>
      url.includes('/api/search/') ? Response.json(busca) : Response.json(itens),
    );
    const investigador = new InvestigadorDeDemandaPublica(
      new SensorDePncpHttp({ buscar, agora: AGORA }),
      AGORA,
    );

    const r = await investigador.investigar(pedido('demanda_publica', 'pncp', 'refil purificador'));

    const [primeiro, segundo] = pedidos;
    expect(new URL(primeiro ?? '').searchParams.get('q')).toBe('refil purificador');
    expect(segundo).toBe(
      'https://pncp.gov.br/api/pncp/v1/orgaos/00394460005887/compras/2026/12/itens?pagina=1&tamanhoPagina=100',
    );
    expect(r.confirmadas).toEqual(['demanda_publica']);
    // O homologado — o que o órgão pagou —, e não o estimado.
    expect(r.achados[0]?.oQue).toContain(`mediano de ${brl(49.5)}`);
    expect(r.achados[0]?.origemUrl).toBe('https://pncp.gov.br/app/editais/00394460005887/2026/12');
  });

  it('sem compra pública, a hipótese cai; sem conseguir olhar, ela fica aberta', async () => {
    const vazio: SensorDePncp = {
      nome: 'falso',
      estadoDaConsulta: () => ({ tipo: 'presumido', modo: 'm2_publico' }),
      consultar: () => Promise.resolve([]),
    };
    const fora: SensorDePncp = { ...vazio, consultar: () => Promise.reject(new Error('503')) };

    const semDemanda = await new InvestigadorDeDemandaPublica(vazio).investigar(
      pedido('demanda_publica', 'pncp', 'refil'),
    );
    const semOlhar = await new InvestigadorDeDemandaPublica(fora).investigar(
      pedido('demanda_publica', 'pncp', 'refil'),
    );

    expect(semDemanda.descartadas).toEqual(['demanda_publica']);
    expect(semOlhar.descartadas).toBeUndefined();
    expect(semOlhar.achados).toEqual([]);
  });
});
