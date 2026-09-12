import { describe, expect, it } from 'vitest';
import { percentualParaPontosBase, reaisParaCentavos, somar } from '@/lib/dinheiro';
import type { Centavos } from '@/lib/dinheiro';
import { CORTE_MARKUP_MINIMO, EntradaDeMargemInvalida, calcularMargem } from './margem';
import { FIM_ZONA_MORTA_ML, LIMIAR_FAIXA_SHOPEE, LIMIAR_FRETE_GRATIS_ML } from './tabelas';
import type { CodigoAviso, ContextoDoVendedor, EntradaDeMargem } from './tipos';

const r = reaisParaCentavos;

const CPF: ContextoDoVendedor = { regimeFiscal: 'cpf', temCnpj: false };
const MEI: ContextoDoVendedor = {
  regimeFiscal: 'mei',
  temCnpj: true,
  dasMensal: r('75.90'),
  unidadesPrevistasNoMes: 60,
};
const SIMPLES: ContextoDoVendedor = {
  regimeFiscal: 'simples',
  temCnpj: true,
  aliquotaSimples: percentualParaPontosBase(6),
};

/**
 * Refil de purificador: o caso concreto que a especificação usa de exemplo.
 *
 * Há um construtor por plataforma em vez de um só com `tipoAnuncioML: undefined`
 * porque `exactOptionalPropertyTypes` distingue "chave ausente" de "chave com
 * undefined" — e essa distinção é justamente o que impede gravar `undefined` num
 * campo opcional por acidente. Aqui ela custa três construtores.
 */
const COMUM = {
  pesoGramas: 250,
  custoProduto: r(15),
  embalagem: r('1.50'),
  modoFrete: 'comprador_paga',
  taxaDevolucaoEsperada: percentualParaPontosBase(3),
  vendedor: CPF,
  em: new Date('2026-09-12T00:00:00Z'),
} as const satisfies Omit<EntradaDeMargem, 'preco' | 'plataforma'>;

function refil(sobrepor: Partial<EntradaDeMargem> = {}): EntradaDeMargem {
  return { ...COMUM, preco: r(69), plataforma: 'ml', tipoAnuncioML: 'classico', ...sobrepor };
}

function naShopee(sobrepor: Partial<EntradaDeMargem> = {}): EntradaDeMargem {
  return { ...COMUM, preco: r(69), plataforma: 'shopee', ...sobrepor };
}

function naAmazon(sobrepor: Partial<EntradaDeMargem> = {}): EntradaDeMargem {
  return { ...COMUM, preco: r(69), plataforma: 'amazon', ...sobrepor };
}

const codigos = (avisos: readonly { codigo: CodigoAviso }[]) => avisos.map((a) => a.codigo);

describe('calcularMargem — identidade contábil', () => {
  it('a decomposição sempre fecha com a margem', () => {
    const entradas: EntradaDeMargem[] = [
      refil(),
      refil({ preco: r(39) }),
      refil({ preco: r(150), vendedor: MEI }),
      refil({ preco: r(250), tipoAnuncioML: 'premium', vendedor: SIMPLES }),
      naShopee({ preco: r(45) }),
      naShopee({ preco: r(120), emCampanha: true }),
      naAmazon({ preco: r(99) }),
    ];

    for (const entrada of entradas) {
      const res = calcularMargem(entrada);
      const d = res.decomposicao;

      const retido = somar(
        d.comissao,
        d.custoFixoPlataforma,
        d.frete,
        ...d.acrescimos.map((a) => a.valor),
      );
      expect(res.repasseLiquido).toBe(d.preco - retido);

      const proprios = somar(d.custoProduto, d.embalagem, d.tributo, d.provisaoDevolucao);
      expect(res.margemReais).toBe(res.repasseLiquido - proprios);
    }
  });

  it('registra qual tabela foi usada, para auditoria', () => {
    expect(calcularMargem(refil()).tabelaUsada).toContain('ML');
    expect(calcularMargem(naShopee()).tabelaUsada).toContain('Shopee');
  });
});

describe('validação de entrada', () => {
  it('recusa preço zero ou negativo', () => {
    expect(() => calcularMargem(refil({ preco: 0 as Centavos }))).toThrow(EntradaDeMargemInvalida);
    expect(() => calcularMargem(refil({ preco: r(-10) }))).toThrow(EntradaDeMargemInvalida);
  });

  it('recusa custo ou embalagem negativos', () => {
    expect(() => calcularMargem(refil({ custoProduto: r(-1) }))).toThrow(EntradaDeMargemInvalida);
    expect(() => calcularMargem(refil({ embalagem: r(-1) }))).toThrow(EntradaDeMargemInvalida);
  });

  it('recusa peso negativo ou não numérico', () => {
    expect(() => calcularMargem(refil({ pesoGramas: -1 }))).toThrow(EntradaDeMargemInvalida);
    expect(() => calcularMargem(refil({ pesoGramas: Number.NaN }))).toThrow(
      EntradaDeMargemInvalida,
    );
  });

  it('exige tipo de anúncio no ML, porque é ele que decide a comissão', () => {
    // A chave é ausente, não `undefined`: é assim que um chamador esqueceria.
    const semTipo: EntradaDeMargem = { ...COMUM, preco: r(69), plataforma: 'ml' };
    expect(() => calcularMargem(semTipo)).toThrow(/tipo de anúncio/);
  });

  it('não exige tipo de anúncio nas outras plataformas', () => {
    expect(() => calcularMargem(naShopee())).not.toThrow();
  });
});

describe('Mercado Livre — o degrau do frete grátis', () => {
  it('abaixo do limiar, paga taxa fixa e o comprador paga o frete', () => {
    const res = calcularMargem(refil({ preco: r(70) }));
    expect(res.decomposicao.custoFixoPlataforma).toBe(r('6.75'));
    expect(res.decomposicao.frete).toBe(0);
  });

  it('no limiar, a taxa fixa desaparece e o frete vira custo do vendedor', () => {
    const res = calcularMargem(refil({ preco: LIMIAR_FRETE_GRATIS_ML }));
    expect(res.decomposicao.custoFixoPlataforma).toBe(0);
    expect(res.decomposicao.frete).toBeGreaterThan(0);
  });

  it('um centavo antes do limiar ainda é o mundo antigo', () => {
    const antes = calcularMargem(refil({ preco: (LIMIAR_FRETE_GRATIS_ML - 1) as Centavos }));
    expect(antes.decomposicao.custoFixoPlataforma).toBe(r('6.75'));
    expect(antes.decomposicao.frete).toBe(0);
  });

  it('a margem CAI ao cruzar o limiar, mesmo o preço subindo — é a zona morta', () => {
    // O achado central da especificação: trocar R$ 6,50 de taxa fixa por R$ 18+
    // de frete é mau negócio, e o gráfico precisa mostrar essa queda.
    const antes = calcularMargem(refil({ preco: (LIMIAR_FRETE_GRATIS_ML - 1) as Centavos }));
    const depois = calcularMargem(refil({ preco: LIMIAR_FRETE_GRATIS_ML }));
    expect(depois.margemReais).toBeLessThan(antes.margemReais);
  });

  it('paga o frete grátis mesmo com modoFrete comprador_paga acima do limiar', () => {
    // A plataforma obriga, então o cálculo não pode depender de o usuário marcar
    // a opção certa.
    const res = calcularMargem(refil({ preco: r(150), modoFrete: 'comprador_paga' }));
    expect(res.decomposicao.frete).toBeGreaterThan(0);
  });

  it('retirada nunca cobra frete do vendedor', () => {
    const res = calcularMargem(refil({ preco: r(150), modoFrete: 'retirada' }));
    expect(res.decomposicao.frete).toBe(0);
  });

  it('usa o frete conhecido em vez da estimativa por peso', () => {
    const res = calcularMargem(refil({ preco: r(150), freteConhecido: r('19.90') }));
    expect(res.decomposicao.frete).toBe(r('19.90'));
  });

  it('estima o frete por peso quando não há valor conhecido', () => {
    const leve = calcularMargem(refil({ preco: r(150), pesoGramas: 200 }));
    const pesado = calcularMargem(refil({ preco: r(150), pesoGramas: 4000 }));
    expect(pesado.decomposicao.frete).toBeGreaterThan(leve.decomposicao.frete);
  });

  it('as faixas fixas seguem os degraus de R$ 29 e R$ 50', () => {
    expect(calcularMargem(refil({ preco: r(20) })).decomposicao.custoFixoPlataforma).toBe(r(6));
    expect(calcularMargem(refil({ preco: r(35) })).decomposicao.custoFixoPlataforma).toBe(
      r('6.50'),
    );
    expect(calcularMargem(refil({ preco: r(60) })).decomposicao.custoFixoPlataforma).toBe(
      r('6.75'),
    );
  });

  it('premium cobra mais comissão que clássico no mesmo preço', () => {
    const classico = calcularMargem(refil({ preco: r(200), tipoAnuncioML: 'classico' }));
    const premium = calcularMargem(refil({ preco: r(200), tipoAnuncioML: 'premium' }));
    expect(premium.decomposicao.comissao).toBeGreaterThan(classico.decomposicao.comissao);
    expect(premium.margemReais).toBeLessThan(classico.margemReais);
  });
});

describe('Shopee — degrau de comissão e acréscimos', () => {
  const shopee = (sobrepor: Partial<EntradaDeMargem> = {}) => naShopee(sobrepor);

  it('abaixo do limiar: comissão de 20% e taxa de R$ 4 por item', () => {
    const res = calcularMargem(shopee({ preco: r(50), vendedor: SIMPLES }));
    expect(res.decomposicao.comissao).toBe(r(10));
    expect(res.decomposicao.custoFixoPlataforma).toBe(r(4));
  });

  it('acima do limiar: comissão cai para 14% e a taxa por item some', () => {
    const res = calcularMargem(shopee({ preco: r(100), vendedor: SIMPLES }));
    expect(res.decomposicao.comissao).toBe(r(14));
    expect(res.decomposicao.custoFixoPlataforma).toBe(0);
  });

  it('a comissão em pontos cai exatamente no limiar', () => {
    const antes = calcularMargem(shopee({ preco: (LIMIAR_FAIXA_SHOPEE - 1) as Centavos }));
    const depois = calcularMargem(shopee({ preco: LIMIAR_FAIXA_SHOPEE }));
    // R$ 79,99 a 20% = R$ 16,00 · R$ 80,00 a 14% = R$ 11,20
    expect(antes.decomposicao.comissao).toBe(r(16));
    expect(depois.decomposicao.comissao).toBe(r('11.20'));
  });

  it('cobra R$ 3 por item de vendedor sem CNPJ', () => {
    const comCnpj = calcularMargem(shopee({ preco: r(50), vendedor: SIMPLES }));
    const semCnpj = calcularMargem(shopee({ preco: r(50), vendedor: CPF }));
    expect(comCnpj.decomposicao.acrescimos).toHaveLength(0);
    expect(semCnpj.decomposicao.acrescimos).toHaveLength(1);
    expect(semCnpj.decomposicao.acrescimos[0]?.valor).toBe(r(3));
  });

  it('cobra 2,5% adicionais em campanha', () => {
    const res = calcularMargem(shopee({ preco: r(200), vendedor: SIMPLES, emCampanha: true }));
    const campanha = res.decomposicao.acrescimos.find((a) => a.rotulo.includes('campanha'));
    expect(campanha?.valor).toBe(r(5));
  });

  it('acumula os dois acréscimos quando as duas condições valem', () => {
    const res = calcularMargem(shopee({ preco: r(200), vendedor: CPF, emCampanha: true }));
    expect(res.decomposicao.acrescimos).toHaveLength(2);
    expect(somar(...res.decomposicao.acrescimos.map((a) => a.valor))).toBe(r(8));
  });
});

describe('Amazon', () => {
  const amazon = (sobrepor: Partial<EntradaDeMargem> = {}) => naAmazon(sobrepor);

  it('cobra a taxa por item do plano individual em qualquer preço', () => {
    expect(calcularMargem(amazon({ preco: r(30) })).decomposicao.custoFixoPlataforma).toBe(r(2));
    expect(calcularMargem(amazon({ preco: r(300) })).decomposicao.custoFixoPlataforma).toBe(r(2));
  });

  it('não tem limiar de frete grátis obrigatório', () => {
    const res = calcularMargem(amazon({ preco: r(300), modoFrete: 'comprador_paga' }));
    expect(res.decomposicao.frete).toBe(0);
  });

  it('cobra frete quando o vendedor assume', () => {
    const res = calcularMargem(amazon({ preco: r(300), modoFrete: 'vendedor_paga' }));
    expect(res.decomposicao.frete).toBeGreaterThan(0);
  });
});

describe('regime fiscal', () => {
  it('CPF não lança tributo, mas declara a incerteza', () => {
    const res = calcularMargem(refil({ vendedor: CPF }));
    expect(res.decomposicao.tributo).toBe(0);
    expect(codigos(res.avisos)).toContain('regime_cpf_sem_tributo');
  });

  it('MEI rateia o DAS por unidade prevista', () => {
    // R$ 75,90 em 60 unidades = R$ 1,265 → a primeira fatia é R$ 1,27.
    const res = calcularMargem(refil({ vendedor: MEI }));
    expect(res.decomposicao.tributo).toBe(127);
  });

  it('MEI sem unidades previstas avisa em vez de fingir tributo zero', () => {
    const res = calcularMargem(
      refil({ vendedor: { regimeFiscal: 'mei', temCnpj: true, dasMensal: r('75.90') } }),
    );
    expect(res.decomposicao.tributo).toBe(0);
    expect(codigos(res.avisos)).toContain('das_sem_unidades_previstas');
  });

  it('MEI com zero unidades previstas não divide por zero', () => {
    const res = calcularMargem(
      refil({
        vendedor: {
          regimeFiscal: 'mei',
          temCnpj: true,
          dasMensal: r('75.90'),
          unidadesPrevistasNoMes: 0,
        },
      }),
    );
    expect(res.decomposicao.tributo).toBe(0);
    expect(codigos(res.avisos)).toContain('das_sem_unidades_previstas');
  });

  it('Simples aplica a alíquota sobre o preço', () => {
    const res = calcularMargem(refil({ preco: r(100), vendedor: SIMPLES }));
    expect(res.decomposicao.tributo).toBe(r(6));
  });

  it('Simples sem alíquota avisa', () => {
    const res = calcularMargem(refil({ vendedor: { regimeFiscal: 'simples', temCnpj: true } }));
    expect(res.decomposicao.tributo).toBe(0);
    expect(codigos(res.avisos)).toContain('das_sem_unidades_previstas');
  });

  it('MEI com mais unidades previstas dilui o DAS por unidade', () => {
    const poucas = calcularMargem(refil({ vendedor: { ...MEI, unidadesPrevistasNoMes: 10 } }));
    const muitas = calcularMargem(refil({ vendedor: { ...MEI, unidadesPrevistasNoMes: 200 } }));
    expect(muitas.decomposicao.tributo).toBeLessThan(poucas.decomposicao.tributo);
  });
});

describe('provisão de devolução', () => {
  it('entra como custo e cresce com a taxa esperada', () => {
    const baixa = calcularMargem(refil({ taxaDevolucaoEsperada: percentualParaPontosBase(1) }));
    const alta = calcularMargem(refil({ taxaDevolucaoEsperada: percentualParaPontosBase(10) }));
    expect(alta.decomposicao.provisaoDevolucao).toBeGreaterThan(
      baixa.decomposicao.provisaoDevolucao,
    );
    expect(alta.margemReais).toBeLessThan(baixa.margemReais);
  });

  it('é zero quando a taxa esperada é zero', () => {
    const res = calcularMargem(refil({ taxaDevolucaoEsperada: percentualParaPontosBase(0) }));
    expect(res.decomposicao.provisaoDevolucao).toBe(0);
  });

  it('cresce com o frete, porque devolução paga ida e volta', () => {
    const semFrete = calcularMargem(refil({ preco: r(70), modoFrete: 'comprador_paga' }));
    const comFrete = calcularMargem(refil({ preco: r(70), modoFrete: 'vendedor_paga' }));
    expect(comFrete.decomposicao.provisaoDevolucao).toBeGreaterThan(
      semFrete.decomposicao.provisaoDevolucao,
    );
  });
});

describe('avisos', () => {
  it('margem negativa é alerta vermelho', () => {
    const res = calcularMargem(refil({ preco: r(20), custoProduto: r(18) }));
    expect(res.margemReais).toBeLessThan(0);
    const aviso = res.avisos.find((a) => a.codigo === 'margem_negativa');
    expect(aviso?.severidade).toBe('vermelho');
    expect(aviso?.mensagem).toContain('Não publique');
  });

  it('zona morta do ML é alerta vermelho e cita as faixas boas', () => {
    const res = calcularMargem(refil({ preco: r(95), custoProduto: r(20) }));
    const aviso = res.avisos.find((a) => a.codigo === 'zona_morta_ml');
    expect(aviso?.severidade).toBe('vermelho');
    expect(aviso?.mensagem).toContain('Zona morta');
  });

  it('a zona morta começa no limiar e termina no fim declarado', () => {
    const antes = calcularMargem(refil({ preco: (LIMIAR_FRETE_GRATIS_ML - 1) as Centavos }));
    const dentroInicio = calcularMargem(refil({ preco: LIMIAR_FRETE_GRATIS_ML }));
    const dentroFim = calcularMargem(refil({ preco: (FIM_ZONA_MORTA_ML - 1) as Centavos }));
    const depois = calcularMargem(refil({ preco: FIM_ZONA_MORTA_ML }));

    expect(codigos(antes.avisos)).not.toContain('zona_morta_ml');
    expect(codigos(dentroInicio.avisos)).toContain('zona_morta_ml');
    expect(codigos(dentroFim.avisos)).toContain('zona_morta_ml');
    expect(codigos(depois.avisos)).not.toContain('zona_morta_ml');
  });

  it('a zona morta é só do ML', () => {
    const res = calcularMargem(naShopee({ preco: r(95) }));
    expect(codigos(res.avisos)).not.toContain('zona_morta_ml');
  });

  it('markup abaixo de 3x é avisado', () => {
    const res = calcularMargem(refil({ preco: r(200), custoProduto: r(100) }));
    expect(res.markupSobreCusto).toBeLessThan(CORTE_MARKUP_MINIMO);
    expect(codigos(res.avisos)).toContain('markup_abaixo_do_corte');
  });

  it('markup acima de 3x não é avisado', () => {
    const res = calcularMargem(refil({ preco: r(200), custoProduto: r(40) }));
    expect(res.markupSobreCusto).toBeGreaterThanOrEqual(CORTE_MARKUP_MINIMO);
    expect(codigos(res.avisos)).not.toContain('markup_abaixo_do_corte');
  });

  it('custo zero avisa que a margem é o teto e não a real', () => {
    const res = calcularMargem(refil({ custoProduto: 0 as Centavos }));
    expect(res.markupSobreCusto).toBeNull();
    expect(codigos(res.avisos)).toContain('custo_nao_informado');
    expect(codigos(res.avisos)).not.toContain('markup_abaixo_do_corte');
  });

  it('taxa fixa dominante avisa que subir o preço vale mais que cortar custo', () => {
    // R$ 6,00 de taxa fixa sobre R$ 20,00 é 30% do preço.
    const res = calcularMargem(refil({ preco: r(20), custoProduto: r(2) }));
    expect(codigos(res.avisos)).toContain('taxa_fixa_domina');
  });

  it('ticket abaixo do corte é informativo, não bloqueio', () => {
    const res = calcularMargem(refil({ preco: r(50) }));
    const aviso = res.avisos.find((a) => a.codigo === 'ticket_abaixo_do_corte');
    expect(aviso?.severidade).toBe('informativo');
  });

  it('anúncio de catálogo avisa sobre reputação verde', () => {
    const res = calcularMargem(refil({ preco: r(200), tipoAnuncioML: 'catalogo' }));
    expect(codigos(res.avisos)).toContain('catalogo_sem_reputacao');
  });

  it('tabela manual sempre avisa que é presumida', () => {
    // Todas as tabelas de hoje são manuais; o aviso desaparece quando
    // listing_prices responder e a tabela entrar com fonte m3_api.
    for (const entrada of [refil(), naShopee(), naAmazon()]) {
      const res = calcularMargem(entrada);
      expect(codigos(res.avisos), entrada.plataforma).toContain('tabela_presumida');
    }
  });

  it('margem apertada avisa mesmo sendo positiva', () => {
    const res = calcularMargem(refil({ preco: r(70), custoProduto: r(50) }));
    expect(res.margemReais).toBeGreaterThanOrEqual(0);
    expect(codigos(res.avisos)).toContain('margem_apertada');
  });

  it('margem saudável não gera aviso de margem', () => {
    const res = calcularMargem(refil({ preco: r(200), custoProduto: r(30) }));
    expect(codigos(res.avisos)).not.toContain('margem_negativa');
    expect(codigos(res.avisos)).not.toContain('margem_apertada');
  });
});

describe('caso concreto — refil de purificador a R$ 69 no clássico', () => {
  it('fecha com os números esperados linha por linha', () => {
    const res = calcularMargem(refil({ preco: r(69), custoProduto: r(15), vendedor: MEI }));
    const d = res.decomposicao;

    expect(d.comissao).toBe(r('8.28')); // 12% de R$ 69,00
    expect(d.custoFixoPlataforma).toBe(r('6.75')); // faixa R$ 50–79
    expect(d.frete).toBe(0); // abaixo do limiar, comprador paga
    expect(d.custoProduto).toBe(r(15));
    expect(d.embalagem).toBe(r('1.50'));
    expect(d.tributo).toBe(127); // DAS rateado em 60 unidades
    expect(d.provisaoDevolucao).toBe(r('0.50')); // 3% de (15 + 1,50)

    expect(res.repasseLiquido).toBe(r('53.97')); // 69 − 8,28 − 6,75
    expect(res.margemReais).toBe(r('35.70')); // 53,97 − 15 − 1,50 − 1,27 − 0,50
    expect(res.margemPontosBase).toBe(5174); // 51,74%
    expect(res.markupSobreCusto).toBeCloseTo(4.6, 5);
  });
});
