/**
 * A conta de uma venda, do jeito que a tela Catálogo e preço mostra. Pura, com teste.
 *
 * Duas peças da tela usam: a tabela de preços, que responde quanto cobrar em cada loja
 * para ficar com uma parte de cada R$ 100 vendidos, e o cupom do produto, que mostra para
 * onde vai cada real de uma venda. As duas rodam no navegador, para o número mudar
 * enquanto a pessoa mexe, e por isso nada aqui toca banco: o motor de margem (M8) é
 * código puro desde a fase 1.
 *
 * ## Dinheiro em reais de cada R$ 100, e não em percentual
 *
 * "20% de margem" e "R$ 20 de cada R$ 100 vendidos" são o mesmo número. O segundo é
 * entendido por quem nunca fez conta de margem: gente lê frequência natural melhor do que
 * percentual (Gigerenzer e Hoffrage, 1995). A tela fala o segundo, e o domínio continua em
 * pontos-base.
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
import { precoParaMargem } from '@/dominio/precificacao/simulador';
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

/**
 * Onde a busca de preço começa e termina: de R$ 1 a R$ 10.000.
 *
 * Largo de propósito. A tela antiga varria de R$ 10 a R$ 500, e peça de R$ 400 de custo
 * saía "sem preço que dê margem" quando o preço existia, só estava fora da varredura.
 */
export const PRECO_MINIMO_DA_BUSCA = centavos(100);
export const PRECO_MAXIMO_DA_BUSCA = centavos(1_000_000);

/** O alvo que a pessoa pode pedir: de R$ 1 a R$ 90 de cada R$ 100. */
export const ALVO_MINIMO_BP = 100;
export const ALVO_MAXIMO_BP = 9_000;

/** O alvo dentro dos limites, em passos de R$ 1 de cada R$ 100. */
export function limitarAlvo(alvoBp: number): number {
  const inteiro = Math.round(alvoBp / 100) * 100;
  return Math.min(ALVO_MAXIMO_BP, Math.max(ALVO_MINIMO_BP, inteiro));
}

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
 * O menor preço que deixa o alvo com a pessoa.
 *
 * `null` quando nenhum preço da busca chega lá. Sem custo também não há preço: presumir
 * custo zero daria um preço bonito e falso, que é o pior tipo de resposta.
 */
export function precoParaFicarCom(
  ficha: FichaDaConta,
  cenario: CenarioDaConta,
  alvoBp: number,
): Centavos | null {
  if (ficha.custo === null) return null;
  return precoParaMargem({
    base: montarConta(ficha, cenario).base,
    margemAlvo: { tipo: 'pontos_base', valor: pontosBase(alvoBp) },
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
    // Entrada que o M8 recusa (preço fora de forma) não derruba a tela: a conta some,
    // e o campo de preço continua lá para a pessoa corrigir.
    return null;
  }
}

// ─── A tabela de preços ──────────────────────────────────────────────────────

/** O que um produto vendeu numa loja nos últimos 30 dias. */
export interface VendaNaLoja {
  readonly unidades: number;
  /** Soma dos preços, em centavos. */
  readonly faturamento: number;
}

export type PrecoDaTabela =
  | { readonly tipo: 'preco'; readonly valor: Centavos }
  | { readonly tipo: 'sem_custo' }
  | { readonly tipo: 'nao_alcanca' };

/** Uma célula da tabela: o preço que a loja pede, e o que a pessoa cobra de verdade. */
export interface CelulaDaTabela {
  readonly plataforma: Plataforma;
  readonly cobre: PrecoDaTabela;
  /** Preço médio das vendas dos últimos 30 dias. `null` sem venda. */
  readonly voceCobra: Centavos | null;
  readonly unidades: number;
  /** Cobra menos do que a tabela pede para ficar com o alvo. */
  readonly abaixo: boolean;
}

/** As três lojas de um produto, na ordem do domínio. */
export function celulasDoProduto(params: {
  readonly ficha: FichaDaConta;
  readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
  readonly alvoBp: number;
  readonly vendedor: ContextoDoVendedor;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly em?: Date;
}): readonly CelulaDaTabela[] {
  return PLATAFORMAS.map((plataforma) => {
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
      const preco = precoParaFicarCom(
        params.ficha,
        {
          plataforma,
          tipoAnuncioML: params.tipoAnuncioML,
          modoFrete: params.modoFrete,
          vendedor: params.vendedor,
          ...(params.em === undefined ? {} : { em: params.em }),
        },
        params.alvoBp,
      );
      cobre = preco === null ? { tipo: 'nao_alcanca' } : { tipo: 'preco', valor: preco };
    }

    return {
      plataforma,
      cobre,
      voceCobra,
      unidades,
      abaixo: cobre.tipo === 'preco' && voceCobra !== null && voceCobra < cobre.valor,
    };
  });
}

// ─── Os textos do alvo ───────────────────────────────────────────────────────

/** Reais sem centavos quando redondos: "R$ 20", e não "R$ 20,00". */
export function reaisCurtos(valor: Centavos): string {
  const texto = formatarBRL(valor);
  return valor % 100 === 0 ? texto.replace(/,00$/, '') : texto;
}

/** O alvo como se fala: "R$ 20 de cada R$ 100 vendidos". */
export function fraseDoAlvo(alvoBp: number): string {
  return `${reaisCurtos(centavos(alvoBp))} de cada R$\u00a0100 vendidos`;
}

/**
 * Quanto fica de cada R$ 100 numa venda: "R$ 25 de cada R$ 100".
 *
 * Arredondado ao real, porque é leitura de relance ao lado do número exato em reais.
 * Prejuízo diz quanto se perde, no mesmo formato.
 */
export function ficaDeCadaCem(margemBp: number): string {
  const reais = Math.round(Math.abs(margemBp) / 100);
  return `R$\u00a0${String(reais)} de cada R$\u00a0100`;
}

// ─── A régua do dinheiro ─────────────────────────────────────────────────────

/**
 * As partes em que o preço se divide.
 *
 * `fica` vem primeiro, encostada no começo da régua: é a única parte com cor, e começar
 * do mesmo ponto em todas as réguas é o que deixa comparar uma com a outra de relance
 * (posição num eixo comum é o que o olho mede melhor, Cleveland e McGill).
 */
export const PARTES = ['fica', 'produto', 'loja', 'resto'] as const;
export type ChaveDaParte = (typeof PARTES)[number];

export const ROTULO_DA_PARTE: Readonly<Record<ChaveDaParte, string>> = {
  fica: 'Fica com você',
  produto: 'O produto',
  loja: 'A loja e o frete',
  resto: 'Imposto, embalagem e devolução',
};

export interface ParteDaConta {
  readonly chave: ChaveDaParte;
  readonly valor: Centavos;
  /** Fração da régua, de 0 a 1. */
  readonly fracao: number;
}

export interface Regua {
  readonly partes: readonly ParteDaConta[];
  /**
   * Onde o preço termina na régua, de 0 a 1.
   *
   * É 1 quando a venda dá lucro: a régua inteira é o preço. Com prejuízo, a régua inteira
   * são os custos, que passam do preço, e o trecho depois deste ponto é o que se perde.
   */
  readonly fimDoPreco: number;
  /** Quanto se perde por venda. Zero quando dá lucro. */
  readonly perde: Centavos;
}

function somaDe(valores: readonly number[]): number {
  return valores.reduce((total, v) => total + v, 0);
}

export function reguaDaConta(resultado: ResultadoDeMargem): Regua {
  const d = resultado.decomposicao;
  const valores: Readonly<Record<ChaveDaParte, number>> = {
    fica: Math.max(0, resultado.margemReais),
    produto: d.custoProduto,
    loja: somaDe([d.comissao, d.custoFixoPlataforma, d.frete, ...d.acrescimos.map((a) => a.valor)]),
    resto: somaDe([d.tributo, d.embalagem, d.provisaoDevolucao]),
  };
  const perde = Math.max(0, 0 - resultado.margemReais);
  const inteira = resultado.preco + perde;
  if (inteira <= 0) return { partes: [], fimDoPreco: 1, perde: centavos(0) };

  return {
    partes: PARTES.filter((chave) => valores[chave] > 0).map((chave) => ({
      chave,
      valor: centavos(valores[chave]),
      fracao: valores[chave] / inteira,
    })),
    fimDoPreco: resultado.preco / inteira,
    perde: centavos(perde),
  };
}

// ─── O cupom ─────────────────────────────────────────────────────────────────

/** Uma linha do cupom: do preço até antes do total. */
export interface LinhaDoCupom {
  readonly rotulo: string;
  readonly valor: Centavos;
  /** A parte da régua desta linha: é a legenda da régua. */
  readonly parte: ChaveDaParte;
  /** O campo da ficha que a conta presumiu nesta linha, ou `null` quando é valor sabido. */
  readonly presumido: CampoPresumido | null;
}

/**
 * As saídas de dinheiro de uma venda, na ordem em que saem.
 *
 * Linha zerada não entra: cupom com "Frete R$ 0,00" e "Imposto R$ 0,00" é lista de zeros
 * que ninguém lê. Frete é estimado quando a conta usou peso presumido.
 */
export function linhasDoCupom(
  resultado: ResultadoDeMargem,
  plataforma: Plataforma,
  presumidos: readonly CampoPresumido[],
): readonly LinhaDoCupom[] {
  const d = resultado.decomposicao;
  const se = (campo: CampoPresumido): CampoPresumido | null =>
    presumidos.includes(campo) ? campo : null;
  const linhas: LinhaDoCupom[] = [
    {
      rotulo: `Taxa ${daLoja(plataforma)}`,
      valor: centavos(d.comissao + d.custoFixoPlataforma),
      parte: 'loja',
      presumido: null,
    },
    ...d.acrescimos.map((a) => ({
      rotulo: a.rotulo,
      valor: a.valor,
      parte: 'loja' as const,
      presumido: null,
    })),
    { rotulo: 'Frete', valor: d.frete, parte: 'loja', presumido: se('peso') },
    { rotulo: 'Imposto', valor: d.tributo, parte: 'resto', presumido: null },
    { rotulo: 'Embalagem', valor: d.embalagem, parte: 'resto', presumido: se('embalagem') },
    {
      rotulo: 'Reserva para devolução',
      valor: d.provisaoDevolucao,
      parte: 'resto',
      presumido: se('devolucao'),
    },
    { rotulo: 'O produto', valor: d.custoProduto, parte: 'produto', presumido: null },
  ];
  return linhas.filter((linha) => linha.valor > 0);
}

const O_QUE_FOI_ESTIMADO: Readonly<Record<CampoPresumido, string>> = {
  peso: `frete pelo peso padrão de ${String(PESO_PRESUMIDO_GRAMAS)} g`,
  embalagem: `embalagem de ${reaisCurtos(centavos(EMBALAGEM_PRESUMIDA_CENTAVOS))}`,
  devolucao: `devolução de ${String(DEVOLUCAO_PRESUMIDA_BP / 100)} em cada 100 vendas`,
};

/**
 * O rodapé do cupom: o que a conta estimou, com o número que usou.
 *
 * Dizer o número é o que deixa a pessoa julgar se a estimativa serve. "Estimado" sozinho
 * pediria confiança; "embalagem de R$ 1,50" pede só uma olhada.
 */
export function notaDoEstimado(linhas: readonly LinhaDoCupom[]): string | null {
  const partes = linhas.flatMap((l) =>
    l.presumido === null ? [] : [O_QUE_FOI_ESTIMADO[l.presumido]],
  );
  if (partes.length === 0) return null;
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
 * ficam de fora cinco. Prejuízo, porque o total do cupom já diz em vermelho. Custo não
 * informado, porque a tela pergunta o custo antes de mostrar a conta. Tabela manual, que
 * vira a nota de rodapé do cupom. E as duas regras de bolso, markup de 3 vezes e venda
 * abaixo de R$ 80: a primeira contradiz o alvo que a própria pessoa escolheu (o preço da
 * tabela deixa os R$ 20 de cada R$ 100 e mesmo assim a regra reclamava), e a segunda
 * aparecia em quase todo refil, que é o que este negócio vende. Aviso que aparece sempre
 * ensina a não ler aviso nenhum.
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
