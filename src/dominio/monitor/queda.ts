/**
 * Detector de queda real de preço (M13 — 11.5).
 *
 * A especificação nomeia o truque que isto existe para furar: "calcula se o desconto
 * é verdadeiro ou se é o truque de subir o preço para depois 'baixar'. O score de
 * desconto compara com a **mediana dos últimos 90 dias**, não com o 'preço de'
 * anunciado."
 *
 * ## Por que a mediana, e por que 90 dias
 *
 * O "preço de" é escrito pelo vendedor e não é evidência de nada. A mediana é o que o
 * produto **custou de fato** na janela, e não se move porque houve uma semana caro: é
 * a diferença entre "está barato" e "está anunciado como barato".
 *
 * Noventa dias é a janela da especificação, e ela tem uma razão prática: pega mais de
 * um ciclo de promoção sazonal. Uma janela de trinta dias confundiria "voltou ao
 * normal depois da Black Friday" com "caiu de verdade".
 *
 * ## Desconto é em pontos-base, e a queda é medida contra a mediana
 *
 * Tudo inteiro (ADR 0004). Comparar `0.08` com `0.08` em ponto flutuante num corte de
 * publicação é convite a bug, e aqui o corte decide se a oferta vai para o grupo.
 */
import { centavos, proporcaoEmPontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/** Janela de referência, em dias. É o número da especificação. */
export const JANELA_DE_REFERENCIA_DIAS = 90;

/**
 * Desconto mínimo para a oferta valer uma publicação, em pontos-base.
 *
 * 15%. Abaixo disso o desconto não move ninguém, e grupo que publica queda de 5% é
 * grupo que os membros silenciam — que é a morte do canal, não uma oferta perdida.
 */
export const DESCONTO_QUE_VALE_BP = 1_500;

/**
 * Observações mínimas para a mediana valer.
 *
 * Três. Com duas, "mediana" é só o menor dos dois, e chamar isso de referência
 * histórica seria dar ao número uma autoridade que ele não tem.
 */
export const OBSERVACOES_MINIMAS = 3;

export const VEREDITOS_DE_QUEDA = [
  'queda_real',
  'desconto_fraco',
  'preco_inflado',
  'sem_referencia',
] as const;
export type VereditoDeQueda = (typeof VEREDITOS_DE_QUEDA)[number];

/** Um preço observado numa data. É o que a tabela de histórico guarda. */
export interface PrecoObservado {
  readonly preco: Centavos;
  readonly em: Date;
}

export interface AvaliacaoDaQueda {
  readonly veredito: VereditoDeQueda;
  readonly precoAtual: Centavos;
  /** Mediana da janela. `null` quando não há observações suficientes. */
  readonly medianaJanela: Centavos | null;
  /** Desconto real contra a mediana. Negativo significa que **subiu**. */
  readonly descontoBp: PontosBase | null;
  readonly observacoes: number;
  readonly valePublicar: boolean;
  readonly mensagem: string;
}

export interface OpcoesDaQueda {
  readonly agora?: Date;
  readonly fuso?: string;
  readonly janelaDias?: number;
  readonly descontoMinimoBp?: number;
}

/** Dias civis entre duas datas, no fuso do vendedor. */
function diasEntre(de: Date, ate: Date, fuso: string): number {
  const emDias = (data: Date): number =>
    Date.parse(`${diaNoFuso(data, fuso)}T00:00:00Z`) / 86_400_000;
  return Math.round(emDias(ate) - emDias(de));
}

/**
 * Mediana de preços inteiros.
 *
 * Com quantidade par devolve o **menor** dos dois centrais, e não a média: média de
 * dois centavos inteiros pode dar meio centavo, que não existe. Errar para o menor
 * também erra para o lado conservador — a referência fica mais barata, e o desconto
 * calculado contra ela fica menor.
 */
export function medianaDePrecos(precos: readonly Centavos[]): Centavos | null {
  if (precos.length === 0) return null;
  const ordenados = [...precos].sort((a, b) => a - b);
  return ordenados[Math.floor((ordenados.length - 1) / 2)] ?? null;
}

/**
 * Avalia se a queda é real.
 *
 * Quatro vereditos, e cada um leva a uma ação diferente:
 *
 * - `queda_real` — desconto acima do corte contra a mediana. Publica.
 * - `desconto_fraco` — caiu, mas pouco. Não publica, e não é engano de ninguém.
 * - `preco_inflado` — o preço atual está **acima** da mediana. É o truque: subiu para
 *   depois "baixar". Não publica, e o motivo aparece escrito.
 * - `sem_referencia` — menos de três observações na janela. Não publica, porque não
 *   há com o que comparar — e isso é diferente de "não está barato".
 */
export function avaliarQueda(
  precoAtual: Centavos,
  historico: readonly PrecoObservado[],
  opcoes: OpcoesDaQueda = {},
): AvaliacaoDaQueda {
  const agora = opcoes.agora ?? new Date();
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const janela = opcoes.janelaDias ?? JANELA_DE_REFERENCIA_DIAS;
  const corte = opcoes.descontoMinimoBp ?? DESCONTO_QUE_VALE_BP;

  const naJanela = historico.filter((o) => {
    const dias = diasEntre(o.em, agora, fuso);
    return dias >= 0 && dias <= janela;
  });

  const mediana = medianaDePrecos(naJanela.map((o) => o.preco));

  if (mediana === null || naJanela.length < OBSERVACOES_MINIMAS) {
    return {
      veredito: 'sem_referencia',
      precoAtual,
      medianaJanela: mediana,
      descontoBp: null,
      observacoes: naJanela.length,
      valePublicar: false,
      mensagem: `Só ${String(naJanela.length)} observação(ões) de preço em ${String(janela)} dias. Sem ${String(OBSERVACOES_MINIMAS)} não há mediana que sirva de referência — e "não sei se está barato" é diferente de "não está barato".`,
    };
  }

  // Positivo quando o preço atual está **abaixo** da mediana, que é o que interessa.
  const descontoBp = proporcaoEmPontosBase(centavos(mediana - precoAtual), mediana, 'baixo');

  if (descontoBp <= 0) {
    return {
      veredito: 'preco_inflado',
      precoAtual,
      medianaJanela: mediana,
      descontoBp,
      observacoes: naJanela.length,
      valePublicar: false,
      mensagem:
        'O preço de agora está no nível da mediana dos últimos 90 dias, ou acima dela. Se o anúncio diz que é desconto, o desconto é contra um "preço de" que ninguém pagou.',
    };
  }

  const valePublicar = descontoBp >= corte;

  return {
    veredito: valePublicar ? 'queda_real' : 'desconto_fraco',
    precoAtual,
    medianaJanela: mediana,
    descontoBp,
    observacoes: naJanela.length,
    valePublicar,
    mensagem: valePublicar
      ? `Queda real contra a mediana de ${String(naJanela.length)} observação(ões) em ${String(janela)} dias.`
      : `Caiu, mas pouco para o corte de publicação. Grupo que publica desconto pequeno é grupo que os membros silenciam.`,
  };
}
