/**
 * O dossiê do prospector (M6 — 10.5, 10.7, 10.8).
 *
 * A saída do módulo: "um dossiê por alvo — fornecedores candidatos com contato e
 * preço, faixa de preço de mercado, compatibilidades encontradas, concorrentes e
 * força de cada um, produtos adjacentes, e uma recomendação com a evidência anexada.
 * Revisável, auditável, e **cada item tem a URL de onde veio**."
 *
 * ## Orçamento obrigatório, verificado no construtor
 *
 * "Agente sem teto de gasto é a forma mais rápida de transformar curiosidade em
 * fatura" (especificação) e "agente sem teto de orçamento por execução não roda"
 * (convenções, 3.5). Então o teto não é opcional e não tem padrão silencioso: falta
 * de teto **lança**, como em `Orcamento` do serviço de LLM.
 *
 * Dois tetos, e os dois são obrigatórios pelo mesmo motivo de lá: reais é o teto que
 * interessa ao bolso, e passos é o que continua valendo quando uma ferramenta não
 * informa custo.
 *
 * ## O dossiê parcial é o comportamento normal, não a exceção
 *
 * Estourar o orçamento é resultado previsto, e perder o trabalho feito até ali seria
 * pagar duas vezes pela mesma investigação. `paraGravar` produz um dossiê completo e
 * salvável **em qualquer ponto** — é o que permite salvar a cada passo e retomar
 * depois com teto maior.
 */
import { centavos, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import type { Achado, EstadoDaBusca, Hipotese, ItemDaFronteira, MotivoDeParada } from './fronteira';
import type { FamiliaDeHipotese } from './hipoteses';

export class OrcamentoDoDossieInvalido extends Error {
  override readonly name = 'OrcamentoDoDossieInvalido';
}

/**
 * O teto de uma execução.
 *
 * Classe e não objeto simples porque a validação no construtor é a garantia: um
 * `interface` deixaria passar `{ centavos: 0 }` e o agente rodaria sem teto — que é
 * exatamente o que as convenções proíbem.
 */
export class OrcamentoDaBusca {
  private gastoEmCentavos = 0;

  constructor(
    readonly limiteCentavos: Centavos,
    readonly limitePassos: number,
  ) {
    if (!Number.isInteger(limiteCentavos) || limiteCentavos <= 0) {
      throw new OrcamentoDoDossieInvalido(
        `teto em centavos precisa ser inteiro positivo, recebeu ${String(limiteCentavos)}`,
      );
    }
    if (!Number.isInteger(limitePassos) || limitePassos <= 0) {
      throw new OrcamentoDoDossieInvalido(
        `teto de passos precisa ser inteiro positivo, recebeu ${String(limitePassos)}`,
      );
    }
  }

  get gasto(): Centavos {
    return centavos(this.gastoEmCentavos);
  }

  get restante(): Centavos {
    return centavos(Math.max(0, this.limiteCentavos - this.gastoEmCentavos));
  }

  /** Registra gasto. Devolve `false` quando o teto foi alcançado ou passado. */
  registrar(valor: Centavos): boolean {
    this.gastoEmCentavos += valor;
    return this.gastoEmCentavos < this.limiteCentavos;
  }

  get estourou(): boolean {
    return this.gastoEmCentavos >= this.limiteCentavos;
  }
}

/** Um fornecedor candidato achado pela investigação. */
export interface FornecedorCandidato {
  readonly nome: string;
  readonly contato: string | null;
  /** Preço visto, por unidade. Nulo quando a página não trazia preço. */
  readonly precoUnidade: Centavos | null;
  /** Custo desembarcado, quando houve como calcular (frete, imposto, mínimo). */
  readonly custoDesembarcado: Centavos | null;
  readonly origemUrl: string;
}

export interface ConcorrenteVisto {
  readonly nome: string;
  readonly preco: Centavos | null;
  /** Força percebida, de 0 a 100. Palpite do agente, não medida. */
  readonly forca: number;
  readonly origemUrl: string;
}

export interface DossieParaGravar {
  readonly alvo: string;
  readonly hipoteses: readonly Hipotese[];
  /**
   * A fronteira **inteira**, com peso, custo e ferramenta de cada item.
   *
   * Guardava só `{alvo, familia}` — o que interessa a quem lê — e o efeito apareceu
   * ao escrever o executor: sem `ferramenta` não dá para saber se o item pode ser
   * investigado hoje, e sem `valorEsperado` e `custoEmPassos` a ordem da fila se
   * perde. Uma execução retomada escolheria outro caminho, e o dossiê promete ser
   * retomável desde o schema da fase 1.
   *
   * Quem lê a tela quer o que **ficou**: é `fronteiraRestante`, derivada com
   * `investigados`.
   */
  readonly fronteira: readonly ItemDaFronteira[];
  readonly achados: readonly Achado[];
  /** Ids já investigados. Sem eles, retomar re-investiga e paga duas vezes. */
  readonly investigados: readonly string[];
  readonly orcamentoCentavos: Centavos;
  readonly gastoCentavos: Centavos;
  readonly orcamentoPassos: number;
  readonly passosGastos: number;
  /** Investigações seguidas sem achado novo. É daqui que sai a parada por saturação. */
  readonly passosSemAchado: number;
  readonly motivoParada: MotivoDeParada | null;
  readonly recomendacao: string | null;
}

export interface ParametrosDoDossie {
  readonly alvo: string;
  readonly estado: EstadoDaBusca;
  readonly orcamento: OrcamentoDaBusca;
  readonly motivoParada?: MotivoDeParada | null;
  readonly recomendacao?: string | null;
}

/**
 * Monta o dossiê salvável a partir do estado atual.
 *
 * Funciona **em qualquer ponto** da execução, e é isso que faz o dossiê parcial ser
 * comportamento normal: o executor chama isto a cada passo, e o que está no banco é
 * sempre o que foi descoberto até agora.
 *
 * `motivoParada` nulo significa "em andamento", e não "terminou sem motivo".
 */
export function paraGravar(params: ParametrosDoDossie): DossieParaGravar {
  const { estado, orcamento } = params;

  return {
    alvo: params.alvo,
    hipoteses: estado.hipoteses,
    fronteira: estado.fronteira,
    achados: estado.achados,
    investigados: estado.investigados,
    orcamentoCentavos: orcamento.limiteCentavos,
    gastoCentavos: orcamento.gasto,
    orcamentoPassos: orcamento.limitePassos,
    passosGastos: estado.passosGastos,
    passosSemAchado: estado.passosSemAchado,
    motivoParada: params.motivoParada ?? null,
    recomendacao: params.recomendacao ?? null,
  };
}

/**
 * O que ficou para investigar.
 *
 * É a leitura que a tela faz da fronteira, e existe como função porque a fronteira
 * gravada passou a ser a inteira: filtrar no JSX faria cada leitor decidir por conta
 * própria o que "ficou" significa.
 */
export function fronteiraRestante(dossie: DossieParaGravar): readonly ItemDaFronteira[] {
  const jaFoi = new Set(dossie.investigados);
  return dossie.fronteira.filter((i) => !jaFoi.has(i.id));
}

/**
 * O estado da busca de volta, para retomar de onde parou.
 *
 * O inverso de `paraGravar`, e o que faz a promessa do schema ("execução interrompida
 * retomável") ser verdade em vez de intenção. Retomar não recomeça: os investigados
 * continuam investigados, o contador de saturação continua onde estava, e os passos
 * gastos contam contra o teto.
 */
export function estadoDaBusca(dossie: DossieParaGravar): EstadoDaBusca {
  return {
    hipoteses: dossie.hipoteses,
    fronteira: dossie.fronteira,
    achados: dossie.achados,
    investigados: dossie.investigados,
    passosGastos: dossie.passosGastos,
    passosSemAchado: dossie.passosSemAchado,
  };
}

/**
 * Achados que não têm URL de origem.
 *
 * Existe para a auditoria ser verificável e não uma promessa: a especificação diz que
 * cada item tem a URL de onde veio, e esta função é como se prova. Um achado sem
 * origem é uma afirmação sem fonte, e a disciplina de evidência do M4 já decidiu o
 * que isso vale.
 */
export function achadosSemOrigem(dossie: DossieParaGravar): readonly Achado[] {
  return dossie.achados.filter((a) => a.origemUrl.trim() === '');
}

export interface ResumoDoDossie {
  readonly achados: number;
  readonly hipotesesAbertas: number;
  readonly hipotesesConfirmadas: number;
  readonly porFamilia: Readonly<Partial<Record<FamiliaDeHipotese, number>>>;
  readonly auditavel: boolean;
  readonly mensagem: string;
}

/**
 * O dossiê em uma linha, para a tela e para o log.
 *
 * Lidera pelo que foi **confirmado**, não pelo que foi investigado: passos gastos é
 * métrica de esforço, e esforço sem achado não é resultado.
 */
export function resumirDossie(dossie: DossieParaGravar): ResumoDoDossie {
  const porFamilia: Partial<Record<FamiliaDeHipotese, number>> = {};
  for (const a of dossie.achados) {
    porFamilia[a.familia] = (porFamilia[a.familia] ?? 0) + 1;
  }

  const semOrigem = achadosSemOrigem(dossie).length;
  const abertas = dossie.hipoteses.filter((h) => h.estado === 'aberta').length;
  const confirmadas = dossie.hipoteses.filter((h) => h.estado === 'confirmada').length;

  return {
    achados: dossie.achados.length,
    hipotesesAbertas: abertas,
    hipotesesConfirmadas: confirmadas,
    porFamilia,
    auditavel: semOrigem === 0,
    mensagem: mensagemDoDossie(dossie, abertas, semOrigem),
  };
}

/**
 * A frase das hipóteses em aberto, conforme o que interrompeu.
 *
 * Continuar resolve teto. Não resolve saturação — investigar mais do mesmo não acha o
 * que três passos não acharam — e não resolve fronteira vazia, onde o que falta é
 * ferramenta e não orçamento.
 */
function clausulaDeAberta(abertas: number, motivo: MotivoDeParada | null): string {
  const quantas = contagem(abertas, 'hipótese continua em aberto', 'hipóteses continuam em aberto');

  switch (motivo) {
    case 'orcamento_passos':
    case 'orcamento_reais':
    case null:
      return `${contagem(abertas, 'hipótese em aberto', 'hipóteses em aberto')} — dá para continuar de onde parou.`;
    case 'fronteira_vazia':
      return `${quantas}, esperando ferramenta.`;
    case 'saturacao':
    case 'concluido':
      return `${quantas}.`;
  }
}

function mensagemDoDossie(dossie: DossieParaGravar, abertas: number, semOrigem: number): string {
  const partes: string[] = [];
  const passos = contagem(dossie.passosGastos, 'passo', 'passos');

  if (dossie.passosGastos === 0) {
    // Zero passo com zero achado não é informação sobre o alvo: é plano escrito e
    // nada rodado. A frase de "nenhum achado" afirmaria que o alvo é estreito demais
    // sem ninguém ter olhado, e ela aparecia assim antes de haver tela.
    partes.push('Plano escrito, e nenhum passo gasto ainda.');
  } else if (dossie.achados.length === 0) {
    partes.push(
      `Nenhum achado em ${passos}. Isso é informação: o alvo pode ser estreito demais, ou as ferramentas desta execução não alcançam o que ele exige.`,
    );
  } else {
    partes.push(
      `${contagem(dossie.achados.length, 'achado confirmado', 'achados confirmados')} em ${passos}.`,
    );
  }

  if (abertas > 0) {
    // "Dá para continuar de onde parou" só vale quando o que interrompeu foi o **teto**.
    // Saía em todo dossiê com hipótese aberta, e produziu duas contradições que só
    // apareceram quando a tela passou a mostrar a mensagem inteira: ao lado de "parou
    // por saturação: aumentar o teto não traria mais nada", e ao lado de "aumentar o
    // teto não resolve; ligar uma ferramenta resolve".
    partes.push(clausulaDeAberta(abertas, dossie.motivoParada));
  }

  if (dossie.motivoParada === 'orcamento_passos' || dossie.motivoParada === 'orcamento_reais') {
    partes.push('Parou no teto, e o dossiê foi salvo como está: continuar não recomeça.');
  }

  if (dossie.motivoParada === 'saturacao') {
    partes.push('Parou por saturação: aumentar o teto não traria mais nada neste alvo.');
  }

  if (semOrigem > 0) {
    partes.push(
      `Atenção: ${contagem(semOrigem, 'achado', 'achados')} sem URL de origem. Achado sem fonte não é auditável e não deveria contar.`,
    );
  }

  return partes.join(' ');
}
