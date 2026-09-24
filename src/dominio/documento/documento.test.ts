import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, formatarDocumento, lerDocumento } from './index';

describe('CPF', () => {
  it('aceita CPF com dígito certo', () => {
    expect(cpfValido('52998224725')).toBe(true);
  });

  it('recusa um dígito trocado', () => {
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('52998224735')).toBe(false);
  });

  it('recusa todos os dígitos iguais, que passam no cálculo e não são de ninguém', () => {
    expect(cpfValido('11111111111')).toBe(false);
  });
});

describe('CNPJ', () => {
  it('aceita CNPJ só de números', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('00000000000191')).toBe(true);
  });

  it('aceita o CNPJ com letras, que a Receita emite desde julho de 2026', () => {
    // O exemplo da própria Receita: 12.ABC.345/01DE-35.
    expect(cnpjValido('12ABC34501DE35')).toBe(true);
  });

  it('recusa dígito verificador trocado, com letras ou sem', () => {
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('12ABC34501DE36')).toBe(false);
  });

  it('recusa letra nos dígitos verificadores e letra minúscula', () => {
    expect(cnpjValido('12ABC34501DEA5')).toBe(false);
    expect(cnpjValido('12abc34501de35')).toBe(false);
  });
});

describe('lerDocumento', () => {
  it('lê do jeito que se cola, com pontuação e minúscula', () => {
    expect(lerDocumento(' 12.abc.345/01de-35 ')).toEqual({
      tipo: 'ok',
      documento: { tipo: 'cnpj', valor: '12ABC34501DE35' },
    });
    expect(lerDocumento('529.982.247-25')).toEqual({
      tipo: 'ok',
      documento: { tipo: 'cpf', valor: '52998224725' },
    });
  });

  it('vazio é vazio, e não inválido', () => {
    expect(lerDocumento('  ')).toEqual({ tipo: 'vazio' });
  });

  it('diz por que recusou: tamanho ou dígito', () => {
    const curto = lerDocumento('1234');
    expect(curto.tipo === 'invalido' && curto.motivo).toContain('CPF tem 11 e CNPJ tem 14');

    const trocado = lerDocumento('11.222.333/0001-82');
    expect(trocado.tipo === 'invalido' && trocado.motivo).toContain('dígito verificador');
  });
});

describe('formatarDocumento', () => {
  it('formata como se escreve', () => {
    expect(formatarDocumento({ tipo: 'cnpj', valor: '12ABC34501DE35' })).toBe('12.ABC.345/01DE-35');
    expect(formatarDocumento({ tipo: 'cpf', valor: '52998224725' })).toBe('529.982.247-25');
  });
});
