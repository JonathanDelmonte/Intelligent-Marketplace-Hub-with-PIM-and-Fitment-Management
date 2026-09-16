import { describe, expect, it } from 'vitest';
import { centavos, pontosBase, reaisParaCentavos, ZERO } from '@/lib/dinheiro';
import {
  CAMPOS_PRESUMIVEIS,
  DEVOLUCAO_PRESUMIDA_BP,
  EMBALAGEM_PRESUMIDA_CENTAVOS,
  O_QUE_O_PRESUMIDO_CUSTA,
  PESO_PRESUMIDO_GRAMAS,
  entradaParaMargem,
} from './entrada';
import type { FichaParaMargem } from './entrada';
import { calcularMargem } from './margem';
import type { ContextoDoVendedor } from './tipos';

const VENDEDOR: ContextoDoVendedor = { regimeFiscal: 'cpf', temCnpj: false };

const ficha = (campos: Partial<FichaParaMargem> = {}) => ({
  custoAtual: reaisParaCentavos(20),
  pesoG: 500,
  taxaDevolucaoEsperadaBp: pontosBase(300),
  embalagem: reaisParaCentavos(2),
  ...campos,
});

const montar = (campos: Partial<FichaParaMargem> = {}) =>
  entradaParaMargem({
    ficha: ficha(campos),
    plataforma: 'ml',
    vendedor: VENDEDOR,
    modoFrete: 'vendedor_paga',
    tipoAnuncioML: 'classico',
  });

describe('entradaParaMargem', () => {
  it('ficha completa não presume nada', () => {
    const r = montar();
    expect(r.presumidos).toEqual([]);
    expect(r.semCusto).toBe(false);
    expect(r.base.pesoGramas).toBe(500);
    expect(r.base.custoProduto).toBe(reaisParaCentavos(20));
  });

  it('cada campo ausente entra presumido, e é declarado', () => {
    // Presunção que não aparece na tela é a forma mais barata de perder dinheiro com
    // confiança.
    const r = montar({ pesoG: null, taxaDevolucaoEsperadaBp: null, embalagem: null });

    expect(r.presumidos).toEqual(['peso', 'embalagem', 'devolucao']);
    expect(r.base.pesoGramas).toBe(PESO_PRESUMIDO_GRAMAS);
    expect(r.base.embalagem).toBe(centavos(EMBALAGEM_PRESUMIDA_CENTAVOS));
    expect(r.base.taxaDevolucaoEsperada).toBe(pontosBase(DEVOLUCAO_PRESUMIDA_BP));
  });

  it('embalagem ausente do objeto conta como presumida', () => {
    // A ficha do SKU não tem coluna de embalagem hoje, então o campo chega `undefined`
    // e não `null`. Os dois são "não sei".
    const r = entradaParaMargem({
      ficha: { custoAtual: reaisParaCentavos(20), pesoG: 500, taxaDevolucaoEsperadaBp: null },
      plataforma: 'ml',
      vendedor: VENDEDOR,
      modoFrete: 'vendedor_paga',
    });
    expect(r.presumidos).toContain('embalagem');
  });

  it('a ordem dos presumidos é a declarada, e não a de descoberta', () => {
    const r = montar({ taxaDevolucaoEsperadaBp: null, pesoG: null });
    expect(r.presumidos).toEqual(CAMPOS_PRESUMIVEIS.filter((c) => c !== 'embalagem'));
  });

  it('custo ausente entra zero, e não presumido', () => {
    // Presumir custo erraria para o lado otimista, que é o pior lado.
    const r = montar({ custoAtual: null });
    expect(r.semCusto).toBe(true);
    expect(r.presumidos).not.toContain('custo');
    expect(r.base.custoProduto).toBe(ZERO);
  });

  it('e o M8 avisa que a margem sem custo é o teto', async () => {
    const r = montar({ custoAtual: null });
    const margem = calcularMargem({ ...r.base, preco: reaisParaCentavos(100) });

    expect(margem.avisos.map((a) => a.codigo)).toContain('custo_nao_informado');
    expect(margem.markupSobreCusto).toBeNull();
    await Promise.resolve();
  });

  it('a entrada montada alimenta o M8 sem tradução', () => {
    const r = montar();
    const margem = calcularMargem({ ...r.base, preco: reaisParaCentavos(100) });

    expect(margem.decomposicao.custoProduto).toBe(reaisParaCentavos(20));
    expect(margem.decomposicao.embalagem).toBe(reaisParaCentavos(2));
    expect(margem.margemReais).toBeLessThan(reaisParaCentavos(100));
  });

  it('campo opcional ausente não entra como undefined na entrada', () => {
    // `exactOptionalPropertyTypes`: passar `{ categoria: undefined }` não é o mesmo que
    // não passar, e a tabela de taxas escolhe por presença de chave.
    const r = entradaParaMargem({
      ficha: ficha(),
      plataforma: 'shopee',
      vendedor: VENDEDOR,
      modoFrete: 'comprador_paga',
    });
    expect('categoria' in r.base).toBe(false);
    expect('tipoAnuncioML' in r.base).toBe(false);
  });

  it('toda presunção tem texto dizendo o que ela custa quando erra', () => {
    for (const campo of CAMPOS_PRESUMIVEIS) {
      expect(O_QUE_O_PRESUMIDO_CUSTA[campo].length).toBeGreaterThan(30);
    }
  });
});
