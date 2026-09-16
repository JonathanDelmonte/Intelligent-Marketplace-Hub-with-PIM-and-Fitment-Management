import { describe, expect, it } from 'vitest';
import {
  gerarTitulo,
  gerarTituloPara,
  limparTermos,
  LIMITE_DE_TITULO,
  type DadosDoTitulo,
} from './titulo';

const REFIL: DadosDoTitulo = {
  tipoProduto: 'refil de purificador de água',
  marca: 'Electrolux',
  modeloPeca: 'EF-ELX-21',
  modelosCompativeis: ['PA21G', 'PA26G'],
  quantidadeEmbalagem: null,
};

const gerar = (campos: Partial<DadosDoTitulo> = {}, limite = LIMITE_DE_TITULO.ml) =>
  gerarTitulo({ ...REFIL, ...campos }, limite);

describe('ordem dos termos', () => {
  it('o código do aparelho vem antes do código da peça', () => {
    // O comprador sabe o modelo do purificador dele, não o código do refil.
    const t = gerar().titulo;
    expect(t.indexOf('PA21G')).toBeLessThan(t.indexOf('EFELX21'));
  });

  it('começa pelo tipo e pela marca, que é como a busca começa', () => {
    expect(gerar().titulo.startsWith('Refil de purificador de água Electrolux')).toBe(true);
  });

  it('capitaliza a inicial sem virar title case', () => {
    expect(gerar().titulo).toContain('Refil de purificador');
    expect(gerar().titulo).not.toContain('Refil De Purificador');
  });
});

describe('limite de caracteres', () => {
  it('nunca passa do limite', () => {
    for (const limite of [20, 40, 60, 120]) {
      const r = gerar({}, limite);
      expect(r.tamanho, `limite ${String(limite)}`).toBeLessThanOrEqual(limite);
    }
  });

  it('não corta no meio de um código de modelo', () => {
    // Meio código é pior que código nenhum: não casa com a busca e ocupa espaço.
    const r = gerar({}, 45);
    for (const modelo of r.modelosIncluidos) expect(r.titulo).toContain(modelo);
    for (const cortado of r.modelosCortados) expect(r.titulo).not.toContain(cortado);
  });

  it('relata o que foi cortado, porque cada um é uma busca perdida', () => {
    const r = gerar({ modelosCompativeis: ['PA21G', 'PA26G', 'PA31G', 'PA41G'] }, 45);
    expect(r.modelosCortados.length).toBeGreaterThan(0);
    expect(r.avisos.join(' ')).toContain('segundo anúncio');
  });

  it('um modelo cortado não "couberam"', () => {
    const um = gerar({ modelosCompativeis: ['PA21G', 'PA26G'] }, 45);
    expect(um.modelosCortados).toHaveLength(1);
    expect(um.avisos.join(' ')).toContain('1 modelo não coube');

    const varios = gerar({ modelosCompativeis: ['PA21G', 'PA26G', 'PA31G', 'PA41G'] }, 45);
    expect(varios.modelosCortados.length).toBeGreaterThan(1);
    expect(varios.avisos.join(' ')).toContain('modelos não couberam');
  });

  it('avisa quando sobra espaço, porque espaço em título é grátis', () => {
    const r = gerar({ modelosCompativeis: ['PA21G'] }, 120);
    expect(r.avisos.join(' ')).toContain('Sobraram');
  });

  it('não avisa de sobra quando o corte foi por falta de espaço', () => {
    const r = gerar({ modelosCompativeis: ['PA21G', 'PA26G', 'PA31G'] }, 45);
    expect(r.avisos.join(' ')).not.toContain('Sobraram');
  });

  it('usa o limite da plataforma quando pedido por nome', () => {
    expect(gerarTituloPara(REFIL, 'ml').limite).toBe(60);
    expect(gerarTituloPara(REFIL, 'shopee').limite).toBe(120);
  });
});

describe('base que não cabe no limite', () => {
  // Foi o teste de limite que forçou a pensar nisto: a primeira versão montava
  // tipo + marca sem conferir o limite, e devolvia título que a plataforma
  // recusaria na importação.
  it('cede primeiro o fim do tipo, que é o que menos identifica', () => {
    const r = gerar({ modelosCompativeis: [], modeloPeca: null }, 30);
    expect(r.tamanho).toBeLessThanOrEqual(30);
    expect(r.titulo).toContain('Refil');
    expect(r.titulo).toContain('Electrolux');
  });

  it('não deixa conector solto no fim do título encurtado', () => {
    const r = gerar({ modelosCompativeis: [], modeloPeca: null }, 30);
    expect(r.titulo.endsWith(' de')).toBe(false);
    expect(r.titulo.endsWith(' da')).toBe(false);
  });

  it('encurta o tipo antes de abrir mão da marca', () => {
    // "Refil Electrolux" vale mais em busca que "Refil purificador": a marca é
    // termo que o comprador digita, e o fim do tipo é o que menos identifica.
    const r = gerar({ tipoProduto: 'refil purificador', marca: 'Electrolux' }, 18);
    expect(r.tamanho).toBeLessThanOrEqual(18);
    expect(r.titulo).toContain('Electrolux');
    expect(r.avisos.join(' ')).not.toContain('marca não caberia');
  });

  it('abre mão da marca quando não há mais tipo para ceder, e avisa', () => {
    const r = gerar({ tipoProduto: 'refil', marca: 'Electrolux do Brasil' }, 8);
    expect(r.tamanho).toBeLessThanOrEqual(8);
    expect(r.titulo).not.toContain('Electrolux');
    expect(r.avisos.join(' ')).toContain('marca não caberia');
  });

  it('limite absurdo devolve título cortado e avisa, em vez de estourar', () => {
    const r = gerar({}, 3);
    expect(r.tamanho).toBeLessThanOrEqual(3);
    expect(r.avisos.join(' ')).toContain('precisa ser revisto à mão');
  });
});

describe('palavras que não entram', () => {
  it('tira promoção e enfeite, e diz o que tirou', () => {
    const r = gerar({ tipoProduto: 'refil purificador PROMOÇÃO frete grátis imperdível' });
    expect(r.titulo).not.toContain('PROMOÇÃO');
    expect(r.titulo.toLowerCase()).not.toContain('grátis');
    expect(r.avisos[0]).toContain('Tirei do título');
  });

  it('mantém "original", que é termo de busca real em peça de reposição', () => {
    expect(gerar({ tipoProduto: 'refil original de purificador' }).titulo).toContain('original');
  });

  it('compara sem acento, então "promocao" e "Promoção" caem os dois', () => {
    expect(limparTermos('refil promocao').limpo).toBe('refil');
    expect(limparTermos('refil Promoção').limpo).toBe('refil');
  });
});

describe('sem código de modelo', () => {
  it('avisa que o anúncio não vai ser encontrado', () => {
    const r = gerar({ modelosCompativeis: [], modeloPeca: null });
    expect(r.avisos.join(' ')).toContain('nenhum código de modelo');
    expect(r.avisos.join(' ')).toContain('Cadastre a compatibilidade');
  });

  it('não avisa quando há só o código da peça', () => {
    const r = gerar({ modelosCompativeis: [] });
    expect(r.avisos.join(' ')).not.toContain('nenhum código de modelo');
  });
});

describe('casos de borda', () => {
  it('sem tipo de produto não há título', () => {
    const r = gerar({ tipoProduto: '   ' });
    expect(r.titulo).toBe('');
    expect(r.avisos[0]).toContain('única parte obrigatória');
  });

  it('tipo de produto que é só palavra proibida também não gera título', () => {
    expect(gerar({ tipoProduto: 'promoção imperdível' }).titulo).toBe('');
  });

  it('não repete o código da peça quando ele está na lista de compatíveis', () => {
    const r = gerar({ modeloPeca: 'PA21G', modelosCompativeis: ['PA21G', 'PA26G'] });
    expect(r.titulo.match(/PA21G/g)).toHaveLength(1);
  });

  it('normaliza a grafia dos códigos', () => {
    expect(gerar({ modelosCompativeis: ['pa-21-g'] }).titulo).toContain('PA21G');
  });

  it('ignora o que não é código de modelo na lista de compatíveis', () => {
    const r = gerar({ modelosCompativeis: ['purificador de agua', 'PA26G'] });
    expect(r.modelosIncluidos).toEqual(['PA26G']);
  });

  it('não duplica modelo repetido na entrada', () => {
    const r = gerar({ modelosCompativeis: ['PA21G', 'pa 21 g', 'PA21G'] });
    expect(r.modelosIncluidos).toEqual(['PA21G']);
  });

  it('marca kit só quando há mais de uma unidade', () => {
    expect(gerar({ quantidadeEmbalagem: 1 }).titulo).not.toContain('Kit');
    expect(gerar({ quantidadeEmbalagem: 3, modelosCompativeis: ['PA21G'] }).titulo).toContain(
      'Kit 3',
    );
  });

  it('sem marca não deixa espaço duplo', () => {
    const r = gerar({ marca: null });
    expect(r.titulo).not.toContain('  ');
  });
});
