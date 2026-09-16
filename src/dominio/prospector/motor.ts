/**
 * O motor do prospector: o laço que gasta passo e chama ferramenta (M6).
 *
 * A fase 10 entregou a máquina e nada que a dirigisse. Este arquivo é o motorista, e
 * ele é **determinístico**: quem decide a ordem é `proximoPasso`, quem aplica é
 * `aplicarInvestigacao`, e o que ele acrescenta é só o laço, o orçamento e a gravação.
 *
 * Chama-se motor e não executor porque neste repositório `Executor*` é quem consome
 * fila — `ExecutorDeIngestao`, `ExecutorDeIdentidade`, `ExecutorDePedidos`. O consumidor
 * de fila deste módulo está em `tarefa.ts`, e usa este motor.
 *
 * ## O que é julgamento continua fora
 *
 * O executor não decide o que investigar nem em quem acreditar: ele chama o
 * investigador da ferramenta que o item pede. Investigador com LLM entra pela mesma
 * porta que o de base local, e é aí — dentro dele — que o julgamento mora.
 *
 * ## Grava a cada passo, e é isso que faz retomar não recomeçar
 *
 * A gravação por passo é a promessa da fase 10 ("dossiê parcial salvo quando o
 * orçamento estoura"), e agora ela tem quem a cumpra. Um passo que falha perde **um**
 * passo: o dossiê no banco é o de antes dele, os itens já investigados continuam
 * marcados, e o contador de saturação continua onde estava.
 *
 * ## O teto é do dossiê, e não da chamada
 *
 * `proximoPasso` compara `passosGastos` — acumulado no dossiê — com o teto, e a
 * mensagem de parada diz "dá para continuar com um teto maior". Então o teto pertence
 * ao alvo, não à execução: continuar é passar um teto maior, e a tela mostra gasto
 * contra teto sem que um dos dois minta. O que ADR 0005 exige — nenhuma execução sem
 * teto declarado — continua valendo, e é `OrcamentoDaBusca` que verifica.
 */
import type { Registrador } from '@/infra/log';
import { registradorSilencioso } from '@/infra/log';
import type { Centavos } from '@/lib/dinheiro';
import { abrirAlvo, rerotearFronteira } from './abertura';
import { OrcamentoDaBusca, estadoDaBusca, paraGravar } from './dossie';
import { aplicarInvestigacao, proximoPasso } from './fronteira';
import type {
  EstadoDaBusca,
  ItemDaFronteira,
  MotivoDeParada,
  ResultadoDaInvestigacao,
} from './fronteira';
import type { Ferramenta } from './hipoteses';
import type { DossieGravado, RepositorioDeDossies } from './repositorio';

/** O que uma investigação devolve, mais o que ela custou. */
export interface RespostaDaInvestigacao extends ResultadoDaInvestigacao {
  /**
   * Custo em centavos. Zero é resposta legítima: consulta à base local não paga nada,
   * e o que limita esse passo é o teto de passos.
   */
  readonly custoCentavos: Centavos;
}

export interface PedidoDeInvestigacao {
  readonly item: ItemDaFronteira;
  /**
   * O alvo do **dossiê**, que não é sempre o alvo do item: depois que a busca
   * ramifica, o item aponta para uma URL ou um CNPJ, e o investigador ainda precisa
   * saber sobre o que é a investigação.
   */
  readonly alvoDoDossie: string;
  /**
   * Quanto resta do teto.
   *
   * O laço verifica o estouro **antes** de cada passo, e não prevê o custo do próximo —
   * só o investigador sabe quanto vai cobrar. Então o último passo pode passar do teto,
   * e é por isso que o restante vem no pedido: quem cobra decide se cabe. O teto
   * garante que a execução **para**, não que o gasto final caiba no centavo.
   */
  readonly restanteCentavos: Centavos;
}

/**
 * Uma ferramenta que sabe investigar.
 *
 * Porta, e não classe base: é o que permite o investigador de base local (SQL) e o de
 * página (rede e LLM) entrarem no mesmo laço sem que o laço saiba a diferença. Sem
 * investigador registrado, a ferramenta simplesmente não existe para a fronteira — que
 * já sabe recusar item de ferramenta ausente.
 */
export interface Investigador {
  readonly ferramenta: Ferramenta;
  investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao>;
}

export interface ResultadoDaExecucao {
  readonly dossie: DossieGravado;
  /** Passos gastos **nesta** execução. O acumulado está no dossiê. */
  readonly passosNestaExecucao: number;
  readonly motivo: MotivoDeParada;
}

export interface PedidoDeExecucao {
  readonly alvo: string;
  readonly tetoCentavos: Centavos;
  readonly tetoPassos: number;
}

export class MotorDoProspector {
  private readonly porFerramenta: ReadonlyMap<Ferramenta, Investigador>;

  constructor(
    private readonly repositorio: RepositorioDeDossies,
    investigadores: readonly Investigador[],
    private readonly registrador: Registrador = registradorSilencioso,
  ) {
    this.porFerramenta = new Map(investigadores.map((i) => [i.ferramenta, i]));
  }

  /**
   * As ferramentas que este executor sabe chamar.
   *
   * É a fonte da verdade da disponibilidade: "existe investigador registrado" é a
   * pergunta certa, e não "a configuração declara". A tela lê daqui.
   */
  get ferramentas(): readonly Ferramenta[] {
    return [...this.porFerramenta.keys()];
  }

  /**
   * Investiga um alvo até parar, e devolve o dossiê e o motivo da parada.
   *
   * Retoma o dossiê do mesmo alvo quando já existe: os investigados continuam
   * investigados, o gasto anterior conta contra o teto, e a saturação continua de onde
   * estava. Nunca recomeça um alvo — recomeçar seria pagar de novo o que já foi pago.
   */
  async investigar(pedido: PedidoDeExecucao): Promise<ResultadoDaExecucao> {
    const log = this.registrador.com({ alvo: pedido.alvo });
    const existente = await this.repositorio.porAlvo(pedido.alvo);

    // Reencaminha a fronteira para o que existe hoje: dossiê aberto quando uma
    // ferramenta não existia tem item parado numa rota que ninguém percorre, e o
    // reencaminhamento é o que faz registrar um investigador novo destravar o que já
    // estava na fila. Em alvo novo é operação nula.
    let estado: EstadoDaBusca = rerotearFronteira(
      existente === null ? abrirAlvo(pedido.alvo, this.ferramentas) : estadoDaBusca(existente),
      this.ferramentas,
    );

    const orcamento = new OrcamentoDaBusca(pedido.tetoCentavos, pedido.tetoPassos);
    if (existente !== null && existente.gastoCentavos > 0) {
      orcamento.registrar(existente.gastoCentavos);
    }

    // O alvo gravado é o do dossiê existente, e não o que veio agora: a grafia do
    // primeiro é a que vale, como em `salvar`.
    const alvo = existente?.alvo ?? pedido.alvo;
    let passosNestaExecucao = 0;
    let motivo: MotivoDeParada;

    for (;;) {
      if (orcamento.estourou) {
        motivo = 'orcamento_reais';
        break;
      }

      const passo = proximoPasso(estado, {
        passos: pedido.tetoPassos,
        ferramentas: this.ferramentas,
      });

      if (passo.tipo === 'parar') {
        motivo = passo.motivo;
        log.info('prospector.parou', { motivo: passo.motivo, explicacao: passo.explicacao });
        break;
      }

      const investigador = this.porFerramenta.get(passo.item.ferramenta);
      // Não pode acontecer: `proximoPasso` escolhe entre as ferramentas deste
      // executor. Falhar alto é melhor que gastar um passo em silêncio.
      if (investigador === undefined) {
        throw new Error(`sem investigador para a ferramenta ${passo.item.ferramenta}`);
      }

      // Erro aqui **propaga**: a fila reagenda, e o dossiê no banco é o do passo
      // anterior. Engolir o erro e marcar o item como investigado esconderia
      // ferramenta quebrada atrás de um dossiê que "não achou nada".
      const resposta = await investigador.investigar({
        item: passo.item,
        alvoDoDossie: alvo,
        restanteCentavos: orcamento.restante,
      });

      orcamento.registrar(resposta.custoCentavos);
      estado = aplicarInvestigacao(estado, passo.item, resposta);
      passosNestaExecucao += 1;

      log.info('prospector.passo', {
        familia: passo.item.familia,
        ferramenta: passo.item.ferramenta,
        achados: resposta.achados.length,
        custoCentavos: resposta.custoCentavos,
      });

      await this.gravar(alvo, estado, orcamento, null);
    }

    const dossie = await this.gravar(alvo, estado, orcamento, motivo);
    return { dossie, passosNestaExecucao, motivo };
  }

  private async gravar(
    alvo: string,
    estado: EstadoDaBusca,
    orcamento: OrcamentoDaBusca,
    motivoParada: MotivoDeParada | null,
  ): Promise<DossieGravado> {
    return this.repositorio.salvar(paraGravar({ alvo, estado, orcamento, motivoParada }));
  }
}
