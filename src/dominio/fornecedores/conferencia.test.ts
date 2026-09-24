import { describe, expect, it } from 'vitest';
import {
  achouLojaPropria,
  classificarResultado,
  conferirFornecedor,
  ehPaginaDeLoja,
  lerConferencia,
  nomeDeBusca,
  nomeIdentifica,
  nomeParaConferir,
  precisaDeConferencia,
  vitrineConcluida,
  type Conferencia,
} from './conferencia';

const AGORA = new Date('2026-09-24T12:00:00Z');

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

const html = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A página de resultados do buscador, com os resultados dados. */
function resultados(itens: readonly { titulo: string; url: string; trecho?: string }[]): string {
  return itens
    .map(
      (r) => `<div class="result"><h2 class="result__title"><a class="result__a"
 href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&amp;rut=x">${r.titulo}</a></h2>
 <a class="result__snippet">${r.trecho ?? ''}</a></div>`,
    )
    .join('\n');
}

const CADASTRO = {
  razao_social: 'ACME COMERCIO DE PECAS LTDA',
  nome_fantasia: 'ACME PECAS',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2015-03-12',
  cnae_fiscal_descricao: 'Comércio atacadista de peças e acessórios',
  cnaes_secundarios: [],
  municipio: 'CURITIBA',
  uf: 'PR',
};

const semPausa = () => Promise.resolve();

describe('o nome', () => {
  it('tira forma societária para buscar, e ramo para achar o núcleo', () => {
    expect(nomeDeBusca('Acme Distribuidora Ltda.')).toBe('Acme Distribuidora');
    expect(nomeDeBusca('Acme Comércio e Importação Eireli - ME')).toBe(
      'Acme Comércio e Importação',
    );
    expect(nomeDeBusca('Leve-me Store S/A')).toBe('Leve-me Store');

    expect(nomeParaConferir('Acme Distribuidora de Peças LTDA')).toEqual({
      inteiro: ['acme', 'distribuidora', 'pecas'],
      nucleo: ['acme', 'pecas'],
    });
  });

  it('nome só de ramo, ou curto demais, não identifica ninguém', () => {
    expect(nomeIdentifica(nomeParaConferir('Distribuidora Brasil'))).toBe(false);
    expect(nomeIdentifica(nomeParaConferir('MK'))).toBe(false);
    expect(nomeIdentifica(nomeParaConferir('Acme'))).toBe(true);
  });
});

describe('ehPaginaDeLoja', () => {
  it('reconhece loja e perfil, e recusa anúncio, busca e categoria', () => {
    expect(ehPaginaDeLoja('https://www.mercadolivre.com.br/loja/acme', 'ml')).toBe(true);
    expect(ehPaginaDeLoja('https://perfil.mercadolivre.com.br/ACMEPECAS', 'ml')).toBe(true);
    expect(ehPaginaDeLoja('https://lista.mercadolivre.com.br/_CustId_123456', 'ml')).toBe(true);
    expect(ehPaginaDeLoja('https://produto.mercadolivre.com.br/MLB-123456789-refil', 'ml')).toBe(
      false,
    );

    expect(ehPaginaDeLoja('https://shopee.com.br/acmepecas', 'shopee')).toBe(true);
    expect(ehPaginaDeLoja('https://shopee.com.br/shop/123456', 'shopee')).toBe(true);
    expect(ehPaginaDeLoja('https://shopee.com.br/Refil-Acme-i.123.456', 'shopee')).toBe(false);
    expect(ehPaginaDeLoja('https://shopee.com.br/Casa-cat.11059983', 'shopee')).toBe(false);
    expect(ehPaginaDeLoja('https://shopee.com.br/search', 'shopee')).toBe(false);

    expect(ehPaginaDeLoja('https://www.amazon.com.br/stores/Acme/page/ABC', 'amazon')).toBe(true);
    expect(ehPaginaDeLoja('https://www.amazon.com.br/sp?seller=A1B2C3', 'amazon')).toBe(true);
    expect(ehPaginaDeLoja('https://www.amazon.com.br/s?me=A1B2C3', 'amazon')).toBe(true);
    expect(ehPaginaDeLoja('https://www.amazon.com.br/dp/B0ABCDEFGH', 'amazon')).toBe(false);
  });
});

describe('classificarResultado', () => {
  const acme = [nomeParaConferir('Acme Distribuidora')];

  it('loja com o nome inteiro responde; loja só com o núcleo é indício', () => {
    expect(
      classificarResultado(
        {
          titulo: 'Acme Distribuidora | Mercado Livre',
          url: 'https://www.mercadolivre.com.br/loja/acme-distribuidora',
          trecho: '',
        },
        acme,
      ),
    ).toEqual({ plataforma: 'ml', tipo: 'loja' });

    expect(
      classificarResultado(
        { titulo: 'ACME | Loja oficial', url: 'https://shopee.com.br/acme_oficial', trecho: '' },
        acme,
      ),
    ).toEqual({ plataforma: 'shopee', tipo: 'indicio' });
  });

  it('o nome inteiro também casa pelo endereço da loja', () => {
    expect(
      classificarResultado(
        { titulo: 'Loja no Shopee', url: 'https://shopee.com.br/acmedistribuidora', trecho: '' },
        acme,
      )?.tipo,
    ).toBe('loja');
  });

  it('anúncio que cita o nome é indício: pode ser a marca que outros revendem', () => {
    expect(
      classificarResultado(
        {
          titulo: 'Refil Acme Distribuidora PA21G',
          url: 'https://produto.mercadolivre.com.br/MLB-123456789-refil',
          trecho: '',
        },
        acme,
      )?.tipo,
    ).toBe('indicio');
  });

  it('palavra dentro de outra não casa, e site fora das vitrines não conta', () => {
    expect(
      classificarResultado(
        { titulo: 'Acmeflex', url: 'https://www.mercadolivre.com.br/loja/acmeflex', trecho: '' },
        [nomeParaConferir('Acme')],
      ),
    ).toBeNull();
    expect(
      classificarResultado(
        { titulo: 'Acme Distribuidora', url: 'https://acme.com.br/', trecho: '' },
        acme,
      ),
    ).toBeNull();
  });

  it('nome que não identifica ninguém nunca responde, nem em página de loja', () => {
    const generico = [nomeParaConferir('Distribuidora Brasil')];
    expect(
      classificarResultado(
        {
          titulo: 'Distribuidora Brasil',
          url: 'https://www.mercadolivre.com.br/loja/distribuidora-brasil',
          trecho: '',
        },
        generico,
      )?.tipo,
    ).toBe('indicio');
  });
});

describe('conferirFornecedor', () => {
  it('confere o CNPJ e para na primeira loja própria, com o nome fantasia da Receita', async () => {
    const { buscar, pedidos } = rede((url) => {
      if (url.includes('brasilapi')) return json(CADASTRO);
      if (url.includes('mercadolivre')) {
        return html(
          resultados([
            {
              titulo: 'Refil Acme original',
              url: 'https://produto.mercadolivre.com.br/MLB-111111111-refil',
            },
            {
              titulo: 'Perfil de ACME PECAS',
              url: 'https://perfil.mercadolivre.com.br/ACMEPECAS',
            },
          ]),
        );
      }
      return html(resultados([]));
    });

    const conferencia = await conferirFornecedor(
      { nome: 'Acme', cnpj: '11.222.333/0001-81' },
      { buscador: { buscar }, receita: { buscar }, pausa: semPausa, agora: () => AGORA },
    );

    expect(conferencia.cadastro).toMatchObject({
      tipo: 'encontrado',
      ativo: true,
      atacadista: true,
      nome: 'ACME PECAS',
    });
    // "Perfil de ACME PECAS" casa com o nome fantasia inteiro; o anúncio é só indício.
    expect(conferencia.vitrine.lojas).toEqual([
      {
        plataforma: 'ml',
        titulo: 'Perfil de ACME PECAS',
        url: 'https://perfil.mercadolivre.com.br/ACMEPECAS',
      },
    ]);
    expect(conferencia.vitrine.indicios).toHaveLength(1);
    // Achou no Mercado Livre: não pergunta à Shopee nem à Amazon.
    expect(pedidos.filter((u) => u.includes('duckduckgo'))).toHaveLength(1);
    expect(achouLojaPropria(conferencia)).toBe(true);
    expect(vitrineConcluida(conferencia)).toBe(true);
    expect(conferencia.em).toBe(AGORA.toISOString());
  });

  it('sem nada achado, confere as três vitrines — e não responde "não"', async () => {
    const { buscar, pedidos } = rede(() => html(resultados([])));
    const conferencia = await conferirFornecedor(
      { nome: 'Acme Distribuidora LTDA', cnpj: null },
      { buscador: { buscar }, pausa: semPausa, agora: () => AGORA },
    );

    expect(conferencia.cadastro).toEqual({ tipo: 'sem_documento' });
    expect(conferencia.vitrine).toMatchObject({
      buscadoComo: 'Acme Distribuidora',
      conferidas: ['ml', 'shopee', 'amazon'],
      lojas: [],
      falha: null,
    });
    expect(pedidos.map((u) => decodeURIComponent(u.replace(/\+/g, ' ')))).toEqual([
      expect.stringContaining('Acme Distribuidora site:mercadolivre.com.br'),
      expect.stringContaining('site:shopee.com.br'),
      expect.stringContaining('site:amazon.com.br'),
    ]);
    expect(achouLojaPropria(conferencia)).toBe(false);
    expect(vitrineConcluida(conferencia)).toBe(true);
  });

  it('buscador que recusa no meio não perde o que já conferiu', async () => {
    const { buscar } = rede((url) =>
      url.includes('shopee') ? html('', 202) : html(resultados([])),
    );
    const conferencia = await conferirFornecedor(
      { nome: 'Acme', cnpj: null },
      { buscador: { buscar }, pausa: semPausa },
    );

    expect(conferencia.vitrine.conferidas).toEqual(['ml']);
    expect(conferencia.vitrine.falha).toContain('pausa');
    expect(vitrineConcluida(conferencia)).toBe(false);
  });

  it('CNPJ com dígito errado, CPF e CNPJ desconhecido: cada um com o seu registro', async () => {
    const { buscar, pedidos } = rede((url) =>
      url.includes('brasilapi') ? json({ message: 'não encontrado' }, 404) : html(resultados([])),
    );
    const opcoes = { buscador: { buscar }, receita: { buscar }, pausa: semPausa };

    const errado = await conferirFornecedor({ nome: 'Acme', cnpj: '11.222.333/0001-82' }, opcoes);
    expect(errado.cadastro).toMatchObject({ tipo: 'invalido' });

    const cpf = await conferirFornecedor({ nome: 'Acme', cnpj: '529.982.247-25' }, opcoes);
    expect(cpf.cadastro).toEqual({ tipo: 'cpf' });

    // Só o CNPJ válido chega à Receita.
    expect(pedidos.filter((u) => u.includes('brasilapi'))).toHaveLength(0);
    const desconhecido = await conferirFornecedor(
      { nome: 'Acme', cnpj: '11.222.333/0001-81' },
      opcoes,
    );
    expect(desconhecido.cadastro).toMatchObject({ tipo: 'inexistente' });
    expect(desconhecido.cadastro.tipo === 'inexistente' && desconhecido.cadastro.frase).toContain(
      'não consta',
    );
  });

  it('Receita fora do ar é falha registrada, e a vitrine segue', async () => {
    const { buscar } = rede((url) =>
      url.includes('brasilapi') ? json({}, 503) : html(resultados([])),
    );
    const conferencia = await conferirFornecedor(
      { nome: 'Acme', cnpj: '11.222.333/0001-81' },
      { buscador: { buscar }, receita: { buscar }, pausa: semPausa },
    );
    expect(conferencia.cadastro).toMatchObject({ tipo: 'falhou' });
    expect(conferencia.vitrine.conferidas).toHaveLength(3);
  });
});

describe('lerConferencia', () => {
  it('lê a gravada, e devolve nulo para forma antiga em vez de quebrar a tela', async () => {
    const { buscar } = rede(() => html(resultados([])));
    const conferencia = await conferirFornecedor(
      { nome: 'Acme', cnpj: null },
      { buscador: { buscar }, pausa: semPausa, agora: () => AGORA },
    );
    expect(lerConferencia(JSON.parse(JSON.stringify(conferencia)))).toEqual(conferencia);
    expect(lerConferencia({ em: 'ontem' })).toBeNull();
    expect(lerConferencia(null)).toBeNull();
  });
});

describe('precisaDeConferencia', () => {
  const HORA = 60 * 60 * 1000;
  const feita = (horasAtras: number, completa: boolean): Conferencia => ({
    em: new Date(AGORA.getTime() - horasAtras * HORA).toISOString(),
    cadastro: { tipo: 'sem_documento' },
    vitrine: {
      buscadoComo: 'Acme',
      conferidas: completa ? ['ml', 'shopee', 'amazon'] : ['ml'],
      lojas: [],
      indicios: [],
      falha: completa ? null : 'o buscador pediu uma pausa',
    },
  });
  const fornecedor = (conferencia: Conferencia | null) => ({
    vendeDiretoMarketplace: null,
    vendeDiretoFonte: null,
    conferencia,
  });

  it('nunca conferido confere; completa vale noventa dias; incompleta, doze horas', () => {
    expect(precisaDeConferencia(fornecedor(null), AGORA)).toBe(true);
    expect(precisaDeConferencia(fornecedor(feita(24 * 89, true)), AGORA)).toBe(false);
    expect(precisaDeConferencia(fornecedor(feita(24 * 90, true)), AGORA)).toBe(true);
    expect(precisaDeConferencia(fornecedor(feita(11, false)), AGORA)).toBe(false);
    expect(precisaDeConferencia(fornecedor(feita(12, false)), AGORA)).toBe(true);
  });

  it('quem a pessoa já descartou não é conferido de novo', () => {
    expect(
      precisaDeConferencia(
        { vendeDiretoMarketplace: true, vendeDiretoFonte: 'manual', conferencia: null },
        AGORA,
      ),
    ).toBe(false);
    // Descartado pela própria conferência continua sendo conferido: a loja pode fechar.
    expect(
      precisaDeConferencia(
        { vendeDiretoMarketplace: true, vendeDiretoFonte: 'm0_link', conferencia: null },
        AGORA,
      ),
    ).toBe(true);
  });
});
