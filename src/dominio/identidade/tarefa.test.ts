/**
 * A resolução de identidade rodando **sozinha**, contra Postgres e disco de verdade.
 *
 * O que este arquivo prova é a frase que resume a fase 5 na especificação: "daqui em
 * diante o sistema fica mais inteligente a cada link colado". Não a cada clique — a
 * cada link. Então o teste sobe uma planilha, roda o poller, e verifica que o grafo
 * de identidade cresceu sem ninguém chamar nada à mão.
 *
 * E prova as duas decisões que custam mais caro se estiverem erradas: orçamento é por
 * job (não por vida do processo) e teto estourado **adia** em vez de falhar.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { llmCall, parIdentidade, produtoExterno } from '@/infra/banco/schema';
import { montarNucleoCom, type Nucleo } from '@/infra/montagem';
import { Poller, tarefasEmOrdem, type Temporizador } from '@/infra/fila/poller';
import {
  LimiteDoProvedor,
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type RespostaDoModelo,
} from '@/infra/llm';
import {
  abrirBancoDeTeste,
  limparTabelas,
  resolvedorDePerfilDeTeste,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { tarefaDeIngestao } from '@/dominio/ingestao/tarefa';
import { RepositorioDePares } from './pares';
import { ResolvedorDeIdentidade } from './resolucao';
import {
  ExecutorDeIdentidade,
  TIPO_JOB_IDENTIDADE,
  chaveDeIdentidade,
  tarefaDeIdentidade,
} from './tarefa';
import { DIMENSAO_EMBEDDING, RepositorioDeEmbeddings } from './vizinhos';

const NL = String.fromCharCode(10);

/**
 * Duas linhas que o casamento determinístico liga, e uma que ele separa.
 *
 * Os EANs das duas primeiras são o mesmo: é o caso definitivo, e o que o poller tem
 * de resolver sem nenhuma chave configurada.
 */
const CSV = [
  'Código MLB;Título;Preço (R$);EAN',
  'MLB1;Refil Filtro Purificador Electrolux PA21G;69,90;7896541200909',
  'MLB2;Elemento Filtrante p/ purificador Electrolux PA21G;64,90;7896541200909',
  'MLB3;Vedação para Purificador Electrolux;19,90;7896541200916',
].join(NL);

describe.skipIf(!temBancoDeTeste())('resolução de identidade como tarefa de poller', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let nucleo: Nucleo;
  let pares: RepositorioDePares;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-identidade-'));
    nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-identidade'),
    );
    pares = new RepositorioDePares(conexao.db);

    await limparTabelas(conexao.db, [
      'job',
      'par_identidade',
      'exemplo_identidade',
      'llm_call',
      'embedding',
      'preco_historico',
      'produto_externo',
    ]);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  /** Poller sem espera de verdade, rodando as duas tarefas em ordem. */
  function pollerDeTeste(): Poller {
    const semEspera: Temporizador = (_ms, acao) => {
      const t = setTimeout(acao, 0);
      return () => {
        clearTimeout(t);
      };
    };
    return new Poller(
      tarefasEmOrdem('ingestao+identidade', [
        tarefaDeIngestao(nucleo.executor),
        tarefaDeIdentidade(nucleo.executorDeIdentidade),
      ]),
      { pararQuandoOcioso: true, temporizador: semEspera, limiteDeTiques: 60 },
    );
  }

  async function subirPlanilha(): Promise<void> {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });
  }

  it('a ingestão enfileira uma resolução por ocorrência gravada', async () => {
    await subirPlanilha();
    await nucleo.executor.processarProximo();

    const jobs = (await nucleo.fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_IDENTIDADE);
    const produtos = await conexao.db.select({ id: produtoExterno.id }).from(produtoExterno);

    expect(produtos).toHaveLength(3);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.chaveIdempotencia).sort()).toEqual(
      produtos.map((p) => chaveDeIdentidade(p.id)).sort(),
    );
  });

  it('o poller liga as duas ocorrências do mesmo GTIN sozinho, sem chave de LLM', async () => {
    await subirPlanilha();
    await pollerDeTeste().iniciar();

    const contagem = await pares.contarPorStatus();
    expect(contagem.automatico).toBe(1);

    const linhas = await conexao.db.select().from(parIdentidade);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.decisao).toBe('mesmo');
    expect(linhas[0]?.nivel).toBe('gtin');
    expect(linhas[0]?.confiancaBp).toBe(10_000);
    expect(linhas[0]?.origem).toBe('deterministico');

    // E nada ficou pendente: a fila drenou inteira.
    const status = await nucleo.fila.contagemPorStatus();
    expect(status.pendente).toBe(0);
    expect(status.falhou).toBe(0);
  });

  it('grava a forma canônica de cada ocorrência ao passar', async () => {
    await subirPlanilha();
    await pollerDeTeste().iniciar();

    const linhas = await conexao.db
      .select({ forma: produtoExterno.formaCanonica })
      .from(produtoExterno);
    // O importador de planilha não extrai marca nem modelo — isso é trabalho do
    // extrator por LLM, que não existe. A forma canônica sai vazia, e **vazia é uma
    // resposta**: a coluna deixa de ser nula, então a ocorrência não volta para a
    // fila de preparação a cada rodada.
    expect(linhas.every((l) => l.forma !== null)).toBe(true);
  });

  it('rodar de novo não reavalia par nenhum', async () => {
    await subirPlanilha();
    await pollerDeTeste().iniciar();
    const antes = await conexao.db.select().from(parIdentidade);

    // Reenfileira os jobs de identidade à mão e roda outra vez.
    for (const job of (await nucleo.fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_IDENTIDADE)) {
      await nucleo.fila.reenfileirar(job.id);
    }
    await pollerDeTeste().iniciar();

    const depois = await conexao.db.select().from(parIdentidade);
    expect(depois).toHaveLength(antes.length);
    expect(depois[0]?.atualizadoEm.getTime()).toBe(antes[0]?.atualizadoEm.getTime());
  });

  it('entrada de job inválida vai para revisão, não derruba o laço', async () => {
    await nucleo.fila.enfileirar({
      tipo: TIPO_JOB_IDENTIDADE,
      chaveIdempotencia: 'lixo',
      entrada: { produtoExternoId: 'não é uuid' },
    });

    const resultado = await nucleo.executorDeIdentidade.processarProximo();
    expect(resultado.tipo).toBe('pendente_revisao');

    const jobs = await nucleo.fila.ultimos();
    expect(jobs[0]?.status).toBe('pendente_revisao');
    expect(jobs[0]?.erro).toContain('produtoExternoId');
  });

  it('ocorrência apagada faz o job falhar e reagendar, sem parar a fila', async () => {
    await subirPlanilha();
    await nucleo.executor.processarProximo();
    await conexao.db.delete(produtoExterno);

    const resultado = await nucleo.executorDeIdentidade.processarProximo();
    expect(resultado.tipo).toBe('falhou');
    if (resultado.tipo !== 'falhou') throw new Error('esperava falhou');
    expect(resultado.reagendado).toBe(true);
  });

  /**
   * Três ocorrências próximas por embedding e sem código de peça, e o job da primeira
   * enfileirado: o par só o julgamento resolve, então cada teste decide o que o
   * julgamento faz.
   */
  async function prepararParQueSoOJulgamentoResolve(): Promise<{ readonly jobId: string }> {
    const criados = await conexao.db
      .insert(produtoExterno)
      .values([
        {
          tituloBruto: 'Refil de filtro Electrolux',
          hashConteudo: 'o1',
          fonte: 'm0_link',
          atributosExtraidos: { tipoProduto: 'refil de filtro', marca: 'Electrolux' },
        },
        {
          tituloBruto: 'Elemento filtrante Electrolux',
          hashConteudo: 'o2',
          fonte: 'm0_link',
          atributosExtraidos: { tipoProduto: 'elemento filtrante', marca: 'Electrolux' },
        },
        {
          tituloBruto: 'Vedação Electrolux',
          hashConteudo: 'o3',
          fonte: 'm0_link',
          atributosExtraidos: { tipoProduto: 'vedação', marca: 'Electrolux' },
        },
      ])
      .returning({ id: produtoExterno.id });

    await new ResolvedorDeIdentidade(conexao.db).prepararLote();

    const embeddings = new RepositorioDeEmbeddings(conexao.db);
    for (const [i, criado] of criados.entries()) {
      const vetor = new Array<number>(DIMENSAO_EMBEDDING).fill(0);
      vetor[0] = 1;
      vetor[1] = i * 0.01;
      await embeddings.gravar({
        produtoExternoId: criado.id,
        textoCanonico: `t${String(i)}`,
        modelo: 'sintetico',
        vetor,
      });
    }

    const alvo = criados[0]?.id ?? '';
    const { job } = await nucleo.fila.enfileirar({
      tipo: TIPO_JOB_IDENTIDADE,
      chaveIdempotencia: chaveDeIdentidade(alvo),
      entrada: { produtoExternoId: alvo },
    });
    return { jobId: job.id };
  }

  it('teto de orçamento adia o job em vez de falhar, e não gasta tentativa', async () => {
    // Duas ocorrências próximas por embedding e sem código de peça: o par só o
    // julgamento resolve, e o orçamento de uma chamada estoura na segunda.
    const { jobId } = await prepararParQueSoOJulgamentoResolve();

    const chamador: Chamador = {
      nome: 'falso',
      chamar: (): Promise<RespostaDoModelo> =>
        Promise.resolve({
          saida: { mesmoProduto: true, certeza: 'media', justificativa: 'parecem iguais' },
          custoCentavos: 1,
        }),
    };

    // Orçamento de uma chamada: o primeiro par é julgado, o segundo estoura.
    const executor = new ExecutorDeIdentidade(
      nucleo.fila,
      (jobId) =>
        new ResolvedorDeIdentidade(conexao.db, {
          jobId,
          modeloDeEmbedding: 'sintetico',
          modeloDeJulgamento: 'modelo-de-teste',
          llm: new ServicoDeLlm(conexao.db, chamador, new Orcamento(1_000, 1)),
        }),
    );

    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('adiado');

    // `buscarDetalhado`, não `buscarPorId`: só o detalhado traz `agendadoPara`, que é
    // o campo que prova o adiamento.
    const depois = await nucleo.fila.buscarDetalhado(jobId);
    expect(depois?.status).toBe('pendente');
    // Adiamento não é erro: a tentativa fica intacta, senão um job que progride
    // acabaria na lista de mortos por progredir devagar.
    expect(depois?.tentativas).toBe(0);
    expect(depois?.erro).toContain('orçamento');
    expect(depois?.agendadoPara.getTime()).toBeGreaterThan(Date.now());

    // E o par que foi julgado antes do estouro ficou gravado: a retomada continua
    // de onde parou em vez de recomeçar.
    expect(await conexao.db.select().from(parIdentidade)).toHaveLength(1);
  });

  it('cota do provedor adia o job até a hora que o provedor disse', async () => {
    const { jobId } = await prepararParQueSoOJulgamentoResolve();
    const volta = new Date(Date.now() + 5 * 60 * 60 * 1000);

    const chamador: Chamador = {
      nome: 'falso',
      chamar: (): Promise<RespostaDoModelo> =>
        Promise.reject(new LimiteDoProvedor('acabou a cota diária', volta, true)),
    };
    const executor = new ExecutorDeIdentidade(
      nucleo.fila,
      (id) =>
        new ResolvedorDeIdentidade(conexao.db, {
          jobId: id,
          modeloDeEmbedding: 'sintetico',
          modeloDeJulgamento: 'openrouter/free',
          llm: new ServicoDeLlm(conexao.db, chamador, new Orcamento(1_000, 10)),
        }),
    );

    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('adiado');

    const depois = await nucleo.fila.buscarDetalhado(jobId);
    expect(depois?.status).toBe('pendente');
    expect(depois?.tentativas).toBe(0);
    // A hora do provedor, e não o intervalo fixo do orçamento: repetir antes só
    // gastaria cota com pedido recusado.
    expect(depois?.agendadoPara.getTime()).toBe(volta.getTime());
    expect(depois?.erro).toContain('cota diária');

    // A recusa veio do provedor, então foi um pedido, e ficou registrada.
    const chamadas = await conexao.db.select().from(llmCall);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.erro).toContain('cota diária');
  });
  it('cada job nasce com orçamento novo, senão o teto seria por vida do processo', async () => {
    const orcamentos: Orcamento[] = [];
    const executor = new ExecutorDeIdentidade(nucleo.fila, (jobId) => {
      const orcamento = new Orcamento(1_000, 5);
      orcamentos.push(orcamento);
      return new ResolvedorDeIdentidade(conexao.db, { jobId });
    });

    await subirPlanilha();
    await nucleo.executor.processarProximo();

    await executor.processarProximo();
    await executor.processarProximo();

    expect(orcamentos).toHaveLength(2);
    expect(orcamentos[0]).not.toBe(orcamentos[1]);
  });

  it('o custo do julgamento fica atribuído ao job que o pediu', async () => {
    // `llm_call.job_id` existe para isso: sem ele, "por que a conta subiu" responde
    // por finalidade e não por qual trabalho gastou.
    const criados = await conexao.db
      .insert(produtoExterno)
      .values([
        {
          tituloBruto: 'Refil de filtro Electrolux',
          hashConteudo: 'c1',
          fonte: 'm0_link',
          atributosExtraidos: { tipoProduto: 'refil de filtro', marca: 'Electrolux' },
        },
        {
          tituloBruto: 'Elemento filtrante Electrolux',
          hashConteudo: 'c2',
          fonte: 'm0_link',
          atributosExtraidos: { tipoProduto: 'elemento filtrante', marca: 'Electrolux' },
        },
      ])
      .returning({ id: produtoExterno.id });

    await new ResolvedorDeIdentidade(conexao.db).prepararLote();

    const embeddings = new RepositorioDeEmbeddings(conexao.db);
    for (const [i, criado] of criados.entries()) {
      const vetor = new Array<number>(DIMENSAO_EMBEDDING).fill(0);
      vetor[0] = 1;
      vetor[1] = i * 0.01;
      await embeddings.gravar({
        produtoExternoId: criado.id,
        textoCanonico: `c${String(i)}`,
        modelo: 'sintetico',
        vetor,
      });
    }

    const alvo = criados[0]?.id ?? '';
    const { job } = await nucleo.fila.enfileirar({
      tipo: TIPO_JOB_IDENTIDADE,
      chaveIdempotencia: chaveDeIdentidade(alvo),
      entrada: { produtoExternoId: alvo },
    });

    const executor = new ExecutorDeIdentidade(
      nucleo.fila,
      (jobId) =>
        new ResolvedorDeIdentidade(conexao.db, {
          jobId,
          modeloDeEmbedding: 'sintetico',
          modeloDeJulgamento: 'modelo-de-teste',
          llm: new ServicoDeLlm(
            conexao.db,
            {
              nome: 'falso',
              chamar: (): Promise<RespostaDoModelo> =>
                Promise.resolve({
                  saida: { mesmoProduto: true, certeza: 'alta', justificativa: 'mesmo refil' },
                  custoCentavos: 2,
                }),
            },
            new Orcamento(1_000, 5),
          ),
        }),
    );

    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('concluido');

    const chamadas = await conexao.db.select().from(llmCall);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.jobId).toBe(job.id);
    expect(chamadas[0]?.custoCentavos).toBe(2);
  });
});
