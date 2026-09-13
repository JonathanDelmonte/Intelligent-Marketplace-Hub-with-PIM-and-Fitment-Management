import { describe, expect, it } from 'vitest';
import {
  FATOR_FAMILIA_BP,
  inferirCompatibilidade,
  type AfirmacaoConhecida,
  type AparelhoConhecido,
} from './inferencia';
import { LIMIAR_PUBLICACAO_BP, resolverCompatibilidade, TOTAL_BP } from './resolucao';

const AGORA = new Date('2026-09-13T12:00:00.000Z');

const aparelho = (
  id: string,
  familia: string | null,
  linhagem: string | null,
): AparelhoConhecido => ({
  id,
  familia,
  linhagem,
  rotulo: `Acme ${id.toUpperCase()}`,
});

const afirma = (
  aparelhoId: string,
  decisao: AfirmacaoConhecida['decisao'],
  confiancaBp = TOTAL_BP,
  inferida = false,
): AfirmacaoConhecida => ({ aparelhoId, decisao, confiancaBp, inferida });

/** Duas cores do mesmo aparelho, e uma linha vizinha. */
const base: readonly AparelhoConhecido[] = [
  aparelho('xp21a', 'acme:xp21', 'acme:xp'),
  aparelho('xp21b', 'acme:xp21', 'acme:xp'),
  aparelho('xp26a', 'acme:xp26', 'acme:xp'),
];

const inferir = (afirmacoes: readonly AfirmacaoConhecida[], aparelhos = base) =>
  inferirCompatibilidade({ aparelhos, afirmacoes, agora: AGORA });

/** A inferência de um alvo, ou falha o teste — evita asserção de não-nulo espalhada. */
const umaInferencia = (afirmacoes: readonly AfirmacaoConhecida[], alvo: string) => {
  const achada = inferir(afirmacoes).inferencias.find((i) => i.aparelhoId === alvo);
  if (achada === undefined) throw new Error(`esperava inferência para ${alvo}`);
  return achada;
};

describe('inferência de família', () => {
  it('propaga para o irmão de família', () => {
    const r = inferir([afirma('xp21a', 'serve')]);
    const familia = r.inferencias.filter((i) => i.grau === 'familia');
    expect(familia).toHaveLength(1);
    expect(familia[0]?.aparelhoId).toBe('xp21b');
    expect(familia[0]?.origemAparelhoId).toBe('xp21a');
  });

  it('herda uma fração da confiança da origem', () => {
    const r = inferir([afirma('xp21a', 'serve', TOTAL_BP)]);
    const i = r.inferencias.find((x) => x.aparelhoId === 'xp21b');
    expect(i?.confiancaBp).toBe(FATOR_FAMILIA_BP);
  });

  it('inferência da melhor fonte possível ainda fica abaixo do corte de publicação', () => {
    // A propriedade que o fator existe para garantir: a gramática propõe, nunca publica.
    const i = umaInferencia([afirma('xp21a', 'serve', TOTAL_BP)], 'xp21b');
    expect(i.confiancaBp).toBeLessThan(LIMIAR_PUBLICACAO_BP);
    expect(resolverCompatibilidade([i.evidencia]).publicavel).toBe(false);
  });

  it('a evidência gerada entra direto na resolução, com a força da inferência', () => {
    const i = umaInferencia([afirma('xp21a', 'serve', 9_000)], 'xp21b');
    expect(i.evidencia.tipo).toBe('inferencia_familia');
    expect(i.evidencia.forcaBp).toBe(5_400);
    expect(i.evidencia.em).toBe(AGORA.toISOString());
    expect(resolverCompatibilidade([i.evidencia]).confiancaBp).toBe(5_400);
  });

  it('não sobrescreve aparelho que já tem afirmação própria', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'serve', 8_000)]);
    expect(r.inferencias.some((i) => i.aparelhoId === 'xp21b')).toBe(false);
  });

  it('preenche aparelho cuja afirmação está indefinida', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'indefinido', 0)]);
    expect(r.inferencias.some((i) => i.aparelhoId === 'xp21b' && i.grau === 'familia')).toBe(true);
  });

  it('não encadeia: inferência não serve de origem', () => {
    const r = inferir([afirma('xp21a', 'serve', TOTAL_BP, true)]);
    expect(r.inferencias).toHaveLength(0);
  });

  it('não propaga de "não serve"', () => {
    const r = inferir([afirma('xp21a', 'nao_serve')]);
    expect(r.inferencias).toHaveLength(0);
  });

  it('ignora aparelho sem família e sem linhagem', () => {
    const r = inferir([afirma('solto', 'serve')], [aparelho('solto', null, null)]);
    expect(r.inferencias).toHaveLength(0);
    expect(r.inconsistencias).toHaveLength(0);
  });

  it('escolhe a origem mais forte, e desempata de forma estável', () => {
    const aparelhos = [
      aparelho('a', 'acme:xp21', 'acme:xp'),
      aparelho('b', 'acme:xp21', 'acme:xp'),
      aparelho('c', 'acme:xp21', 'acme:xp'),
    ];
    const r = inferir([afirma('b', 'serve', 8_000), afirma('c', 'serve', 8_000)], aparelhos);
    expect(r.inferencias.map((i) => i.origemAparelhoId)).toEqual(['b']);
  });
});

describe('restrição de família', () => {
  it('serve em um e não serve no irmão é inconsistência sinalizada', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'nao_serve')]);
    expect(r.inconsistencias).toHaveLength(1);
    expect(r.inconsistencias[0]?.grupo).toBe('acme:xp21');
    expect(r.inconsistencias[0]?.descricao).toContain('mesmo aparelho');
  });

  it('família com premissa quebrada não propaga nada', () => {
    const aparelhos = [
      aparelho('xp21a', 'acme:xp21', 'acme:xp'),
      aparelho('xp21b', 'acme:xp21', 'acme:xp'),
      aparelho('xp21c', 'acme:xp21', 'acme:xp'),
    ];
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'nao_serve')], aparelhos);
    expect(r.inferencias.some((i) => i.aparelhoId === 'xp21c')).toBe(false);
  });

  it('inconsistência não é escolha silenciosa: as duas listas aparecem', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'nao_serve')]);
    expect(r.inconsistencias[0]?.serveEm).toEqual(['xp21a']);
    expect(r.inconsistencias[0]?.naoServeEm).toEqual(['xp21b']);
  });

  it('inferência anterior não gera inconsistência, porque inferência não é evidência', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp21b', 'nao_serve', 5_000, true)]);
    expect(r.inconsistencias).toHaveLength(0);
  });
});

describe('inferência de linhagem', () => {
  it('sugere a linha vizinha, com confiança muito menor', () => {
    const r = inferir([afirma('xp21a', 'serve')]);
    const linhagem = r.inferencias.find((i) => i.grau === 'linhagem');
    expect(linhagem?.aparelhoId).toBe('xp26a');
    expect(linhagem?.confiancaBp).toBeLessThan(FATOR_FAMILIA_BP);
  });

  it('sugestão de linhagem nunca chega ao corte, mesmo somando várias', () => {
    const linhagem = umaInferencia([afirma('xp21a', 'serve')], 'xp26a');
    const muitas = Array.from({ length: 10 }, () => linhagem.evidencia);
    expect(resolverCompatibilidade(muitas).publicavel).toBe(false);
  });

  it('não sugere por linhagem quando alguma linha já provou que a peça distingue linha', () => {
    const r = inferir([afirma('xp21a', 'serve'), afirma('xp26a', 'nao_serve')]);
    expect(r.inferencias.some((i) => i.grau === 'linhagem')).toBe(false);
  });

  it('a inferência de família tem precedência sobre a de linhagem para o mesmo alvo', () => {
    const r = inferir([afirma('xp21a', 'serve')]);
    const porAlvo = r.inferencias.filter((i) => i.aparelhoId === 'xp21b');
    expect(porAlvo).toHaveLength(1);
    expect(porAlvo[0]?.grau).toBe('familia');
  });

  it('diz na explicação que serve para conferir, não para publicar', () => {
    const r = inferir([afirma('xp21a', 'serve')]);
    expect(r.inferencias.find((i) => i.grau === 'linhagem')?.motivo).toContain('não vale publicar');
  });
});

describe('determinismo', () => {
  it('duas execuções com a mesma base devolvem a mesma coisa', () => {
    const a = inferir([afirma('xp21a', 'serve')]);
    const b = inferir([afirma('xp21a', 'serve')]);
    expect(a).toEqual(b);
  });

  it('a ordem de entrada não muda a saída', () => {
    const direta = inferir([afirma('xp21a', 'serve')], base);
    const invertida = inferir([afirma('xp21a', 'serve')], [...base].reverse());
    expect(direta.inferencias).toEqual(invertida.inferencias);
  });
});
