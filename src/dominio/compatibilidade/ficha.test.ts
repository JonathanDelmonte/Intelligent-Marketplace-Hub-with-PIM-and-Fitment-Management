import { describe, expect, it } from 'vitest';
import type { Evidencia, TipoDeEvidencia } from './evidencia';
import {
  descreverRetencao,
  fichaEmCsv,
  montarFicha,
  responder,
  textoParaDescricao,
  type AparelhoDaFicha,
  type CompatibilidadeParaFicha,
} from './ficha';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP } from './resolucao';

let seq = 0;
const ev = (tipo: TipoDeEvidencia, negativa = false): Evidencia => {
  seq += 1;
  return {
    tipo,
    url: `https://exemplo.invalid/${seq}`,
    trecho: null,
    em: '2026-09-01T00:00:00.000Z',
    negativa,
    forcaBp: null,
  };
};

type CamposDeTeste = Omit<Partial<CompatibilidadeParaFicha>, 'aparelho'> & {
  readonly familia?: string | null;
  readonly aparelho?: Partial<AparelhoDaFicha>;
};

const compat = (modelo: string, campos: CamposDeTeste = {}): CompatibilidadeParaFicha => ({
  decisao: 'serve',
  confiancaBp: TOTAL_BP,
  conflito: null,
  evidencias: [ev('manual_fabricante')],
  ...campos,
  aparelho: {
    tipo: 'purificador de agua',
    marca: 'Electrolux',
    modelo,
    variante: null,
    familia: campos.familia ?? `electrolux:${modelo.slice(0, 4).toLowerCase()}`,
    ...campos.aparelho,
  },
});

describe('montarFicha', () => {
  it('publica só o que passa do corte, sem conflito', () => {
    const ficha = montarFicha([compat('PA21G')]);
    expect(ficha.publicaveis.map((l) => l.modelo)).toEqual(['PA21G']);
    expect(ficha.retidas).toHaveLength(0);
  });

  it('retém o que está abaixo do corte, com o motivo', () => {
    const ficha = montarFicha([compat('PA21X', { confiancaBp: LIMIAR_PUBLICACAO_BP - 1 })]);
    expect(ficha.publicaveis).toHaveLength(0);
    expect(ficha.retidas[0]?.motivo).toBe('abaixo_do_corte');
  });

  it('retém o que tem conflito aberto, mesmo com confiança alta', () => {
    const ficha = montarFicha([compat('PA21G', { conflito: 'fontes discordam' })]);
    expect(ficha.publicaveis).toHaveLength(0);
    expect(ficha.retidas[0]?.motivo).toBe('conflito_aberto');
    expect(ficha.retidas[0]?.conflito).toBe('fontes discordam');
  });

  it('separa "não serve" de "ninguém sabe"', () => {
    const ficha = montarFicha([
      compat('PA26G', { decisao: 'nao_serve' }),
      compat('PA31G', { decisao: 'indefinido', confiancaBp: 0 }),
    ]);
    expect(ficha.retidas.map((r) => r.motivo).sort()).toEqual(['indefinido', 'nao_serve']);
  });

  it('ordena por marca e modelo, que é como a pessoa lê', () => {
    const ficha = montarFicha([compat('PA31G'), compat('PA21G'), compat('PA26G')]);
    expect(ficha.publicaveis.map((l) => l.modelo)).toEqual(['PA21G', 'PA26G', 'PA31G']);
  });

  it('todo motivo de retenção tem texto', () => {
    expect(descreverRetencao('conflito_aberto')).toContain('discord');
    expect(descreverRetencao('abaixo_do_corte')).not.toBe('');
  });
});

describe('fichaEmCsv', () => {
  it('gera cabeçalho e linha com separador de planilha brasileira', () => {
    const csv = fichaEmCsv(montarFicha([compat('PA21G')]));
    expect(csv.split('\n')[0]).toBe('Tipo;Marca;Modelo;Variação;Ano de;Ano até');
    expect(csv.split('\n')[1]).toBe('purificador de agua;Electrolux;PA21G;;;');
  });

  it('não exporta linha retida', () => {
    const csv = fichaEmCsv(montarFicha([compat('PA21X', { confiancaBp: 100 })]));
    expect(csv.trim().split('\n')).toHaveLength(1);
  });

  it('escapa valor que contém o separador', () => {
    const csv = fichaEmCsv(
      montarFicha([compat('PA21G', { aparelho: { variante: 'branco; 220v' } })]),
    );
    expect(csv).toContain('"branco; 220v"');
  });
});

describe('textoParaDescricao', () => {
  it('lista os modelos publicáveis', () => {
    const texto = textoParaDescricao(montarFicha([compat('PA21G'), compat('PA26G')]));
    expect(texto).toContain('Compatível com:');
    expect(texto).toContain('• Electrolux PA21G');
  });

  it('fica vazio quando não há nada publicável, em vez de um bloco sem itens', () => {
    expect(textoParaDescricao(montarFicha([compat('PA21G', { confiancaBp: 10 })]))).toBe('');
  });
});

describe('responder ao comprador', () => {
  const base = [compat('PA21G')];

  it('confirma quando a compatibilidade é publicável, citando a fonte', () => {
    const r = responder({ pergunta: 'serve no meu purificador PA21G?', compatibilidades: base });
    expect(r.tipo).toBe('serve');
    expect(r.texto).toContain('Serve');
    expect(r.fontes).toContain('manual do fabricante');
  });

  it('não cita como fonte a evidência que não pesou', () => {
    // O anúncio próprio vale zero. Citá-lo ao comprador seria apontar o próprio
    // anúncio como prova — o raciocínio circular que a força zero impede.
    const r = responder({
      pergunta: 'serve no PA21G?',
      compatibilidades: [
        compat('PA21G', { evidencias: [ev('anuncio_proprio'), ev('manual_fabricante')] }),
      ],
    });
    expect(r.tipo).toBe('serve');
    expect(r.fontes).toEqual(['manual do fabricante']);
  });

  it('reconhece o código escrito de outra forma', () => {
    const r = responder({ pergunta: 'tenho o pa-21-g, serve?', compatibilidades: base });
    expect(r.tipo).toBe('serve');
  });

  it('nunca confirma com dado abaixo do corte', () => {
    const r = responder({
      pergunta: 'serve no PA21G?',
      compatibilidades: [compat('PA21G', { confiancaBp: LIMIAR_PUBLICACAO_BP - 1 })],
    });
    expect(r.tipo).toBe('em_duvida');
    expect(r.texto).not.toContain('Serve, sim');
  });

  it('não confirma o que tem conflito aberto', () => {
    const r = responder({
      pergunta: 'serve no PA21G?',
      compatibilidades: [compat('PA21G', { conflito: 'fontes discordam' })],
    });
    expect(r.tipo).toBe('em_duvida');
  });

  it('diz que não serve quando a evidência diz isso', () => {
    const r = responder({
      pergunta: 'serve no PA26G?',
      compatibilidades: [
        compat('PA26G', { decisao: 'nao_serve', evidencias: [ev('manual_fabricante', true)] }),
      ],
    });
    expect(r.tipo).toBe('nao_serve');
    expect(r.texto).toContain('não serve');
  });

  it('pede o modelo quando a pergunta não tem nenhum', () => {
    const r = responder({ pergunta: 'serve no meu purificador?', compatibilidades: base });
    expect(r.tipo).toBe('sem_modelo');
    expect(r.texto).toContain('etiqueta');
  });

  it('avisa que é da mesma família de um confirmado, sem prometer', () => {
    // PA21X é variação de PA21G pela gramática da semente. A resposta reconhece o
    // parentesco e continua não confirmando — é a mesma regra da inferência.
    const r = responder({ pergunta: 'e no PA21X, serve?', compatibilidades: base });
    expect(r.tipo).toBe('parente_confirmado');
    expect(r.texto).toContain('mesma linha');
    expect(r.texto).toContain('não confirmo');
  });

  it('diz que não sabe quando não tem o modelo nem parente', () => {
    const r = responder({ pergunta: 'serve no XZ99Q?', compatibilidades: base });
    expect(r.tipo).toBe('nao_sei');
    expect(r.codigos).toContain('XZ99Q');
  });

  it('a resposta nunca promete sem base: só "serve" afirma', () => {
    const perguntas = ['serve no PA21X?', 'serve no XZ99Q?', 'serve no meu aparelho?'];
    for (const pergunta of perguntas) {
      expect(responder({ pergunta, compatibilidades: base }).tipo).not.toBe('serve');
    }
  });
});
