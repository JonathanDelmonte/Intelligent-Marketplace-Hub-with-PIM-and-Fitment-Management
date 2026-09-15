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
import type { Achado, EstadoDaBusca, Hipotese, MotivoDeParada } from './fronteira';
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
  readonly fronteira: readonly { readonly alvo: string; readonly familia: FamiliaDeHipotese }[];
  readonly achados: readonly Achado[];
  readonly orcamentoCentavos: Centavos;
  readonly gastoCentavos: Centavos;
  readonly orcamentoPassos: number;
  readonly passosGastos: number;
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
    // Da fronteira só o que interessa a quem lê: o que **ficou** para investigar. Os
    // pesos e custos são da máquina, e não ajudam a ler o dossiê.
    fronteira: estado.fronteira
      .filter((i) => !estado.investigados.includes(i.id))
      .map((i) => ({ alvo: i.alvo, familia: i.familia })),
    achados: estado.achados,
    orcamentoCentavos: orcamento.limiteCentavos,
    gastoCentavos: orcamento.gasto,
    orcamentoPassos: orcamento.limitePassos,
    passosGastos: estado.passosGastos,
    motivoParada: params.motivoParada ?? null,
    recomendacao: params.recomendacao ?? null,
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

function mensagemDoDossie(dossie: DossieParaGravar, abertas: number, semOrigem: number): string {
  const partes: string[] = [];

  if (dossie.achados.length === 0) {
    partes.push(
      `Nenhum achado em ${String(dossie.passosGastos)} passo(s). Isso é informação: o alvo pode ser estreito demais, ou as ferramentas desta execução não alcançam o que ele exige.`,
    );
  } else {
    partes.push(
      `${String(dossie.achados.length)} achado(s) confirmado(s) em ${String(dossie.passosGastos)} passo(s).`,
    );
  }

  if (abertas > 0) {
    partes.push(`${String(abertas)} hipótese(s) em aberto — dá para continuar de onde parou.`);
  }

  if (dossie.motivoParada === 'orcamento_passos' || dossie.motivoParada === 'orcamento_reais') {
    partes.push('Parou no teto, e o dossiê foi salvo como está: continuar não recomeça.');
  }

  if (dossie.motivoParada === 'saturacao') {
    partes.push('Parou por saturação: aumentar o teto não traria mais nada neste alvo.');
  }

  if (semOrigem > 0) {
    partes.push(
      `Atenção: ${String(semOrigem)} achado(s) sem URL de origem. Achado sem fonte não é auditável e não deveria contar.`,
    );
  }

  return partes.join(' ');
}
