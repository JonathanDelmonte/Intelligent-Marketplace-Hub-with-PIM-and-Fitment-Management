/**
 * O que a tela de catálogo diz. Funções puras, com teste.
 *
 * A pergunta da tela é **quanto cobrar, e dá lucro?** — e a parte difícil não é o
 * cálculo (o M8 faz, desde a fase 1, com teste em cada degrau): é dizer com quantas
 * presunções aquele número foi feito, sem esconder e sem assustar.
 */
import { custoDefasado, idadeDoCustoEmDias } from '@/dominio/catalogo/custo';
import type { SkuGravado } from '@/dominio/catalogo/sku';
import { O_QUE_O_PRESUMIDO_CUSTA, type CampoPresumido } from '@/dominio/precificacao/entrada';
import {
  MODOS_FRETE,
  PLATAFORMAS,
  TIPOS_ANUNCIO_ML,
  type ModoFrete,
  type Plataforma,
  type TipoAnuncioML,
} from '@/dominio/precificacao/tipos';
import type { Aviso as AvisoDeMargem, Severidade } from '@/dominio/precificacao/tipos';
import { formatarBRL, lerReaisDigitados, pontosBase, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { MARGEM_ALVO_PADRAO_BP } from './constantes';

/** O estado de um produto na lista: o que falta nele para a margem ser real. */
export interface EstadoDoProduto {
  readonly semCusto: boolean;
  readonly custoDefasado: boolean;
  readonly idadeDoCustoEmDias: number | null;
  readonly semPeso: boolean;
  readonly semDevolucao: boolean;
}

export function estadoDoProduto(sku: SkuGravado, agora: Date): EstadoDoProduto {
  return {
    semCusto: sku.custoAtual === null,
    custoDefasado: custoDefasado(sku.custoAtualizadoEm, agora),
    idadeDoCustoEmDias: idadeDoCustoEmDias(sku.custoAtualizadoEm, agora),
    semPeso: sku.pesoG === null,
    semDevolucao: sku.taxaDevolucaoEsperadaBp === null,
  };
}

/**
 * A etiqueta do produto na lista.
 *
 * Uma só, e a mais grave: uma linha com quatro etiquetas é uma linha que ninguém lê.
 * Sem custo vem antes de custo velho, que vem antes de peso ausente — é a ordem do
 * quanto cada falta distorce a margem.
 */
export interface EtiquetaDoProduto {
  readonly texto: string;
  readonly tom: 'ok' | 'atencao' | 'alerta';
}

export function etiquetaDoProduto(estado: EstadoDoProduto): EtiquetaDoProduto {
  if (estado.semCusto) return { texto: 'sem custo', tom: 'alerta' };

  if (estado.custoDefasado) {
    const dias = estado.idadeDoCustoEmDias ?? 0;
    return { texto: `custo de ${contagem(dias, 'dia', 'dias')}`, tom: 'atencao' };
  }

  if (estado.semPeso) return { texto: 'sem peso', tom: 'atencao' };
  if (estado.semDevolucao) return { texto: 'sem devolução', tom: 'atencao' };
  return { texto: 'ficha completa', tom: 'ok' };
}

/**
 * A frase do alto da tela.
 *
 * Lidera por quantos produtos **não têm custo**, porque é a única falta que impede a
 * margem de existir — as outras a deixam aproximada.
 */
export function resumoDoCatalogo(params: {
  readonly total: number;
  readonly semCusto: number;
  readonly defasados: number;
}): string {
  if (params.total === 0) {
    return 'Nenhum produto no catálogo. Produto entra por aqui, ou vem da tela de juntar iguais quando duas ocorrências viram o mesmo item.';
  }

  const base = contagem(params.total, 'produto', 'produtos');

  if (params.semCusto === 0 && params.defasados === 0) {
    return `${base}, todos com custo informado e recente. A margem que a tela mostra é a real.`;
  }

  const partes: string[] = [];
  if (params.semCusto > 0) partes.push(`${String(params.semCusto)} sem custo`);
  if (params.defasados > 0) partes.push(`${String(params.defasados)} com custo velho`);

  return `${base}, ${partes.join(' e ')}. Sem custo a margem mostrada é o teto, não a real.`;
}

/** O que a margem presumiu, em texto. Vem do domínio; aqui é só a lista pronta. */
export function textoDasPresuncoes(presumidos: readonly CampoPresumido[]): readonly string[] {
  return presumidos.map((campo) => O_QUE_O_PRESUMIDO_CUSTA[campo]);
}

export const TOM_DA_SEVERIDADE: Readonly<Record<Severidade, 'erro' | 'atencao' | 'neutro'>> = {
  vermelho: 'erro',
  amarelo: 'atencao',
  informativo: 'neutro',
};

/** Ordena os avisos do M8 pela severidade: vermelho primeiro. */
export function ordenarAvisos(avisos: readonly AvisoDeMargem[]): readonly AvisoDeMargem[] {
  const peso: Readonly<Record<Severidade, number>> = { vermelho: 0, amarelo: 1, informativo: 2 };
  return [...avisos].sort((a, b) => peso[a.severidade] - peso[b.severidade]);
}

/**
 * As linhas da decomposição, na ordem em que o dinheiro sai.
 *
 * Do preço até a margem, cada linha subtraindo. É a ordem que responde "para onde foi o
 * meu dinheiro" — a ordem alfabética responderia outra pergunta.
 */
export interface LinhaDaDecomposicao {
  readonly rotulo: string;
  readonly valor: Centavos;
  /** Linha de saída de dinheiro. A primeira e a última não são. */
  readonly subtrai: boolean;
}

export function linhasDaDecomposicao(resultado: {
  readonly preco: Centavos;
  readonly margemReais: Centavos;
  readonly decomposicao: {
    readonly comissao: Centavos;
    readonly custoFixoPlataforma: Centavos;
    readonly acrescimos: readonly { readonly rotulo: string; readonly valor: Centavos }[];
    readonly frete: Centavos;
    readonly custoProduto: Centavos;
    readonly embalagem: Centavos;
    readonly tributo: Centavos;
    readonly provisaoDevolucao: Centavos;
  };
}): readonly LinhaDaDecomposicao[] {
  const d = resultado.decomposicao;

  return [
    { rotulo: 'Preço de venda', valor: resultado.preco, subtrai: false },
    { rotulo: 'Comissão da plataforma', valor: d.comissao, subtrai: true },
    { rotulo: 'Custo fixo por venda', valor: d.custoFixoPlataforma, subtrai: true },
    ...d.acrescimos.map((a) => ({ rotulo: a.rotulo, valor: a.valor, subtrai: true })),
    { rotulo: 'Frete', valor: d.frete, subtrai: true },
    { rotulo: 'Custo do produto', valor: d.custoProduto, subtrai: true },
    { rotulo: 'Embalagem', valor: d.embalagem, subtrai: true },
    { rotulo: 'Tributo', valor: d.tributo, subtrai: true },
    { rotulo: 'Provisão de devolução', valor: d.provisaoDevolucao, subtrai: true },
    { rotulo: 'Sobra', valor: resultado.margemReais, subtrai: false },
  ].filter((linha) => linha.subtrai === false || linha.valor !== 0);
}

/** Margem em percentual, com o sinal. `formatarPontosBase` não dá o sinal de mais. */
export function margemLegivel(margemBp: number): string {
  const pct = margemBp / 100;
  const casas = Math.abs(pct) < 10 ? 1 : 0;
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;
}

// ─── Parâmetros do simulador, que viajam na URL ──────────────────────────────

export interface ParametrosDoSimulador {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  /** Preço a decompor. `null` quando a pessoa ainda não escolheu um. */
  readonly preco: Centavos | null;
  readonly margemAlvoBp: number;
}

/** A margem alvo como se digita: `2000` pontos-base vira `"20"`. */
export function alvoEmPercentual(margemAlvoBp: number): string {
  return String(Math.round(margemAlvoBp / 100));
}

/** Percentual digitado de volta em pontos-base, ou `null`. */
export function lerAlvo(bruto: string): number | null {
  const n = Number.parseFloat(bruto.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return null;
  return pontosBase(Math.round(n * 100));
}

/**
 * Lê os parâmetros do simulador da URL.
 *
 * Na URL e não em estado de cliente: a tela é servidor, o resultado é compartilhável,
 * e recarregar não perde o que se estava olhando. Valor fora da lista cai no padrão em
 * vez de derrubar a página — URL é texto que qualquer um digita.
 */
export function lerParametros(
  bruto: Record<string, string | string[] | undefined>,
): ParametrosDoSimulador {
  const um = (chave: string): string | undefined => {
    const valor = bruto[chave];
    return Array.isArray(valor) ? valor[0] : valor;
  };

  const plataforma = PLATAFORMAS.find((p) => p === um('plataforma')) ?? 'ml';
  const tipo = TIPOS_ANUNCIO_ML.find((t) => t === um('tipo')) ?? 'classico';
  const frete = MODOS_FRETE.find((f) => f === um('frete')) ?? 'comprador_paga';

  // O campo do formulário é **percentual** ("20"), e o que o domínio usa é ponto-base
  // (2000). A primeira versão lia o parâmetro como ponto-base e o formulário mandava
  // percentual: pedir 25% de margem virava 0,25%, e a tela respondia um preço mínimo
  // baixo com cara de resposta certa. Ida e volta pela mesma função, agora.
  const margemAlvoBp = lerAlvo(um('alvo') ?? '') ?? MARGEM_ALVO_PADRAO_BP;

  return {
    plataforma,
    tipoAnuncioML: tipo,
    modoFrete: frete,
    preco: lerReaisDigitados(um('preco') ?? ''),
    margemAlvoBp,
  };
}

/**
 * O texto do preço mínimo para a margem alvo.
 *
 * `null` do domínio significa "nenhum preço na faixa varrida dá essa margem", e isso é
 * resposta: com custo alto e comissão da plataforma, margem de 30% pode não existir a
 * nenhum preço — e saber disso antes de anunciar é o ponto da fase 1.
 */
export function textoDoPrecoMinimo(params: {
  readonly preco: Centavos | null;
  readonly margemAlvoBp: number;
  readonly deReais: number;
  readonly ateReais: number;
}): string {
  const alvo = margemLegivel(params.margemAlvoBp);

  if (params.preco === null) {
    return `Nenhum preço entre R$ ${String(params.deReais)} e R$ ${String(params.ateReais)} dá ${alvo} de margem. Ou o custo está alto para esta plataforma, ou a faixa é estreita demais.`;
  }

  return `Para ${alvo} de margem, o preço mínimo é ${formatarBRL(params.preco)}.`;
}

export const CODIGOS_DE_AVISO = [
  'criado',
  'custo',
  'ficha',
  'nada',
  'produto_invalido',
  'custo_invalido',
  'ficha_invalida',
  'desativado',
  'reativado',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

export function descreverAviso(codigo: string | undefined): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'criado':
      return {
        tom: 'ok',
        titulo: 'Produto no catálogo.',
        corpo:
          'Informe o custo para a margem sair de verdade — sem ele, o que a tela mostra é o teto.',
      };
    case 'custo':
      return {
        tom: 'ok',
        titulo: 'Custo informado.',
        corpo:
          'A data ficou gravada junto: é ela que permite avisar quando o custo envelhecer, e custo velho é a causa mais comum de margem otimista.',
      };
    case 'ficha':
      return {
        tom: 'ok',
        titulo: 'Ficha salva.',
        corpo: 'Menos presunção no cálculo. O que ficou em branco continua presumido.',
      };
    case 'nada':
      return {
        tom: 'atencao',
        titulo: 'Nada para salvar.',
        corpo: 'Nenhum campo mudou, então nada foi escrito.',
      };
    case 'produto_invalido':
      return {
        tom: 'erro',
        titulo: 'Esse produto não entrou.',
        corpo:
          'O nome precisa de três caracteres ou mais. Se você informou código de barras, ele é conferido pelo dígito verificador — código interno de fornecedor não é código de barras, e tem campo próprio.',
      };
    case 'custo_invalido':
      return {
        tom: 'erro',
        titulo: 'Custo fora de forma.',
        corpo: 'Use um valor como 18,40. Custo zero é diferente de custo não informado.',
      };
    case 'ficha_invalida':
      return {
        tom: 'erro',
        titulo: 'Número que não fecha.',
        corpo:
          'Peso em gramas e medida em milímetros são positivos, peças na embalagem é número inteiro, e a devolução fica entre 0 e 100%. Nada foi salvo.',
      };
    case 'desativado':
      return {
        tom: 'ok',
        titulo: 'Produto desativado.',
        // Curto de propósito: a faixa logo abaixo diz o que desativar significa, e as
        // duas juntas repetiam a mesma frase.
        corpo: 'Se foi engano, o botão Reativar logo abaixo desfaz.',
      };
    case 'reativado':
      return {
        tom: 'ok',
        titulo: 'Produto de volta.',
        corpo:
          'Voltou ao catálogo e às outras listas com tudo o que tinha: custo, ficha e cadastro fiscal.',
      };
    case 'falha':
      return { tom: 'erro', titulo: 'Não deu.', corpo: 'Nada foi salvo. O erro está no log.' };
  }
}
