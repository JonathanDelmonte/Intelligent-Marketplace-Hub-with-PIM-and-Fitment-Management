/**
 * Testes do veredito de compra.
 *
 * Cada caso é uma decisão de dinheiro. O que se verifica não é que a função
 * devolve algo: é que ela devolve **não** quando o negócio não presta, e que o
 * "até quanto posso pagar" é exatamente a fronteira do próprio veredito.
 */
import { describe, expect, it } from 'vitest';
import { centavos, pontosBase, type Centavos } from '@/lib/dinheiro';
import type { EntradaSemPreco } from '@/dominio/precificacao/simulador';
import { CORTE_MARKUP_MINIMO, MARGEM_APERTADA_BP, calcularMargem } from '@/dominio/precificacao';
import type { Fonte } from '@/dominio/procedencia';
import {
  CRITERIO_PADRAO,
  ROTULO_DO_VEREDITO,
  VEREDITOS,
  VeredictoSemEvidencia,
  confiancaDe,
  custoMaximoQueAindaCompra,
  decidirCompra,
  dispersaoBp,
  medianaDePrecos,
  melhorNivelDeProcedencia,
  type EvidenciaDePreco,
} from './veredito';

const AGORA = new Date('2026-09-12T12:00:00.000Z');

/** Vendedor MEI com CNPJ, o caso do perfil real. */
const BASE: Omit<EntradaSemPreco, 'custoProduto'> = {
  plataforma: 'ml',
  tipoAnuncioML: 'classico',
  pesoGramas: 300,
  embalagem: centavos(150),
  modoFrete: 'comprador_paga',
  taxaDevolucaoEsperada: pontosBase(200),
  vendedor: {
    regimeFiscal: 'mei',
    temCnpj: true,
    dasMensal: centavos(7500),
    unidadesPrevistasNoMes: 100,
  },
};

function evidencia(
  reais: number,
  opcoes: { readonly fonte?: Fonte; readonly diasAtras?: number } = {},
): EvidenciaDePreco {
  const dias = opcoes.diasAtras ?? 1;
  return {
    preco: centavos(Math.round(reais * 100)),
    procedencia: {
      fonte: opcoes.fonte ?? 'm1_planilha',
      coletadoEm: new Date(AGORA.getTime() - dias * 86_400_000),
    },
  };
}

const decidir = (custoReais: number, evidencias: readonly EvidenciaDePreco[]) =>
  decidirCompra({
    custoUnitario: centavos(Math.round(custoReais * 100)),
    evidencias,
    base: BASE,
    em: AGORA,
  });

describe('sem evidência', () => {
  it('lista vazia é sem_dado, e diz o que fazer', () => {
    const r = decidir(10, []);

    expect(r.veredito).toBe('sem_dado');
    expect(r.precoDeReferencia).toBeNull();
    expect(r.margem).toBeNull();
    expect(r.custoMaximoParaComprar).toBeNull();
    expect(r.confiancaBp).toBe(0);
    expect(r.motivos.map((m) => m.codigo)).toContain('sem_evidencia');
  });

  it('evidência toda fora da janela é sem_dado_recente, que é outra coisa', () => {
    const r = decidir(10, [
      evidencia(69.9, { diasAtras: 200 }),
      evidencia(74.9, { diasAtras: 400 }),
    ]);

    expect(r.veredito).toBe('sem_dado_recente');
    expect(r.evidenciaVencida).toHaveLength(2);
    expect(r.evidenciaUsada).toHaveLength(0);
    expect(r.motivos.map((m) => m.codigo)).toContain('evidencia_vencida');
  });

  it('a fronteira da janela é inclusiva no último dia', () => {
    const noLimite = decidir(10, [
      evidencia(69.9, { diasAtras: CRITERIO_PADRAO.janelaDeEvidenciaDias }),
    ]);
    const passando = decidir(10, [
      evidencia(69.9, { diasAtras: CRITERIO_PADRAO.janelaDeEvidenciaDias + 1 }),
    ]);

    expect(noLimite.veredito).not.toBe('sem_dado_recente');
    expect(passando.veredito).toBe('sem_dado_recente');
  });
});

describe('escolha do preço de referência', () => {
  it('usa a mediana, não o maior — um anúncio absurdo não vira a base', () => {
    const r = decidir(10, [evidencia(69.9), evidencia(74.9), evidencia(499)]);

    expect(r.precoDeReferencia).toBe(centavos(7490));
  });

  it('mediana de quantidade par é a média dos dois centrais', () => {
    expect(medianaDePrecos([evidencia(10), evidencia(20)])).toBe(centavos(1500));
    expect(medianaDePrecos([evidencia(10), evidencia(11)])).toBe(centavos(1050));
  });

  it('lista vazia lança em vez de devolver zero', () => {
    expect(() => medianaDePrecos([])).toThrow(VeredictoSemEvidencia);
  });

  it('cinco extrações de página não sobrepujam uma leitura de API', () => {
    // Regra 3.3: dado de origem fraca não sobrescreve — e numa mediana isso quer
    // dizer que não entra na contagem junto.
    const r = decidir(10, [
      evidencia(120, { fonte: 'm3_api' }),
      evidencia(60, { fonte: 'm0_link' }),
      evidencia(61, { fonte: 'm0_link' }),
      evidencia(62, { fonte: 'm0_link' }),
      evidencia(63, { fonte: 'm0_link' }),
      evidencia(64, { fonte: 'm0_link' }),
    ]);

    expect(r.precoDeReferencia).toBe(centavos(12000));
    expect(r.evidenciaUsada).toHaveLength(1);
  });

  it('melhorNivelDeProcedencia mantém todas as do topo', () => {
    const escolhidas = melhorNivelDeProcedencia([
      evidencia(10, { fonte: 'm1_planilha' }),
      evidencia(20, { fonte: 'manual' }),
      evidencia(30, { fonte: 'manual' }),
      evidencia(40, { fonte: 'm0_link' }),
    ]);

    expect(escolhidas).toHaveLength(2);
    expect(escolhidas.map((e) => e.preco)).toEqual([centavos(2000), centavos(3000)]);
  });
});

describe('o veredito', () => {
  it('custo alto contra preço praticado é não compra, e o motivo é prejuízo', () => {
    const r = decidir(65, [evidencia(69.9), evidencia(69.9), evidencia(74.9)]);

    expect(r.veredito).toBe('nao_compra');
    expect(r.motivos.map((m) => m.codigo)).toContain('margem_negativa');
    expect(r.margem?.margemReais).toBeLessThanOrEqual(0);
  });

  it('custo baixo com evidência boa é compra', () => {
    const r = decidir(12, [evidencia(69.9), evidencia(69.9), evidencia(74.9)]);

    expect(r.veredito).toBe('compra');
    expect(r.margem?.margemReais).toBeGreaterThan(0);
    expect(r.margem?.markupSobreCusto ?? 0).toBeGreaterThanOrEqual(CORTE_MARKUP_MINIMO);
  });

  it('margem positiva mas apertada é compra com ressalva', () => {
    // Custo escolhido para cair entre zero e o corte de margem apertada.
    const evidencias = [evidencia(69.9), evidencia(69.9), evidencia(69.9)];
    const referencia = centavos(6990);
    let custoApertado: Centavos | null = null;

    for (let custo = 6900; custo > 1000; custo -= 10) {
      const m = calcularMargem({ ...BASE, preco: referencia, custoProduto: centavos(custo) });
      if (m.margemReais > 0 && m.margemPontosBase < MARGEM_APERTADA_BP) {
        custoApertado = centavos(custo);
        break;
      }
    }
    expect(custoApertado).not.toBeNull();

    const r = decidirCompra({
      custoUnitario: custoApertado!,
      evidencias,
      base: BASE,
      em: AGORA,
    });

    expect(r.veredito).toBe('compra_com_ressalva');
    expect(r.motivos.map((m) => m.codigo)).toContain('margem_apertada');
  });

  it('markup abaixo de 3x rebaixa para ressalva mesmo com margem folgada', () => {
    const r = decidir(30, [evidencia(89.9), evidencia(89.9), evidencia(89.9)]);

    expect(r.margem?.margemPontosBase ?? 0).toBeGreaterThanOrEqual(MARGEM_APERTADA_BP);
    expect(r.margem?.markupSobreCusto ?? 0).toBeLessThan(CORTE_MARKUP_MINIMO);
    expect(r.veredito).toBe('compra_com_ressalva');
    expect(r.motivos.map((m) => m.codigo)).toContain('markup_abaixo_do_corte');
  });

  it('evidência única rebaixa compra para ressalva', () => {
    const boa = decidir(12, [evidencia(69.9), evidencia(69.9), evidencia(69.9)]);
    const unica = decidir(12, [evidencia(69.9)]);

    expect(boa.veredito).toBe('compra');
    expect(unica.veredito).toBe('compra_com_ressalva');
    expect(unica.motivos.map((m) => m.codigo)).toContain('evidencia_unica');
  });

  it('preço muito espalhado rebaixa para ressalva', () => {
    const r = decidir(12, [evidencia(40), evidencia(70), evidencia(140)]);

    expect(r.motivos.map((m) => m.codigo)).toContain('dispersao_alta');
    expect(r.veredito).toBe('compra_com_ressalva');
  });

  it('ticket baixo aparece como informativo, sem rebaixar o veredito', () => {
    const r = decidir(5, [evidencia(35), evidencia(35), evidencia(35)]);

    const ticket = r.motivos.find((m) => m.codigo === 'ticket_abaixo_do_corte');
    expect(ticket?.severidade).toBe('informativo');
    // Informativo não é ressalva: o veredito continua sendo o da margem.
    expect(r.veredito).toBe('compra');
  });

  it('código de caixa avisa antes de qualquer cálculo', () => {
    const r = decidirCompra({
      custoUnitario: centavos(1200),
      codigoDeAgrupamento: true,
      unidadesNoLote: 12,
      evidencias: [evidencia(69.9), evidencia(69.9), evidencia(69.9)],
      base: BASE,
      em: AGORA,
    });

    expect(r.motivos[0]?.codigo).toBe('lote_de_agrupamento');
    expect(r.veredito).toBe('compra_com_ressalva');
  });

  it('todo veredito tem rótulo', () => {
    for (const v of VEREDITOS) expect(ROTULO_DO_VEREDITO[v]).not.toBe('');
  });
});

describe('até quanto posso pagar', () => {
  it('é exatamente a fronteira do veredito: um centavo acima deixa de ser compra', () => {
    const r = decidir(12, [evidencia(69.9), evidencia(69.9), evidencia(69.9)]);
    const maximo = r.custoMaximoParaComprar;
    expect(maximo).not.toBeNull();

    const noMaximo = decidirCompra({
      custoUnitario: maximo!,
      evidencias: [evidencia(69.9), evidencia(69.9), evidencia(69.9)],
      base: BASE,
      em: AGORA,
    });
    const umCentavoAcima = decidirCompra({
      custoUnitario: centavos(maximo! + 1),
      evidencias: [evidencia(69.9), evidencia(69.9), evidencia(69.9)],
      base: BASE,
      em: AGORA,
    });

    expect(noMaximo.veredito).toBe('compra');
    expect(umCentavoAcima.veredito).not.toBe('compra');
  });

  it('não depende do custo informado — é propriedade do preço', () => {
    const evidencias = [evidencia(69.9), evidencia(69.9), evidencia(69.9)];
    const comCustoBaixo = decidirCompra({
      custoUnitario: centavos(500),
      evidencias,
      base: BASE,
      em: AGORA,
    });
    const comCustoAlto = decidirCompra({
      custoUnitario: centavos(6000),
      evidencias,
      base: BASE,
      em: AGORA,
    });

    expect(comCustoBaixo.custoMaximoParaComprar).toBe(comCustoAlto.custoMaximoParaComprar);
  });

  it('respeita o corte de markup: nunca passa de um terço do preço', () => {
    const preco = centavos(6990);
    const maximo = custoMaximoQueAindaCompra({ base: BASE, preco });

    expect(maximo).not.toBeNull();
    expect(maximo!).toBeLessThanOrEqual(Math.floor(preco / CORTE_MARKUP_MINIMO));
  });

  it('devolve null quando nem um centavo de custo daria compra', () => {
    // Preço baixo demais: a taxa fixa come tudo antes de sobrar margem.
    const maximo = custoMaximoQueAindaCompra({ base: BASE, preco: centavos(300) });
    expect(maximo).toBeNull();
  });
});

describe('confiança e dispersão', () => {
  it('cresce com a força da fonte', () => {
    const porLink = decidir(12, [evidencia(70, { fonte: 'm0_link' })]);
    const porApi = decidir(12, [evidencia(70, { fonte: 'm3_api' })]);

    expect(porApi.confiancaBp).toBeGreaterThan(porLink.confiancaBp);
  });

  it('cresce com o tamanho da amostra até o mínimo, e para de crescer depois', () => {
    const uma = decidir(12, [evidencia(70)]);
    const tres = decidir(12, [evidencia(70), evidencia(70), evidencia(70)]);
    const dez = decidir(
      12,
      Array.from({ length: 10 }, () => evidencia(70)),
    );

    expect(tres.confiancaBp).toBeGreaterThan(uma.confiancaBp);
    expect(dez.confiancaBp).toBe(tres.confiancaBp);
  });

  it('cai quando os preços estão espalhados', () => {
    const juntos = decidir(12, [evidencia(70), evidencia(71), evidencia(72)]);
    const espalhados = decidir(12, [evidencia(40), evidencia(70), evidencia(140)]);

    expect(espalhados.confiancaBp).toBeLessThan(juntos.confiancaBp);
  });

  it('dispersão de uma observação só é zero, não indefinida', () => {
    expect(dispersaoBp([evidencia(70)], centavos(7000))).toBe(0);
    expect(dispersaoBp([], centavos(7000))).toBe(0);
    expect(dispersaoBp([evidencia(70), evidencia(70)], centavos(0))).toBe(0);
  });

  it('confiança de lista vazia é zero', () => {
    expect(confiancaDe([], centavos(7000), CRITERIO_PADRAO)).toBe(0);
  });
});

describe('critério injetável', () => {
  it('janela mais curta muda o que conta como recente', () => {
    const evidencias = [evidencia(69.9, { diasAtras: 30 })];

    const comPadrao = decidirCompra({
      custoUnitario: centavos(1200),
      evidencias,
      base: BASE,
      em: AGORA,
    });
    const comJanelaCurta = decidirCompra({
      custoUnitario: centavos(1200),
      evidencias,
      base: BASE,
      em: AGORA,
      criterio: { ...CRITERIO_PADRAO, janelaDeEvidenciaDias: 7 },
    });

    expect(comPadrao.precoDeReferencia).not.toBeNull();
    expect(comJanelaCurta.veredito).toBe('sem_dado_recente');
  });
});
