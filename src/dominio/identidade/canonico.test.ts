import { describe, expect, it } from 'vitest';
import {
  chaveDeAgrupamento,
  codigosDeModelo,
  codigosDoRegistro,
  ehCodigoDeModelo,
  formaCanonica,
  normalizarCodigoDeModelo,
  normalizarMarca,
  normalizarTexto,
} from './canonico';
import { esquemaRegistroDeProduto } from './registro';

const registro = (campos: Record<string, unknown>) => esquemaRegistroDeProduto.parse(campos);

describe('normalizarTexto', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(normalizarTexto('Refil  Filtro/Purificador Água')).toBe('refil filtro purificador agua');
  });

  it('não remove palavra, porque palavra às vezes é o produto', () => {
    // "kit" muda a quantidade, e quantidade diferente é produto diferente.
    expect(normalizarTexto('Kit 3 Refis')).toBe('kit 3 refis');
  });

  it('devolve vazio para texto só de pontuação', () => {
    expect(normalizarTexto(' -- // ')).toBe('');
  });
});

describe('normalizarMarca', () => {
  it('apara sufixo de razão social', () => {
    expect(normalizarMarca('Electrolux do Brasil S/A')).toBe('electrolux');
    expect(normalizarMarca('ACME Indústria e Comércio Ltda')).toBe('acme');
  });

  it('apara sufixo repetido, que é o caso real de nota fiscal', () => {
    expect(normalizarMarca('Acme Comercio Ltda')).toBe('acme');
  });

  it('não apara quando o sufixo é a marca inteira', () => {
    // Não há o que aparar sem sobrar string vazia; a marca "CO" fica.
    expect(normalizarMarca('CO')).toBe('co');
  });
});

describe('ehCodigoDeModelo', () => {
  it('aceita código de fabricante', () => {
    for (const codigo of ['PA21G', 'PE11B', 'EF-ELX-21', 'W10295370', 'DA29-00020B']) {
      expect(ehCodigoDeModelo(codigo), codigo).toBe(true);
    }
  });

  it('recusa medida, que tem a mesma forma', () => {
    for (const medida of ['500ml', '12V', '220v', '3x', '1kg', '10mm', '2L']) {
      expect(ehCodigoDeModelo(medida), medida).toBe(false);
    }
  });

  it('recusa token sem dígito e token sem letra', () => {
    expect(ehCodigoDeModelo('purificador')).toBe(false);
    expect(ehCodigoDeModelo('2024')).toBe(false);
    expect(ehCodigoDeModelo('8990')).toBe(false);
  });

  it('recusa token curto demais para não ser acidente', () => {
    expect(ehCodigoDeModelo('A3')).toBe(false);
    expect(ehCodigoDeModelo('P1')).toBe(false);
  });

  it('aceita prefixo de uma letra que coincide com unidade', () => {
    // `W10295370` é peça de Whirlpool e `W` é watt. Recusar por coincidir com
    // unidade jogaria fora o padrão de várias marcas de linha branca.
    expect(ehCodigoDeModelo('W10295370')).toBe(true);
    expect(ehCodigoDeModelo('A1234')).toBe(true);
  });

  it('recusa palavra grudada em código', () => {
    // `purificador-PA21G` tem letra, dígito e tamanho; o que o desqualifica é a
    // palavra dentro.
    expect(ehCodigoDeModelo('purificador-PA21G')).toBe(false);
    expect(ehCodigoDeModelo('EF-ELX-21')).toBe(true);
  });

  it('recusa texto longo demais para ser código', () => {
    expect(ehCodigoDeModelo('REFIL1PARAPURIFICADORDEAGUAELECTROLUX')).toBe(false);
  });
});

describe('normalizarCodigoDeModelo', () => {
  it('iguala as três grafias que as fontes usam', () => {
    expect(normalizarCodigoDeModelo('pa-21-g')).toBe('PA21G');
    expect(normalizarCodigoDeModelo('PA 21 G')).toBe('PA21G');
    expect(normalizarCodigoDeModelo('PA21G')).toBe('PA21G');
  });

  it('devolve null quando não é código', () => {
    expect(normalizarCodigoDeModelo('refil original')).toBeNull();
  });
});

describe('codigosDeModelo', () => {
  it('acha os três códigos de um título de marketplace', () => {
    const titulo = 'Refil Filtro Purificador Electrolux PA21G PA26G PE11B Original Frete Grátis';
    expect(codigosDeModelo(titulo)).toEqual(['PA21G', 'PA26G', 'PE11B']);
  });

  it('não junta números através de uma palavra comum', () => {
    // Veio de pergunta de comprador: `é 110 ou 220?` produzia o código `110OU220`, e a
    // resposta automática tratava uma dúvida de voltagem como pergunta sobre um modelo
    // que não existe. `PA 21 G` não tem palavra no meio; `110 ou 220` tem.
    expect(codigosDeModelo('é 110 ou 220?')).toEqual([]);
    expect(codigosDeModelo('tem de 21 cm?')).toEqual([]);
    expect(codigosDeModelo('kit com 2 unidades')).toEqual([]);
    // Segunda ocorrência, achada na tela de perguntas: `vem 1 ou 2 unidades?`
    // produzia `VEM1`, e a dúvida de quantidade virava dúvida de compatibilidade
    // sobre um modelo inexistente. Verbo curto antes de número é o mesmo caso.
    expect(codigosDeModelo('vem 1 ou 2 unidades?')).toEqual([]);
    expect(codigosDeModelo('tem 2 anos de garantia?')).toEqual([]);
    expect(codigosDeModelo('vai 3 meses?')).toEqual([]);
  });

  it('junta token separado por espaço', () => {
    expect(codigosDeModelo('Refil PA 21 G para purificador')).toEqual(['PA21G']);
  });

  it('não junta dois códigos vizinhos em um', () => {
    expect(codigosDeModelo('PA21G PE11B')).toEqual(['PA21G', 'PE11B']);
  });

  it('ignora medida e preço', () => {
    expect(codigosDeModelo('Refil 500ml 12V por R$ 89,90')).toEqual([]);
  });

  it('não repete o mesmo código escrito de dois jeitos', () => {
    expect(codigosDeModelo('Refil PA21G (pa-21-g) original')).toEqual(['PA21G']);
  });

  it('mantém hífen dentro do código e separa em barra', () => {
    expect(codigosDeModelo('Filtro DA29-00020B original')).toEqual(['DA2900020B']);
    expect(codigosDeModelo('serve em PA21G/PA26G')).toEqual(['PA21G', 'PA26G']);
  });

  it('devolve lista vazia para título sem código', () => {
    expect(codigosDeModelo('Elemento Filtrante para purificador de água')).toEqual([]);
  });
});

describe('formaCanonica', () => {
  it('é tipo + marca + modelo, nessa ordem', () => {
    const r = registro({
      tipoProduto: 'Refil de filtro',
      marca: 'Electrolux',
      modeloPeca: 'pa-21-g',
    });
    // Tudo minúsculo: a forma canônica é comparada como string e virada em vetor,
    // e caixa diferente no mesmo código seria diferença sem significado.
    expect(formaCanonica(r)).toBe('refil de filtro electrolux pa21g');
  });

  it('colapsa as três descrições do mesmo produto na mesma forma', () => {
    const a = registro({
      tipoProduto: 'refil de filtro',
      marca: 'Electrolux',
      modeloPeca: 'PA21G',
    });
    const b = registro({
      tipoProduto: 'Refil  de  Filtro',
      marca: 'ELECTROLUX DO BRASIL S/A',
      modeloPeca: 'pa 21 g',
    });
    expect(formaCanonica(a)).toBe(formaCanonica(b));
  });

  it('não inclui palavra-chave de SEO, porque não vem do título', () => {
    const r = registro({ tipoProduto: 'refil', marca: 'Electrolux', modeloPeca: 'PA21G' });
    expect(formaCanonica(r)).not.toContain('frete');
    expect(formaCanonica(r)).not.toContain('original');
  });

  it('devolve vazio quando o registro não tem nenhum dos três', () => {
    expect(formaCanonica(registro({ material: 'polipropileno' }))).toBe('');
  });

  it('usa o texto normalizado quando o modelo não é um código', () => {
    const r = registro({ marca: 'Acme', modeloPeca: 'Linha Premium' });
    expect(formaCanonica(r)).toBe('acme linha premium');
  });
});

describe('chaveDeAgrupamento', () => {
  it('é marca|modelo quando os dois existem', () => {
    expect(chaveDeAgrupamento(registro({ marca: 'Electrolux', modeloPeca: 'pa-21-g' }))).toBe(
      'electrolux|pa21g',
    );
  });

  it('é null sem marca, e null sem modelo — e é isso que impede o colapso da base', () => {
    expect(chaveDeAgrupamento(registro({ modeloPeca: 'PA21G' }))).toBeNull();
    expect(chaveDeAgrupamento(registro({ marca: 'Electrolux' }))).toBeNull();
    expect(chaveDeAgrupamento(registro({}))).toBeNull();
  });

  it('é null quando marca ou modelo normalizam para vazio', () => {
    // `---` já virou null no schema do registro; aqui o caso é pontuação que
    // sobrevive ao schema e desaparece na normalização.
    expect(chaveDeAgrupamento(registro({ marca: '///', modeloPeca: 'PA21G' }))).toBeNull();
    expect(chaveDeAgrupamento(registro({ marca: 'Electrolux', modeloPeca: '///' }))).toBeNull();
  });

  it('duas fontes do mesmo produto chegam na mesma chave', () => {
    const anuncio = registro({ marca: 'Electrolux', modeloPeca: 'PA21G' });
    const distribuidor = registro({ marca: 'electrolux do brasil', modeloPeca: 'pa 21 g' });
    expect(chaveDeAgrupamento(anuncio)).toBe(chaveDeAgrupamento(distribuidor));
  });
});

describe('codigosDoRegistro', () => {
  it('reúne o modelo da peça e os aparelhos compatíveis', () => {
    const r = registro({
      modeloPeca: 'EF-ELX-21',
      modelosCompativeis: ['PA21G', 'PA26G', 'purificador de mesa'],
    });
    expect(codigosDoRegistro(r)).toEqual(['EFELX21', 'PA21G', 'PA26G']);
  });
});
