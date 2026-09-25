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
import { ColetorDeCompatibilidade } from '@/dominio/compatibilidade/coletor';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import {
  ExecutorDeCompatibilidade,
  tarefaDeCompatibilidade,
} from '@/dominio/compatibilidade/tarefa';
import { conferirFornecedor } from '@/dominio/fornecedores/conferencia';
import { RepositorioDeFornecedores } from '@/dominio/fornecedores/repositorio';
import {
  ExecutorDeConferencia,
  tarefaDeConferencia,
} from '@/dominio/fornecedores/tarefa-de-conferencia';
import { GeradorDeEmbeddings } from '@/dominio/identidade/embedding';
import { ExtratorDeRegistros } from '@/dominio/identidade/extracao';
import { tarefaDeIdentidade } from '@/dominio/identidade/tarefa';
import { ExecutorDeEmbedding, tarefaDeEmbedding } from '@/dominio/identidade/tarefa-de-embedding';
import { ExecutorDeExtracao, tarefaDeExtracao } from '@/dominio/identidade/tarefa-de-extracao';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { ExecutorDePedidos, tarefaDePedidos, type ResolverPerfil } from '@/dominio/pedidos/tarefa';
import { carregarPerfil } from '@/dominio/perfil';
import { tarefaDeIngestao } from '@/dominio/ingestao/tarefa';
import { ExecutorDeIngestao } from '@/dominio/ingestao/executor';
import { leitorDeImagemCom } from '@/dominio/ingestao/imagem';
import { ImportadorDePlanilha } from '@/dominio/ingestao/planilha/importador';
import { ExecutorDeIdentidade } from '@/dominio/identidade/tarefa';
import { ResolvedorDeIdentidade } from '@/dominio/identidade/resolucao';
import { Orquestrador } from '@/dominio/ingestao/orquestrador';
import { IngestorDeProdutoExterno } from '@/dominio/ingestao/produto-externo';
import { LeitorDoMonitor } from '@/dominio/monitor/leitura';
import { RepositorioDoMonitor } from '@/dominio/monitor/repositorio';
import {
  ExecutorDeLeituraDoMonitor,
  tarefaDeLeituraDoMonitor,
} from '@/dominio/monitor/tarefa-de-leitura';
import { MotorDoProspector } from '@/dominio/prospector/motor';
import type { OpcoesDaRede } from '@/infra/web/rede';
import { investigadoresDaInstalacao } from '@/dominio/prospector/registro';
import { RepositorioDeDossies } from '@/dominio/prospector/repositorio';
import { ExecutorDoProspector, tarefaDoProspector } from '@/dominio/prospector/tarefa';
import { type Ambiente, lerAmbiente } from '@/config/ambiente';
import { ArmazenamentoDeConteudo } from './armazenamento/conteudo';
import type { Deposito } from './armazenamento/deposito';
import { DepositoS3 } from './armazenamento/deposito-s3';
import { banco, type Banco } from './banco/cliente';
import { Fila } from './fila/fila';
import { tarefasEmOrdem, type Tarefa } from './fila/poller';
import type { ServicoDeLlm } from './llm';
import { llmDoAmbiente } from './llm/ambiente';
import { registradorSilencioso, type Registrador } from './log';

/**
 * O LLM de um job, ou de um lote de extração: serviço com orçamento novo e os modelos.
 *
 * `undefined` quando não há chave — e o resolvedor decide tudo o que dá para decidir
 * sem julgamento, deixando o resto na fila de revisão com o motivo escrito; a extração
 * fica parada, e o que foi importado espera a chave sem se perder.
 */
export type LlmDeJob = () =>
  | {
      readonly servico: ServicoDeLlm;
      readonly modeloDeJulgamento: string;
      readonly modeloDeExtracao: string;
      readonly modeloDeEmbedding: string;
      /** Modelo com visão, para imagem de tabela (3.6). Sem ele, o de extração. */
      readonly modeloDeVisao?: string | undefined;
    }
  | undefined;

export interface OpcoesDaMontagem {
  /** Ausente em teste: o grafo monta sem LLM, que é o caminho que não depende de rede. */
  readonly llmDeJob?: LlmDeJob | undefined;
  /**
   * Rede para ler link colado e para as ferramentas do garimpo. Ausente em teste: o link
   * fica guardado em revisão, o garimpo monta só com a base local, e a suíte não depende
   * de internet nem bate em serviço de terceiro.
   */
  readonly rede?: OpcoesDaRede | undefined;
}

export interface Nucleo {
  readonly db: Banco;
  readonly fila: Fila;
  readonly armazenamento: ArmazenamentoDeConteudo;
  readonly ingestor: IngestorDeProdutoExterno;
  readonly orquestrador: Orquestrador;
  readonly executor: ExecutorDeIngestao;
  /** Lê marca, peça e aparelho dos títulos, em lote (M3, 5.1). */
  readonly executorDeExtracao: ExecutorDeExtracao;
  /** Gera o vetor da forma canônica, em lote (M3, 5.2). */
  readonly executorDeEmbedding: ExecutorDeEmbedding;
  /** Consome a fila de resolução de identidade (M3). */
  readonly executorDeIdentidade: ExecutorDeIdentidade;
  /** Consome a fila de coleta de compatibilidade (M4). */
  readonly executorDeCompatibilidade: ExecutorDeCompatibilidade;
  readonly compatibilidade: RepositorioDeCompatibilidade;
  /** Consome a fila de importação de pedido (M10). */
  readonly executorDePedidos: ExecutorDePedidos;
  readonly pedidos: RepositorioDePedidos;
  /** Lê os grupos do monitor por IA, em lote (M15, 11.1). Parada sem chave. */
  readonly executorDeLeituraDoMonitor: ExecutorDeLeituraDoMonitor;
  /** Confere CNPJ e vitrine de fornecedor, um por vez (M5, 7.3). Parada sem rede. */
  readonly executorDeConferencia: ExecutorDeConferencia;
  /** Consome a fila de investigação de alvo (M6). */
  readonly executorDoProspector: ExecutorDoProspector;
  /** O laço da investigação. A tela lê dele quais ferramentas existem. */
  readonly prospector: MotorDoProspector;
  readonly dossies: RepositorioDeDossies;
}

/** Nome da tarefa composta, no log. */
export const NOME_DA_TAREFA_COMPLETA =
  'ingestao+extracao+embedding+identidade+compatibilidade+pedidos+monitor+conferencia+prospector';

/**
 * A tarefa que o sistema roda, com as filas e as tarefas em lote na ordem de prioridade.
 *
 * Existe aqui, e não no script do poller, porque **duas pontas a executam**: o
 * processo do poller e o botão "Processar agora" da tela de jobs. Enquanto o botão
 * tinha a sua própria composição, ele drenava só a fila de ingestão — e o efeito
 * era o relatado pelo dono do repositório: a planilha entrava, a tela de jobs dizia
 * "nada para processar", e a de identidade continuava zerada. O botão está numa tela
 * que lista jobs de **todos** os tipos; drenar só um tipo é surpresa, não economia.
 */
export function tarefaCompleta(
  nucleo: Nucleo,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  return tarefasEmOrdem(NOME_DA_TAREFA_COMPLETA, [
    tarefaDeIngestao(nucleo.executor, registrador),
    // Antes da identidade: com extração pendente, a resolução espera e resolve já com
    // marca e modelo, em vez de resolver sem e ter de resolver de novo.
    tarefaDeExtracao(nucleo.executorDeExtracao, registrador),
    // Depois da extração, que dá a forma canônica; antes da identidade, que usa os vizinhos.
    tarefaDeEmbedding(nucleo.executorDeEmbedding, registrador),
    tarefaDeIdentidade(nucleo.executorDeIdentidade, registrador),
    tarefaDeCompatibilidade(nucleo.executorDeCompatibilidade, registrador),
    tarefaDePedidos(nucleo.executorDePedidos, registrador),
    // Depois das filas de dado: divide a mesma cota gratuita, e dado novo vale mais que a
    // hipótese sobre dado velho.
    tarefaDeLeituraDoMonitor(nucleo.executorDeLeituraDoMonitor, registrador),
    // Um fornecedor por vez, espaçado: o buscador gratuito recusa quem pergunta demais.
    tarefaDeConferencia(nucleo.executorDeConferencia, registrador),
    // O prospector é o último da ordem de propósito: é o único que gasta dinheiro por
    // passo, e fila de dado novo não deve esperar investigação.
    tarefaDoProspector(nucleo.executorDoProspector, registrador),
  ]);
}

/**
 * Roda a tarefa completa até a fila esvaziar ou o teto bater.
 *
 * Devolve quantas unidades fizeram trabalho — é o número que a tela mostra.
 */
export async function drenar(tarefa: Tarefa, limite: number): Promise<number> {
  let feitas = 0;
  for (let i = 0; i < limite; i += 1) {
    const resultado = await tarefa.executar();
    if (resultado.ocioso) break;
    feitas += 1;
  }
  return feitas;
}

/**
 * Monta o grafo a partir de banco e diretório já escolhidos.
 *
 * Função pura de composição: não lê ambiente e não guarda instância. É o que
 * permite ao teste montar o mesmo grafo apontando para um banco de teste e uma
 * pasta temporária, sem depender de `process.env`.
 */
export function montarNucleoCom(
  db: Banco,
  destinoDeConteudo: string | Deposito,
  resolverPerfil: ResolverPerfil,
  opcoes: OpcoesDaMontagem = {},
): Nucleo {
  const fila = new Fila(db);
  const armazenamento = new ArmazenamentoDeConteudo(destinoDeConteudo);
  // O ingestor avisa o monitor quando o preço de uma recaptura muda. É a única
  // ligação entre a fase 3 e a fase 11, e ela mora aqui porque é montagem — nem a
  // ingestão nem o monitor precisam conhecer o outro.
  const ingestor = new IngestorDeProdutoExterno(db, new RepositorioDoMonitor(db));
  const orquestrador = new Orquestrador(fila, armazenamento);
  const executor = new ExecutorDeIngestao(
    fila,
    armazenamento,
    ingestor,
    orquestrador,
    opcoes.rede ?? null,
    undefined,
    // A imagem de tabela é lida pela IA com visão (3.6), com orçamento novo por imagem.
    // Sem chave — e no teste —, a leitura responde "sem chave", e a imagem fica guardada.
    (bytes, tentativa) => {
      const llm = opcoes.llmDeJob?.();
      return llm === undefined
        ? Promise.resolve({ tipo: 'sem_chave' as const })
        : leitorDeImagemCom(llm.servico, llm.modeloDeVisao ?? llm.modeloDeExtracao)(
            bytes,
            tentativa,
          );
    },
  );
  // Uma instância de importador para as duas pontas: a de anúncio, dentro do
  // executor de ingestão, e a de venda, aqui. É sem estado.
  const importadorDePlanilha = new ImportadorDePlanilha();

  /**
   * Um resolvedor **por job**, e é aí que mora o teto de orçamento.
   *
   * Se o resolvedor fosse único e de vida longa, o `Orcamento` dentro dele esgotaria
   * na primeira hora e nunca mais deixaria nada rodar: "teto por execução" do ADR
   * 0005 viraria "teto por vida do processo", que não é teto nenhum.
   *
   * O LLM vem de fora (`opcoes.llmDeJob`), porque esta função não lê ambiente. Sem ele —
   * sem chave, ou em teste —, o resolvedor trata a ausência como caminho previsto e
   * decide tudo que é decidível sem julgamento.
   */
  const executorDeIdentidade = new ExecutorDeIdentidade(fila, (jobId) => {
    const llm = opcoes.llmDeJob?.();
    return new ResolvedorDeIdentidade(db, {
      jobId,
      ...(llm === undefined
        ? {}
        : {
            llm: llm.servico,
            modeloDeJulgamento: llm.modeloDeJulgamento,
            modeloDeEmbedding: llm.modeloDeEmbedding,
          }),
    });
  });

  /**
   * Um extrator **por lote**, pelo mesmo motivo do resolvedor: orçamento novo a cada
   * pedido. O executor em volta é um só, porque é ele que guarda a espera depois de uma
   * cota esgotada — e espera que se esquece a cada tique não é espera.
   */
  const executorDeExtracao = new ExecutorDeExtracao(fila, () => {
    const llm = opcoes.llmDeJob?.();
    return llm === undefined
      ? undefined
      : new ExtratorDeRegistros(db, { llm: llm.servico, modelo: llm.modeloDeExtracao });
  });

  const executorDeEmbedding = new ExecutorDeEmbedding(fila, () => {
    const llm = opcoes.llmDeJob?.();
    return llm === undefined
      ? undefined
      : new GeradorDeEmbeddings(db, { llm: llm.servico, modelo: llm.modeloDeEmbedding });
  });

  // Sem LLM e sem orçamento: a coleta de compatibilidade é comparação de texto
  // normalizado contra os aparelhos cadastrados, então uma instância só serve para
  // todos os jobs — ao contrário do resolvedor de identidade.
  const compatibilidade = new RepositorioDeCompatibilidade(db);
  const executorDeCompatibilidade = new ExecutorDeCompatibilidade(
    fila,
    new ColetorDeCompatibilidade(db, compatibilidade),
  );

  // Pedido é dado **operacional** e exige `perfil_id`, então o executor recebe um
  // resolvedor de perfil em vez de ler ambiente: é o que permite ao teste montar o
  // mesmo grafo apontando para um perfil que ele mesmo criou.
  const pedidos = new RepositorioDePedidos(db);
  const executorDePedidos = new ExecutorDePedidos(
    fila,
    armazenamento,
    importadorDePlanilha,
    pedidos,
    resolverPerfil,
  );

  const executorDeLeituraDoMonitor = new ExecutorDeLeituraDoMonitor(() => {
    const llm = opcoes.llmDeJob?.();
    return llm === undefined
      ? undefined
      : new LeitorDoMonitor(new RepositorioDoMonitor(db), {
          llm: llm.servico,
          modelo: llm.modeloDeJulgamento,
        });
  });

  // A conferência de fornecedor sai para a internet — Receita e buscador —, então sem
  // rede ela fica parada, e a suíte não bate em serviço de terceiro.
  const rede = opcoes.rede;
  const executorDeConferencia = new ExecutorDeConferencia(
    new RepositorioDeFornecedores(db),
    rede === undefined ? null : (f) => conferirFornecedor(f, { buscador: rede, receita: rede }),
  );

  // O prospector recebe os investigadores da instalação — hoje só o de base local, que
  // é o único que roda sem rede e sem chave. Acrescentar ferramenta é acrescentar uma
  // linha em `prospector/registro.ts`, e a tela passa a mostrá-la como disponível sem
  // mudança nenhuma aqui.
  const dossies = new RepositorioDeDossies(db);
  const prospector = new MotorDoProspector(
    dossies,
    investigadoresDaInstalacao(db, { rede: opcoes.rede ?? false }),
  );
  const executorDoProspector = new ExecutorDoProspector(fila, prospector);

  return {
    db,
    fila,
    armazenamento,
    ingestor,
    orquestrador,
    executor,
    executorDeExtracao,
    executorDeEmbedding,
    executorDeIdentidade,
    executorDeCompatibilidade,
    compatibilidade,
    executorDePedidos,
    pedidos,
    executorDeLeituraDoMonitor,
    executorDeConferencia,
    executorDoProspector,
    prospector,
    dossies,
  };
}

/**
 * Onde o conteúdo mora: no S3 quando há endereço (o Render gratuito, ADR 0013), senão
 * em disco. A validação do ambiente já garantiu chave e segredo junto do endereço.
 */
function destinoDoConteudo(ambiente: Ambiente): string | Deposito {
  const endpoint = ambiente.ARMAZENAMENTO_S3_ENDPOINT;
  if (endpoint === undefined) return ambiente.ARMAZENAMENTO_DIR;
  return new DepositoS3({
    endpoint,
    regiao: ambiente.ARMAZENAMENTO_S3_REGIAO,
    chave: ambiente.ARMAZENAMENTO_S3_CHAVE ?? '',
    segredo: ambiente.ARMAZENAMENTO_S3_SEGREDO ?? '',
    balde: ambiente.ARMAZENAMENTO_S3_BALDE,
  });
}

/**
 * Monta o núcleo do processo.
 *
 * **Não guarda instância, e isso é uma correção.** A versão anterior guardava o
 * núcleo em `globalThis`, "pelo mesmo motivo do pool de conexão". O motivo não se
 * aplicava: o pool já é guardado por `banco/cliente.ts`, e todo componente daqui é
 * casca sem estado em volta dele — `Fila`, orquestrador, executores, repositórios.
 *
 * O que o cache produzia era uma armadilha. `globalThis` sobrevive à reavaliação
 * de módulo da recarga a quente, então **o núcleo guardado tinha a forma do código
 * antigo**: ao acrescentar o executor de pedido, a tela continuou usando o núcleo
 * sem ele, e o erro chegou como `Cannot read properties of undefined (reading
 * 'processarProximo')` — mensagem que não aponta para nada. Apareceu no navegador,
 * não em teste, porque teste monta o grafo do zero toda vez.
 *
 * O custo de montar por chamada é um punhado de `new` em objetos vazios. O custo
 * de guardar era um bug por mudança de forma.
 */
export function montarNucleo(): Nucleo {
  const ambiente = lerAmbiente();
  const db = banco();
  return montarNucleoCom(
    db,
    destinoDoConteudo(ambiente),
    async () => {
      const perfil = await carregarPerfil(db, ambiente.BANCADA_PERFIL_PADRAO);
      return perfil.id;
    },
    {
      // As ferramentas do garimpo saem para a internet: buscador, páginas, CNPJ, PNCP.
      rede: {},
      // Por job, e não uma vez aqui: cada chamada monta um orçamento novo.
      llmDeJob: () => {
        const llm = llmDoAmbiente(db);
        return llm.temChave
          ? {
              servico: llm.servico,
              modeloDeJulgamento: llm.modelos.julgamento,
              modeloDeExtracao: llm.modelos.extracao,
              modeloDeEmbedding: llm.modelos.embedding,
              modeloDeVisao: llm.modelos.visao,
            }
          : undefined;
      },
    },
  );
}
