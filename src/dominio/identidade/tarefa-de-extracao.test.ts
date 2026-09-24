/**
 * A extração rodando como tarefa do poller, contra Postgres e disco de verdade.
 *
 * O teste que importa é o de ponta a ponta: uma planilha sem EAN, dois anúncios do
 * mesmo refil escritos de jeitos diferentes, e o poller — sem ninguém chamar nada à
 * mão — lê marca e código dos títulos e junta os dois pela chave de agrupamento. É a
 * via da pendência 3.2, que estava construída e sem dado para morder.
 *
 * E as esperas: cota do provedor espera a hora dita, falha que não é cota espera cinco
 * minutos e dobra — sem perguntar de novo a cada tique.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parIdentidade, produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  resolvedorDePerfilDeTeste,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { Fila } from '@/infra/fila/fila';
import {
  LimiteDoProvedor,
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from '@/infra/llm';
import { drenar, montarNucleoCom, tarefaCompleta, type Nucleo } from '@/infra/montagem';
import { ExtratorDeRegistros } from './extracao';
import { TIPO_JOB_IDENTIDADE, chaveDeIdentidade } from './tarefa';
import {
  ESPERA_INICIAL_POR_FALHA_MS,
  ExecutorDeExtracao,
  tarefaDeExtracao,
} from './tarefa-de-extracao';

const NL = String.fromCharCode(10);

/** Dois anúncios do mesmo refil, sem EAN, e um de outra peça. */
const CSV = [
  'Código MLB;Título;Preço (R$)',
  'MLB1;Elemento Filtrante Electrolux EF-ELX-21 p/ PA21G;64,90',
  'MLB2;Refil EF-ELX-21 Electrolux Original Pronta Entrega;69,90',
  'MLB3;Vedação Electrolux VD-10 para purificador;19,90',
].join(NL);

const LEITURAS: Readonly<Record<string, Record<string, unknown>>> = {
  'Elemento Filtrante Electrolux EF-ELX-21 p/ PA21G': {
    tipoProduto: 'refil de filtro',
    marca: 'Electrolux',
    modeloPeca: 'EF-ELX-21',
    modelosCompativeis: ['PA21G'],
  },
  'Refil EF-ELX-21 Electrolux Original Pronta Entrega': {
    tipoProduto: 'refil de filtro',
    marca: 'Electrolux',
    modeloPeca: 'EF-ELX-21',
  },
  'Vedação Electrolux VD-10 para purificador': {
    tipoProduto: 'vedação',
    marca: 'Electrolux',
    modeloPeca: 'VD-10',
  },
};

const esquemaDoPedido = z.object({
  produtos: z.array(z.object({ id: z.string(), titulo: z.string() })),
});

/** Lê pelo título, como um modelo leria. Julgamento não é pedido neste teste. */
class ModeloFalso implements Chamador {
  readonly nome = 'falso';
  pedidos: PedidoAoModelo[] = [];
  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.pedidos.push(pedido);
    const lido = esquemaDoPedido.parse(pedido.entrada);
    const registros = lido.produtos.map((p) => ({ id: p.id, ...LEITURAS[p.titulo] }));
    return await Promise.resolve({ saida: { registros }, custoCentavos: 0 });
  }
}

describe.skipIf(!temBancoDeTeste())('extração como tarefa do poller', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let modelo: ModeloFalso;
  let nucleo: Nucleo;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-extracao-'));
    modelo = new ModeloFalso();
    nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-extracao'),
      {
        llmDeJob: () => ({
          servico: new ServicoDeLlm(conexao.db, modelo, new Orcamento(1_000, 10)),
          modeloDeJulgamento: 'julgador-de-teste',
          modeloDeExtracao: 'extrator-de-teste',
        }),
      },
    );
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

  it('planilha sem EAN: o poller lê os títulos e junta o mesmo refil pela marca e código', async () => {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });

    await drenar(tarefaCompleta(nucleo), 30);

    // Um pedido só para os três títulos: é o lote que cabe na cota gratuita.
    expect(modelo.pedidos.filter((p) => p.proposito === 'extracao')).toHaveLength(1);

    const chaves = await conexao.db
      .select({ titulo: produtoExterno.tituloBruto, chave: produtoExterno.chaveAgrupamento })
      .from(produtoExterno);
    expect(chaves.map((c) => c.chave).sort()).toEqual([
      'electrolux|efelx21',
      'electrolux|efelx21',
      'electrolux|vd10',
    ]);

    const juntados = await conexao.db
      .select({ decisao: parIdentidade.decisao, nivel: parIdentidade.nivel })
      .from(parIdentidade);
    // Um par só: a vedação tem outra chave, e chave diferente não gera candidato — sem
    // embedding, ela não é comparada com o refil, que é o certo.
    expect(juntados).toEqual([{ decisao: 'mesmo', nivel: 'marca_modelo' }]);
    expect(modelo.pedidos.filter((p) => p.proposito === 'julgamento_identidade')).toHaveLength(0);
  });

  it('quem ganhou registro volta para a resolução: job concluído é reaberto, e o que não existia é criado', async () => {
    const fila = new Fila(conexao.db);
    const [comJob, semJob] = await conexao.db
      .insert(produtoExterno)
      .values([
        {
          tituloBruto: 'Elemento Filtrante Electrolux EF-ELX-21 p/ PA21G',
          hashConteudo: 'h1',
          fonte: 'm1_planilha' as const,
          coletadoEm: new Date(),
        },
        {
          tituloBruto: 'Vedação Electrolux VD-10 para purificador',
          hashConteudo: 'h2',
          fonte: 'm1_planilha' as const,
          coletadoEm: new Date(),
        },
      ])
      .returning({ id: produtoExterno.id });
    const idComJob = comJob?.id ?? '';
    const idSemJob = semJob?.id ?? '';

    const { job } = await fila.enfileirar({
      tipo: TIPO_JOB_IDENTIDADE,
      chaveIdempotencia: chaveDeIdentidade(idComJob),
      entrada: { produtoExternoId: idComJob },
    });
    await fila.concluir(job.id, {});

    const lote = await nucleo.executorDeExtracao.processarLote();

    expect(lote).toMatchObject({ tipo: 'extracao', reabertos: 2 });
    expect((await fila.buscarPorId(job.id))?.status).toBe('pendente');
    expect(
      (await fila.buscarPorChave(TIPO_JOB_IDENTIDADE, chaveDeIdentidade(idSemJob)))?.status,
    ).toBe('pendente');
  });

  it('cota do provedor: espera a hora dita, sem perguntar de novo antes dela', async () => {
    const volta = new Date('2026-09-25T00:00:00Z');
    let agora = Date.parse('2026-09-24T20:00:00Z');
    let pedidos = 0;
    const cotaEsgotada: Chamador = {
      nome: 'sem-cota',
      chamar: () => {
        pedidos += 1;
        return Promise.reject(new LimiteDoProvedor('a cota do dia acabou', volta, true));
      },
    };
    const executor = new ExecutorDeExtracao(
      new Fila(conexao.db),
      () =>
        new ExtratorDeRegistros(conexao.db, {
          llm: new ServicoDeLlm(conexao.db, cotaEsgotada, new Orcamento(1_000, 10)),
          modelo: 'extrator-de-teste',
        }),
      () => agora,
    );
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'Vedação Electrolux VD-10 para purificador',
      hashConteudo: 'h3',
      fonte: 'm1_planilha',
      coletadoEm: new Date(),
    });

    expect(await executor.processarLote()).toMatchObject({ tipo: 'interrompido', ate: volta });
    expect(await executor.processarLote()).toMatchObject({ tipo: 'em_espera' });
    expect(pedidos).toBe(1);

    // A tarefa fica ociosa na espera: as outras filas seguem.
    expect(await tarefaDeExtracao(executor).executar()).toEqual({ ocioso: true });

    agora = volta.getTime() + 1;
    await executor.processarLote();
    expect(pedidos).toBe(2);
  });

  it('falha que não é cota espera cinco minutos, e a espera dobra', async () => {
    let agora = 0;
    let pedidos = 0;
    const recusa: Chamador = {
      nome: 'recusa',
      chamar: () => {
        pedidos += 1;
        return Promise.reject(new Error('No endpoints found matching your data policy'));
      },
    };
    const executor = new ExecutorDeExtracao(
      new Fila(conexao.db),
      () =>
        new ExtratorDeRegistros(conexao.db, {
          llm: new ServicoDeLlm(conexao.db, recusa, new Orcamento(1_000, 10)),
          modelo: 'extrator-de-teste',
        }),
      () => agora,
    );
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'Vedação Electrolux VD-10 para purificador',
      hashConteudo: 'h4',
      fonte: 'm1_planilha',
      coletadoEm: new Date(),
    });

    await executor.processarLote();
    agora = ESPERA_INICIAL_POR_FALHA_MS - 1;
    expect(await executor.processarLote()).toMatchObject({ tipo: 'em_espera' });

    agora = ESPERA_INICIAL_POR_FALHA_MS;
    await executor.processarLote();
    expect(pedidos).toBe(2);

    // Segunda falha: dez minutos.
    agora += 2 * ESPERA_INICIAL_POR_FALHA_MS - 1;
    expect(await executor.processarLote()).toMatchObject({ tipo: 'em_espera' });
  });

  it('sem chave, a tarefa fica ociosa e nada é marcado', async () => {
    const executor = new ExecutorDeExtracao(new Fila(conexao.db), () => undefined);
    expect(await tarefaDeExtracao(executor).executar()).toEqual({ ocioso: true });
  });
});
