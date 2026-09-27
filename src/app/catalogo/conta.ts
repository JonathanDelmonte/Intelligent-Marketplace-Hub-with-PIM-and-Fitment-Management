/**
 * A conta de uma venda, do jeito que a Catálogo e preço mostra. Pura, com teste.
 *
 * A tabela de preços e o simulador do produto rodam no navegador, para o número mudar
 * enquanto a pessoa mexe, e por isso nada aqui toca banco: o motor de margem (M8) é
 * código puro desde a fase 1.
 *
 * ## A meta é da pessoa, do jeito que ela quiser
 *
 * A meta pode ser um percentual do preço ("quero 20% de margem") ou um valor fixo por
 * venda ("quero R$ 12 em cada venda"), e aceita qualquer número, com casas decimais. A
 * versão anterior prendia a meta em reais inteiros de cada R$ 100, e o dono perguntou,
 * com razão, por que ele não podia pôr o número que quisesse.
 */
import {
  DEVOLUCAO_PRESUMIDA_BP,
  EMBALAGEM_PRESUMIDA_CENTAVOS,
  entradaParaMargem,
  PESO_PRESUMIDO_GRAMAS,
  type CampoPresumido,
  type EntradaMontada,
} from '@/dominio/precificacao/entrada';
import { calcularMargem, TAXA_FIXA_DOMINANTE_BP } from '@/dominio/precificacao/margem';
import { precoParaMargem, simularFaixa, type PontoDaCurva } from '@/dominio/precificacao/simulador';
import { FIM_ZONA_MORTA_ML, LIMIAR_FRETE_GRATIS_ML } from '@/dominio/precificacao/tabelas';
import {
  PLATAFORMAS,
  type ContextoDoVendedor,
  type ModoFrete,
  type Plataforma,
  type ResultadoDeMargem,
  type TipoAnuncioML,
} from '@/dominio/precificacao/tipos';
import { centavos, formatarBRL, pontosBase, ZERO, type Centavos } from '@/lib/dinheiro';
import { daLoja } from '../ui/rotulos';

/** O que a conta precisa saber do produto. Números crus: chega do servidor como prop. */
export interface FichaDaConta {
  /** Custo de uma unidade, em centavos. `null` é "não informado", e não zero. */
  readonly custo: number | null;
  readonly pesoG: number | null;
  readonly devolucaoBp: number | null;
  readonly categoriaMl: string | null;
}

/** Onde e como a venda acontece. */
export interface CenarioDaConta {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly vendedor: ContextoDoVendedor;
  readonly em?: Date;
}

/** Onde a busca de preço começa e termina: de R$ 1 a R$ 10.000. */
export const PRECO_MINIMO_DA_BUSCA = centavos(100);
export const PRECO_MAXIMO_DA_BUSCA = centavos(1_000_000);

// ─── A meta ──────────────────────────────────────────────────────────────────

/** Quanto a pessoa quer que sobre: uma parte do preço, ou um valor fixo por venda. */
export type Meta =
  | { readonly tipo: 'percentual'; readonly bp: number }
  | { readonly tipo: 'reais'; readonly centavos: number };

/**
 * A meta com que a tela abre: 20% do preço.
 *
 * É o número que a especificação usa como referência de margem sadia em peça de
 * reposição, e é o que a pessoa troca primeiro. Sugerido, e não fixo: o campo aceita
 * qualquer número.
 */
export const META_PADRAO: Meta = { tipo: 'percentual', bp: 2_000 };

/** Os limites de uma meta que ainda faz sentido: de 0,5% a 95%, ou de 1 centavo a R$ 100 mil. */
export function metaValida(meta: Meta): boolean {
  return meta.tipo === 'percentual'
    ? Number.isInteger(meta.bp) && meta.bp >= 50 && meta.bp <= 9_500
    : Number.isInteger(meta.centavos) && meta.centavos >= 1 && meta.centavos <= 10_000_000;
}

/** A meta como se diz: "20% do preço" ou "R$ 12,00 por venda". */
export function textoDaMeta(meta: Meta): string {
  if (meta.tipo === 'reais') return `${formatarBRL(centavos(meta.centavos))} por venda`;
  return `${(meta.bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do preço`;
}

/** A venda alcança a meta? */
export function alcancaMeta(resultado: ResultadoDeMargem, meta: Meta): boolean {
  return meta.tipo === 'percentual'
    ? resultado.margemPontosBase >= meta.bp
    : resultado.margemReais >= meta.centavos;
}

// ─── A conta ─────────────────────────────────────────────────────────────────

/** A entrada do M8 para esta ficha neste cenário, com o que ela presumiu. */
export function montarConta(ficha: FichaDaConta, cenario: CenarioDaConta): EntradaMontada {
  return entradaParaMargem({
    ficha: {
      custoAtual: ficha.custo === null ? null : centavos(ficha.custo),
      pesoG: ficha.pesoG,
      taxaDevolucaoEsperadaBp: ficha.devolucaoBp === null ? null : pontosBase(ficha.devolucaoBp),
    },
    plataforma: cenario.plataforma,
    vendedor: cenario.vendedor,
    modoFrete: cenario.modoFrete,
    tipoAnuncioML: cenario.tipoAnuncioML,
    ...(ficha.categoriaMl === null ? {} : { categoria: ficha.categoriaMl }),
    ...(cenario.em === undefined ? {} : { em: cenario.em }),
  });
}

/**
 * O menor preço que alcança a meta.
 *
 * `null` quando nenhum preço da busca chega lá. Sem custo também não há preço: presumir
 * custo zero daria um preço bonito e falso, que é o pior tipo de resposta.
 */
export function precoParaMeta(
  ficha: FichaDaConta,
  cenario: CenarioDaConta,
  meta: Meta,
): Centavos | null {
  if (ficha.custo === null) return null;
  return precoParaMargem({
    base: montarConta(ficha, cenario).base,
    margemAlvo:
      meta.tipo === 'percentual'
        ? { tipo: 'pontos_base', valor: pontosBase(meta.bp) }
        : { tipo: 'reais', valor: centavos(meta.centavos) },
    de: PRECO_MINIMO_DA_BUSCA,
    ate: PRECO_MAXIMO_DA_BUSCA,
  });
}

/** O preço abaixo do qual a venda dá prejuízo. `null` sem custo, ou sem preço que empate. */
export function precoSemPrejuizo(ficha: FichaDaConta, cenario: CenarioDaConta): Centavos | null {
  if (ficha.custo === null) return null;
  return precoParaMargem({
    base: montarConta(ficha, cenario).base,
    margemAlvo: { tipo: 'reais', valor: ZERO },
    de: PRECO_MINIMO_DA_BUSCA,
    ate: PRECO_MAXIMO_DA_BUSCA,
  });
}

/** A conta inteira de uma venda a um preço. `null` quando o preço não serve de entrada. */
export function contaDaVenda(
  ficha: FichaDaConta,
  cenario: CenarioDaConta,
  preco: Centavos,
): ResultadoDeMargem | null {
  if (preco <= 0) return null;
  try {
    return calcularMargem({ ...montarConta(ficha, cenario).base, preco });
  } catch {
    // Entrada que o M8 recusa não derruba a tela: a conta some, e o campo de preço
    // continua lá para a pessoa corrigir.
    return null;
  }
}

/** O trecho de preços que o gráfico mostra. */
export interface FaixaDoGrafico {
  readonly de: Centavos;
  readonly ate: Centavos;
}

/**
 * Onde o gráfico começa e termina: um pouco abaixo do menor preço de referência, até bem
 * acima do maior, para a pessoa ver os dois lados, onde perde e quanto ganha subindo.
 *
 * Sem referência nenhuma (a meta não se alcança e nenhum preço empata), o trecho sai do
 * dobro do custo, que é o preço de um lado a outro de quase todo produto de reposição.
 *
 * Degrau de taxa ou de frete que cai na ponta estica o trecho: a queda desenhada colada na
 * borda parecia defeito do gráfico, e é justamente a informação mais útil dele (no Mercado
 * Livre, o frete grátis que passa a ser seu a partir de R$ 79).
 */
export function faixaDoGrafico(
  referencias: readonly (Centavos | null)[],
  custo: number,
  degraus: readonly Centavos[] = [],
): FaixaDoGrafico {
  const conhecidos = referencias.filter((p): p is Centavos => p !== null && p > 0);
  const base = conhecidos.length === 0 ? [Math.max(custo * 2, 1_000)] : conhecidos;
  const de = Math.max(PRECO_MINIMO_DA_BUSCA, Math.round(Math.min(...base) * 0.6));
  const ate = Math.max(de + 1_000, Math.round(Math.max(...base) * 1.45));
  const folga = (ate - de) * 0.15;
  const naPonta = degraus.filter((d) => d > ate - folga && d <= ate + folga * 1.5);
  const fim = naPonta.length === 0 ? ate : Math.max(ate, Math.round(Math.max(...naPonta) + folga));
  return { de: centavos(de), ate: centavos(fim) };
}

/**
 * A curva de lucro por preço, para o gráfico do simulador.
 *
 * Os degraus de taxa e de frete entram na curva como queda de verdade, e não como linha
 * reta: é onde subir o preço faz ganhar menos.
 */
export function curvaDeLucro(params: {
  readonly ficha: FichaDaConta;
  readonly cenario: CenarioDaConta;
  readonly faixa: FaixaDoGrafico;
}): readonly PontoDaCurva[] {
  if (params.ficha.custo === null) return [];
  try {
    return simularFaixa({
      base: montarConta(params.ficha, params.cenario).base,
      de: params.faixa.de,
      ate: params.faixa.ate,
      amostras: 160,
    }).pontos;
  } catch {
    return [];
  }
}

// ─── A tabela de preços ──────────────────────────────────────────────────────

/** O que um produto vendeu numa loja nos últimos 30 dias. */
export interface VendaNaLoja {
  readonly unidades: number;
  /** Soma dos preços, em centavos. */
  readonly faturamento: number;
  /** Soma das margens realizadas dos pedidos que têm margem. */
  readonly margem: number;
  /** Faturamento só dos pedidos que têm margem. */
  readonly faturamentoComMargem: number;
  /** Unidades só dos pedidos que têm margem. */
  readonly unidadesComMargem: number;
}

export type PrecoDaTabela =
  | { readonly tipo: 'preco'; readonly valor: Centavos }
  | { readonly tipo: 'sem_custo' }
  | { readonly tipo: 'nao_alcanca' };

/** Como está o que a pessoa cobra hoje, perto da meta. */
export type Situacao = 'na_meta' | 'abaixo' | 'prejuizo';

/** Uma casa da tabela: o preço que a loja pede, e o que a pessoa cobra de verdade. */
export interface CelulaDaTabela {
  readonly plataforma: Plataforma;
  readonly cobre: PrecoDaTabela;
  /** Preço médio das vendas dos últimos 30 dias. `null` sem venda. */
  readonly voceCobra: Centavos | null;
  readonly unidades: number;
  /** A margem, em pontos-base, ao preço que a pessoa cobra hoje. `null` sem venda ou sem custo. */
  readonly margemHojeBp: number | null;
  /** O que sobra por venda ao preço de hoje. `null` sem venda ou sem custo. */
  readonly margemHoje: Centavos | null;
  /** A situação ao preço de hoje. `null` sem venda ou sem custo. */
  readonly situacao: Situacao | null;
}

/** As três lojas de um produto, na ordem do domínio. */
export function celulasDoProduto(params: {
  readonly ficha: FichaDaConta;
  readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
  readonly meta: Meta;
  readonly vendedor: ContextoDoVendedor;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly em?: Date;
}): readonly CelulaDaTabela[] {
  return PLATAFORMAS.map((plataforma) => {
    const cenario: CenarioDaConta = {
      plataforma,
      tipoAnuncioML: params.tipoAnuncioML,
      modoFrete: params.modoFrete,
      vendedor: params.vendedor,
      ...(params.em === undefined ? {} : { em: params.em }),
    };
    const venda = params.vendas[plataforma];
    const unidades = venda?.unidades ?? 0;
    const voceCobra =
      venda === undefined || venda.unidades <= 0
        ? null
        : centavos(Math.round(venda.faturamento / venda.unidades));

    let cobre: PrecoDaTabela;
    if (params.ficha.custo === null) {
      cobre = { tipo: 'sem_custo' };
    } else {
      const preco = precoParaMeta(params.ficha, cenario, params.meta);
      cobre = preco === null ? { tipo: 'nao_alcanca' } : { tipo: 'preco', valor: preco };
    }

    const hoje =
      voceCobra === null || params.ficha.custo === null
        ? null
        : contaDaVenda(params.ficha, cenario, voceCobra);

    return {
      plataforma,
      cobre,
      voceCobra,
      unidades,
      margemHojeBp: hoje === null ? null : hoje.margemPontosBase,
      margemHoje: hoje === null ? null : hoje.margemReais,
      situacao:
        hoje === null
          ? null
          : hoje.margemReais < 0
            ? 'prejuizo'
            : alcancaMeta(hoje, params.meta)
              ? 'na_meta'
              : 'abaixo',
    };
  });
}

/** A situação de um produto na tabela: a da pior loja onde ele vende. */
export type SituacaoDoProduto = 'sem_custo' | 'sem_vendas' | Situacao;

export function situacaoDoProduto(
  custo: number | null,
  celulas: readonly CelulaDaTabela[],
): SituacaoDoProduto {
  if (custo === null) return 'sem_custo';
  const situacoes = celulas.flatMap((c) => (c.situacao === null ? [] : [c.situacao]));
  if (situacoes.length === 0) return 'sem_vendas';
  if (situacoes.includes('prejuizo')) return 'prejuizo';
  if (situacoes.includes('abaixo')) return 'abaixo';
  return 'na_meta';
}

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDoProduto, string>> = {
  sem_custo: 'Falta o custo',
  sem_vendas: 'Sem vendas',
  prejuizo: 'Dando prejuízo',
  abaixo: 'Abaixo da meta',
  na_meta: 'Na meta',
};

// ─── Os números do alto ──────────────────────────────────────────────────────

export interface NumerosDoCatalogo {
  readonly produtos: number;
  readonly semCusto: number;
  readonly custoVelho: number;
  readonly abaixoDaMeta: number;
  readonly unidades: number;
  readonly faturamento: Centavos;
  readonly unidadesPorLoja: Readonly<Record<Plataforma, number>>;
  /** Soma das margens realizadas. */
  readonly lucro: Centavos;
  /** Margem realizada sobre o faturamento dos pedidos com margem. `null` sem nenhum. */
  readonly margemRealBp: number | null;
  /** Lucro médio por unidade dos pedidos com margem. `null` sem nenhum. */
  readonly lucroPorUnidade: Centavos | null;
}

/** Os quatro números do alto da tabela, somando os produtos. */
export function numerosDoCatalogo(
  produtos: readonly {
    readonly custo: number | null;
    readonly custoVelho: boolean;
    readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
    readonly situacao: SituacaoDoProduto;
  }[],
): NumerosDoCatalogo {
  const unidadesPorLoja: Record<Plataforma, number> = { ml: 0, shopee: 0, amazon: 0 };
  let faturamento = 0;
  let lucro = 0;
  let base = 0;
  let unidadesComMargem = 0;
  for (const produto of produtos) {
    for (const plataforma of PLATAFORMAS) {
      const venda = produto.vendas[plataforma];
      if (venda === undefined) continue;
      unidadesPorLoja[plataforma] += venda.unidades;
      faturamento += venda.faturamento;
      lucro += venda.margem;
      base += venda.faturamentoComMargem;
      unidadesComMargem += venda.unidadesComMargem;
    }
  }
  return {
    produtos: produtos.length,
    semCusto: produtos.filter((p) => p.custo === null).length,
    custoVelho: produtos.filter((p) => p.custoVelho).length,
    abaixoDaMeta: produtos.filter((p) => p.situacao === 'abaixo' || p.situacao === 'prejuizo')
      .length,
    unidades: PLATAFORMAS.reduce((t, p) => t + unidadesPorLoja[p], 0),
    faturamento: centavos(faturamento),
    unidadesPorLoja,
    lucro: centavos(lucro),
    margemRealBp: base === 0 ? null : Math.trunc((lucro * 10_000) / base),
    lucroPorUnidade:
      unidadesComMargem === 0 ? null : centavos(Math.round(lucro / unidadesComMargem)),
  };
}

// ─── Os textos ───────────────────────────────────────────────────────────────

/** Reais sem centavos quando redondos: "R$ 20", e não "R$ 20,00". */
export function reaisCurtos(valor: Centavos): string {
  const texto = formatarBRL(valor);
  return valor % 100 === 0 ? texto.replace(/,00$/, '') : texto;
}

/** Percentual de pontos-base, com uma casa quando pequeno: "8,5%", "23%". */
export function percentual(bp: number): string {
  const valor = bp / 100;
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(valor) < 10 ? 1 : 0 })}%`;
}

// ─── Para onde vai o dinheiro ────────────────────────────────────────────────

/**
 * As partes em que o preço se divide.
 *
 * `fica` vem primeiro, encostada no começo da barra: é a parte que a pessoa procura, e
 * começar do mesmo ponto em todas as barras deixa comparar uma com a outra de relance
 * (posição num eixo comum é o que o olho mede melhor, Cleveland e McGill).
 */
export const PARTES = ['fica', 'produto', 'loja', 'frete', 'resto'] as const;
export type ChaveDaParte = (typeof PARTES)[number];

export interface ParteDaConta {
  readonly chave: ChaveDaParte;
  readonly rotulo: string;
  readonly valor: Centavos;
  /** Fração da barra, de 0 a 1. */
  readonly fracao: number;
  /** O campo presumido nesta parte, quando é estimativa. */
  readonly presumido: CampoPresumido | null;
}

export interface DivisaoDoDinheiro {
  readonly partes: readonly ParteDaConta[];
  /** Onde o preço termina na barra: 1 com lucro; menos que 1 com prejuízo. */
  readonly fimDoPreco: number;
  /** Quanto se perde por venda. Zero quando dá lucro. */
  readonly perde: Centavos;
}

export function divisaoDoDinheiro(
  resultado: ResultadoDeMargem,
  plataforma: Plataforma,
  presumidos: readonly CampoPresumido[],
): DivisaoDoDinheiro {
  const d = resultado.decomposicao;
  const somar = (valores: readonly number[]): number => valores.reduce((t, v) => t + v, 0);
  const presumiu = (campo: CampoPresumido): CampoPresumido | null =>
    presumidos.includes(campo) ? campo : null;
  const brutas: readonly Omit<ParteDaConta, 'fracao'>[] = [
    {
      chave: 'fica',
      rotulo: 'Fica com você',
      valor: centavos(Math.max(0, resultado.margemReais)),
      presumido: null,
    },
    { chave: 'produto', rotulo: 'O produto', valor: d.custoProduto, presumido: null },
    {
      chave: 'loja',
      rotulo: `Taxa ${daLoja(plataforma)}`,
      valor: centavos(
        somar([d.comissao, d.custoFixoPlataforma, ...d.acrescimos.map((a) => a.valor)]),
      ),
      presumido: null,
    },
    { chave: 'frete', rotulo: 'Frete', valor: d.frete, presumido: presumiu('peso') },
    {
      chave: 'resto',
      rotulo: 'Imposto, embalagem e devolução',
      valor: centavos(somar([d.tributo, d.embalagem, d.provisaoDevolucao])),
      presumido: presumiu('embalagem') ?? presumiu('devolucao'),
    },
  ];
  const perde = Math.max(0, 0 - resultado.margemReais);
  const inteira = resultado.preco + perde;
  if (inteira <= 0) return { partes: [], fimDoPreco: 1, perde: centavos(0) };
  return {
    partes: brutas.filter((p) => p.valor > 0).map((p) => ({ ...p, fracao: p.valor / inteira })),
    fimDoPreco: resultado.preco / inteira,
    perde: centavos(perde),
  };
}

const O_QUE_FOI_ESTIMADO: Readonly<Record<CampoPresumido, string>> = {
  peso: `frete pelo peso padrão de ${String(PESO_PRESUMIDO_GRAMAS)} g`,
  embalagem: `embalagem de ${reaisCurtos(centavos(EMBALAGEM_PRESUMIDA_CENTAVOS))}`,
  devolucao: `devolução de ${String(DEVOLUCAO_PRESUMIDA_BP / 100)} em cada 100 vendas`,
};

/** O que a conta estimou, com o número que usou. `null` quando nada foi estimado. */
export function notaDoEstimado(
  resultado: ResultadoDeMargem,
  presumidos: readonly CampoPresumido[],
): string | null {
  const d = resultado.decomposicao;
  const usados = presumidos.filter((campo) =>
    campo === 'peso'
      ? d.frete > 0
      : campo === 'embalagem'
        ? d.embalagem > 0
        : d.provisaoDevolucao > 0,
  );
  if (usados.length === 0) return null;
  const partes = usados.map((campo) => O_QUE_FOI_ESTIMADO[campo]);
  const ultima = partes.at(-1) ?? '';
  const lista = partes.length === 1 ? ultima : `${partes.slice(0, -1).join(', ')} e ${ultima}`;
  return `Estimado: ${lista}.`;
}

// ─── Avisos, em português de balcão ──────────────────────────────────────────

export interface AvisoDaConta {
  readonly codigo: string;
  readonly tom: 'erro' | 'atencao' | 'nota';
  readonly texto: string;
}

const TOM: Readonly<Record<'vermelho' | 'amarelo' | 'informativo', AvisoDaConta['tom']>> = {
  vermelho: 'erro',
  amarelo: 'atencao',
  informativo: 'nota',
};

/**
 * Os avisos do M8, reescritos para quem não fala "markup" nem "ticket".
 *
 * O domínio continua com as mensagens técnicas, que o log e as outras telas usam. Aqui
 * ficam de fora cinco. Prejuízo, porque o lucro já aparece em vermelho. Custo não
 * informado, porque a tela pergunta o custo antes de mostrar a conta. Tabela manual, que
 * vira nota de rodapé. E as duas regras de bolso, markup de 3 vezes e venda abaixo de
 * R$ 80: a primeira contradiz a meta que a própria pessoa escolheu, e a segunda aparecia
 * em quase todo refil, que é o que este negócio vende. Aviso que aparece sempre ensina a
 * não ler aviso nenhum.
 */
export function avisosDaConta(resultado: ResultadoDeMargem): readonly AvisoDaConta[] {
  const peso = { erro: 0, atencao: 1, nota: 2 } as const;
  const avisos: AvisoDaConta[] = [];
  for (const aviso of resultado.avisos) {
    const texto = textoDoAviso(aviso.codigo);
    if (texto !== null) avisos.push({ codigo: aviso.codigo, tom: TOM[aviso.severidade], texto });
  }
  return avisos.sort((a, b) => peso[a.tom] - peso[b.tom]);
}

function textoDoAviso(codigo: string): string | null {
  switch (codigo) {
    case 'margem_apertada':
      return 'Sobra pouco. Se uma venda em dez voltar, o lucro dessas dez vai embora.';
    case 'zona_morta_ml':
      return `No Mercado Livre, entre ${reaisCurtos(LIMIAR_FRETE_GRATIS_ML)} e ${reaisCurtos(FIM_ZONA_MORTA_ML)} o frete grátis passa a ser seu e custa mais do que a taxa que deixa de existir. Cobre abaixo de ${reaisCurtos(LIMIAR_FRETE_GRATIS_ML)} ou acima de ${reaisCurtos(FIM_ZONA_MORTA_ML)}.`;
    case 'taxa_fixa_domina':
      return `A taxa fixa da loja passa de ${String(TAXA_FIXA_DOMINANTE_BP / 100)}% do preço. Aqui, subir o preço ajuda mais do que baixar o custo.`;
    case 'catalogo_sem_reputacao':
      return 'Anúncio de catálogo só ganha o destaque com reputação verde. Conta nova aparece em "outras opções de compra".';
    case 'regime_cpf_sem_tributo':
      return 'Você vende como pessoa física, então nenhum imposto entrou nesta conta.';
    case 'das_sem_unidades_previstas':
      return 'O DAS do MEI ficou fora desta conta. Informe o valor e quantas vendas você faz por mês em Meu negócio.';
    default:
      return null;
  }
}
