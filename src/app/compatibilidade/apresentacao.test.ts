import { describe, expect, it } from 'vitest';
import type { Evidencia, TipoDeEvidencia } from '@/dominio/compatibilidade/evidencia';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP } from '@/dominio/compatibilidade/resolucao';
import {
  CODIGOS_DE_AVISO,
  descreverAviso,
  emPorcento,
  estadoDaBase,
  explicarSituacao,
  resumoDasEvidencias,
  rotuloDaConfianca,
  rotuloDaDecisao,
} from './apresentacao';

const ev = (tipo: TipoDeEvidencia, negativa = false): Evidencia => ({
  tipo,
  url: null,
  trecho: null,
  em: '2026-09-01T00:00:00.000Z',
  negativa,
  forcaBp: null,
});

describe('emPorcento', () => {
  it('converte pontos-base em porcentagem legível', () => {
    expect(emPorcento(TOTAL_BP)).toBe('100%');
    expect(emPorcento(LIMIAR_PUBLICACAO_BP)).toBe('70%');
    expect(emPorcento(0)).toBe('0%');
  });

  it('arredonda a âncora de três concorrentes para o número que a pessoa espera', () => {
    expect(emPorcento(8_001)).toBe('80%');
  });
});

describe('rotuloDaConfianca', () => {
  it('dá palavra para cada faixa', () => {
    expect(rotuloDaConfianca(TOTAL_BP)).toBe('confirmado');
    expect(rotuloDaConfianca(8_001)).toBe('suficiente');
    expect(rotuloDaConfianca(4_152)).toBe('indício');
    expect(rotuloDaConfianca(0)).toBe('fraco');
  });

  it('a fronteira de "suficiente" é o corte de publicação, não um número solto', () => {
    expect(rotuloDaConfianca(LIMIAR_PUBLICACAO_BP)).toBe('suficiente');
    expect(rotuloDaConfianca(LIMIAR_PUBLICACAO_BP - 1)).toBe('indício');
  });
});

describe('rotuloDaDecisao', () => {
  it('não usa o vocabulário do banco', () => {
    expect(rotuloDaDecisao('serve')).toBe('serve');
    expect(rotuloDaDecisao('nao_serve')).toBe('não serve');
    expect(rotuloDaDecisao('indefinido')).toBe('ninguém confirmou');
  });
});

describe('resumoDasEvidencias', () => {
  it('agrupa por tipo com a contagem', () => {
    expect(resumoDasEvidencias([ev('concorrente'), ev('concorrente'), ev('forum')])).toEqual([
      '2 × anúncio de concorrente',
      'fórum ou grupo de assistência',
    ]);
  });

  it('põe a fonte mais forte primeiro', () => {
    const resumo = resumoDasEvidencias([ev('forum'), ev('manual_fabricante')]);
    expect(resumo[0]).toBe('manual do fabricante');
  });

  it('marca quem diz que não serve', () => {
    expect(resumoDasEvidencias([ev('manual_fabricante', true)])).toEqual([
      'manual do fabricante (diz que não serve)',
    ]);
  });

  it('lista vazia é lista vazia', () => {
    expect(resumoDasEvidencias([])).toEqual([]);
  });
});

describe('explicarSituacao', () => {
  const linha = (campos: Partial<Parameters<typeof explicarSituacao>[0]> = {}) => ({
    decisao: 'serve' as const,
    confiancaBp: TOTAL_BP,
    conflito: null,
    evidencias: [ev('manual_fabricante')],
    ...campos,
  });

  it('conflito vem antes de tudo, porque é o aviso de que pode estar errado', () => {
    const texto = explicarSituacao(linha({ conflito: 'o manual e um fórum discordam' }));
    expect(texto).toContain('discordam');
    expect(texto).toContain('Nada vai para o anúncio');
  });

  it('diz que está pronto quando está pronto', () => {
    expect(explicarSituacao(linha())).toContain('Pronto para entrar na ficha');
  });

  it('explica a dedução de irmão sem usar a palavra "inferência"', () => {
    const texto = explicarSituacao(
      linha({ confiancaBp: 6_000, evidencias: [ev('inferencia_familia')] }),
    );
    expect(texto).toContain('modelo irmão');
    expect(texto).not.toContain('inferência');
  });

  it('não chama linha vizinha de irmão, que é outro aparelho', () => {
    // Apareceu dirigindo a tela: o PA31G, que é outra linha, vinha escrito como
    // "deduzido de um modelo irmão". É a distinção que os dois fatores de
    // confiança existem para fazer.
    const texto = explicarSituacao(
      linha({ confiancaBp: 2_500, evidencias: [ev('inferencia_linhagem')] }),
    );
    expect(texto).toContain('linha vizinha');
    expect(texto).not.toContain('irmão');
  });

  it('quando falta evidência, diz quanto falta', () => {
    const texto = explicarSituacao(linha({ confiancaBp: 4_000, evidencias: [ev('forum')] }));
    expect(texto).toContain('40%');
    expect(texto).toContain('70%');
  });

  it('trata "ninguém confirmou" como convite, não como erro', () => {
    const texto = explicarSituacao(
      linha({ decisao: 'indefinido', confiancaBp: 0, evidencias: [ev('anuncio_proprio')] }),
    );
    expect(texto).toContain('Um clique seu resolve');
  });

  it('registra o "não serve" como informação útil', () => {
    const texto = explicarSituacao(linha({ decisao: 'nao_serve' }));
    expect(texto).toContain('não sugerir por engano');
  });
});

describe('descreverAviso', () => {
  it('devolve nulo sem código e para código desconhecido', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código declarado tem aviso com título e corpo', () => {
    for (const codigo of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(codigo);
      expect(aviso, codigo).not.toBeNull();
      expect(aviso?.titulo, codigo).not.toBe('');
      expect(aviso?.corpo, codigo).not.toBe('');
    }
  });

  it('a procura diz quantas afirmações novas encontrou', () => {
    expect(descreverAviso('coletado', 4)?.titulo).toContain('4');
  });

  it('distingue "nada mudou" de "não havia anúncio"', () => {
    // Os dois cabiam na mesma mensagem, e juntá-los fazia a tela dizer "nenhum
    // anúncio cita um modelo cadastrado" com a ficha cheia na mesma página.
    expect(descreverAviso('sem_coleta')?.corpo).toContain('já estava na base');
    expect(descreverAviso('sem_anuncio')?.corpo).toContain('Importe uma planilha');
  });

  it('falha diz que nada foi alterado', () => {
    expect(descreverAviso('falha')?.corpo).toContain('Nada foi alterado');
  });
});

describe('estadoDaBase', () => {
  it('sem produto no catálogo, manda para o começo da cadeia', () => {
    const aviso = estadoDaBase({ aparelhos: 0, publicaveis: 0, emRevisao: 0, skus: 0 });
    expect(aviso?.corpo).toContain('produtos repetidos');
  });

  it('com produto e sem aparelho, pede o primeiro aparelho', () => {
    const aviso = estadoDaBase({ aparelhos: 0, publicaveis: 0, emRevisao: 0, skus: 3 });
    expect(aviso?.titulo).toContain('Nenhum aparelho');
  });

  it('com aparelho e sem afirmação, aponta o botão de procurar', () => {
    const aviso = estadoDaBase({ aparelhos: 2, publicaveis: 0, emRevisao: 0, skus: 3 });
    expect(aviso?.corpo).toContain('Procurar nos anúncios');
  });

  it('cala a boca quando a base está andando', () => {
    expect(estadoDaBase({ aparelhos: 2, publicaveis: 5, emRevisao: 1, skus: 3 })).toBeNull();
  });
});
