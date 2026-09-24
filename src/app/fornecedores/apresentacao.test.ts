import { describe, expect, it } from 'vitest';
import type { VereditoDeTriagem } from '@/dominio/fornecedores/triagem';
import { PERGUNTAS, VEREDITOS_DE_TRIAGEM } from '@/dominio/fornecedores/triagem';
import { reaisParaCentavos } from '@/lib/dinheiro';
import type { Conferencia } from '@/dominio/fornecedores/conferencia';
import {
  CODIGOS_DE_AVISO,
  conferenciaNaTela,
  confiabilidadeEmTexto,
  descreverAviso,
  documentoEmTexto,
  estadoDaBase,
  etiquetaDoVeredito,
  pedidoMinimoEmTexto,
  perguntasEmTexto,
  prazoEmTexto,
  respostaEmTexto,
  tomDoVeredito,
  vitrineEmTexto,
} from './apresentacao';

const contagem = (campos: Partial<Record<VereditoDeTriagem, number>> = {}) => ({
  aprovado: 0,
  ressalva: 0,
  perguntar: 0,
  descartar: 0,
  ...campos,
});

describe('respostaEmTexto', () => {
  it('distingue "não perguntei" de "não"', () => {
    expect(respostaEmTexto(null)).toBe('não perguntei');
    expect(respostaEmTexto(false)).toBe('não');
    expect(respostaEmTexto(true)).toBe('sim');
  });
});

describe('prazoEmTexto', () => {
  it('zero é resposta: posta no mesmo dia', () => {
    expect(prazoEmTexto(0)).toBe('no mesmo dia');
  });

  it('concorda o singular', () => {
    expect(prazoEmTexto(1)).toBe('1 dia útil');
    expect(prazoEmTexto(4)).toBe('4 dias úteis');
  });

  it('vazio é "não perguntei", não "zero dias"', () => {
    expect(prazoEmTexto(null)).toBe('não perguntei');
  });
});

describe('pedidoMinimoEmTexto', () => {
  it('mostra as duas formas quando há as duas', () => {
    expect(pedidoMinimoEmTexto(reaisParaCentavos(300), 12)).toContain('300,00');
    expect(pedidoMinimoEmTexto(reaisParaCentavos(300), 12)).toContain('12 un');
  });

  it('nada preenchido é "não perguntei"', () => {
    expect(pedidoMinimoEmTexto(null, null)).toBe('não perguntei');
  });

  it('zero é resposta: não tem pedido mínimo', () => {
    expect(pedidoMinimoEmTexto(null, 0)).toBe('não tem');
  });
});

describe('veredito na tela', () => {
  it('só o descarte tem tom de alerta', () => {
    expect(tomDoVeredito('descartar')).toBe('alerta');
    expect(tomDoVeredito('aprovado')).toBe('ok');
    expect(tomDoVeredito('perguntar')).toBe('atencao');
    expect(tomDoVeredito('ressalva')).toBe('atencao');
  });

  it('todo veredito tem etiqueta', () => {
    for (const v of VEREDITOS_DE_TRIAGEM) expect(etiquetaDoVeredito(v), v).not.toBe('');
  });

  it('a etiqueta é estado, não ordem — imperativo ali lê como botão', () => {
    expect(etiquetaDoVeredito('descartar')).toBe('descartado');
  });
});

describe('perguntasEmTexto', () => {
  it('devolve o texto de cada pendência, pronto para mandar', () => {
    const textos = perguntasEmTexto(PERGUNTAS);
    expect(textos).toHaveLength(PERGUNTAS.length);
    for (const t of textos) expect(t.endsWith('?')).toBe(true);
  });
});

describe('descreverAviso', () => {
  it('devolve nulo sem código e para código desconhecido', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código tem título e corpo', () => {
    for (const c of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(c);
      expect(aviso, c).not.toBeNull();
      expect(aviso?.titulo, c).not.toBe('');
      expect(aviso?.corpo, c).not.toBe('');
    }
  });

  it('o descarte explica por que, e diz que fica cadastrado', () => {
    const aviso = descreverAviso('descartado');
    expect(aviso?.corpo).toContain('preço de fábrica');
    expect(aviso?.corpo).toContain('Fica cadastrado');
  });
});

describe('estadoDaBase', () => {
  it('base vazia convida a cadastrar o primeiro', () => {
    expect(estadoDaBase(contagem())?.titulo).toContain('Nenhum fornecedor');
  });

  it('sem aprovado e com pendência, diz que é falta de resposta', () => {
    const aviso = estadoDaBase(contagem({ perguntar: 3 }));
    expect(aviso?.corpo).toContain('falta de resposta');
  });

  it('cala a boca quando há aprovado', () => {
    expect(estadoDaBase(contagem({ aprovado: 1, perguntar: 2 }))).toBeNull();
  });

  it('não reclama quando só há descartados e ressalvas', () => {
    expect(estadoDaBase(contagem({ descartar: 2, ressalva: 1 }))).toBeNull();
  });
});

describe('documentoEmTexto', () => {
  it('pontua o que confere, e diz quando não confere', () => {
    expect(documentoEmTexto(null)).toBe('sem CNPJ');
    expect(documentoEmTexto('11222333000181')).toBe('CNPJ 11.222.333/0001-81');
    expect(documentoEmTexto('52998224725')).toBe('CPF 529.982.247-25');
    // Gravado antes da conferência do dígito: aparece, marcado.
    expect(documentoEmTexto('11.222.333/0001-82')).toBe('CNPJ 11.222.333/0001-82 (não confere)');
  });
});

describe('vitrineEmTexto', () => {
  it('o "sim" da conferência manda olhar o link; o da pessoa é só "sim"', () => {
    expect(vitrineEmTexto(true, 'manual')).toBe('sim');
    expect(vitrineEmTexto(true, 'm0_link')).toBe('sim, pela conferência (link abaixo)');
    expect(vitrineEmTexto(null, null)).toBe('não perguntei');
  });
});

describe('conferenciaNaTela', () => {
  const base: Conferencia = {
    em: '2026-09-24T12:00:00.000Z',
    cadastro: {
      tipo: 'encontrado',
      frase: 'ACME LTDA, CNPJ 11.222.333/0001-81, ativo.',
      ativo: true,
      atacadista: true,
      fabricante: false,
      nome: 'ACME',
      fonte: 'https://brasilapi.com.br/api/cnpj/v1/11222333000181',
    },
    vitrine: {
      buscadoComo: 'Acme',
      conferidas: ['ml', 'shopee', 'amazon'],
      lojas: [],
      indicios: [],
      falha: null,
    },
  };

  it('nada achado é tom ok, e diz que não achar não prova nada', () => {
    const tela = conferenciaNaTela(base);
    expect(tela.tom).toBe('ok');
    expect(tela.quando).toBe('24/09/2026');
    expect(tela.vitrine).toContain('Não achar não prova');
  });

  it('loja própria é alerta, com o link e o nome da vitrine', () => {
    const tela = conferenciaNaTela({
      ...base,
      vitrine: {
        ...base.vitrine,
        conferidas: ['ml'],
        lojas: [
          { plataforma: 'ml', titulo: 'Acme', url: 'https://www.mercadolivre.com.br/loja/acme' },
        ],
      },
    });
    expect(tela.tom).toBe('alerta');
    expect(tela.lojas).toEqual([
      { rotulo: 'Mercado Livre: Acme', url: 'https://www.mercadolivre.com.br/loja/acme' },
    ]);
  });

  it('CNPJ baixado preocupa mesmo sem loja achada', () => {
    const tela = conferenciaNaTela({
      ...base,
      cadastro: {
        tipo: 'encontrado',
        frase: 'ACME: situação baixada.',
        ativo: false,
        atacadista: false,
        fabricante: false,
        nome: 'ACME',
        fonte: 'https://brasilapi.com.br/api/cnpj/v1/11222333000181',
      },
    });
    expect(tela).toMatchObject({ tom: 'alerta', cadastroPreocupa: true });
  });

  it('busca que parou diz onde conferiu e por quê', () => {
    const tela = conferenciaNaTela({
      ...base,
      vitrine: { ...base.vitrine, conferidas: ['ml'], falha: 'o buscador pediu uma pausa.' },
    });
    expect(tela.vitrine).toContain('Conferido só em Mercado Livre');
    expect(tela.vitrine).toContain('pediu uma pausa');
  });
});

describe('confiabilidadeEmTexto', () => {
  it('sem pedido e com poucos, não mostra nota', () => {
    expect(confiabilidadeEmTexto(undefined)).toBe('sem pedido medido');
    expect(confiabilidadeEmTexto({ tipo: 'poucos', medidos: 1 })).toBe(
      '1 pedido medido — a nota sai com 5',
    );
  });

  it('com nota, diz de onde ela vem', () => {
    expect(confiabilidadeEmTexto({ tipo: 'medida', nota: 4, medidos: 20, noPrazo: 18 })).toBe(
      '4 de 5 — 18 de 20 postados no prazo',
    );
  });
});
