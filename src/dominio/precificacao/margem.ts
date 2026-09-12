/**
 * `calcularMargem` — o núcleo de M8.
 *
 * Função pura: mesma entrada, mesma saída, sem I/O e sem relógio (a data de
 * referência entra como parâmetro). É o que permite testar cada degrau de cada
 * plataforma sem subir nada.
 *
 * A regra que ela existe para garantir: **nunca publicar anúncio com margem
 * negativa**, e saber a margem *realizada* e não a prevista.
 */
import {
  ZERO,
  aplicarPontosBase,
  centavos,
  formatarBRL,
  proporcaoEmPontosBase,
  somar,
} from '@/lib/dinheiro';
import type { Centavos, PontosBase } from '@/lib/dinheiro';
import { provisaoDeDevolucao, tributoPorUnidade } from './fiscal';
import {
  FIM_ZONA_MORTA_ML,
  LIMIAR_FRETE_GRATIS_ML,
  RETOMADA_SAUDAVEL_ML,
  freteEstimadoML,
  fretePrograma,
  tabelaVigente,
} from './tabelas';
import type {
  Aviso,
  ComissaoConfigurada,
  DecomposicaoDeMargem,
  EntradaDeMargem,
  FaixaDeValorFixo,
  ResultadoDeMargem,
  TabelaDeTaxas,
  TipoAnuncioML,
} from './tipos';

export class EntradaDeMargemInvalida extends Error {
  override readonly name = 'EntradaDeMargemInvalida';
}

/**
 * Cortes do scanner determinístico (M7) que a tela de preço também usa, para o
 * aviso aparecer na hora de precificar e não só no garimpo.
 */
export const CORTE_MARKUP_MINIMO = 3;
export const CORTE_TICKET_MINIMO = 8000 as Centavos; // R$ 80,00
/** Abaixo disso a margem é fina o bastante para uma devolução zerar o lote. */
export const MARGEM_APERTADA_BP = 800 as PontosBase; // 8%
/** Acima disso a taxa fixa manda mais que a comissão, e o preço está baixo. */
export const TAXA_FIXA_DOMINANTE_BP = 1500 as PontosBase; // 15% do preço

export function calcularMargem(entrada: EntradaDeMargem): ResultadoDeMargem {
  validar(entrada);

  const em = entrada.em ?? new Date();
  const tabela = tabelaVigente(entrada.plataforma, em);
  const avisos: Aviso[] = [];

  const comissao = calcularComissao(entrada, tabela);
  const custoFixoPlataforma = valorDaFaixa(tabela.custoFixoPorUnidade, entrada.preco);
  const frete = calcularFrete(entrada, tabela);
  const acrescimos = calcularAcrescimos(entrada, tabela);
  const totalAcrescimos = somar(...acrescimos.map((a) => a.valor));

  const tributo = tributoPorUnidade(entrada.preco, entrada.vendedor);
  const provisao = provisaoDeDevolucao({
    custoProduto: entrada.custoProduto,
    embalagem: entrada.embalagem,
    frete,
    taxaEsperada: entrada.taxaDevolucaoEsperada,
  });

  const retidoPelaPlataforma = somar(comissao, custoFixoPlataforma, totalAcrescimos, frete);
  const repasseLiquido = centavos(entrada.preco - retidoPelaPlataforma);

  const custosProprios = somar(entrada.custoProduto, entrada.embalagem, tributo.valor, provisao);
  const margemReais = centavos(repasseLiquido - custosProprios);
  const margemPontosBase = proporcaoEmPontosBase(margemReais, entrada.preco);

  const decomposicao: DecomposicaoDeMargem = {
    preco: entrada.preco,
    comissao,
    custoFixoPlataforma,
    acrescimos,
    frete,
    custoProduto: entrada.custoProduto,
    embalagem: entrada.embalagem,
    tributo: tributo.valor,
    provisaoDevolucao: provisao,
  };

  const markupSobreCusto = entrada.custoProduto > 0 ? entrada.preco / entrada.custoProduto : null;

  avisos.push(
    ...avisosDeMargem({ entrada, margemReais, margemPontosBase, markupSobreCusto }),
    ...avisosDeEstrutura({ entrada, tabela, custoFixoPlataforma }),
    ...avisosFiscais(tributo.incerteza),
  );

  return {
    preco: entrada.preco,
    repasseLiquido,
    margemReais,
    margemPontosBase,
    markupSobreCusto,
    decomposicao,
    avisos,
    tabelaUsada: tabela.rotulo,
  };
}

// ─── Validação ───────────────────────────────────────────────────────────────

function validar(entrada: EntradaDeMargem): void {
  if (entrada.preco <= 0) {
    throw new EntradaDeMargemInvalida(`preço precisa ser positivo, recebeu ${entrada.preco}`);
  }
  if (entrada.custoProduto < 0 || entrada.embalagem < 0) {
    throw new EntradaDeMargemInvalida('custo e embalagem não podem ser negativos');
  }
  if (!Number.isFinite(entrada.pesoGramas) || entrada.pesoGramas < 0) {
    throw new EntradaDeMargemInvalida(
      `peso precisa ser número não negativo, recebeu ${String(entrada.pesoGramas)}`,
    );
  }
  if (entrada.taxaDevolucaoEsperada < 0) {
    throw new EntradaDeMargemInvalida('taxa de devolução não pode ser negativa');
  }
  if (entrada.plataforma === 'ml' && entrada.tipoAnuncioML === undefined) {
    throw new EntradaDeMargemInvalida(
      'no Mercado Livre o tipo de anúncio decide a comissão, então é obrigatório',
    );
  }
}

// ─── Componentes do cálculo ──────────────────────────────────────────────────

function calcularComissao(entrada: EntradaDeMargem, tabela: TabelaDeTaxas): Centavos {
  return aplicarPontosBase(entrada.preco, pontosBaseDaComissao(entrada, tabela.comissao));
}

function pontosBaseDaComissao(entrada: EntradaDeMargem, comissao: ComissaoConfigurada): PontosBase {
  if (comissao.tipo === 'por_tipo_anuncio') {
    const tipo: TipoAnuncioML = entrada.tipoAnuncioML ?? 'classico';
    const porCategoria =
      entrada.categoria !== undefined ? comissao.porCategoria?.[entrada.categoria] : undefined;
    return porCategoria?.[tipo] ?? comissao.porTipo[tipo];
  }

  const porCategoria =
    entrada.categoria !== undefined ? comissao.porCategoria?.[entrada.categoria] : undefined;
  if (porCategoria !== undefined) return porCategoria;

  const faixa = comissao.faixas.find(
    (f) => f.ateExclusivo === null || entrada.preco < f.ateExclusivo,
  );
  return faixa?.pontosBase ?? (0 as PontosBase);
}

/** Valor da primeira faixa cujo limite superior é maior que o preço. */
function valorDaFaixa(faixas: readonly FaixaDeValorFixo[], preco: Centavos): Centavos {
  const faixa = faixas.find((f) => f.ateExclusivo === null || preco < f.ateExclusivo);
  return faixa?.valor ?? ZERO;
}

/**
 * Frete que sai do bolso do vendedor.
 *
 * Três situações, e a terceira é o degrau que define a precificação no ML:
 *
 * 1. `retirada` ou `comprador_paga` abaixo do limiar → zero.
 * 2. `vendedor_paga` → o valor conhecido, ou a estimativa por peso.
 * 3. `comprador_paga` **acima** do limiar de frete grátis obrigatório → a
 *    plataforma obriga o frete grátis, então o vendedor paga de todo jeito. É o
 *    caso que o usuário mais erra ao estimar, e o que o cálculo tem que acertar
 *    sem depender de o usuário marcar a opção certa.
 */
function calcularFrete(entrada: EntradaDeMargem, tabela: TabelaDeTaxas): Centavos {
  if (entrada.modoFrete === 'retirada') return ZERO;

  const limiar = tabela.limiarFreteGratisObrigatorio;
  const obrigadoAPagar = limiar !== null && entrada.preco >= limiar;

  if (entrada.modoFrete === 'comprador_paga' && !obrigadoAPagar) return ZERO;

  if (entrada.freteConhecido !== undefined) return entrada.freteConhecido;

  switch (entrada.plataforma) {
    case 'ml':
      return freteEstimadoML(entrada.pesoGramas);
    case 'shopee':
      return fretePrograma(entrada.pesoGramas);
    case 'amazon':
      // A Amazon não tem programa de frete grátis obrigatório na tabela atual, e
      // sem tabela própria a estimativa do ML é o melhor palpite disponível — o
      // aviso `tabela_presumida` avisa que é palpite.
      return freteEstimadoML(entrada.pesoGramas);
  }
}

function calcularAcrescimos(
  entrada: EntradaDeMargem,
  tabela: TabelaDeTaxas,
): readonly { readonly rotulo: string; readonly valor: Centavos }[] {
  const limiar = tabela.limiarFreteGratisObrigatorio;

  return tabela.acrescimos
    .filter((a) => {
      switch (a.quando) {
        case 'sempre':
          return true;
        case 'vendedor_sem_cnpj':
          return !entrada.vendedor.temCnpj;
        case 'em_campanha':
          return entrada.emCampanha === true;
        case 'acima_do_limiar_de_frete':
          return limiar !== null && entrada.preco >= limiar;
      }
    })
    .map((a) => ({
      rotulo: a.rotulo,
      valor:
        a.cobranca.tipo === 'fixo_por_item'
          ? a.cobranca.valor
          : aplicarPontosBase(entrada.preco, a.cobranca.pontosBase),
    }));
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

function avisosDeMargem(params: {
  readonly entrada: EntradaDeMargem;
  readonly margemReais: Centavos;
  readonly margemPontosBase: PontosBase;
  readonly markupSobreCusto: number | null;
}): Aviso[] {
  const { entrada, margemReais, margemPontosBase, markupSobreCusto } = params;
  const avisos: Aviso[] = [];

  if (margemReais < 0) {
    avisos.push({
      codigo: 'margem_negativa',
      severidade: 'vermelho',
      mensagem: `Prejuízo de ${formatarBRL(centavos(0 - margemReais))} por unidade. Não publique.`,
    });
  } else if (margemPontosBase < MARGEM_APERTADA_BP) {
    avisos.push({
      codigo: 'margem_apertada',
      severidade: 'amarelo',
      mensagem:
        `Margem de ${formatarBRL(margemReais)} (${(margemPontosBase / 100).toFixed(1)}%). ` +
        'Uma devolução em dez zera o lote.',
    });
  }

  if (entrada.custoProduto === 0) {
    avisos.push({
      codigo: 'custo_nao_informado',
      severidade: 'amarelo',
      mensagem: 'Custo do produto está zero: a margem mostrada é o teto, não a real.',
    });
  } else if (markupSobreCusto !== null && markupSobreCusto < CORTE_MARKUP_MINIMO) {
    avisos.push({
      codigo: 'markup_abaixo_do_corte',
      severidade: 'amarelo',
      mensagem:
        `Markup de ${markupSobreCusto.toFixed(2)}x sobre o custo, abaixo do corte de ` +
        `${String(CORTE_MARKUP_MINIMO)}x. Comissão, frete e uma devolução em dez zeram a margem.`,
    });
  }

  if (entrada.preco < CORTE_TICKET_MINIMO) {
    avisos.push({
      codigo: 'ticket_abaixo_do_corte',
      severidade: 'informativo',
      mensagem:
        `Ticket de ${formatarBRL(entrada.preco)}, abaixo de ${formatarBRL(CORTE_TICKET_MINIMO)}. ` +
        'Nessa faixa a taxa fixa come a margem.',
    });
  }

  return avisos;
}

function avisosDeEstrutura(params: {
  readonly entrada: EntradaDeMargem;
  readonly tabela: TabelaDeTaxas;
  readonly custoFixoPlataforma: Centavos;
}): Aviso[] {
  const { entrada, tabela, custoFixoPlataforma } = params;
  const avisos: Aviso[] = [];

  // A zona morta do ML. O alerta mais valioso da tela de preço: a estrutura de
  // custo da plataforma torna a faixa logo acima do limiar pior que a faixa logo
  // abaixo, e isso não é intuitivo para ninguém.
  if (
    entrada.plataforma === 'ml' &&
    entrada.preco >= LIMIAR_FRETE_GRATIS_ML &&
    entrada.preco < FIM_ZONA_MORTA_ML
  ) {
    avisos.push({
      codigo: 'zona_morta_ml',
      severidade: 'vermelho',
      mensagem:
        `Zona morta do Mercado Livre: entre ${formatarBRL(LIMIAR_FRETE_GRATIS_ML)} e ` +
        `${formatarBRL(FIM_ZONA_MORTA_ML)} a taxa fixa desaparece mas o frete grátis passa a ser ` +
        'seu, e trocar R$ 6,50 por R$ 22 é mau negócio. As faixas boas são ' +
        `${formatarBRL(centavos(5500))}–${formatarBRL(centavos(LIMIAR_FRETE_GRATIS_ML - 100))} ` +
        `ou acima de ${formatarBRL(RETOMADA_SAUDAVEL_ML)}.`,
    });
  }

  if (
    custoFixoPlataforma > 0 &&
    proporcaoEmPontosBase(custoFixoPlataforma, entrada.preco) > TAXA_FIXA_DOMINANTE_BP
  ) {
    avisos.push({
      codigo: 'taxa_fixa_domina',
      severidade: 'amarelo',
      mensagem:
        `A taxa fixa de ${formatarBRL(custoFixoPlataforma)} é mais de ` +
        `${(TAXA_FIXA_DOMINANTE_BP / 100).toFixed(0)}% do preço. Subir o preço melhora a margem ` +
        'mais que cortar custo.',
    });
  }

  if (entrada.plataforma === 'ml' && entrada.tipoAnuncioML === 'catalogo') {
    avisos.push({
      codigo: 'catalogo_sem_reputacao',
      severidade: 'informativo',
      mensagem:
        'Anúncio de catálogo exige reputação verde para ganhar a posição destacada. ' +
        'Conta nova fica em "outras opções de compra".',
    });
  }

  if (tabela.fonte === 'manual') {
    avisos.push({
      codigo: 'tabela_presumida',
      severidade: 'informativo',
      mensagem:
        `Taxas de "${tabela.rotulo}" vêm de tabela manual, não da API. ` +
        'Confirme a da sua categoria no painel da plataforma antes de precificar.',
    });
  }

  return avisos;
}

function avisosFiscais(incerteza: ReturnType<typeof tributoPorUnidade>['incerteza']): Aviso[] {
  switch (incerteza) {
    case 'nenhuma':
      return [];
    case 'regime_cpf':
      return [
        {
          codigo: 'regime_cpf_sem_tributo',
          severidade: 'informativo',
          mensagem:
            'Regime CPF: nenhum tributo sobre a venda está entrando no cálculo. ' +
            'Venda com habitualidade tem obrigação de IRPF, e a partir de 01/01/2027 ' +
            'pessoa física contribuinte de CBS precisa de CNPJ.',
        },
      ];
    case 'das_sem_unidades_previstas':
      return [
        {
          codigo: 'das_sem_unidades_previstas',
          severidade: 'amarelo',
          mensagem:
            'DAS do MEI não entrou na margem: informe o valor mensal e as unidades ' +
            'previstas no mês para o rateio por unidade.',
        },
      ];
    case 'aliquota_ausente':
      return [
        {
          codigo: 'das_sem_unidades_previstas',
          severidade: 'amarelo',
          mensagem: 'Simples sem alíquota efetiva informada: nenhum tributo entrou na margem.',
        },
      ];
  }
}
