/**
 * O poller consumindo a fila de verdade.
 *
 * Os testes do poller em `infra/fila/poller.test.ts` usam tarefa de mentira para
 * exercitar o laço; este usa **Postgres e disco de verdade** para exercitar o
 * encaixe: a tarefa que traduz o resultado do executor, a montagem do núcleo, e o
 * caminho inteiro de uma entrada até `produto_externo` sem ninguém chamar
 * `processarProximo` à mão.
 *
 * É a diferença entre "as peças funcionam" e "o sistema anda sozinho", que era o
 * que faltava.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { produtoExterno } from '@/infra/banco/schema';
import { montarNucleoCom, type Nucleo } from '@/infra/montagem';
import { Poller, type Temporizador } from '@/infra/fila/poller';
import { criarRegistrador } from '@/infra/log';
import {
  abrirBancoDeTeste,
  limparTabelas,
  resolvedorDePerfilDeTeste,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { tarefaDeIngestao } from './tarefa';

const NL = String.fromCharCode(10);

const CSV_ML = [
  'Relatório de anúncios - Mercado Livre',
  'Gerado em 12/09/2026',
  '',
  'Código MLB;Título;Preço (R$);Estoque;EAN',
  'MLB7111111111;Refil Filtro Purificador Electrolux PA21G;69,90;10;7896541200909',
  'MLB7222222222;Refil Filtro Purificador Electrolux PA26G;74,90;5;7896541200916',
  'MLB7333333333;Vedação para Purificador Electrolux;19,90;20;',
].join(NL);

/** Planilha separada por vírgula, com linha de título — o caso que quebrava. */
const CSV_VIRGULA = [
  'Relatorio de anuncios',
  'ID do produto,Nome do produto,Preco,Estoque',
  'SP7001,Refil Filtro Purificador Consul CPB35,"59,90",7',
  'SP7002,Vedacao Purificador Consul,"14,90",3',
].join(NL);

describe.skipIf(!temBancoDeTeste())('poller consumindo a fila de ingestão', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let nucleo: Nucleo;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-poller-'));
    nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-ingestao'),
    );

    await limparTabelas(conexao.db, ['job', 'produto_externo', 'preco_historico']);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao.encerrar();
  });

  /** Temporizador que dispara na hora: nenhum teste espera de verdade. */
  const semEspera: Temporizador = (_ms, acao) => {
    acao();
    return () => undefined;
  };

  function pollerDeTeste(
    opcoes: { readonly registrador?: ReturnType<typeof criarRegistrador> } = {},
  ) {
    const tarefa = tarefaDeIngestao(nucleo.executor, opcoes.registrador);
    return new Poller(tarefa, {
      pararQuandoOcioso: true,
      temporizador: semEspera,
      ...(opcoes.registrador === undefined ? {} : { registrador: opcoes.registrador }),
    });
  }

  it('drena a fila inteira sozinho e grava os produtos', async () => {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_ML),
    });

    const estatisticas = await pollerDeTeste().iniciar();

    expect(estatisticas.comTrabalho).toBe(1);
    expect(estatisticas.errosTotais).toBe(0);

    const produtos = await conexao.db.select().from(produtoExterno);
    expect(produtos).toHaveLength(3);

    const contagem = await nucleo.fila.contagemPorStatus();
    expect(contagem.concluido).toBe(1);
    // Três jobs de resolução de identidade ficaram pendentes, um por ocorrência
    // gravada: é a ingestão alimentando o M3 sem ninguém pedir. Este poller de teste
    // só roda a tarefa de ingestão, então eles ficam onde estão.
    expect(contagem.pendente).toBe(3);
    const pendentes = (await nucleo.fila.ultimos()).filter((j) => j.status === 'pendente');
    expect(pendentes.map((j) => j.tipo)).toEqual([
      'resolver_identidade',
      'resolver_identidade',
      'resolver_identidade',
    ]);
  });

  it('importa planilha separada por vírgula com linha de título', async () => {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_shopee.csv' },
      conteudo: new TextEncoder().encode(CSV_VIRGULA),
    });

    await pollerDeTeste().iniciar();

    // O job de ingestão, nomeado: `ultimos()` devolve o mais recente primeiro, e o
    // mais recente agora é um job de identidade enfileirado pela própria ingestão.
    const jobs = await nucleo.fila.ultimos();
    const ingestao = jobs.find((j) => j.tipo === 'ingestao');
    expect(ingestao?.status, ingestao?.erro ?? '').toBe('concluido');

    const produtos = await conexao.db.select().from(produtoExterno);
    expect(produtos.map((p) => p.tituloBruto).sort()).toEqual([
      'Refil Filtro Purificador Consul CPB35',
      'Vedacao Purificador Consul',
    ]);
  });

  it('processa vários jobs em tiques seguidos, um por tique', async () => {
    for (const n of [1, 2, 3]) {
      await nucleo.orquestrador.receber({
        entrada: {
          tipo: 'url',
          valor: `https://produto.mercadolivre.com.br/MLB-90000000${String(n)}-x`,
        },
      });
    }

    const estatisticas = await pollerDeTeste().iniciar();

    expect(estatisticas.comTrabalho).toBe(3);
    expect(estatisticas.ociosos).toBe(1);
    expect(estatisticas.tiques).toBe(4);

    // Anúncio de marketplace depende de extrator com LLM, que não existe: vai
    // para revisão com o motivo, e isso é resultado esperado, não falha.
    const contagem = await nucleo.fila.contagemPorStatus();
    expect(contagem.pendente_revisao).toBe(3);
    expect(contagem.falhou).toBe(0);
  });

  it('lista de links abre um job por link, e o poller os consome no mesmo laço', async () => {
    const lista = [
      'https://produto.mercadolivre.com.br/MLB-911111111-a',
      'https://produto.mercadolivre.com.br/MLB-922222222-b',
    ].join(NL);

    await nucleo.orquestrador.receber({ entrada: { tipo: 'texto', valor: lista } });

    const estatisticas = await pollerDeTeste().iniciar();

    // Um tique para a lista, dois para os filhos, mais o tique ocioso do fim.
    expect(estatisticas.comTrabalho).toBe(3);

    const jobs = await nucleo.fila.ultimos();
    expect(jobs).toHaveLength(3);
    expect(jobs.filter((j) => j.status === 'pendente_revisao')).toHaveLength(2);
  });

  it('o erro de um job não impede o próximo — e fica visível na lista', async () => {
    // Job de um tipo que o executor não conhece: payload sem forma de ingestão.
    await nucleo.fila.enfileirar({
      tipo: 'ingestao',
      chaveIdempotencia: 'payload-torto',
      entrada: { qualquerCoisa: true },
    });
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_ML),
    });

    const estatisticas = await pollerDeTeste().iniciar();

    expect(estatisticas.comTrabalho).toBe(2);
    expect(estatisticas.errosTotais).toBe(0);

    const jobs = await nucleo.fila.ultimos();
    const torto = jobs.find((j) => j.chaveIdempotencia === 'payload-torto');
    expect(torto?.status).toBe('pendente_revisao');
    expect(torto?.erro).toContain('forma esperada');

    // O outro job concluiu, apesar do vizinho torto.
    expect(jobs.filter((j) => j.status === 'concluido')).toHaveLength(1);
  });

  it('reexecutar o poller sobre fila vazia é inofensivo e não regrava nada', async () => {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_ML),
    });

    await pollerDeTeste().iniciar();
    const depoisDoPrimeiro = await conexao.db.select().from(produtoExterno);

    const segundo = await pollerDeTeste().iniciar();
    const depoisDoSegundo = await conexao.db.select().from(produtoExterno);

    expect(segundo.comTrabalho).toBe(0);
    expect(segundo.ociosos).toBe(1);
    expect(depoisDoSegundo).toHaveLength(depoisDoPrimeiro.length);
  });

  it('reenfileirar e rodar de novo não duplica produto — a ingestão é idempotente', async () => {
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_ML),
    });

    await pollerDeTeste().iniciar();
    const primeiro = (await nucleo.fila.ultimos()).find((j) => j.tipo === 'ingestao');
    expect(primeiro?.status).toBe('concluido');

    await nucleo.fila.reenfileirar(primeiro?.id ?? '');
    await pollerDeTeste().iniciar();

    const produtos = await conexao.db.select().from(produtoExterno);
    expect(produtos).toHaveLength(3);

    const jobs = await nucleo.fila.ultimos();
    const resultado = jobs.find((j) => j.tipo === 'ingestao')?.resultado as {
      duplicados?: number;
    } | null;
    expect(resultado?.duplicados).toBe(3);

    // E a reexecução não criou job de identidade repetido: a chave de idempotência é
    // o id da ocorrência, e a linha duplicada reenfileira a mesma chave.
    const deIdentidade = jobs.filter((j) => j.tipo === 'resolver_identidade');
    expect(deIdentidade).toHaveLength(3);
  });

  it('o log do laço nomeia o job e o que foi gravado', async () => {
    const linhas: string[] = [];
    const registrador = criarRegistrador({
      nivelMinimo: 'debug',
      escrever: (l) => linhas.push(l),
    });

    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_ML),
    });

    await pollerDeTeste({ registrador }).iniciar();

    const concluido = linhas.find((l) => l.includes('ingestao.job_concluido'));
    expect(concluido).toBeDefined();
    expect(concluido).toContain('"gravados":3');
    expect(concluido).toContain('"tipoDeEntrada":"planilha_exportacao"');
    expect(linhas.some((l) => l.includes('poller.parou'))).toBe(true);
  });
});
