/**
 * Montagem do núcleo — o único lugar que sabe como as peças se encaixam.
 *
 * Orquestrador, executor, fila, armazenamento e ingestor não se conhecem: cada um
 * recebe o que precisa pelo construtor, e é isso que os torna testáveis contra
 * banco e disco de verdade sem mock. O preço dessa escolha é que **alguém** tem
 * que montar o grafo, e montar em dois lugares é como as duas pontas divergem.
 *
 * Duas pontas usam este arquivo hoje:
 *
 * - `scripts/poller.ts`, o processo que consome a fila.
 * - `src/app/jobs`, a tela que enfileira e mostra.
 *
 * Se cada uma montasse o seu, a tela gravaria conteúdo numa pasta e o poller
 * leria de outra — e o sintoma seria job em revisão dizendo "o arquivo não chegou
 * ao armazenamento", com o arquivo lá, na pasta errada.
 */
import { ExecutorDeIngestao } from '@/dominio/ingestao/executor';
import { ExecutorDeIdentidade } from '@/dominio/identidade/tarefa';
import { ResolvedorDeIdentidade } from '@/dominio/identidade/resolucao';
import { Orquestrador } from '@/dominio/ingestao/orquestrador';
import { IngestorDeProdutoExterno } from '@/dominio/ingestao/produto-externo';
import { lerAmbiente } from '@/config/ambiente';
import { ArmazenamentoDeConteudo } from './armazenamento/conteudo';
import { banco, type Banco } from './banco/cliente';
import { Fila } from './fila/fila';

export interface Nucleo {
  readonly db: Banco;
  readonly fila: Fila;
  readonly armazenamento: ArmazenamentoDeConteudo;
  readonly ingestor: IngestorDeProdutoExterno;
  readonly orquestrador: Orquestrador;
  readonly executor: ExecutorDeIngestao;
  /** Consome a fila de resolução de identidade (M3). */
  readonly executorDeIdentidade: ExecutorDeIdentidade;
}

/**
 * Monta o grafo a partir de banco e diretório já escolhidos.
 *
 * Função pura de composição: não lê ambiente e não guarda instância. É o que
 * permite ao teste montar o mesmo grafo apontando para um banco de teste e uma
 * pasta temporária, sem depender de `process.env`.
 */
export function montarNucleoCom(db: Banco, diretorioDeConteudo: string): Nucleo {
  const fila = new Fila(db);
  const armazenamento = new ArmazenamentoDeConteudo(diretorioDeConteudo);
  const ingestor = new IngestorDeProdutoExterno(db);
  const orquestrador = new Orquestrador(fila, armazenamento);
  const executor = new ExecutorDeIngestao(fila, armazenamento, ingestor, orquestrador);

  /**
   * Um resolvedor **por job**, e é aí que mora o teto de orçamento.
   *
   * Se o resolvedor fosse único e de vida longa, o `Orcamento` dentro dele esgotaria
   * na primeira hora e nunca mais deixaria nada rodar: "teto por execução" do ADR
   * 0005 viraria "teto por vida do processo", que não é teto nenhum.
   *
   * Hoje nasce sem serviço de LLM, porque não há chave. O resolvedor trata isso como
   * caminho previsto e decide tudo que é decidível sem julgamento.
   */
  const executorDeIdentidade = new ExecutorDeIdentidade(
    fila,
    (jobId) => new ResolvedorDeIdentidade(db, { jobId }),
  );

  return {
    db,
    fila,
    armazenamento,
    ingestor,
    orquestrador,
    executor,
    executorDeIdentidade,
  };
}

/**
 * Núcleo do processo, montado uma vez.
 *
 * Guardado em `globalThis` pelo mesmo motivo do pool de conexão: recarga a quente
 * do Next reavalia o módulo e um `let` voltaria a `null`. Ver `banco/cliente.ts`.
 */
const CHAVE_GLOBAL = Symbol.for('bancada.nucleo');

interface GlobalComNucleo {
  [CHAVE_GLOBAL]?: Nucleo;
}

export function montarNucleo(): Nucleo {
  const global = globalThis as GlobalComNucleo;
  global[CHAVE_GLOBAL] ??= montarNucleoCom(banco(), lerAmbiente().ARMAZENAMENTO_DIR);
  return global[CHAVE_GLOBAL];
}
