import { describe, expect, it } from 'vitest';
import { montarFicha, type CompatibilidadeParaFicha } from '@/dominio/compatibilidade/ficha';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP } from '@/dominio/compatibilidade/resolucao';
import type { Evidencia } from '@/dominio/compatibilidade/evidencia';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { montarAnuncio, type DadosDoProduto } from './anuncio';
import { gerarDescricao } from './descricao';

const evidencia: Evidencia = {
  tipo: 'manual_fabricante',
  url: 'https://exemplo.invalid/manual',
  trecho: null,
  em: '2026-09-01T00:00:00.000Z',
  negativa: false,
  forcaBp: null,
};

const compat = (modelo: string, confiancaBp = TOTAL_BP): CompatibilidadeParaFicha => ({
  decisao: 'serve',
  confiancaBp,
  conflito: null,
  evidencias: [evidencia],
  aparelho: {
    tipo: 'purificador de agua',
    marca: 'Electrolux',
    modelo,
    variante: null,
    familia: 'electrolux:pa21',
  },
});

const PRODUTO: DadosDoProduto = {
  tipoProduto: 'refil de purificador de água',
  marca: 'Electrolux',
  modeloPeca: 'EF-ELX-21',
  quantidadeEmbalagem: null,
  ean: '7896541200909',
  categoria: 'MLB1234',
  pesoGramas: 300,
  ficha: montarFicha([compat('PA21G'), compat('PA26G')]),
};

const montar = (campos: Partial<DadosDoProduto> = {}) =>
  montarAnuncio(
    { ...PRODUTO, ...campos },
    { plataforma: 'ml', preco: reaisParaCentavos(89.9), quantidade: 5 },
  );

describe('montarAnuncio', () => {
  it('avisa de categoria regulada antes de publicar, que é a hora que importa', () => {
    // Anúncio irregular de suplemento é cancelado. Descobrir depois custa a venda e
    // uma marca na conta, que é o ativo — então o alerta vive no único lugar por
    // onde tudo que vai ser publicado passa.
    const r = montar({ tipoProduto: 'suplemento de colágeno', tituloInterno: 'Colágeno 300g' });
    expect(r.regulacao.area).toBe('anvisa_suplemento');
    expect(r.avisos.join(' ')).toContain('ANVISA');
  });

  it('a marcação do SKU vence o palpite da palavra', () => {
    const r = montar({ tipoProduto: 'refil de purificador', categoriaRegulada: 'inmetro' });
    expect(r.regulacao.origem).toBe('marcado_no_sku');
    expect(r.avisos.join(' ')).toContain('INMETRO');
  });

  it('produto comum não ganha aviso de regulação', () => {
    const r = montar();
    expect(r.regulacao.mensagem).toBeNull();
    expect(r.avisos.join(' ')).not.toContain('ANVISA');
  });

  it('produz o objeto que o adaptador exporta', () => {
    const r = montar();
    expect(r.anuncio.tituloInterno).toContain('PA21G');
    expect(r.anuncio.preco).toBe(reaisParaCentavos(89.9));
    expect(r.anuncio.quantidade).toBe(5);
    expect(r.anuncio.ean).toBe('7896541200909');
  });

  it('só põe no título o que é publicável na ficha', () => {
    // Título é afirmação de compatibilidade na vitrine. Afirmar o que está abaixo
    // do corte é o caminho curto para a devolução que a fase 6 evita.
    const r = montar({
      ficha: montarFicha([compat('PA21G'), compat('PA26G', LIMIAR_PUBLICACAO_BP - 1)]),
    });
    expect(r.anuncio.tituloInterno).toContain('PA21G');
    expect(r.anuncio.tituloInterno).not.toContain('PA26G');
  });

  it('a descrição traz a tabela de compatibilidade', () => {
    const r = montar();
    expect(r.anuncio.descricao).toContain('Compatível com:');
    expect(r.anuncio.descricao).toContain('Electrolux PA21G');
  });

  it('descrição vazia vira nulo, não string vazia', () => {
    const r = montar({
      tipoProduto: '   promoção   ',
      marca: null,
      modeloPeca: null,
      ficha: montarFicha([]),
    });
    expect(r.anuncio.descricao).toBeNull();
  });

  it('avisa de cada campo que a importação exige e falta', () => {
    const r = montar({ ean: null, categoria: null, pesoGramas: null });
    const avisos = r.avisos.join(' ');
    expect(avisos).toContain('código de barras');
    expect(avisos).toContain('categoria');
    expect(avisos).toContain('peso');
  });

  it('avisa quando não há compatibilidade publicável', () => {
    const r = montar({ ficha: montarFicha([compat('PA21G', 100)]) });
    expect(r.avisos.join(' ')).toContain('sem tabela de compatibilidade');
  });

  it('repassa os avisos do título', () => {
    const r = montar({ tipoProduto: 'refil promoção de purificador' });
    expect(r.avisos.join(' ')).toContain('Tirei do título');
  });

  it('não decide preço: usa o que recebeu', () => {
    const r = montarAnuncio(PRODUTO, {
      plataforma: 'ml',
      preco: reaisParaCentavos(10),
      quantidade: 1,
    });
    expect(r.anuncio.preco).toBe(reaisParaCentavos(10));
  });

  it('quantidade zero avisa que o anúncio entra pausado', () => {
    const r = montarAnuncio(PRODUTO, {
      plataforma: 'ml',
      preco: reaisParaCentavos(50),
      quantidade: 0,
    });
    expect(r.avisos.join(' ')).toContain('pausado');
  });
});

describe('gerarDescricao', () => {
  const base = {
    tipoProduto: 'refil de purificador de água',
    marca: 'Electrolux',
    modeloPeca: 'EF-ELX-21',
    quantidadeEmbalagem: null,
    ficha: montarFicha([compat('PA21G')]),
  };

  it('identifica o produto antes da tabela', () => {
    const texto = gerarDescricao(base).texto;
    expect(texto.indexOf('refil de purificador')).toBeLessThan(texto.indexOf('Compatível com:'));
    expect(texto).toContain('Marca: Electrolux');
    expect(texto).toContain('Código: EFELX21');
  });

  it('convida a perguntar quando há modelo retido, e explica por quê', () => {
    const texto = gerarDescricao({
      ...base,
      ficha: montarFicha([compat('PA21G'), compat('PA26G', 2_000)]),
    }).texto;
    expect(texto).toContain('Não achou o seu modelo');
    expect(texto).toContain('só o que está confirmado');
  });

  it('sem modelo retido, o convite é mais curto', () => {
    const texto = gerarDescricao(base).texto;
    expect(texto).toContain('Tem dúvida sobre o seu modelo?');
    expect(texto).not.toContain('Não achou o seu modelo');
  });

  it('sem nada publicável não convida a perguntar sobre lista que não existe', () => {
    const r = gerarDescricao({ ...base, ficha: montarFicha([]) });
    expect(r.texto).not.toContain('Pergunte aqui');
    expect(r.avisos.join(' ')).toContain('sem tabela de compatibilidade');
  });

  it('a observação do vendedor entra no fim, sem alteração', () => {
    const texto = gerarDescricao({ ...base, observacoes: 'Enviamos em 24h.' }).texto;
    expect(texto.endsWith('Enviamos em 24h.')).toBe(true);
  });

  it('mostra a embalagem só quando é mais de uma unidade', () => {
    expect(gerarDescricao({ ...base, quantidadeEmbalagem: 1 }).texto).not.toContain('Embalagem');
    expect(gerarDescricao({ ...base, quantidadeEmbalagem: 3 }).texto).toContain(
      'Embalagem: 3 unidades',
    );
  });
});
