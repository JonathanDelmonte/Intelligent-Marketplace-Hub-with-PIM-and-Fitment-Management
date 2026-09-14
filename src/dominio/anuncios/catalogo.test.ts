import { describe, expect, it } from 'vitest';
import {
  PRESENCAS,
  VENDEDORES_QUE_SUGEREM_FICHA,
  avaliarCatalogoML,
  type OcorrenciaParaCatalogo,
} from './catalogo';

const FICHA = 'https://www.mercadolivre.com.br/p/MLB12345678';
const ANUNCIO = 'https://produto.mercadolivre.com.br/MLB-1234567890-refil';

const oco = (campos: Partial<OcorrenciaParaCatalogo> = {}): OcorrenciaParaCatalogo => ({
  plataformaOuSite: 'ml',
  url: ANUNCIO,
  vendedor: 'loja-a',
  ean: '7896541200909',
  ...campos,
});

/** N ocorrências de ML, cada uma de um vendedor diferente. */
const vendedores = (n: number): OcorrenciaParaCatalogo[] =>
  Array.from({ length: n }, (_, i) => oco({ vendedor: `loja-${i}` }));

describe('avaliarCatalogoML', () => {
  it('sem sinal não inventa alerta, e não devolve caixa vazia para a tela', () => {
    const r = avaliarCatalogoML([oco()]);
    expect(r.presenca).toBe('sem_sinal');
    expect(r.mensagem).toBeNull();
    expect(r.sinais).toEqual([]);
  });

  it('URL de ficha confirma, mesmo com um vendedor só', () => {
    // Estrutural: `/p/MLB…` é a ficha de catálogo, `/MLB-…` é anúncio de vendedor.
    const r = avaliarCatalogoML([oco({ url: FICHA })]);
    expect(r.presenca).toBe('confirmada');
    expect(r.sinais).toEqual(['url_de_ficha']);
  });

  it('anúncio comum de vendedor não é confundido com ficha', () => {
    expect(avaliarCatalogoML([oco({ url: ANUNCIO })]).presenca).toBe('sem_sinal');
  });

  it('muitos vendedores no mesmo GTIN sugere, mas nunca confirma', () => {
    // Sinal fraco informa e não decide — a mesma disciplina da evidência da fase 6.
    const r = avaliarCatalogoML(vendedores(VENDEDORES_QUE_SUGEREM_FICHA));
    expect(r.presenca).toBe('provavel');
    expect(r.sinais).toEqual(['muitos_vendedores']);
    expect(r.mensagem).toContain('Confirme');
  });

  it('um vendedor abaixo do corte não acende o sinal fraco', () => {
    const r = avaliarCatalogoML(vendedores(VENDEDORES_QUE_SUGEREM_FICHA - 1));
    expect(r.presenca).toBe('sem_sinal');
  });

  it('o mesmo vendedor em vários anúncios conta uma vez', () => {
    // Senão um vendedor com quatro anúncios do mesmo refil acenderia o alerta.
    const r = avaliarCatalogoML([
      oco({ vendedor: 'Loja A' }),
      oco({ vendedor: 'loja a ' }),
      oco({ vendedor: 'LOJA A' }),
      oco({ vendedor: 'loja a' }),
    ]);
    expect(r.vendedoresNoMl).toBe(1);
    expect(r.presenca).toBe('sem_sinal');
  });

  it('ocorrência de outra plataforma não entra na conta', () => {
    const r = avaliarCatalogoML([
      oco({ plataformaOuSite: 'shopee', url: 'https://shopee.com.br/x-i.1.2', vendedor: 'a' }),
      oco({
        plataformaOuSite: 'amazon',
        url: 'https://amazon.com.br/dp/B012345678',
        vendedor: 'b',
      }),
      oco({ plataformaOuSite: 'ml', vendedor: 'c' }),
    ]);
    expect(r.vendedoresNoMl).toBe(1);
  });

  it('reconhece ML pela URL quando a plataforma não está preenchida', () => {
    // Ocorrência capturada por link colado nem sempre tem `plataforma_ou_site`.
    const r = avaliarCatalogoML([oco({ plataformaOuSite: null, url: FICHA })]);
    expect(r.presenca).toBe('confirmada');
  });

  it('vendedor sem nome não conta como vendedor distinto', () => {
    const r = avaliarCatalogoML([
      oco({ vendedor: null }),
      oco({ vendedor: '  ' }),
      oco({ vendedor: 'loja-a' }),
    ]);
    expect(r.vendedoresNoMl).toBe(1);
  });

  it('o mesmo fato muda de sinal conforme a reputação de quem lê', () => {
    const verde = avaliarCatalogoML([oco({ url: FICHA })], 'verde');
    const abaixo = avaliarCatalogoML([oco({ url: FICHA })], 'abaixo_de_verde');

    expect(verde.presenca).toBe(abaixo.presenca);
    // Para quem tem verde, ficha é oportunidade: disputa o destaque.
    expect(verde.severidade).toBe('informativo');
    expect(verde.mensagem).toContain('a favor');
    // Para quem não tem, é o aviso mais duro que este módulo dá.
    expect(abaixo.severidade).toBe('vermelho');
    expect(abaixo.mensagem).toContain('outras opções de compra');
  });

  it('reputação não informada avisa no condicional, sem chutar que é ruim', () => {
    // Chutar "ruim" para todo mundo faria o alerta virar ruído que se aprende a
    // ignorar, e é o fim de qualquer alerta.
    const r = avaliarCatalogoML([oco({ url: FICHA })]);
    expect(r.severidade).toBe('amarelo');
    expect(r.mensagem).toContain('Se a sua conta');
  });

  it('sinal provável sem reputação verde é amarelo, não vermelho', () => {
    // Vermelho é para o que se sabe. Indício não gasta a cor mais forte.
    const r = avaliarCatalogoML(vendedores(VENDEDORES_QUE_SUGEREM_FICHA), 'abaixo_de_verde');
    expect(r.severidade).toBe('amarelo');
  });

  it('lista vazia não quebra e não alerta', () => {
    const r = avaliarCatalogoML([]);
    expect(r.presenca).toBe('sem_sinal');
    expect(r.vendedoresNoMl).toBe(0);
  });

  it('todo veredito declarado é alcançável', () => {
    const vistos = new Set(
      [
        avaliarCatalogoML([oco({ url: FICHA })]),
        avaliarCatalogoML(vendedores(VENDEDORES_QUE_SUGEREM_FICHA)),
        avaliarCatalogoML([oco()]),
      ].map((r) => r.presenca),
    );
    expect([...PRESENCAS].filter((p) => !vistos.has(p))).toEqual([]);
  });
});
