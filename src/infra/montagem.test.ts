/**
 * A tarefa composta, que é o que o sistema roda.
 *
 * Existe por causa de uma divergência que custou caro: o botão "Processar agora" da
 * tela de jobs tinha a sua própria composição e drenava **só** a fila de ingestão.
 * O efeito, relatado pelo dono do repositório: a planilha entrava, a tela dizia
 * "nada para processar", e a de identidade continuava zerada. Nenhum teste pegava,
 * porque cada fila tinha o seu teste e as duas passavam.
 *
 * Então o que este arquivo garante é a coisa que teste de unidade não garante: que
 * **as duas pontas rodam a mesma composição**, e que ela alcança as três filas.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIPO_JOB_COMPATIBILIDADE } from '@/dominio/compatibilidade/tarefa';
import { TIPO_JOB_IDENTIDADE } from '@/dominio/identidade/tarefa';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { TIPO_JOB_INGESTAO } from '@/dominio/ingestao/orquestrador';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { NOME_DA_TAREFA_COMPLETA, drenar, montarNucleoCom, tarefaCompleta } from './montagem';

const NL = String.fromCharCode(10);

/** Duas linhas com o mesmo EAN: o caso que a resolução decide sozinha. */
const CSV = [
  'Código MLB;Título;Preço (R$);EAN',
  'MLB1;Refil Filtro Purificador Electrolux PA21G;69,90;7896541200909',
  'MLB2;Elemento Filtrante p/ purificador Electrolux PA21G;64,90;7896541200909',
].join(NL);

describe.skipIf(!temBancoDeTeste())('tarefa completa', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-montagem-'));
    await limparTabelas(conexao.db, [
      'job',
      'compatibilidade',
      'aparelho',
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

  it('drena ingestão e identidade numa passada, que é o que o botão da tela faz', async () => {
    const nucleo = montarNucleoCom(conexao.db, diretorio);
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });

    const feitas = await drenar(tarefaCompleta(nucleo), 20);
    expect(feitas).toBeGreaterThanOrEqual(3);

    // A prova de que a identidade rodou: o par do mesmo GTIN está ligado.
    const contagem = await new RepositorioDePares(conexao.db).contarPorStatus();
    expect(contagem.automatico).toBe(1);

    const jobs = await nucleo.fila.ultimos();
    const tipos = new Set(jobs.map((j) => j.tipo));
    expect(tipos.has(TIPO_JOB_INGESTAO)).toBe(true);
    expect(tipos.has(TIPO_JOB_IDENTIDADE)).toBe(true);
    expect(jobs.every((j) => j.status === 'concluido')).toBe(true);
  });

  it('a composição declara as três filas, na ordem de prioridade', () => {
    const nucleo = montarNucleoCom(conexao.db, diretorio);
    expect(tarefaCompleta(nucleo).nome).toBe(NOME_DA_TAREFA_COMPLETA);
    expect(NOME_DA_TAREFA_COMPLETA).toBe('ingestao+identidade+compatibilidade');
  });

  it('drena também a fila de compatibilidade', async () => {
    const nucleo = montarNucleoCom(conexao.db, diretorio);
    await nucleo.fila.enfileirar({
      tipo: TIPO_JOB_COMPATIBILIDADE,
      entrada: { skuId: '00000000-0000-4000-8000-000000000000' },
      chaveIdempotencia: 'sku-inexistente:teste',
    });

    const feitas = await drenar(tarefaCompleta(nucleo), 5);
    expect(feitas).toBe(1);

    const jobs = await nucleo.fila.ultimos();
    expect(jobs[0]?.status).toBe('concluido');
  });

  it('fila vazia devolve zero, e a tela diz "nada para processar"', async () => {
    const nucleo = montarNucleoCom(conexao.db, diretorio);
    expect(await drenar(tarefaCompleta(nucleo), 5)).toBe(0);
  });

  it('respeita o teto, porque isso roda dentro de uma requisição', async () => {
    const nucleo = montarNucleoCom(conexao.db, diretorio);
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });
    expect(await drenar(tarefaCompleta(nucleo), 1)).toBe(1);
  });
});
