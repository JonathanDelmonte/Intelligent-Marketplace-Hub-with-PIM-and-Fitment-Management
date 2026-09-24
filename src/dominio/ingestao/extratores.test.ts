import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  enderecoCanonico,
  extrairDaPagina,
  linhasDeCatalogo,
  paginaBloqueada,
  tituloSemSite,
} from './extratores';

const AGORA = new Date('2026-09-24T12:00:00Z');

describe('tituloSemSite', () => {
  it('tira o nome do site do fim, e só quando sobra título', () => {
    expect(tituloSemSite('Refil PA21G Electrolux | Mercado Livre')).toBe('Refil PA21G Electrolux');
    expect(tituloSemSite('Refil Electrolux - Loja Filtros')).toBe('Refil Electrolux');
    expect(tituloSemSite('EF-ELX-21 Elemento filtrante')).toBe('EF-ELX-21 Elemento filtrante');
    expect(tituloSemSite('PA21G | ML')).toBe('PA21G | ML');
  });
});

describe('enderecoCanonico', () => {
  it('sem rastreio e sem âncora: o mesmo anúncio colado de dois lugares é o mesmo', () => {
    expect(enderecoCanonico('https://loja.com.br/p/refil?utm_source=zap#fotos')).toBe(
      'https://loja.com.br/p/refil',
    );
  });
});

describe('paginaBloqueada', () => {
  it('reconhece a página de robô e de login', () => {
    expect(paginaBloqueada('Captcha', '')).toBe(true);
    expect(paginaBloqueada(null, '<p>Access denied</p>')).toBe(true);
    expect(paginaBloqueada('Refil PA21G', '<p>Em estoque</p>')).toBe(false);
  });
});

describe('extrairDaPagina', () => {
  const catalogo = `<title>Catálogo | Distribuidora</title>
<script type="application/ld+json">[
 {"@type":"Product","name":"Refil PA21G","offers":{"price":"38.00","priceCurrency":"BRL"}},
 {"@type":"Product","name":"Refil PE11B","gtin13":"7896541200000","offers":{"price":"42.00","priceCurrency":"BRL"}}
]</script>`;

  it('catálogo com vários produtos declarados vira uma captura por produto', () => {
    const r = extrairDaPagina({
      html: catalogo,
      url: 'https://distribuidora.com.br/refis',
      site: null,
      coletadoEm: AGORA,
      anuncio: false,
    });
    if (r.tipo !== 'capturas') throw new Error('esperava capturas');
    expect(r.capturas.map((c) => [c.tituloBruto, c.precoReais])).toEqual([
      ['Refil PA21G', 38],
      ['Refil PE11B', 42],
    ]);
    // GTIN que não confere não vai para a coluna, e fica guardado no atributo.
    expect(r.capturas[1]?.ean).toBeUndefined();
    expect(r.capturas[1]?.atributos).toMatchObject({ eanInvalido: '7896541200000' });
    expect(r.capturas[0]?.plataformaOuSite).toBe('distribuidora.com.br');
  });

  it('anúncio sem dado estruturado cai no título, sem preço inventado', () => {
    const r = extrairDaPagina({
      html: '<title>Refil PA21G original | Loja</title><p>12x de R$ 8,33 ou R$ 99,90</p>',
      url: 'https://loja.com.br/refil',
      site: null,
      coletadoEm: AGORA,
      anuncio: true,
    });
    if (r.tipo !== 'capturas') throw new Error('esperava capturas');
    expect(r.capturas[0]).toMatchObject({ tituloBruto: 'Refil PA21G original', precoReais: null });
  });

  it('catálogo sem produto declarado vai para revisão, dizendo o que colar', () => {
    const r = extrairDaPagina({
      html: '<title>Distribuidora</title><p>Bem-vindo</p>',
      url: 'https://distribuidora.com.br/',
      site: null,
      coletadoEm: AGORA,
      anuncio: false,
    });
    expect(r.tipo === 'revisao' && r.motivo).toContain('cole o texto da tabela');
  });
});

describe('linhasDeCatalogo', () => {
  it('lê preço com R$ ou no fim, e tira os separadores do título', () => {
    expect(
      linhasDeCatalogo(
        ['PA21G;Refil purificador;38,00', 'Refil PE11B\t42,90', 'Kit 2 refis — R$ 1.299,00'].join(
          '\n',
        ),
      ),
    ).toEqual([
      { titulo: 'PA21G - Refil purificador', preco: reaisParaCentavos(38) },
      { titulo: 'Refil PE11B', preco: reaisParaCentavos(42.9) },
      { titulo: 'Kit 2 refis', preco: reaisParaCentavos(1299) },
    ]);
  });

  it('linha sem preço só fica com código de peça próprio; condição de pagamento sai', () => {
    expect(linhasDeCatalogo('Vedação VD-10\nPagamento à vista ou 30 dias\nObrigado!')).toEqual([
      { titulo: 'Vedação VD-10', preco: null },
    ]);
  });

  it('a mesma linha repetida entra uma vez', () => {
    expect(linhasDeCatalogo('Refil PA21G - 38,00\nRefil PA21G - 38,00')).toHaveLength(1);
  });
});
