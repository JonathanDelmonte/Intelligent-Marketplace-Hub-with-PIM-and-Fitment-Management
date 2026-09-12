/**
 * Testes da lógica da tela do leitor.
 *
 * O caso que move dinheiro é `interpretarCusto`. Errar por um fator de cem
 * transforma "não compra" em "compra", com a pessoa de pé na loja acreditando.
 */
import { describe, expect, it } from 'vitest';
import { centavos } from '@/lib/dinheiro';
import { VEREDITOS } from '@/dominio/leitor/veredito';
import {
  AVISO_SEM_PERSISTENCIA,
  CHAMADA_DO_VEREDITO,
  avaliarLocalmente,
  contarCodigos,
  COR_DO_VEREDITO,
  custoPorUnidade,
  descreverConfianca,
  descreverFila,
  formatarMarkup,
  formatarPercentual,
  formatarReais,
  interpretarCusto,
  novoIdLocal,
  rotuloDoVeredito,
} from './apresentacao';

describe('interpretarCusto', () => {
  it('aceita o que uma pessoa digita apressada', () => {
    expect(interpretarCusto('12')).toBe(1200);
    expect(interpretarCusto('12,5')).toBe(1250);
    expect(interpretarCusto('12,50')).toBe(1250);
    expect(interpretarCusto('12.50')).toBe(1250);
    expect(interpretarCusto('R$ 12,50')).toBe(1250);
    expect(interpretarCusto('r$12,50')).toBe(1250);
    expect(interpretarCusto('  8  ')).toBe(800);
    expect(interpretarCusto('0,99')).toBe(99);
  });

  it('recusa forma ambígua em vez de chutar', () => {
    // Chutar aqui significa calcular margem sobre um custo inventado.
    for (const ruim of ['1.2.3', '12,5,0', '12,505', 'doze', '', '   ', '-5', 'R$']) {
      expect(interpretarCusto(ruim), ruim).toBeNull();
    }
  });

  it('recusa separador de milhar, porque no balcão isso é dedo errado', () => {
    // `1.200` num campo de custo de balcão é quase sempre `12,00`. Aceitar como
    // mil e duzentos transformaria erro de digitação em veredito confiante.
    expect(interpretarCusto('1.200')).toBeNull();
    expect(interpretarCusto('1,200')).toBeNull();
  });

  it('recusa zero: custo zero não é compra, é doação', () => {
    expect(interpretarCusto('0')).toBeNull();
    expect(interpretarCusto('0,00')).toBeNull();
  });
});

describe('formatação', () => {
  it('formata dinheiro, percentual e markup', () => {
    expect(formatarReais(6990)).toContain('69,90');
    expect(formatarReais(null)).toBe('—');
    expect(formatarPercentual(5800)).toBe('58%');
    expect(formatarPercentual(null)).toBe('—');
    expect(formatarMarkup(5.82)).toBe('5.8x');
    expect(formatarMarkup(null)).toBe('—');
  });
});

describe('confiança em palavra', () => {
  it('três faixas, porque "72%" sugere precisão que a medida não tem', () => {
    expect(descreverConfianca(10_000)).toEqual({ rotulo: 'evidência forte', forte: true });
    expect(descreverConfianca(8000).forte).toBe(true);
    expect(descreverConfianca(7999).rotulo).toBe('evidência razoável');
    expect(descreverConfianca(4000).rotulo).toBe('evidência razoável');
    expect(descreverConfianca(3999).rotulo).toBe('evidência fraca');
    expect(descreverConfianca(0).rotulo).toBe('sem evidência');
  });
});

describe('custo por unidade', () => {
  it('divide quando a pessoa diz quantas vêm no lote', () => {
    expect(custoPorUnidade(centavos(12_000), 12)).toEqual({ unitario: 1000, dividiu: true });
  });

  it('não divide para lote de um, nem para valor sem sentido', () => {
    expect(custoPorUnidade(centavos(1200), 1)).toEqual({ unitario: 1200, dividiu: false });
    expect(custoPorUnidade(centavos(1200), 0)).toEqual({ unitario: 1200, dividiu: false });
    expect(custoPorUnidade(centavos(1200), 1.5)).toEqual({ unitario: 1200, dividiu: false });
  });

  it('arredonda para centavo inteiro', () => {
    expect(custoPorUnidade(centavos(1000), 3).unitario).toBe(333);
  });
});

describe('identificador local', () => {
  it('gera identificadores distintos', () => {
    const a = novoIdLocal();
    const b = novoIdLocal();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});

describe('estado da fila', () => {
  it('fila vazia diz que está tudo sincronizado', () => {
    expect(descreverFila({ pendentes: 0, travadas: 0, online: true, persistente: true })).toEqual({
      texto: 'tudo sincronizado',
      alerta: false,
    });
  });

  it('offline com fila diz que está guardado no aparelho', () => {
    const r = descreverFila({ pendentes: 3, travadas: 0, online: false, persistente: true });
    expect(r.texto).toContain('guardadas no aparelho');
    expect(r.alerta).toBe(false);
  });

  it('online com fila diz que está subindo', () => {
    const r = descreverFila({ pendentes: 3, travadas: 0, online: true, persistente: true });
    expect(r.texto).toContain('subindo');
  });

  it('leitura travada é alerta, e tem precedência sobre o resto', () => {
    const r = descreverFila({ pendentes: 5, travadas: 2, online: true, persistente: true });
    expect(r.alerta).toBe(true);
    expect(r.texto).toContain('várias tentativas');
  });
});

describe('completude', () => {
  it('todo veredito tem cor, chamada e rótulo', () => {
    for (const v of VEREDITOS) {
      expect(COR_DO_VEREDITO[v], v).toContain('var(--');
      expect(CHAMADA_DO_VEREDITO[v], v).not.toBe('');
      expect(rotuloDoVeredito(v), v).not.toBe('');
    }
  });

  it('o aviso de falta de persistência diz a consequência', () => {
    expect(AVISO_SEM_PERSISTENCIA).toContain('somem');
  });
});

describe('avaliação possível sem rede', () => {
  it('valida o código no próprio navegador — o módulo de GTIN é função pura', () => {
    const r = avaliarLocalmente('7896541200121');

    expect(r.gtinValido?.formatado).toBe('789 6541 20012 1');
    expect(r.gtinValido?.tipo).toBe('EAN-13');
    expect(r.gtinValido?.canonico).toBe('7896541200121');
    expect(r.gtinValido?.prefixo).toBe('Brasil');
  });

  it('descobre código lido errado sem precisar de servidor', () => {
    // É o que mais importa offline: veredito não vem, mas saber que o código
    // está errado evita decidir sobre o produto errado.
    expect(avaliarLocalmente('7896541200123').gtinValido).toBeNull();
  });

  it('reconhece caixa sem rede', () => {
    const r = avaliarLocalmente('17896541200128');
    expect(r.gtinValido?.nivelDeEmbalagem).toBe('agrupamento');
    expect(r.gtinValido?.canonico).toBeNull();
  });
});

describe('plural de código', () => {
  it('concorda em número', () => {
    expect(contarCodigos(0)).toBe('0 códigos na base');
    expect(contarCodigos(1)).toBe('1 código na base');
    expect(contarCodigos(2)).toBe('2 códigos na base');
  });
});
