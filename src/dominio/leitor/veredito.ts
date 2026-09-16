/**
 * M14 — o veredito: compra ou não compra.
 *
 * A especificação pede uma resposta em dois segundos, com a pessoa de pé na
 * liquidação, capital de R$ 50 a R$ 100 e o celular na mão. Duas perguntas, nessa
 * ordem: **compro?** e, se sim, **até quanto posso pagar?**
 *
 * Função pura sobre M8. O que ela não faz é tão importante quanto o que faz: não
 * busca dado, não chama plataforma, não decide nada sobre rede. Recebe a
 * evidência que alguém já reuniu e devolve o julgamento — e é por isso que dá
 * para testar cada regra contra número conhecido.
 *
 * ## Nenhum limiar novo
 *
 * O projeto já tem os cortes que decidem se um negócio presta: markup mínimo de
 * 3, margem apertada abaixo de 8%, ticket mínimo de R$ 80 (ver `margem.ts`).
 * Inventar um limiar de "compra" ao lado deles criaria duas verdades sobre o
 * mesmo negócio. `custoMaximoParaComprar` é definido como **a fronteira do
 * próprio veredito**: o maior custo com que ele ainda diria `compra`.
 *
 * ## Escolha do preço de referência
 *
 * Três regras, e cada uma existe por um erro que ela evita:
 *
 * 1. **O maior preço observado, não.** Um anúncio absurdo de um vendedor que não
 *    vende nada viraria a base do cálculo, e o veredito sairia otimista.
 * 2. **A média, não.** Mesmo problema, diluído: um outlier ainda desloca.
 *    Mediana é robusta, e é o que se usa.
 * 3. **Mediana do melhor nível de procedência, não de tudo junto.** Cinco
 *    extrações de página não podem sobrepujar uma leitura de API oficial — é a
 *    regra 3.3 do projeto, e misturar os níveis antes da mediana a violaria.
 *
 * E dado velho não é evidência de preço de hoje: fora da janela, a observação sai
 * do cálculo. Se **todas** saírem, o veredito é `sem_dado_recente`, que é
 * diferente de não ter dado — e a diferença muda o que a pessoa faz.
 */
import {
  CORTE_MARKUP_MINIMO,
  CORTE_TICKET_MINIMO,
  MARGEM_APERTADA_BP,
  calcularMargem,
} from '@/dominio/precificacao';
import type { EntradaSemPreco } from '@/dominio/precificacao/simulador';
import type { ResultadoDeMargem, Severidade } from '@/dominio/precificacao/tipos';
import { FORCA_DA_FONTE, type Procedencia } from '@/dominio/procedencia';
import { contagem } from '@/lib/texto';
import { centavos, type Centavos } from '@/lib/dinheiro';

export const VEREDITOS = [
  'compra',
  'compra_com_ressalva',
  'nao_compra',
  'sem_dado_recente',
  'sem_dado',
] as const;
export type Veredito = (typeof VEREDITOS)[number];

export const ROTULO_DO_VEREDITO: Readonly<Record<Veredito, string>> = {
  compra: 'compra',
  compra_com_ressalva: 'compra com ressalva',
  nao_compra: 'não compra',
  sem_dado_recente: 'só tenho dado velho',
  sem_dado: 'sem dado',
};

export const CODIGOS_DE_MOTIVO = [
  'sem_evidencia',
  'evidencia_vencida',
  'evidencia_unica',
  'evidencia_fraca',
  'margem_negativa',
  'margem_apertada',
  'markup_abaixo_do_corte',
  'ticket_abaixo_do_corte',
  'lote_de_agrupamento',
  'dispersao_alta',
  'margem_e_markup_ok',
] as const;
export type CodigoDeMotivo = (typeof CODIGOS_DE_MOTIVO)[number];

export interface MotivoDoVeredito {
  readonly codigo: CodigoDeMotivo;
  readonly severidade: Severidade;
  readonly mensagem: string;
}

/** Um preço praticado observado, com de onde veio e quando. */
export interface EvidenciaDePreco {
  readonly preco: Centavos;
  readonly procedencia: Procedencia;
  /** De onde a pessoa reconhece a observação: "anúncio de X", "meu SKU". */
  readonly rotulo?: string;
}

export interface CriterioDeCompra {
  /** Fora desta janela, a observação não conta como preço de hoje. */
  readonly janelaDeEvidenciaDias: number;
  /** Abaixo disto, a confiança cai por amostra pequena. */
  readonly minObservacoes: number;
  /**
   * Dispersão acima disto (em pontos-base sobre a mediana) vira ressalva: preço
   * muito espalhado quer dizer que não existe "preço praticado", existem vários
   * mercados no mesmo código de barras.
   */
  readonly dispersaoMaximaBp: number;
}

export const CRITERIO_PADRAO: CriterioDeCompra = {
  // Três meses. Tabela de taxa muda, campanha entra e sai, concorrente novo
  // aparece. Mais que isso deixa de ser preço praticado e passa a ser história.
  janelaDeEvidenciaDias: 90,
  minObservacoes: 3,
  // 40% de espalhamento em torno da mediana.
  dispersaoMaximaBp: 4000,
};

export interface EntradaDoVeredito {
  /**
   * Custo por **unidade**, já dividido quando o lote tem mais de uma.
   *
   * Por unidade e não do lote de propósito: o preço praticado é por unidade, e
   * comparar as duas coisas é o erro que faz o veredito sair doze vezes otimista
   * quando o código de barras lido era o da caixa.
   */
  readonly custoUnitario: Centavos;
  /** Quantas unidades vieram no lote. Só entra no relato, não no cálculo. */
  readonly unidadesNoLote?: number;
  /** Verdadeiro quando o código lido identifica caixa, não unidade. */
  readonly codigoDeAgrupamento?: boolean;
  readonly evidencias: readonly EvidenciaDePreco[];
  /** Tudo que M8 precisa fora preço e custo. */
  readonly base: Omit<EntradaSemPreco, 'custoProduto'>;
  readonly em?: Date;
  readonly criterio?: CriterioDeCompra;
}

export interface ResultadoDoVeredito {
  readonly veredito: Veredito;
  /** Mediana do melhor nível de procedência dentro da janela. */
  readonly precoDeReferencia: Centavos | null;
  /** Margem calculada no preço de referência com o custo informado. */
  readonly margem: ResultadoDeMargem | null;
  /**
   * O maior custo por unidade com que o veredito ainda seria `compra`.
   *
   * É a resposta para "até quanto eu ofereço". `null` quando não há preço de
   * referência, ou quando nem o custo mínimo possível daria `compra`.
   */
  readonly custoMaximoParaComprar: Centavos | null;
  readonly motivos: readonly MotivoDoVeredito[];
  /** Confiança da evidência, em pontos-base. Não é probabilidade de modelo. */
  readonly confiancaBp: number;
  readonly evidenciaUsada: readonly EvidenciaDePreco[];
  readonly evidenciaVencida: readonly EvidenciaDePreco[];
}

const DIA_MS = 86_400_000;

export function decidirCompra(entrada: EntradaDoVeredito): ResultadoDoVeredito {
  const criterio = entrada.criterio ?? CRITERIO_PADRAO;
  const agora = entrada.em ?? new Date();
  const motivos: MotivoDoVeredito[] = [];

  if (entrada.codigoDeAgrupamento === true) {
    motivos.push({
      codigo: 'lote_de_agrupamento',
      severidade: 'amarelo',
      mensagem:
        'o código lido identifica uma caixa, não a unidade. Confirme quantas unidades tem ' +
        'antes de confiar no custo por unidade.',
    });
  }

  const { dentro, vencidas } = separarPorJanela(entrada.evidencias, agora, criterio);

  if (entrada.evidencias.length === 0) {
    return semPreco('sem_dado', motivos, {
      codigo: 'sem_evidencia',
      severidade: 'amarelo',
      mensagem:
        'nenhum preço praticado conhecido para este código. Não dá para dizer se vale: ' +
        'guarde a leitura e decida com outro critério.',
    });
  }

  if (dentro.length === 0) {
    return semPreco(
      'sem_dado_recente',
      motivos,
      {
        codigo: 'evidencia_vencida',
        severidade: 'amarelo',
        mensagem:
          `há ${contagem(vencidas.length, 'observação', 'observações')}, mas ` +
          `${vencidas.length === 1 ? 'ela tem' : 'todas têm'} mais de ` +
          `${String(criterio.janelaDeEvidenciaDias)} dias. Preço velho não é preço praticado.`,
      },
      vencidas,
    );
  }

  const usada = melhorNivelDeProcedencia(dentro);
  const precoDeReferencia = medianaDePrecos(usada);

  const margem = calcularMargem({
    ...entrada.base,
    preco: precoDeReferencia,
    custoProduto: entrada.custoUnitario,
    ...(entrada.em === undefined ? {} : { em: entrada.em }),
  });

  motivos.push(...motivosDaMargem(margem, precoDeReferencia));
  motivos.push(...motivosDaEvidencia(usada, precoDeReferencia, criterio));

  const veredito = decidirPelaMargem(margem);
  const custoMaximoParaComprar = custoMaximoQueAindaCompra({
    base: entrada.base,
    preco: precoDeReferencia,
    ...(entrada.em === undefined ? {} : { em: entrada.em }),
  });

  return {
    veredito: veredito === 'compra' && temRessalva(motivos) ? 'compra_com_ressalva' : veredito,
    precoDeReferencia,
    margem,
    custoMaximoParaComprar,
    motivos,
    confiancaBp: confiancaDe(usada, precoDeReferencia, criterio),
    evidenciaUsada: usada,
    evidenciaVencida: vencidas,
  };
}

// ─── Evidência ───────────────────────────────────────────────────────────────

function separarPorJanela(
  evidencias: readonly EvidenciaDePreco[],
  agora: Date,
  criterio: CriterioDeCompra,
): {
  readonly dentro: readonly EvidenciaDePreco[];
  readonly vencidas: readonly EvidenciaDePreco[];
} {
  const limite = agora.getTime() - criterio.janelaDeEvidenciaDias * DIA_MS;
  const dentro: EvidenciaDePreco[] = [];
  const vencidas: EvidenciaDePreco[] = [];

  for (const e of evidencias) {
    if (e.procedencia.coletadoEm.getTime() >= limite) dentro.push(e);
    else vencidas.push(e);
  }
  return { dentro, vencidas };
}

/**
 * Só as observações do nível de procedência mais forte presente.
 *
 * É a regra 3.3 aplicada antes da mediana: dado de origem fraca não sobrescreve
 * — e, num cálculo de mediana, "não sobrescreve" quer dizer "não entra na
 * contagem junto".
 */
export function melhorNivelDeProcedencia(
  evidencias: readonly EvidenciaDePreco[],
): readonly EvidenciaDePreco[] {
  let melhor = -1;
  for (const e of evidencias) {
    const forca = FORCA_DA_FONTE[e.procedencia.fonte];
    if (forca > melhor) melhor = forca;
  }
  return evidencias.filter((e) => FORCA_DA_FONTE[e.procedencia.fonte] === melhor);
}

/** Mediana em centavos inteiros. Par: média dos dois centrais, arredondada. */
export function medianaDePrecos(evidencias: readonly EvidenciaDePreco[]): Centavos {
  const ordenados = [...evidencias].map((e) => e.preco).sort((a, b) => a - b);
  const n = ordenados.length;
  if (n === 0) throw new VeredictoSemEvidencia('mediana de lista vazia');

  const meio = Math.floor(n / 2);
  if (n % 2 === 1) return centavos(ordenados[meio] ?? 0);

  const a = ordenados[meio - 1] ?? 0;
  const b = ordenados[meio] ?? 0;
  return centavos(Math.round((a + b) / 2));
}

export class VeredictoSemEvidencia extends Error {
  override readonly name = 'VeredictoSemEvidencia';
}

/**
 * Dispersão da amostra em pontos-base sobre a mediana.
 *
 * Amplitude e não desvio padrão: com três a cinco observações o desvio padrão
 * não diz nada, e o que importa para a decisão é "o maior está longe do menor?".
 */
export function dispersaoBp(evidencias: readonly EvidenciaDePreco[], mediana: Centavos): number {
  if (evidencias.length < 2 || mediana <= 0) return 0;
  const precos = evidencias.map((e) => e.preco);
  const amplitude = Math.max(...precos) - Math.min(...precos);
  return Math.round((amplitude / mediana) * 10_000);
}

/**
 * Confiança da evidência, em pontos-base.
 *
 * Composição explícita de três fatores observáveis — força da fonte, tamanho da
 * amostra e dispersão. Não é probabilidade de nada: é o quanto a base do cálculo
 * merece crédito, na mesma escala que o classificador de entrada usa.
 */
export function confiancaDe(
  usada: readonly EvidenciaDePreco[],
  mediana: Centavos,
  criterio: CriterioDeCompra,
): number {
  if (usada.length === 0) return 0;

  const primeira = usada[0];
  if (primeira === undefined) return 0;

  const forca = FORCA_DA_FONTE[primeira.procedencia.fonte] / 100;
  const amostra = Math.min(1, usada.length / criterio.minObservacoes);
  const espalhamento = dispersaoBp(usada, mediana);
  const penalidade = espalhamento <= criterio.dispersaoMaximaBp ? 1 : 0.6;

  return Math.round(forca * amostra * penalidade * 10_000);
}

function motivosDaEvidencia(
  usada: readonly EvidenciaDePreco[],
  mediana: Centavos,
  criterio: CriterioDeCompra,
): readonly MotivoDoVeredito[] {
  const motivos: MotivoDoVeredito[] = [];

  if (usada.length === 1) {
    motivos.push({
      codigo: 'evidencia_unica',
      severidade: 'amarelo',
      mensagem:
        'uma única observação de preço. Pode ser o preço do mercado ou pode ser o anúncio ' +
        'de alguém que não vende.',
    });
  } else if (usada.length < criterio.minObservacoes) {
    motivos.push({
      codigo: 'evidencia_fraca',
      severidade: 'informativo',
      mensagem: `só ${String(usada.length)} observações de preço.`,
    });
  }

  const espalhamento = dispersaoBp(usada, mediana);
  if (espalhamento > criterio.dispersaoMaximaBp) {
    motivos.push({
      codigo: 'dispersao_alta',
      severidade: 'amarelo',
      mensagem:
        `os preços observados variam ${String(Math.round(espalhamento / 100))}% entre si. ` +
        'Confira se são o mesmo produto antes de confiar na mediana.',
    });
  }

  return motivos;
}

// ─── Margem ──────────────────────────────────────────────────────────────────

function motivosDaMargem(margem: ResultadoDeMargem, preco: Centavos): readonly MotivoDoVeredito[] {
  const motivos: MotivoDoVeredito[] = [];

  if (margem.margemReais <= 0) {
    motivos.push({
      codigo: 'margem_negativa',
      severidade: 'vermelho',
      mensagem: 'no preço praticado, este custo dá prejuízo.',
    });
    return motivos;
  }

  if (margem.margemPontosBase < MARGEM_APERTADA_BP) {
    motivos.push({
      codigo: 'margem_apertada',
      severidade: 'amarelo',
      mensagem:
        `margem de ${String(Math.round(margem.margemPontosBase / 100))}%: uma devolução ` +
        'zera o lote.',
    });
  }

  if (margem.markupSobreCusto !== null && margem.markupSobreCusto < CORTE_MARKUP_MINIMO) {
    motivos.push({
      codigo: 'markup_abaixo_do_corte',
      severidade: 'amarelo',
      mensagem:
        `o preço cobre ${margem.markupSobreCusto.toFixed(1)}x o custo, abaixo do corte de ` +
        `${String(CORTE_MARKUP_MINIMO)}x.`,
    });
  }

  if (preco < CORTE_TICKET_MINIMO) {
    motivos.push({
      codigo: 'ticket_abaixo_do_corte',
      severidade: 'informativo',
      mensagem: 'ticket baixo: a taxa fixa pesa mais que a comissão.',
    });
  }

  if (motivos.length === 0) {
    motivos.push({
      codigo: 'margem_e_markup_ok',
      severidade: 'informativo',
      mensagem: 'margem e markup acima dos cortes.',
    });
  }

  return motivos;
}

/** O veredito que a margem sozinha determina, antes das ressalvas de evidência. */
function decidirPelaMargem(margem: ResultadoDeMargem): Veredito {
  if (margem.margemReais <= 0) return 'nao_compra';
  if (margem.margemPontosBase < MARGEM_APERTADA_BP) return 'compra_com_ressalva';
  if (margem.markupSobreCusto !== null && margem.markupSobreCusto < CORTE_MARKUP_MINIMO) {
    return 'compra_com_ressalva';
  }
  return 'compra';
}

function temRessalva(motivos: readonly MotivoDoVeredito[]): boolean {
  return motivos.some((m) => m.severidade === 'amarelo' || m.severidade === 'vermelho');
}

/**
 * O maior custo por unidade com que o veredito ainda seria `compra`.
 *
 * Bisseção, e não fórmula fechada. A margem é **monótona decrescente** no custo,
 * o que basta para a busca funcionar — e depender disso é mais seguro que
 * reproduzir aqui a álgebra do M8. Medido: a margem cai `1 + taxa de devolução`
 * por centavo de custo, porque a provisão de devolução incide sobre o custo. Uma
 * fórmula fechada acertaria hoje e passaria a errar em silêncio no dia em que a
 * provisão mudasse de base.
 */
export function custoMaximoQueAindaCompra(params: {
  readonly base: Omit<EntradaSemPreco, 'custoProduto'>;
  readonly preco: Centavos;
  readonly em?: Date;
}): Centavos | null {
  const compraCom = (custo: number): boolean => {
    const margem = calcularMargem({
      ...params.base,
      preco: params.preco,
      custoProduto: centavos(custo),
      ...(params.em === undefined ? {} : { em: params.em }),
    });
    return decidirPelaMargem(margem) === 'compra';
  };

  // Custo 1 centavo é o piso: custo zero não é compra, é doação, e M8 avisa
  // sobre custo não informado.
  if (!compraCom(1)) return null;

  // Anotados como `number` de propósito: a bisseção opera em inteiro cru, e só o
  // resultado volta a ser `Centavos`. Sem a anotação o compilador infere
  // `Centavos` do preço e recusa a atribuição do ponto médio — que é a marca de
  // tipo funcionando, não atrapalhando.
  let baixo: number = 1;
  let alto: number = params.preco;
  if (compraCom(alto)) return centavos(alto);

  while (alto - baixo > 1) {
    const meio = Math.floor((baixo + alto) / 2);
    if (compraCom(meio)) baixo = meio;
    else alto = meio;
  }

  return centavos(baixo);
}

// ─── Saídas sem preço ────────────────────────────────────────────────────────

function semPreco(
  veredito: Veredito,
  motivos: readonly MotivoDoVeredito[],
  motivo: MotivoDoVeredito,
  vencidas: readonly EvidenciaDePreco[] = [],
): ResultadoDoVeredito {
  return {
    veredito,
    precoDeReferencia: null,
    margem: null,
    custoMaximoParaComprar: null,
    motivos: [...motivos, motivo],
    confiancaBp: 0,
    evidenciaUsada: [],
    evidenciaVencida: vencidas,
  };
}
