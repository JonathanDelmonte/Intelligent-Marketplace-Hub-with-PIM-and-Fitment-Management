import { describe, expect, it } from 'vitest';
import {
  CAMPOS_FISCAIS,
  OBRIGATORIOS_EM_2027,
  PARA_QUE_SERVE,
  ROTULO_DO_CAMPO,
  VALORES_COMUNS,
  estadoFiscal,
  lerCodigoFiscal,
  textoDoProblema,
  type CadastroFiscalDoSku,
} from './codigos';

const cadastro = (campos: Partial<CadastroFiscalDoSku> = {}): CadastroFiscalDoSku => ({
  ncm: '84212100',
  cest: null,
  cst: '000',
  cclasstrib: '000001',
  ...campos,
});

describe('lerCodigoFiscal', () => {
  it('aceita o NCM colado da tabela oficial, com pontos', () => {
    // Recusar o que a pessoa copiou da tabela seria recusar o valor certo.
    const r = lerCodigoFiscal('ncm', '8421.21.00');
    expect(r.valor).toBe('84212100');
    expect(r.aceito).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it('ignora espaço e barra também', () => {
    expect(lerCodigoFiscal('ncm', ' 8421 21 00 ').valor).toBe('84212100');
    expect(lerCodigoFiscal('cclasstrib', '000-001').valor).toBe('000001');
  });

  it('vazio não é erro: é campo não preenchido ainda', () => {
    for (const campo of CAMPOS_FISCAIS) {
      const r = lerCodigoFiscal(campo, '   ');
      expect(r.valor, campo).toBeNull();
      expect(r.aceito, campo).toBe(true);
      expect(r.problemas, campo).toEqual([]);
    }
  });

  it('dígito a menos recusa, porque é digitação e não opinião', () => {
    // E é exatamente o erro que viraria nota rejeitada em janeiro.
    const r = lerCodigoFiscal('ncm', '842121');
    expect(r.aceito).toBe(false);

    const [problema] = r.problemas;
    if (problema === undefined) throw new Error('esperava um problema de formato');
    expect(problema.tipo).toBe('formato');
    expect(textoDoProblema(problema)).toContain('oito dígitos');
  });

  it('letra no meio recusa', () => {
    expect(lerCodigoFiscal('cclasstrib', '00A001').aceito).toBe(false);
  });

  it('valor fora da lista conhecida é aviso, não recusa', () => {
    // A lista é o que eu conheço, não o que existe — recusar um código correto
    // pararia a operação por causa da minha ignorância.
    const r = lerCodigoFiscal('cst', '900', 'mei');
    expect(r.aceito).toBe(true);
    expect(r.valor).toBe('900');

    const [problema] = r.problemas;
    if (problema === undefined) throw new Error('esperava um aviso de valor fora da lista');
    expect(problema.tipo).toBe('fora_da_lista');
    expect(textoDoProblema(problema)).toContain('Gravei do mesmo jeito');
  });

  it('valor da lista passa sem aviso', () => {
    const r = lerCodigoFiscal('cst', '000', 'mei');
    expect(r.problemas).toEqual([]);
  });

  it('sem regime informado não há lista para comparar, e nada é avisado', () => {
    expect(lerCodigoFiscal('cst', '900').problemas).toEqual([]);
  });

  it('CST aceita dois ou três dígitos, porque as duas formas aparecem', () => {
    expect(lerCodigoFiscal('cst', '00').aceito).toBe(true);
    expect(lerCodigoFiscal('cst', '000').aceito).toBe(true);
    expect(lerCodigoFiscal('cst', '0000').aceito).toBe(false);
  });
});

describe('vocabulário', () => {
  it('todo campo tem rótulo e explicação de para que serve', () => {
    // "Preencha o cClassTrib" não diz nada a quem nunca emitiu nota — e é essa
    // pessoa que precisa preencher antes de janeiro.
    for (const campo of CAMPOS_FISCAIS) {
      expect(ROTULO_DO_CAMPO[campo].length, campo).toBeGreaterThan(2);
      expect(PARA_QUE_SERVE[campo].length, campo).toBeGreaterThan(50);
    }
  });

  it('pessoa física não tem valor sugerido, porque não emite nota de mercadoria', () => {
    expect(VALORES_COMUNS.cpf).toEqual({});
  });

  it('CEST fica fora dos obrigatórios', () => {
    // Só vale para mercadoria sujeita a substituição tributária; exigir de todo
    // mundo criaria pendência falsa na maior parte do catálogo.
    expect(OBRIGATORIOS_EM_2027).not.toContain('cest');
    expect(OBRIGATORIOS_EM_2027).toEqual(['ncm', 'cst', 'cclasstrib']);
  });
});

describe('estadoFiscal', () => {
  it('cadastro completo está pronto para 2027', () => {
    const e = estadoFiscal(cadastro());
    expect(e.prontoPara2027).toBe(true);
    expect(e.faltando).toEqual([]);
  });

  it('CEST vazio não é pendência', () => {
    expect(estadoFiscal(cadastro({ cest: null })).prontoPara2027).toBe(true);
  });

  it('nomeia o que falta e diz o que acontece na data', () => {
    const e = estadoFiscal(cadastro({ cclasstrib: null, cst: '  ' }));
    expect(e.prontoPara2027).toBe(false);
    expect(e.faltando).toEqual(['cst', 'cclasstrib']);
    expect(e.mensagem).toContain('cClassTrib');
    expect(e.mensagem).toContain('04/01/2027');
    expect(e.mensagem).toContain('rejeitada');
  });

  it('cadastro vazio lista os três, na ordem declarada', () => {
    const e = estadoFiscal({ ncm: null, cest: null, cst: null, cclasstrib: null });
    expect(e.faltando).toEqual(OBRIGATORIOS_EM_2027);
  });
});
