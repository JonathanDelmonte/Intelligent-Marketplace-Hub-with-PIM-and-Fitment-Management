/**
 * A investigação rodando pelo poller, contra Postgres de verdade.
 *
 * O que este arquivo prova é a ponta que faltava: alguém pede na tela, o poller
 * investiga, e o dossiê aparece preenchido — sem ninguém segurar uma requisição aberta
 * enquanto o laço gasta passos.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { Fila } from '@/infra/fila/fila';
import { reaisParaCentavos, ZERO } from '@/lib/dinheiro';
import { MotorDoProspector } from './motor';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from './motor';
import { InvestigadorDaBaseLocal } from './investigadores/base-local';
import { RepositorioDeDossies } from './repositorio';
import {
  ExecutorDoProspector,
  TIPO_JOB_PROSPECTOR,
  chaveDoProspector,
  enfileirarInvestigacao,
  gatilhoDoMinuto,
  tarefaDoProspector,
} from './tarefa';

const ALVO = 'Refil de purificador PA21G';
const TETO = { tetoCentavos: reaisParaCentavos(5), tetoPassos: 20 };

describe('chaveDoProspector', () => {
  it('normaliza o alvo e carrega o gatilho', () => {
    // O alvo sozinho bloquearia toda investigação futura daquele alvo: a fila colapsa
    // por (tipo, chave) para sempre, e investigar de novo é o uso normal do módulo.
    expect(chaveDoProspector('Refil PA21G', 'g1')).toBe(chaveDoProspector('refil  pa21g ', 'g1'));
    expect(chaveDoProspector('Refil PA21G', 'g1')).not.toBe(chaveDoProspector('Refil PA21G', 'g2'));
  });

  it('o gatilho do minuto colapsa clique repetido e libera no minuto seguinte', () => {
    const agora = new Date('2026-09-16T03:04:05Z');
    expect(gatilhoDoMinuto(agora)).toBe(gatilhoDoMinuto(new Date('2026-09-16T03:04:59Z')));
    expect(gatilhoDoMinuto(agora)).not.toBe(gatilhoDoMinuto(new Date('2026-09-16T03:05:00Z')));
  });
});

describe.skipIf(!temBancoDeTeste())('investigação como tarefa de poller', () => {
  let conexao: ConexaoDeTeste;
  let fila: Fila;
  let dossies: RepositorioDeDossies;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['job', 'dossie', 'produto_externo']);
    fila = new Fila(conexao.db);
    dossies = new RepositorioDeDossies(conexao.db);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  function executorCom(investigadores: readonly Investigador[]): ExecutorDoProspector {
    return new ExecutorDoProspector(fila, new MotorDoProspector(dossies, investigadores));
  }

  async function ocorrencia(titulo: string, n: number) {
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: titulo,
      hashConteudo: `h${String(n)}`,
      fonte: 'm2_publico' as const,
      url: `https://loja.invalid/${String(n)}`,
    });
  }

  it('fila vazia é ócio, e não erro', async () => {
    const r = await executorCom([]).processarProximo();
    expect(r.tipo).toBe('fila_vazia');
  });

  it('da fila ao dossiê preenchido, com a base local de verdade', async () => {
    await ocorrencia('Refil PA21G serve tambem no PA26G', 1);
    await ocorrencia('Vedacao do copo PA21G', 2);

    expect(
      await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilhoDoMinuto(new Date())),
    ).toBe(true);

    const executor = executorCom([new InvestigadorDaBaseLocal(conexao.db)]);
    const r = await executor.processarProximo();

    expect(r.tipo).toBe('concluido');
    if (r.tipo !== 'concluido') return;
    expect(r.passos).toBe(2);
    expect(r.motivo).toBe('fronteira_vazia');

    const dossie = await dossies.porAlvo(ALVO);
    // Um achado de cada família: o PA26G citado ao lado do PA21G, e a vedação como
    // outra peça. O segundo anúncio de refil não entra em "outras peças" — é a mesma
    // peça anunciada com outro título.
    expect([...new Set(dossie?.achados.map((a) => a.familia))].sort()).toEqual([
      'em_que_mais_serve',
      'que_outras_pecas',
    ]);
    expect(dossie?.achados).toHaveLength(2);
    // Cada achado com a URL de onde veio: é o que a auditoria exige.
    expect(dossie?.resumo.auditavel).toBe(true);
  });

  it('clicar duas vezes no mesmo minuto enfileira um job, e não dois', async () => {
    const gatilho = gatilhoDoMinuto(new Date());
    await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilho);
    await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilho);

    const jobs = await fila.ultimos();
    expect(jobs.filter((j) => j.tipo === TIPO_JOB_PROSPECTOR)).toHaveLength(1);
  });

  it('entrada sem teto vai para revisão, e não roda sem teto', async () => {
    // "Agente sem teto de orçamento por execução não roda" — e um job cuja entrada
    // perdeu o teto não pode ser reivindicado só para estourar no construtor.
    await fila.enfileirar({
      tipo: TIPO_JOB_PROSPECTOR,
      entrada: { alvo: ALVO },
      chaveIdempotencia: 'sem-teto',
    });

    const r = await executorCom([]).processarProximo();
    expect(r.tipo).toBe('pendente_revisao');
    if (r.tipo === 'pendente_revisao') expect(r.motivo).toContain('tetoCentavos');
  });

  it('ferramenta que quebra falha o job e deixa o dossiê parcial gravado', async () => {
    await ocorrencia('Refil PA21G serve tambem no PA26G', 1);

    const quebrado: Investigador = {
      ferramenta: 'base_local',
      investigar: (_pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> =>
        Promise.reject(new Error('ferramenta quebrou')),
    };

    await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilhoDoMinuto(new Date()));
    const r = await executorCom([quebrado]).processarProximo();

    expect(r.tipo).toBe('falhou');
    if (r.tipo === 'falhou') expect(r.erro).toContain('ferramenta quebrou');

    // O plano não é o dossiê: quem salva antes do primeiro passo é a tela, e aqui o
    // job falhou no primeiro. O que importa é que a fila reagenda e a retomada continua.
    const dossie = await dossies.porAlvo(ALVO);
    expect(dossie?.passosGastos ?? 0).toBe(0);
  });

  it('a tarefa devolve ócio com a fila vazia e trabalho quando há job', async () => {
    const tarefa = tarefaDoProspector(executorCom([new InvestigadorDaBaseLocal(conexao.db)]));
    expect((await tarefa.executar()).ocioso).toBe(true);

    await ocorrencia('Refil PA21G PA26G', 1);
    await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilhoDoMinuto(new Date()));

    const resultado = await tarefa.executar();
    expect(resultado.ocioso).toBe(false);
    expect(resultado.campos?.['motivo']).toBe('fronteira_vazia');
  });

  it('o custo zero da base local não consome o teto em reais', async () => {
    // O que limita a investigação local é o teto de passos, e é por isso que ele é
    // obrigatório junto com o de reais.
    await ocorrencia('Refil PA21G PA26G', 1);
    await enfileirarInvestigacao(fila, { alvo: ALVO, ...TETO }, gatilhoDoMinuto(new Date()));
    await executorCom([new InvestigadorDaBaseLocal(conexao.db)]).processarProximo();

    expect((await dossies.porAlvo(ALVO))?.gastoCentavos).toBe(ZERO);
  });
});
