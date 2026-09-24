/**
 * A tarefa de conferência contra Postgres de verdade, com a conferência em si falsa: o
 * que se prova aqui é o ritmo — um por vez, espaçado, e esperando quando o serviço recusa.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import type { Conferencia } from './conferencia';
import { RepositorioDeFornecedores, type FornecedorGravado } from './repositorio';
import {
  ESPERA_INICIAL_POR_RECUSA_MS,
  ExecutorDeConferencia,
  INTERVALO_ENTRE_CONFERENCIAS_MS,
  INTERVALO_SEM_TRABALHO_MS,
  tarefaDeConferencia,
} from './tarefa-de-conferencia';

const TABELAS = ['fornecedor_preco_historico', 'fornecedor_sku', 'fornecedor'] as const;

/** A conferência que a busca devolveria: com loja achada, sem nada, ou recusada. */
function conferenciaFalsa(
  resultado: 'loja' | 'nada' | 'recusa',
  agora: number,
): (f: FornecedorGravado) => Promise<Conferencia> {
  return (f) =>
    Promise.resolve({
      em: new Date(agora).toISOString(),
      cadastro: { tipo: 'sem_documento' },
      vitrine: {
        buscadoComo: f.nome,
        conferidas:
          resultado === 'recusa' ? [] : resultado === 'loja' ? ['ml'] : ['ml', 'shopee', 'amazon'],
        lojas:
          resultado === 'loja'
            ? [
                {
                  plataforma: 'ml',
                  titulo: f.nome,
                  url: `https://www.mercadolivre.com.br/loja/${encodeURIComponent(f.nome)}`,
                },
              ]
            : [],
        indicios: [],
        falha: resultado === 'recusa' ? 'o buscador pediu uma pausa' : null,
      },
    });
}

describe.skipIf(!temBancoDeTeste())('ExecutorDeConferencia', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeFornecedores;
  let agora: number;
  const relogio = () => agora;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDeFornecedores(conexao.db);
    agora = new Date('2026-09-24T12:00:00Z').getTime();
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('sem rede, fica parada sem olhar a base', async () => {
    const executor = new ExecutorDeConferencia(repo, null, relogio);
    expect(await executor.conferirProximo()).toEqual({ tipo: 'sem_rede' });
  });

  it('confere um por vez, com um minuto entre um e outro', async () => {
    await repo.criar({ nome: 'Acme', fonte: 'manual' });
    await repo.criar({ nome: 'Beta', fonte: 'manual' });
    const executor = new ExecutorDeConferencia(
      repo,
      (f) => conferenciaFalsa('loja', agora)(f),
      relogio,
    );

    const primeiro = await executor.conferirProximo();
    expect(primeiro).toMatchObject({ tipo: 'conferido', lojas: 1, respondeu: true, recusa: null });
    expect((await executor.conferirProximo()).tipo).toBe('em_espera');

    agora += INTERVALO_ENTRE_CONFERENCIAS_MS;
    expect((await executor.conferirProximo()).tipo).toBe('conferido');

    agora += INTERVALO_ENTRE_CONFERENCIAS_MS;
    expect((await executor.conferirProximo()).tipo).toBe('nada_a_conferir');
    // Sem trabalho, não volta à base a cada tique.
    agora += INTERVALO_SEM_TRABALHO_MS - 1;
    expect((await executor.conferirProximo()).tipo).toBe('em_espera');

    const todos = await repo.listar();
    expect(todos.every((f) => f.vendeDiretoMarketplace === true)).toBe(true);
  });

  it('recusa do buscador espera cinco minutos, e a espera dobra', async () => {
    await repo.criar({ nome: 'Acme', fonte: 'manual' });
    const executor = new ExecutorDeConferencia(
      repo,
      (f) => conferenciaFalsa('recusa', agora)(f),
      relogio,
    );

    expect(await executor.conferirProximo()).toMatchObject({
      tipo: 'conferido',
      recusa: 'o buscador pediu uma pausa',
    });
    agora += ESPERA_INICIAL_POR_RECUSA_MS - 1;
    expect((await executor.conferirProximo()).tipo).toBe('em_espera');

    // A conferência incompleta só volta à fila depois de doze horas.
    agora += 12 * 60 * 60 * 1000;
    expect((await executor.conferirProximo()).tipo).toBe('conferido');
    agora += ESPERA_INICIAL_POR_RECUSA_MS;
    expect((await executor.conferirProximo()).tipo).toBe('em_espera');
    agora += ESPERA_INICIAL_POR_RECUSA_MS;
    expect((await executor.conferirProximo()).tipo).not.toBe('em_espera');
  });

  it('a tarefa só trabalha quando confere', async () => {
    await repo.criar({ nome: 'Acme', fonte: 'manual' });
    const tarefa = tarefaDeConferencia(
      new ExecutorDeConferencia(repo, (f) => conferenciaFalsa('nada', agora)(f), relogio),
    );
    expect((await tarefa.executar()).ocioso).toBe(false);
    expect((await tarefa.executar()).ocioso).toBe(true);
  });
});
