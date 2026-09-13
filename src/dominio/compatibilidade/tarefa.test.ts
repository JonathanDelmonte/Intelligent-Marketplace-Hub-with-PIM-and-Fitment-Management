/**
 * A coleta de compatibilidade rodando pelo poller, contra Postgres de verdade.
 *
 * O que este arquivo prova é que a cadeia fecha sem ninguém abrir tela: uma
 * ocorrência nova ligada a um SKU vira linha de ficha de compatibilidade. A parte
 * humana da cadeia é uma só — criar o SKU — e depois dela o grafo cresce sozinho,
 * que é a propriedade que faz o fosso ser fosso.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { perfilVendedor, produtoExterno, sku } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { Fila } from '@/infra/fila/fila';
import { Poller, type Temporizador } from '@/infra/fila/poller';
import { ColetorDeCompatibilidade } from './coletor';
import { RepositorioDeCompatibilidade } from './repositorio';
import {
  ExecutorDeCompatibilidade,
  TIPO_JOB_COMPATIBILIDADE,
  chaveDeCompatibilidade,
  enfileirarColetaDeCompatibilidade,
  tarefaDeCompatibilidade,
} from './tarefa';

const TABELAS = [
  'job',
  'compatibilidade',
  'aparelho',
  'preco_historico',
  'produto_externo',
  'sku',
  'perfil_vendedor',
] as const;

describe.skipIf(!temBancoDeTeste())('coleta de compatibilidade como tarefa de poller', () => {
  let conexao: ConexaoDeTeste;
  let fila: Fila;
  let repo: RepositorioDeCompatibilidade;
  let executor: ExecutorDeCompatibilidade;
  let perfil: PerfilId;
  let skuId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    fila = new Fila(conexao.db);
    repo = new RepositorioDeCompatibilidade(conexao.db);
    executor = new ExecutorDeCompatibilidade(fila, new ColetorDeCompatibilidade(conexao.db, repo));

    const perfis = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'compat-job', nome: 'Perfil', regime: 'mei' })
      .returning({ id: perfilVendedor.id });
    perfil = perfilId(perfis[0]?.id ?? '');

    const skus = await conexao.db
      .insert(sku)
      .values({ perfilId: perfil, tituloInterno: 'Refil de purificador' })
      .returning({ id: sku.id });
    skuId = skus[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  function pollerDeTeste(): Poller {
    const semEspera: Temporizador = (_ms, acao) => {
      const t = setTimeout(acao, 0);
      return () => {
        clearTimeout(t);
      };
    };
    return new Poller(tarefaDeCompatibilidade(executor), {
      pararQuandoOcioso: true,
      temporizador: semEspera,
      limiteDeTiques: 20,
    });
  }

  it('o mesmo gatilho repetido colapsa em um job', async () => {
    await enfileirarColetaDeCompatibilidade(fila, skuId, 'par:1');
    await enfileirarColetaDeCompatibilidade(fila, skuId, 'par:1');

    const jobs = (await fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_COMPATIBILIDADE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.chaveIdempotencia).toBe(chaveDeCompatibilidade(skuId, 'par:1'));
  });

  it('gatilho diferente enfileira de novo, senão a ficha para de crescer', async () => {
    // A primeira versão usava só o `skuId` como chave, e a fila colapsa por chave
    // para sempre: o primeiro job concluído bloqueava toda coleta futura do SKU.
    await enfileirarColetaDeCompatibilidade(fila, skuId, 'par:1');
    await executor.processarProximo();
    await enfileirarColetaDeCompatibilidade(fila, skuId, 'par:2');

    const jobs = (await fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_COMPATIBILIDADE);
    expect(jobs).toHaveLength(2);
  });

  it('o poller coleta a evidência sem ninguém abrir tela', async () => {
    const aparelho = await repo.garantirAparelho({
      tipo: 'purificador de agua',
      marca: 'Electrolux',
      modelo: 'PA21G',
      fonte: 'manual',
    });
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'Refil Filtro Purificador Electrolux PA21G Original',
      hashConteudo: 'h1',
      fonte: 'm0_link',
      url: 'https://exemplo.invalid/1',
      skuId,
    });

    await enfileirarColetaDeCompatibilidade(fila, skuId, 'teste');
    await pollerDeTeste().iniciar();

    const linhas = await repo.doSku(skuId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.aparelhoId).toBe(aparelho.id);
    expect(linhas[0]?.decisao).toBe('serve');
  });

  it('grava no job o que a coleta encontrou, para a tela de jobs mostrar', async () => {
    await repo.garantirAparelho({
      tipo: 'purificador de agua',
      marca: 'Electrolux',
      modelo: 'PA21G',
      fonte: 'manual',
    });
    await conexao.db.insert(produtoExterno).values({
      tituloBruto: 'Refil Electrolux PA21G',
      hashConteudo: 'h1',
      fonte: 'm0_link',
      skuId,
    });

    await enfileirarColetaDeCompatibilidade(fila, skuId, 'teste');
    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('concluido');

    const jobs = (await fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_COMPATIBILIDADE);
    expect(jobs[0]?.status).toBe('concluido');
    expect(jobs[0]?.resultado).toMatchObject({ skuId, anuncios: 1, evidenciasNovas: 1 });
  });

  it('fila vazia não é erro', async () => {
    expect(await executor.processarProximo()).toEqual({ tipo: 'fila_vazia' });
  });

  it('entrada inválida vai para revisão em vez de falhar em laço', async () => {
    await fila.enfileirar({
      tipo: TIPO_JOB_COMPATIBILIDADE,
      entrada: { skuId: 'não é uuid' },
      chaveIdempotencia: 'invalido',
    });

    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('pendente_revisao');

    const jobs = (await fila.ultimos()).filter((j) => j.chaveIdempotencia === 'invalido');
    expect(jobs[0]?.status).toBe('pendente_revisao');
  });

  it('SKU sem anúncio conclui sem fazer nada', async () => {
    await enfileirarColetaDeCompatibilidade(fila, skuId, 'teste');
    const resultado = await executor.processarProximo();
    expect(resultado.tipo).toBe('concluido');
    expect(await repo.doSku(skuId)).toHaveLength(0);
  });

  it('a segunda ocorrência do mesmo SKU soma evidência, e a terceira publica', async () => {
    await repo.garantirAparelho({
      tipo: 'purificador de agua',
      marca: 'Electrolux',
      modelo: 'PA21G',
      fonte: 'manual',
    });

    for (const [i, titulo] of [
      'Refil Electrolux PA21G original',
      'Refil para purificador Electrolux PA21G',
      'Refil compatível Electrolux PA21G',
    ].entries()) {
      await conexao.db.insert(produtoExterno).values({
        tituloBruto: titulo,
        hashConteudo: `h${String(i)}`,
        fonte: 'm0_link',
        url: `https://exemplo.invalid/${String(i)}`,
        skuId,
      });
      await enfileirarColetaDeCompatibilidade(fila, skuId, `anuncio:${String(i)}`);
      await pollerDeTeste().iniciar();
    }

    const estado = await repo.estado(perfil);
    expect(estado.publicaveis).toBe(1);
  });
});
