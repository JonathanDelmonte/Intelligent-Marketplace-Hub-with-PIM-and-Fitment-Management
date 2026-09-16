/**
 * Testes do executor, contra Postgres de verdade.
 *
 * Com banco porque o que se testa aqui é a **gravação a cada passo** e a **retomada**:
 * um dublê de repositório provaria que o laço chama `salvar`, e não que o dossiê
 * gravado no passo 2 é retomável no passo 3.
 *
 * Os investigadores são dublês de propósito — o laço não deve saber a diferença entre
 * um que consulta SQL e um que chamaria LLM, e é isso que a porta existe para provar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { centavos, reaisParaCentavos, ZERO, type Centavos } from '@/lib/dinheiro';
import { MotorDoProspector } from './motor';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from './motor';
import type { Achado } from './fronteira';
import type { Ferramenta } from './hipoteses';
import { RepositorioDeDossies } from './repositorio';

const ALVO = 'refil de purificador PA21G';

/**
 * Investigador de teste: devolve os achados que o teste mandar, na ordem das chamadas.
 *
 * Declara **todas** as ferramentas quando pedido, para o teste poder exercitar as sete
 * famílias — é o que permite chegar na saturação, que exige três passos seguidos sem
 * achado e mais itens do que a base local alcança.
 */
class Dublê implements Investigador {
  chamadas = 0;

  constructor(
    readonly ferramenta: Ferramenta,
    private readonly roteiro: {
      readonly achadosPorChamada?: readonly (readonly Achado[])[];
      readonly custoPorChamada?: Centavos;
      readonly falharNaChamada?: number;
    } = {},
  ) {}

  investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    this.chamadas += 1;

    if (this.roteiro.falharNaChamada === this.chamadas) {
      return Promise.reject(new Error('ferramenta quebrou no meio'));
    }

    const achados =
      this.roteiro.achadosPorChamada?.[this.chamadas - 1] ??
      (this.roteiro.achadosPorChamada === undefined
        ? [achado(`a${String(this.chamadas)}`, pedido.item.familia)]
        : []);

    return Promise.resolve({
      achados,
      custoCentavos: this.roteiro.custoPorChamada ?? ZERO,
    });
  }
}

function achado(id: string, familia: Achado['familia']): Achado {
  return {
    id,
    familia,
    oQue: 'algo confirmado',
    origemUrl: 'https://fonte.invalid/x',
    achadoEm: '2026-09-16T00:00:00.000Z',
  };
}

describe.skipIf(!temBancoDeTeste())('MotorDoProspector', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeDossies;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['dossie']);
    repo = new RepositorioDeDossies(conexao.db);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const executar = (
    investigadores: readonly Investigador[],
    teto = { reais: 5, passos: 20 },
  ): ReturnType<MotorDoProspector['investigar']> =>
    new MotorDoProspector(repo, investigadores).investigar({
      alvo: ALVO,
      tetoCentavos: reaisParaCentavos(teto.reais),
      tetoPassos: teto.passos,
    });

  it('investiga o que a ferramenta alcança e para quando a fronteira esvazia', async () => {
    // Só a base local: das sete famílias, duas declaram essa ferramenta.
    const dublê = new Dublê('base_local');
    const resultado = await executar([dublê]);

    expect(dublê.chamadas).toBe(2);
    expect(resultado.motivo).toBe('fronteira_vazia');
    expect(resultado.dossie.achados).toHaveLength(2);
    expect(resultado.dossie.investigados).toHaveLength(2);
  });

  it('grava a cada passo, e um passo que falha não desfaz os anteriores', async () => {
    // É a promessa da fase 10: dossiê parcial salvo. Sem ela, ferramenta que quebra no
    // passo 4 cobra os três primeiros de novo.
    const dublê = new Dublê('base_local', { falharNaChamada: 2 });

    await expect(executar([dublê])).rejects.toThrow('ferramenta quebrou');

    const gravado = await repo.porAlvo(ALVO);
    expect(gravado?.achados).toHaveLength(1);
    expect(gravado?.investigados).toHaveLength(1);
    expect(gravado?.motivoParada).toBeNull();
  });

  it('retoma de onde parou, sem re-investigar nem recomeçar a contagem', async () => {
    const primeiro = new Dublê('busca_web');
    const inicial = await executar([primeiro], { reais: 5, passos: 2 });

    expect(inicial.motivo).toBe('orcamento_passos');
    expect(inicial.dossie.passosGastos).toBe(2);
    expect(primeiro.chamadas).toBe(2);

    const segundo = new Dublê('busca_web');
    const continuado = await executar([segundo], { reais: 5, passos: 5 });

    expect(continuado.dossie.passosGastos).toBe(5);
    expect(continuado.passosNestaExecucao).toBe(3);
    // Nenhum item investigado duas vezes: é onde o orçamento seria pago em dobro.
    expect(new Set(continuado.dossie.investigados).size).toBe(5);
  });

  it('para no teto de reais, e o motivo não é confundido com saturação', async () => {
    // Um agente que reporta "estourei o teto" quando saturou faz o dono aumentar o
    // teto para nada — e o contrário faz ele desistir de um alvo que rendia.
    const dublê = new Dublê('busca_web', { custoPorChamada: centavos(120) });
    const resultado = await executar([dublê], { reais: 3, passos: 20 });

    expect(resultado.motivo).toBe('orcamento_reais');
    expect(dublê.chamadas).toBe(3);
    expect(resultado.dossie.gastoCentavos).toBe(centavos(360));
  });

  it('para por saturação depois de três passos sem achado novo', async () => {
    const dublê = new Dublê('busca_web', { achadosPorChamada: [[achado('a1', 'quem_fabrica')]] });
    const resultado = await executar([dublê]);

    expect(resultado.motivo).toBe('saturacao');
    // Um achado no primeiro passo, e três passos vazios depois dele.
    expect(dublê.chamadas).toBe(4);
    expect(resultado.dossie.achados).toHaveLength(1);
  });

  it('achado repetido não conta duas vezes nem zera a saturação', async () => {
    // Id determinístico é o certo — é o que faz um passo repetido pela fila não
    // duplicar o achado. Mas repetir o que já se sabia não é progresso.
    const mesmo = [achado('igual', 'quem_fabrica')];
    const dublê = new Dublê('busca_web', { achadosPorChamada: [mesmo, mesmo, mesmo, mesmo] });
    const resultado = await executar([dublê]);

    expect(resultado.dossie.achados).toHaveLength(1);
    expect(resultado.motivo).toBe('saturacao');
  });

  it('o dossiê guarda a fronteira inteira, com ferramenta e peso', async () => {
    const resultado = await executar([new Dublê('base_local')]);
    const item = resultado.dossie.fronteira.find((i) => i.familia === 'onde_e_mais_barato');

    expect(item?.ferramenta).toBe('busca_web');
    expect(item?.valorEsperado).toBe(100);
  });

  it('as ferramentas do executor são as dos investigadores registrados', () => {
    const executor = new MotorDoProspector(repo, [
      new Dublê('base_local'),
      new Dublê('ler_pagina'),
    ]);
    expect([...executor.ferramentas].sort()).toEqual(['base_local', 'ler_pagina']);
  });
});
