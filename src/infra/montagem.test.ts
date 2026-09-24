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
 * **as duas pontas rodam a mesma composição**, e que ela alcança as quatro filas.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIPO_JOB_COMPATIBILIDADE } from '@/dominio/compatibilidade/tarefa';
import { TIPO_JOB_IDENTIDADE } from '@/dominio/identidade/tarefa';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { TIPO_JOB_INGESTAO } from '@/dominio/ingestao/orquestrador';
import { TIPO_JOB_PEDIDOS } from '@/dominio/pedidos/tarefa';
import { sku } from '@/infra/banco/schema';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  abrirBancoDeTeste,
  limparTabelas,
  resolvedorDePerfilDeTeste,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { NOME_DA_TAREFA_COMPLETA, drenar, montarNucleoCom, tarefaCompleta } from './montagem';

const NL = String.fromCharCode(10);
const EAN = '7896541200909';

/** Duas linhas com o mesmo EAN: o caso que a resolução decide sozinha. */
const CSV = [
  'Código MLB;Título;Preço (R$);EAN',
  'MLB1;Refil Filtro Purificador Electrolux PA21G;69,90;7896541200909',
  'MLB2;Elemento Filtrante p/ purificador Electrolux PA21G;64,90;7896541200909',
].join(NL);

/**
 * Planilha de **venda**, com as colunas que só existem depois de vender.
 *
 * É o caso que prova o encaminhamento: a classificação inicial vê "exportação do
 * Mercado Livre" igual à de anúncio, e só o mapeamento das colunas revela que é
 * venda.
 */
const CSV_DE_VENDAS = [
  'Código MLB;Título;Preço (R$);EAN;Data da venda;Tarifa de venda (R$);Taxa fixa;Frete;Valor líquido',
  `MLB-V1;Refil Filtro Purificador Electrolux PA21G;100,00;${EAN};14/09/2026;12,00;6,00;20,00;62,00`,
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
      'pedido',
      'anuncio',
      'sku',
      'perfil_vendedor',
    ]);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('drena ingestão e identidade numa passada, que é o que o botão da tela faz', async () => {
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
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

  it('a composição declara as tarefas, na ordem de prioridade', () => {
    // A ordem é a da prioridade, e o prospector é o último de propósito: é o único que
    // gasta dinheiro por passo, e fila de dado novo não espera investigação.
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
    expect(tarefaCompleta(nucleo).nome).toBe(NOME_DA_TAREFA_COMPLETA);
    expect(NOME_DA_TAREFA_COMPLETA).toBe(
      'ingestao+extracao+embedding+identidade+compatibilidade+pedidos+monitor+conferencia+prospector',
    );
  });

  it('o prospector monta com os investigadores da instalação', () => {
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
    // A tela lê daqui o que dá para investigar hoje, e é por isso que a montagem é o
    // lugar: a lista de ferramentas prontas não pode ser escrita à mão em dois lugares.
    expect(nucleo.prospector.ferramentas).toEqual(['base_local']);
  });

  it('drena também a fila de compatibilidade', async () => {
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
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
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
    expect(await drenar(tarefaCompleta(nucleo), 5)).toBe(0);
  });

  it('planilha de venda é encaminhada e vira pedido com margem realizada', async () => {
    // A cadeia inteira numa passada: a ingestão lê o cabeçalho, descobre que é
    // venda, encaminha, e o executor de pedido grava com a margem.
    const resolver = resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem');
    const nucleo = montarNucleoCom(conexao.db, diretorio, resolver);

    const perfil = await resolver();
    await conexao.db.insert(sku).values({
      perfilId: perfil,
      tituloInterno: 'Refil PA21G',
      ean: EAN,
      custoAtual: reaisParaCentavos(30),
    });

    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'vendas_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV_DE_VENDAS),
    });

    await drenar(tarefaCompleta(nucleo), 20);

    const jobs = await nucleo.fila.ultimos();
    expect(jobs.some((j) => j.tipo === TIPO_JOB_PEDIDOS)).toBe(true);
    expect(jobs.every((j) => j.status === 'concluido')).toBe(true);

    const resumo = await nucleo.pedidos.resumo(perfil);
    expect(resumo.pedidos).toBe(1);
    expect(resumo.semSku).toBe(0);
    // R$ 62 de repasse menos R$ 30 de custo.
    expect(resumo.margemTotal).toBe(reaisParaCentavos(32));
  });

  it('planilha de anúncio continua gravando ocorrência, não pedido', async () => {
    const resolver = resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem');
    const nucleo = montarNucleoCom(conexao.db, diretorio, resolver);
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });

    await drenar(tarefaCompleta(nucleo), 20);

    const jobs = await nucleo.fila.ultimos();
    expect(jobs.some((j) => j.tipo === TIPO_JOB_PEDIDOS)).toBe(false);
    expect((await nucleo.pedidos.resumo(await resolver())).pedidos).toBe(0);
  });

  it('respeita o teto, porque isso roda dentro de uma requisição', async () => {
    const nucleo = montarNucleoCom(
      conexao.db,
      diretorio,
      resolvedorDePerfilDeTeste(conexao.db, 'perfil-montagem'),
    );
    await nucleo.orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'anuncios_mercadolivre.csv' },
      conteudo: new TextEncoder().encode(CSV),
    });
    expect(await drenar(tarefaCompleta(nucleo), 1)).toBe(1);
  });
});
