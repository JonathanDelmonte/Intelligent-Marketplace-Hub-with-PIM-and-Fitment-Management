/**
 * Controle de teto do MEI, com projeção (M12 — 9.3).
 *
 * A especificação pede: "acumulado do ano contra R$ 81.000, com projeção. Avisar em
 * 70% e em 85%."
 *
 * ## Por que a projeção é o número que importa
 *
 * O acumulado sozinho avisa tarde. Quem chega a 70% em setembro está tranquilo;
 * quem chega a 70% em abril vai estourar, e o acumulado não diz isso — a projeção
 * diz. Estourar o teto do MEI não é multa: é **desenquadramento**, com recolhimento
 * da diferença como Simples e a burocracia de mudar de regime no meio do ano.
 *
 * Então há dois avisos de naturezas diferentes, e os dois existem:
 *
 * - **O acumulado** cruzou 70% ou 85% — fato, sobre o passado.
 * - **A projeção** estoura o teto no ritmo atual — hipótese, sobre o futuro, e
 *   declarada como hipótese.
 *
 * ## A projeção é linear, e isso é uma escolha declarada
 *
 * Receita de reposição tem estação (novembro e dezembro vendem mais), e uma
 * projeção linear subestima quem vende sazonalmente. Modelar sazonalidade exigiria
 * histórico de anos que este sistema ainda não tem — e uma projeção sazonal errada
 * assusta mais que uma linear honesta. A linear é conservadora no sentido certo:
 * quem projeta estouro com ela vai estourar mesmo.
 *
 * ## Proporcional ao mês de abertura
 *
 * O teto do MEI é proporcional no ano em que o CNPJ abre: quem abriu em julho tem
 * metade. Sem isso o controle diria "tranquilo" para quem já estourou.
 */
import { centavos, proporcaoEmPontosBase, type Centavos, type PontosBase } from '@/lib/dinheiro';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import { reaisParaCentavos } from '@/lib/dinheiro';

/** Teto anual do MEI. Levantamento, e fica em um lugar para mudar em um lugar. */
export const TETO_MEI_ANUAL: Centavos = reaisParaCentavos(81_000);

/** Onde avisar, em pontos-base do teto. Os dois números vêm da especificação. */
export const AVISO_AMARELO_BP = 7_000;
export const AVISO_VERMELHO_BP = 8_500;

export const SITUACOES_DO_TETO = ['tranquilo', 'atencao', 'perto', 'estourou'] as const;
export type SituacaoDoTeto = (typeof SITUACOES_DO_TETO)[number];

export interface EntradaDoTeto {
  /** Receita das plataformas, acumulada no ano. */
  readonly receitaBruta: Centavos;
  /** Receita informada à mão, fora das plataformas integradas. */
  readonly receitaExterna: Centavos;
  /** Teto do perfil. Nulo cai no teto anual — e o proporcional entra por `mesDeAbertura`. */
  readonly tetoAnual?: Centavos | null;
  /**
   * Mês em que o CNPJ abriu, 1 a 12, **quando abriu neste ano**.
   *
   * Nulo significa CNPJ de ano anterior, e aí o teto é o cheio. O teto proporcional
   * conta o mês de abertura inteiro: quem abriu em 20 de julho tem seis doze avos.
   */
  readonly mesDeAbertura?: number | null;
}

export interface AvaliacaoDoTeto {
  readonly acumulado: Centavos;
  /** O teto que vale para este perfil neste ano, já proporcional. */
  readonly teto: Centavos;
  readonly usadoBp: PontosBase;
  readonly restante: Centavos;
  readonly situacao: SituacaoDoTeto;
  /** Receita projetada para o fim do ano, no ritmo até aqui. */
  readonly projecaoAnual: Centavos;
  /** A projeção passa do teto. É hipótese, e a mensagem diz isso. */
  readonly projecaoEstoura: boolean;
  /** Quanto por mês daqui em diante caberia sem estourar. `null` se já estourou. */
  readonly mediaMensalQueCabe: Centavos | null;
  readonly mensagem: string;
}

/** Mês civil de uma data, 1 a 12, no fuso do vendedor. */
export function mesNoFuso(data: Date, fuso: string = FUSO_PADRAO): number {
  const [, mes] = diaNoFuso(data, fuso).split('-');
  return Number(mes ?? '1');
}

/**
 * O teto proporcional ao tempo de CNPJ no ano.
 *
 * Doze avos por mês, contando o mês de abertura inteiro. Trunca, porque arredondar
 * para cima daria ao vendedor um teto que ele não tem.
 */
export function tetoProporcional(teto: Centavos, mesDeAbertura: number | null): Centavos {
  if (mesDeAbertura === null || mesDeAbertura <= 1) return teto;
  if (mesDeAbertura > 12) return centavos(0);
  const meses = 12 - mesDeAbertura + 1;
  return centavos(Math.trunc((teto * meses) / 12));
}

/**
 * O mês de abertura que o teto do ano usa: o da data de abertura do CNPJ, **se** ele abriu
 * no ano avaliado. Em qualquer outro ano, `null` — o teto cheio.
 *
 * CNPJ de ano anterior tem o ano inteiro de atividade. E data de abertura depois do ano
 * avaliado também dá `null`, e não mês 13 (teto zero): nesse ano não havia CNPJ, então
 * não havia teto de MEI a controlar, e um "teto estourado" na tela seria alarme falso.
 */
export function mesDeAberturaNoAno(abertoEm: Date | null, ano: number): number | null {
  if (abertoEm === null) return null;
  const [anoDaAbertura, mes] = abertoEm.toISOString().slice(0, 10).split('-').map(Number);
  return anoDaAbertura === ano && mes !== undefined ? mes : null;
}

function situacaoDe(usadoBp: number): SituacaoDoTeto {
  if (usadoBp >= 10_000) return 'estourou';
  if (usadoBp >= AVISO_VERMELHO_BP) return 'perto';
  if (usadoBp >= AVISO_AMARELO_BP) return 'atencao';
  return 'tranquilo';
}

export interface OpcoesDoTeto {
  readonly agora?: Date;
  readonly fuso?: string;
}

/**
 * Avalia o teto.
 *
 * Função pura sobre inteiros em centavos. O mês corrente conta inteiro na
 * projeção — projetar com base em meio mês daria um número que dobra na virada e
 * assusta sem motivo.
 */
export function avaliarTeto(entrada: EntradaDoTeto, opcoes: OpcoesDoTeto = {}): AvaliacaoDoTeto {
  const agora = opcoes.agora ?? new Date();
  const mesAtual = mesNoFuso(agora, opcoes.fuso ?? FUSO_PADRAO);

  const acumulado = centavos(entrada.receitaBruta + entrada.receitaExterna);
  const teto = tetoProporcional(entrada.tetoAnual ?? TETO_MEI_ANUAL, entrada.mesDeAbertura ?? null);

  const usadoBp = proporcaoEmPontosBase(acumulado, teto, 'baixo');
  const restante = centavos(Math.max(0, teto - acumulado));
  const situacao = situacaoDe(usadoBp);

  // Meses já corridos, contando o atual. Em janeiro é 1, e não zero — dividir por
  // zero em janeiro seria o bug mais previsível deste arquivo.
  const mesesCorridos = Math.max(1, mesAtual - (entrada.mesDeAbertura ?? 1) + 1);
  const mesesQueFaltam = 12 - mesAtual;

  const projecaoAnual = centavos(Math.trunc((acumulado / mesesCorridos) * 12));
  const mediaMensalQueCabe =
    mesesQueFaltam <= 0 || restante === 0 ? null : centavos(Math.trunc(restante / mesesQueFaltam));

  return {
    acumulado,
    teto,
    usadoBp,
    restante,
    situacao,
    projecaoAnual,
    projecaoEstoura: projecaoAnual > teto,
    mediaMensalQueCabe,
    mensagem: mensagemDe(situacao, projecaoAnual > teto, mesesQueFaltam),
  };
}

function mensagemDe(
  situacao: SituacaoDoTeto,
  projecaoEstoura: boolean,
  mesesQueFaltam: number,
): string {
  if (situacao === 'estourou') {
    return 'O teto do ano já foi passado. Isso é desenquadramento do MEI: a diferença é recolhida como Simples, e a mudança de regime é retroativa ao início do ano. Fale com quem cuida da sua contabilidade agora, não em janeiro.';
  }

  const sobreOFuturo = projecaoEstoura
    ? ` No ritmo até aqui, a projeção passa do teto antes do fim do ano — é hipótese, calculada em linha reta, e serve para decidir agora e não em dezembro.${mesesQueFaltam > 0 ? ' Dá para segurar reduzindo o faturamento mensal ou preparando a mudança de regime.' : ''}`
    : ' No ritmo até aqui, a projeção fecha o ano dentro do teto.';

  switch (situacao) {
    case 'perto':
      return `Perto do teto.${sobreOFuturo}`;
    case 'atencao':
      return `Passou de setenta por cento do teto.${sobreOFuturo}`;
    case 'tranquilo':
      return `Dentro do teto, com folga.${sobreOFuturo}`;
  }
}
