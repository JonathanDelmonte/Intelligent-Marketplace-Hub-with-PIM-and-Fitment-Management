import { describe, expect, it } from 'vitest';
import { ATRIBUTOS, EXIGENCIAS, conferirAtributos } from '@/dominio/anuncios/atributos';
import type { Conferencia, ProdutoParaConferir } from '@/dominio/anuncios/atributos';
import { avaliarCatalogoML } from '@/dominio/anuncios/catalogo';
import { montarFicha, type CompatibilidadeParaFicha } from '@/dominio/compatibilidade/ficha';
import { TOTAL_BP } from '@/dominio/compatibilidade/resolucao';
import type { Evidencia } from '@/dominio/compatibilidade/evidencia';
import type { TituloGerado } from '@/dominio/anuncios/titulo';
import type { CandidatoAAnuncio } from '@/dominio/anuncios/repositorio';
import {
  CODIGOS_DE_AVISO,
  avisoDeCamposInvalidos,
  descreverAviso,
  descreverCandidato,
  resumoDaConferencia,
  resumoDoTitulo,
  rotuloDaExigencia,
  rotuloDoAtributo,
  textoDoCatalogo,
  tomDaExigencia,
  tomDoCatalogo,
} from './apresentacao';

const evidencia: Evidencia = {
  tipo: 'manual_fabricante',
  url: 'https://exemplo.invalid/manual',
  trecho: null,
  em: '2026-09-01T00:00:00.000Z',
  negativa: false,
  forcaBp: null,
};

const compat = (modelo: string): CompatibilidadeParaFicha => ({
  decisao: 'serve',
  confiancaBp: TOTAL_BP,
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

// Tipado de propósito: sem a anotação, `categoria: 'MLB1234'` é inferido como
// `string` e o teste não pode passar `null` para ver a falta.
const COMPLETO: ProdutoParaConferir = {
  tipoProduto: 'refil de purificador de água',
  marca: 'Electrolux',
  modeloPeca: 'EF-ELX-21',
  ean: '7896541200909',
  categoria: 'MLB1234',
  pesoGramas: 300,
  dimensoesMm: { comprimento: 200, largura: 90, altura: 90 },
  descricao: 'Refil compatível.',
  voltagem: '110 V e 220 V',
  medida: null,
  quantidadeEmbalagem: 1,
  ficha: montarFicha([compat('PA21G')]),
};

const conferir = (campos: Partial<ProdutoParaConferir> = {}): Conferencia =>
  conferirAtributos({ ...COMPLETO, ...campos });

const titulo = (campos: Partial<TituloGerado> = {}): TituloGerado => ({
  titulo: 'Refil purificador Electrolux PA21G',
  tamanho: 34,
  limite: 60,
  modelosIncluidos: ['PA21G'],
  modelosCortados: [],
  avisos: [],
  ...campos,
});

describe('tomDaExigencia e rótulos', () => {
  it('bloqueia e devolução são os dois alertas, como empatam no peso', () => {
    expect(tomDaExigencia('bloqueia')).toBe('alerta');
    expect(tomDaExigencia('devolucao')).toBe('alerta');
    expect(tomDaExigencia('ranqueia')).toBe('atencao');
    expect(tomDaExigencia('ajuda')).toBe('neutro');
  });

  it('todo nível tem rótulo que diz a consequência', () => {
    for (const e of EXIGENCIAS) {
      expect(rotuloDaExigencia(e).length, e).toBeGreaterThan(0);
    }
  });

  it('todo atributo tem nome de pessoa, não nome de coluna', () => {
    // "ean" e "modelo_peca" são nomes de coluna; ninguém fala assim.
    for (const a of ATRIBUTOS) {
      expect(rotuloDoAtributo(a), a).not.toContain('_');
    }
    expect(rotuloDoAtributo('ean')).toBe('código de barras');
    expect(rotuloDoAtributo('compatibilidade')).toBe('onde serve');
  });

  it('atributo desconhecido não quebra a tela', () => {
    expect(rotuloDoAtributo('coisa_nova')).toBe('coisa nova');
  });
});

describe('resumoDaConferencia', () => {
  it('lidera pelo que impede exportar, porque não há escolha nisso', () => {
    const r = resumoDaConferencia(conferir({ categoria: null, voltagem: null }));
    expect(r.startsWith('Não dá para exportar')).toBe(true);
    expect(r).toContain('categoria');
  });

  it('sem bloqueio, lidera pelo que gera devolução', () => {
    // É o que a pessoa adiaria se a tela não insistisse — e é o que custa mais.
    const r = resumoDaConferencia(conferir({ voltagem: null }));
    expect(r).toContain('Dá para exportar');
    expect(r).toContain('devolução');
    expect(r).toContain('voltagem');
  });

  it('só faltando o que ranqueia, diz isso sem alarme', () => {
    const r = resumoDaConferencia(conferir({ marca: null }));
    expect(r).toContain('Dá para exportar');
    expect(r).not.toContain('devolução');
  });

  it('um item que só ranqueia usa o verbo no singular', () => {
    // "Falta 1 item que só ranqueiam pior" é o que o "(s)" deixava passar.
    const r = resumoDaConferencia(conferir({ marca: null }));
    expect(r).toContain('Falta 1 item que só ranqueia pior ou ajuda a achar');
  });

  it('checklist cheio diz para o que o produto é', () => {
    const r = resumoDaConferencia(conferir());
    expect(r).toContain('completo');
    expect(r).toContain('reposicao');
  });

  it('mostra o preenchimento em percentual, não em pontos-base', () => {
    // 6000 bp na tela seria número de programador.
    const r = resumoDaConferencia(conferir({ categoria: null }));
    expect(r).toMatch(/\d+%/);
    expect(r).not.toContain('bp');
  });
});

describe('resumoDoTitulo', () => {
  it('diz o tamanho contra o limite', () => {
    expect(resumoDoTitulo(titulo())).toContain('34 de 60 caracteres');
  });

  it('modelo cortado é dito como busca perdida, com o que fazer', () => {
    // Cada modelo fora é uma busca em que o anúncio não aparece — e a saída é
    // dividir em dois anúncios, não aceitar.
    const r = resumoDoTitulo(titulo({ modelosCortados: ['PA26G', 'PA31G'] }));
    expect(r).toContain('PA26G, PA31G');
    expect(r).toContain('Dois anúncios');
  });

  it('nada cortado não inventa problema', () => {
    expect(resumoDoTitulo(titulo())).toContain('todos os modelos couberam');
  });
});

describe('catálogo', () => {
  const FICHA_URL = 'https://www.mercadolivre.com.br/p/MLB12345678';
  const oco = (url: string, vendedor: string) => ({
    plataformaOuSite: 'ml',
    url,
    vendedor,
    ean: '7896541200909',
  });

  it('sem sinal não devolve texto', () => {
    const a = avaliarCatalogoML([oco('https://produto.mercadolivre.com.br/MLB-1-x', 'loja')]);
    expect(textoDoCatalogo(a)).toBeNull();
    expect(tomDoCatalogo(a)).toBe('neutro');
  });

  it('ficha confirmada sem reputação informada é atenção, não alerta', () => {
    // Vermelho é para o que se sabe; aqui não se sabe a reputação de quem lê.
    const a = avaliarCatalogoML([oco(FICHA_URL, 'loja')]);
    expect(textoDoCatalogo(a)).not.toBeNull();
    expect(tomDoCatalogo(a)).toBe('atencao');
  });

  it('ficha confirmada com reputação abaixo de verde é alerta', () => {
    const a = avaliarCatalogoML([oco(FICHA_URL, 'loja')], 'abaixo_de_verde');
    expect(tomDoCatalogo(a)).toBe('alerta');
  });
});

describe('descreverCandidato', () => {
  const cand = (campos: Partial<CandidatoAAnuncio> = {}): CandidatoAAnuncio => ({
    id: 's1',
    titulo: 'Refil PA21G',
    temEan: true,
    temCusto: true,
    compatibilidadesPublicaveis: 2,
    ...campos,
  });

  it('diz o que falta antes de a pessoa escolher', () => {
    // Para ela não montar um anúncio só para descobrir que falta código de barras.
    const r = descreverCandidato(cand({ temEan: false, temCusto: false }));
    expect(r).toContain('sem código de barras');
    expect(r).toContain('sem custo');
  });

  it('SKU completo mostra quantos modelos já publicam', () => {
    expect(descreverCandidato(cand())).toContain('2 modelos publicáveis');
  });

  it('sem modelo publicável é uma falta, e aparece', () => {
    expect(descreverCandidato(cand({ compatibilidadesPublicaveis: 0 }))).toContain(
      'sem modelo publicável',
    );
  });
});

describe('avisos', () => {
  it('código desconhecido não vira caixa vazia', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código declarado tem título e corpo', () => {
    for (const c of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(c);
      expect(aviso, c).not.toBeNull();
      expect(aviso?.corpo.length ?? 0, c).toBeGreaterThan(20);
    }
  });

  it('campo inválido é nomeado, e o formato esperado vem junto', () => {
    const a = avisoDeCamposInvalidos(['preco', 'qtd']);
    expect(a.corpo).toContain('preco');
    expect(a.corpo).toContain('89,90');
  });
});
