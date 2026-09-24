import { describe, expect, it } from 'vitest';
import {
  EXEMPLOS_DE_NOME_DE_EXPORTACAO,
  LIMIAR_CLASSIFICACAO_CONFIAVEL,
  TIPOS_DE_ENTRADA,
  classificar,
  ehConfiavel,
  ehUrlValida,
  entradaDeTextoLivre,
  exigeLlm,
  extrairUrls,
  siteDaUrl,
} from './classificador';

const url = (valor: string) => classificar({ tipo: 'url', valor });
const texto = (valor: string) => classificar({ tipo: 'texto', valor });
const arquivo = (nome: string, tipoMime?: string) =>
  classificar(
    tipoMime === undefined ? { tipo: 'arquivo', nome } : { tipo: 'arquivo', nome, tipoMime },
  );

describe('reconhecimento de site', () => {
  it('reconhece as três plataformas e as fontes de custo de origem', () => {
    expect(siteDaUrl('https://produto.mercadolivre.com.br/MLB-123456789-refil')).toBe('ml');
    expect(siteDaUrl('https://shopee.com.br/produto-i.123.456')).toBe('shopee');
    expect(siteDaUrl('https://www.amazon.com.br/dp/B0ABCDEFGH')).toBe('amazon');
    expect(siteDaUrl('https://pt.aliexpress.com/item/100500.html')).toBe('aliexpress');
    expect(siteDaUrl('https://detail.1688.com/offer/123.html')).toBe('1688');
    expect(siteDaUrl('https://www.alibaba.com/product-detail/x.html')).toBe('alibaba');
  });

  it('devolve null para site de distribuidor qualquer', () => {
    expect(siteDaUrl('https://distribuidoraexemplo.com.br/catalogo')).toBeNull();
  });

  it('não confunde domínio que apenas contém o nome da plataforma', () => {
    // `mercadolivre.com.br.phishing.com` não é o Mercado Livre.
    expect(siteDaUrl('https://mercadolivre.com.br.exemplo.com/x')).toBeNull();
    expect(siteDaUrl('https://naoeamazon.com/dp/B0ABCDEFGH')).toBeNull();
  });

  it('aceita subdomínio legítimo', () => {
    expect(siteDaUrl('https://lista.mercadolivre.com.br/refil')).toBe('ml');
  });
});

describe('validação de URL', () => {
  it('aceita http e https', () => {
    expect(ehUrlValida('http://exemplo.com')).toBe(true);
    expect(ehUrlValida('https://exemplo.com')).toBe(true);
  });

  it('recusa esquema que não é http — a caixa recebe texto colado', () => {
    // Numa caixa que aceita qualquer coisa, `javascript:` e `file:` seriam
    // superfície de ataque, não entrada de ingestão.
    for (const ruim of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>',
      'ftp://exemplo.com',
    ]) {
      expect(ehUrlValida(ruim), ruim).toBe(false);
    }
  });

  it('recusa texto que não é URL', () => {
    expect(ehUrlValida('não é url')).toBe(false);
    expect(ehUrlValida('')).toBe(false);
  });
});

describe('URL de item vs listagem', () => {
  it('identifica item do ML com confiança máxima', () => {
    const c = url('https://produto.mercadolivre.com.br/MLB-1234567890-refil-purificador');
    expect(c.tipoDeEntrada).toBe('anuncio_marketplace');
    expect(c.site).toBe('ml');
    expect(c.confiancaBp).toBe(10_000);
  });

  it('identifica item de catálogo do ML', () => {
    const c = url('https://www.mercadolivre.com.br/p/MLB12345678');
    expect(c.tipoDeEntrada).toBe('anuncio_marketplace');
  });

  it('identifica item da Shopee pelo padrão -i.shop.item', () => {
    const c = url('https://shopee.com.br/Refil-Filtro-i.123456.7890123');
    expect(c.tipoDeEntrada).toBe('anuncio_marketplace');
    expect(c.site).toBe('shopee');
    expect(c.confiancaBp).toBe(10_000);
  });

  it('identifica item da Amazon pelo ASIN', () => {
    expect(url('https://www.amazon.com.br/dp/B0ABCDEFGH').tipoDeEntrada).toBe(
      'anuncio_marketplace',
    );
    expect(url('https://www.amazon.com.br/gp/product/B0ABCDEFGH').tipoDeEntrada).toBe(
      'anuncio_marketplace',
    );
  });

  it('identifica listagem e NÃO confunde com item', () => {
    // A distinção mais consequente: item devolve 1 produto_externo, listagem
    // devolve N e precisa paginar.
    const casos = [
      'https://lista.mercadolivre.com.br/refil-purificador',
      'https://shopee.com.br/search?keyword=refil',
      'https://www.amazon.com.br/s?k=refil+purificador',
    ];
    for (const caso of casos) {
      expect(url(caso).tipoDeEntrada, caso).toBe('listagem_categoria');
    }
  });

  it('site conhecido com caminho estranho cai em anúncio, com confiança reduzida', () => {
    // Formato novo da plataforma não deve virar erro: o custo de tentar é uma
    // extração que devolve pendente_revisao.
    const c = url('https://www.mercadolivre.com.br/formato-que-ainda-nao-existe');
    expect(c.tipoDeEntrada).toBe('anuncio_marketplace');
    expect(c.confiancaBp).toBeLessThan(10_000);
    expect(c.motivo).toContain('não');
  });
});

describe('URL de site desconhecido', () => {
  it('vira catálogo de distribuidor — o caso mais valioso do M1', () => {
    const c = url('https://distribuidoraexemplo.com.br/produtos/filtros');
    expect(c.tipoDeEntrada).toBe('catalogo_distribuidor');
    expect(c.site).toBeNull();
  });

  it('reconhece PDF, imagem e planilha pela extensão na URL', () => {
    expect(url('https://exemplo.com/tabela-precos.pdf').tipoDeEntrada).toBe('tabela_precos_pdf');
    expect(url('https://exemplo.com/tabela.jpg').tipoDeEntrada).toBe('imagem_tabela');
    expect(url('https://exemplo.com/lista.xlsx').tipoDeEntrada).toBe('planilha_generica');
  });
});

describe('arquivos', () => {
  it('reconhece exportação de plataforma pelo nome, e isso economiza LLM', () => {
    // Exportação tem mapeamento fixo de colunas: zero token.
    const casos: readonly [string, string][] = [
      ['meus-anuncios-mercado-livre.xlsx', 'ml'],
      ['MLB_minhas_vendas_2026.csv', 'ml'],
      ['shopee_mass_update.xlsx', 'shopee'],
      ['amazon-seller-central-report.csv', 'amazon'],
    ];
    for (const [nome, site] of casos) {
      const c = arquivo(nome);
      expect(c.tipoDeEntrada, nome).toBe('planilha_exportacao');
      expect(c.site, nome).toBe(site);
      expect(exigeLlm(c.tipoDeEntrada), nome).toBe(false);
    }
  });

  it('a loja dita pela área dela vence o nome do arquivo, e economiza LLM igual', () => {
    // O botão de importar da área da Shopee manda a loja: "Relatório (3).xlsx" não diz
    // nada, e sem a loja iria para planilha genérica — ou, pior, para revisão.
    const c = classificar({ tipo: 'arquivo', nome: 'Relatório (3).xlsx', loja: 'shopee' });
    expect(c.tipoDeEntrada).toBe('planilha_exportacao');
    expect(c.site).toBe('shopee');
    expect(exigeLlm(c.tipoDeEntrada)).toBe(false);

    const errado = classificar({ tipo: 'arquivo', nome: 'amazon-report.csv', loja: 'ml' });
    expect(errado.site).toBe('ml');
  });

  it('a loja dita não transforma PDF nem imagem em planilha', () => {
    const c = classificar({ tipo: 'arquivo', nome: 'tabela.pdf', loja: 'shopee' });
    expect(c.tipoDeEntrada).toBe('tabela_precos_pdf');
  });

  it('planilha sem pista de plataforma é genérica e precisa de LLM', () => {
    const c = arquivo('tabela do fornecedor.xlsx');
    expect(c.tipoDeEntrada).toBe('planilha_generica');
    expect(c.site).toBeNull();
    expect(exigeLlm(c.tipoDeEntrada)).toBe(true);
  });

  it('classifica por MIME quando a extensão falta', () => {
    expect(arquivo('sem-extensao', 'application/pdf').tipoDeEntrada).toBe('tabela_precos_pdf');
    expect(arquivo('sem-extensao', 'image/jpeg').tipoDeEntrada).toBe('imagem_tabela');
    expect(arquivo('sem-extensao', 'text/csv').tipoDeEntrada).toBe('planilha_generica');
    expect(arquivo('sem-extensao', 'text/plain').tipoDeEntrada).toBe('texto_colado');
  });

  it('imagem vira extração por visão — foto de tabela é comum de verdade', () => {
    const c = arquivo('WhatsApp Image 2026-09-12.jpeg');
    expect(c.tipoDeEntrada).toBe('imagem_tabela');
    expect(c.motivo).toContain('visão');
  });

  it('formato não suportado vira desconhecido, nunca exceção', () => {
    const c = arquivo('video.mp4');
    expect(c.tipoDeEntrada).toBe('desconhecido');
    expect(c.confiancaBp).toBe(0);
    expect(ehConfiavel(c)).toBe(false);
  });

  it('arquivo sem extensão nem MIME diz isso no motivo', () => {
    const c = arquivo('arquivo');
    expect(c.tipoDeEntrada).toBe('desconhecido');
    expect(c.motivo).toContain('sem extensão');
  });

  it('é indiferente à caixa da extensão', () => {
    expect(arquivo('TABELA.XLSX').tipoDeEntrada).toBe('planilha_generica');
    expect(arquivo('FOTO.JPG').tipoDeEntrada).toBe('imagem_tabela');
  });

  it('cada exemplo de nome que a mensagem sugere é de fato reconhecido', () => {
    // A mensagem de revisão de planilha genérica manda renomear e dá exemplos. Se um
    // exemplo não casar com nenhuma pista, o sistema manda a pessoa fazer uma coisa
    // que não funciona — e ninguém descobre até acontecer.
    expect(EXEMPLOS_DE_NOME_DE_EXPORTACAO.length).toBeGreaterThan(0);
    for (const nome of EXEMPLOS_DE_NOME_DE_EXPORTACAO) {
      const c = arquivo(nome);
      expect(c.tipoDeEntrada, nome).toBe('planilha_exportacao');
      expect(c.site, nome).not.toBeNull();
    }
  });
});

describe('texto colado', () => {
  it('uma URL sozinha é tratada como URL, não como texto', () => {
    const c = texto('  https://produto.mercadolivre.com.br/MLB-1234567890-refil  ');
    expect(c.tipoDeEntrada).toBe('anuncio_marketplace');
    expect(c.site).toBe('ml');
  });

  it('várias URLs viram lista de links, para render N jobs', () => {
    const c = texto(`
      https://produto.mercadolivre.com.br/MLB-111111111-a
      https://produto.mercadolivre.com.br/MLB-222222222-b
      https://shopee.com.br/c-i.1.2
    `);
    expect(c.tipoDeEntrada).toBe('lista_de_links');
    expect(c.urls).toHaveLength(3);
    expect(exigeLlm(c.tipoDeEntrada)).toBe(false);
  });

  it('texto com tabela colada vira planilha', () => {
    const c = texto(
      [
        'Codigo;Descricao;Preco',
        'EF-21;Refil PA21G;28,90',
        'EF-26;Refil PA26G;31,50',
        'EF-31;Refil PA31G;33,00',
      ].join('\n'),
    );
    expect(c.tipoDeEntrada).toBe('planilha_generica');
    expect(c.motivo).toContain('tabela');
  });

  it('reconhece tabela separada por tabulação', () => {
    const c = texto(['A\tB\tC', '1\t2\t3', '4\t5\t6', '7\t8\t9'].join('\n'));
    expect(c.tipoDeEntrada).toBe('planilha_generica');
  });

  it('prosa NÃO é confundida com tabela', () => {
    // Falso positivo gastaria extração de tabela em texto livre.
    const c = texto(
      'Olá, tenho interesse no refil do purificador. Vocês têm para o modelo PA26G? ' +
        'Preciso de umas dez unidades, e queria saber o prazo de postagem.',
    );
    expect(c.tipoDeEntrada).toBe('texto_colado');
  });

  it('duas linhas com vírgula não bastam para virar tabela', () => {
    const c = texto('Bom dia, tudo bem?\nTenho o refil, sim.');
    expect(c.tipoDeEntrada).toBe('texto_colado');
  });

  it('texto vazio vira desconhecido, não exceção', () => {
    for (const vazio of ['', '   ', '\n\n']) {
      const c = texto(vazio);
      expect(c.tipoDeEntrada).toBe('desconhecido');
      expect(c.confiancaBp).toBe(0);
    }
  });
});

describe('extrairUrls', () => {
  it('extrai e remove duplicata', () => {
    const urls = extrairUrls('veja https://a.com/x e https://a.com/x e https://b.com/y');
    expect(urls).toEqual(['https://a.com/x', 'https://b.com/y']);
  });

  it('remove pontuação colada no fim do link', () => {
    expect(extrairUrls('olha isso: https://exemplo.com/pagina.')).toEqual([
      'https://exemplo.com/pagina',
    ]);
    expect(extrairUrls('(https://exemplo.com/a) e https://exemplo.com/b,')).toEqual([
      'https://exemplo.com/a',
      'https://exemplo.com/b',
    ]);
  });

  it('devolve vazio quando não há link', () => {
    expect(extrairUrls('nenhum link aqui')).toEqual([]);
  });

  it('ignora esquema não-http', () => {
    expect(extrairUrls('javascript:alert(1) e file:///etc/passwd')).toEqual([]);
  });
});

describe('invariantes do classificador', () => {
  it('nunca lança, para nenhuma entrada', () => {
    const entradas = [
      { tipo: 'url' as const, valor: '' },
      { tipo: 'url' as const, valor: 'lixo://' },
      // Escapes, não bytes literais: fonte com caractere de controle vira
      // arquivo binário para o git e para o grep.
      { tipo: 'texto' as const, valor: '\u0000\u0001' },
      { tipo: 'arquivo' as const, nome: '' },
      { tipo: 'arquivo' as const, nome: '.' },
      { tipo: 'texto' as const, valor: 'x'.repeat(100_000) },
    ];
    for (const entrada of entradas) {
      expect(() => classificar(entrada)).not.toThrow();
    }
  });

  it('sempre devolve um tipo conhecido e confiança entre 0 e 10 000', () => {
    const entradas = [
      { tipo: 'url' as const, valor: 'https://produto.mercadolivre.com.br/MLB-1-a' },
      { tipo: 'url' as const, valor: 'https://qualquer.com/x' },
      { tipo: 'texto' as const, valor: 'texto qualquer' },
      { tipo: 'arquivo' as const, nome: 'x.xlsx' },
      { tipo: 'arquivo' as const, nome: 'x.zip' },
    ];
    for (const entrada of entradas) {
      const c = classificar(entrada);
      expect(TIPOS_DE_ENTRADA).toContain(c.tipoDeEntrada);
      expect(c.confiancaBp).toBeGreaterThanOrEqual(0);
      expect(c.confiancaBp).toBeLessThanOrEqual(10_000);
      expect(c.motivo.length).toBeGreaterThan(3);
    }
  });

  it('desconhecido nunca é confiável, e o resto que passa do limiar é', () => {
    expect(
      ehConfiavel({ tipoDeEntrada: 'desconhecido', site: null, confiancaBp: 0, motivo: 'x' }),
    ).toBe(false);
    expect(
      ehConfiavel({
        tipoDeEntrada: 'anuncio_marketplace',
        site: 'ml',
        confiancaBp: LIMIAR_CLASSIFICACAO_CONFIAVEL,
        motivo: 'x',
      }),
    ).toBe(true);
  });

  it('exigeLlm cobre todo tipo de entrada sem cair em caso não tratado', () => {
    for (const tipo of TIPOS_DE_ENTRADA) {
      expect(typeof exigeLlm(tipo), tipo).toBe('boolean');
    }
  });

  it('os tipos que não exigem LLM são exatamente os determinísticos', () => {
    const semLlm = TIPOS_DE_ENTRADA.filter((t) => !exigeLlm(t));
    expect([...semLlm].sort()).toEqual(
      ['desconhecido', 'lista_de_links', 'planilha_exportacao'].sort(),
    );
  });
});

describe('URL com espaço em branco no meio', () => {
  /**
   * Regressão de uma armadilha do próprio padrão da web.
   *
   * `new URL()` **remove** tabulação e quebra de linha em vez de recusar, então
   * duas URLs colocadas uma por linha viravam uma URL só, válida e sem sentido:
   * `https://a.com` + `https://b.com` dava `https://a.comhttps//b.com`. Numa caixa
   * que aceita texto colado, colar duas linhas é o caso comum.
   */
  it('recusa duas URLs coladas por quebra de linha', () => {
    const duas = [
      'https://produto.mercadolivre.com.br/MLB-111111',
      'https://shopee.com.br/x-i.1.2',
    ];

    expect(ehUrlValida(duas.join(String.fromCharCode(10)))).toBe(false);
    expect(ehUrlValida(duas.join(String.fromCharCode(13, 10)))).toBe(false);
    expect(ehUrlValida(duas.join(String.fromCharCode(9)))).toBe(false);
  });

  it('recusa URL com espaço no meio, e aceita com espaço em volta', () => {
    expect(ehUrlValida('https://exemplo.com/a b')).toBe(false);
    expect(ehUrlValida('  https://exemplo.com/a  ')).toBe(true);
  });

  it('lista de links continua sendo reconhecida como lista', () => {
    const duas = [
      'https://produto.mercadolivre.com.br/MLB-111111111-a',
      'https://produto.mercadolivre.com.br/MLB-222222222-b',
    ].join(String.fromCharCode(10));

    const c = texto(duas);
    expect(c.tipoDeEntrada).toBe('lista_de_links');
    expect(c.urls).toHaveLength(2);
  });
});

describe('entradaDeTextoLivre', () => {
  it('URL sozinha vira entrada de URL', () => {
    expect(entradaDeTextoLivre('  https://produto.mercadolivre.com.br/MLB-123456  ')).toEqual({
      tipo: 'url',
      valor: 'https://produto.mercadolivre.com.br/MLB-123456',
    });
  });

  it('duas URLs viram texto, para o classificador abrir um job por link', () => {
    const duas = [
      'https://produto.mercadolivre.com.br/MLB-111111111-a',
      'https://produto.mercadolivre.com.br/MLB-222222222-b',
    ].join(String.fromCharCode(10));

    const entrada = entradaDeTextoLivre(duas);
    expect(entrada.tipo).toBe('texto');
    expect(classificar(entrada).tipoDeEntrada).toBe('lista_de_links');
  });

  it('texto comum vira entrada de texto', () => {
    expect(entradaDeTextoLivre('refil de purificador consul')).toEqual({
      tipo: 'texto',
      valor: 'refil de purificador consul',
    });
  });

  it('protocolo que não é http(s) não passa como URL', () => {
    expect(entradaDeTextoLivre('javascript:alert(1)').tipo).toBe('texto');
    expect(entradaDeTextoLivre('file:///etc/passwd').tipo).toBe('texto');
  });
});
