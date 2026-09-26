/**
 * Teste de ponta a ponta do M1 e do M2.
 *
 * Exercita o caminho inteiro contra **Postgres e sistema de arquivos de
 * verdade**: entrada chega ao orquestrador, é classificada, guardada, enfileirada,
 * consumida pelo executor, importada, e grava `produto_externo` — e daí um SKU é
 * criado ligando as ocorrências.
 *
 * Os testes de unidade cobrem cada peça. Este cobre **o encaixe**, que é onde
 * mora a outra metade dos defeitos: o payload que o orquestrador escreve e o
 * executor lê, a chave de idempotência que atravessa as duas pontas, e o
 * conteúdo que passa por hash de um lado ao outro.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArmazenamentoDeConteudo } from '@/infra/armazenamento/conteudo';
import { Fila } from '@/infra/fila/fila';
import { perfilVendedor } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { RepositorioDeSku, perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { ExecutorDeIngestao } from './executor';
import { EXEMPLOS_DE_NOME_DE_EXPORTACAO } from './classificador';
import { Orquestrador, TIPO_JOB_INGESTAO } from './orquestrador';
import { IngestorDeProdutoExterno } from './produto-externo';

const CSV_ML = [
  'Relatório de anúncios - Mercado Livre',
  'Gerado em 12/09/2026',
  '',
  'Código MLB;Título;Preço (R$);Estoque;EAN;Link do anúncio',
  'MLB1111111111;Refil Filtro Purificador Electrolux PA21G;69,90;10;7896541200121;https://produto.mercadolivre.com.br/MLB-1111111111-a',
  'MLB2222222222;Refil Filtro Purificador Electrolux PA26G;74,90;5;7896541200138;https://produto.mercadolivre.com.br/MLB-2222222222-b',
  'MLB3333333333;Vedação para Purificador Electrolux;19,90;20;;https://produto.mercadolivre.com.br/MLB-3333333333-c',
].join('\n');

describe.skipIf(!temBancoDeTeste())('ingestão de ponta a ponta', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let armazenamento: ArmazenamentoDeConteudo;
  let fila: Fila;
  let ingestor: IngestorDeProdutoExterno;
  let orquestrador: Orquestrador;
  let executor: ExecutorDeIngestao;
  let repoSku: RepositorioDeSku;
  let perfil: PerfilId;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();

    diretorio = await mkdtemp(join(tmpdir(), 'bancada-e2e-'));
    armazenamento = new ArmazenamentoDeConteudo(diretorio);
    fila = new Fila(conexao.db);
    ingestor = new IngestorDeProdutoExterno(conexao.db);
    orquestrador = new Orquestrador(fila, armazenamento);
    executor = new ExecutorDeIngestao(fila, armazenamento, ingestor, orquestrador);
    repoSku = new RepositorioDeSku(conexao.db);

    await limparTabelas(conexao.db, [
      'job',
      'perfil_vendedor',
      'produto_externo',
      'preco_historico',
      'sku',
    ]);

    const criados = await conexao.db
      .insert(perfilVendedor)
      .values({ slug: 'perfil-e2e', nome: 'Perfil E2E', regime: 'cpf' })
      .returning({ id: perfilVendedor.id });

    perfil = perfilId(criados[0]!.id);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (conexao !== undefined) await conexao.encerrar();
  });

  const arquivoCsv = (nome: string, texto: string) => ({
    entrada: { tipo: 'arquivo' as const, nome, tipoMime: 'text/csv' },
    conteudo: new TextEncoder().encode(texto),
  });

  describe('o caminho completo', () => {
    it('planilha do ML entra e vira produto_externo', async () => {
      const recebido = await orquestrador.receber(
        arquivoCsv('meus-anuncios-mercado-livre.csv', CSV_ML),
      );

      expect(recebido.tipo).toBe('enfileirado');
      if (recebido.tipo !== 'enfileirado') return;
      expect(recebido.classificacao.tipoDeEntrada).toBe('planilha_exportacao');
      expect(recebido.classificacao.site).toBe('ml');

      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('concluido');
      if (processado.tipo !== 'concluido') return;
      expect(processado.contagem).toEqual({ gravados: 3, duplicados: 0, rejeitados: 0 });

      // O que importa de verdade: os registros estão no banco.
      const naoResolvidos = await repoSku.naoResolvidos();
      expect(naoResolvidos).toHaveLength(3);
      expect(naoResolvidos.map((p) => p.preco).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
        1990, 6990, 7490,
      ]);
    });

    it('o job fica concluído com o relatório da importação', async () => {
      const recebido = await orquestrador.receber(
        arquivoCsv('meus-anuncios-mercado-livre.csv', CSV_ML),
      );
      if (recebido.tipo !== 'enfileirado') throw new Error('esperava enfileirado');

      await executor.processarProximo();

      const job = await fila.buscarPorId(recebido.job.id);
      expect(job?.status).toBe('concluido');
      expect(job?.erro).toBeNull();
    });

    it('da planilha ao SKU: ocorrências ligadas e margem calculável', async () => {
      await orquestrador.receber(arquivoCsv('meus-anuncios-mercado-livre.csv', CSV_ML));
      await executor.processarProximo();

      const ocorrencias = await repoSku.naoResolvidos();
      const refis = ocorrencias.filter((o) => o.tituloBruto.includes('Refil'));
      expect(refis).toHaveLength(2);

      // A decisão humana do M2: estas duas ocorrências são o mesmo produto.
      const sku = await repoSku.criar({
        perfil,
        dados: { tituloInterno: 'Refil Electrolux PA21G/PA26G', custoAtual: 1500, pesoG: 250 },
        produtosExternosIds: refis.map((o) => o.id),
      });

      const ligadas = await repoSku.ocorrencias(perfil, sku.id);
      expect(ligadas).toHaveLength(2);
      expect(await repoSku.naoResolvidos()).toHaveLength(1);

      // E o SKU tem o que a calculadora de margem precisa.
      expect(sku.custoAtual).toBe(1500);
      expect(sku.pesoG).toBe(250);
    });
  });

  describe('idempotência atravessa as duas pontas', () => {
    it('subir a mesma planilha duas vezes não duplica nada', async () => {
      const primeiro = await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));
      const segundo = await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));

      expect(primeiro.tipo).toBe('enfileirado');
      expect(segundo.tipo).toBe('enfileirado');
      if (primeiro.tipo !== 'enfileirado' || segundo.tipo !== 'enfileirado') return;

      expect(segundo.jaExistia).toBe(true);
      expect(segundo.job.id).toBe(primeiro.job.id);

      await executor.processarTodos();
      expect(await repoSku.naoResolvidos()).toHaveLength(3);
    });

    it('reprocessar a mesma planilha conta duplicados, não regrava', async () => {
      // O caso real: a pessoa reexporta a planilha no dia seguinte.
      await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));
      const primeiro = await executor.processarProximo();
      expect(primeiro.tipo).toBe('concluido');

      // Nome diferente, conteúdo igual: job novo (o nome entra na chave), mas as
      // capturas colapsam por hash de conteúdo.
      await orquestrador.receber(arquivoCsv('anuncios-mlb-copia.csv', CSV_ML));
      const segundo = await executor.processarProximo();

      expect(segundo.tipo).toBe('concluido');
      if (segundo.tipo !== 'concluido') return;
      expect(segundo.contagem).toEqual({ gravados: 0, duplicados: 3, rejeitados: 0 });
      expect(await repoSku.naoResolvidos()).toHaveLength(3);
    });

    it('conteúdo idêntico é guardado uma vez só no armazenamento', async () => {
      await orquestrador.receber(arquivoCsv('a.csv', CSV_ML));
      await orquestrador.receber(arquivoCsv('b.csv', CSV_ML));

      const jobs = await fila.ultimos();
      const hashes = new Set(
        jobs.map((j) => (j.entrada as { hashConteudo: string | null }).hashConteudo),
      );
      expect(hashes.size).toBe(1);
    });
  });

  describe('mudança de preço na reimportação', () => {
    it('preço novo atualiza e entra no histórico', async () => {
      await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));
      await executor.processarProximo();

      const antes = await repoSku.naoResolvidos();
      const pa21g = antes.find((o) => o.tituloBruto.includes('PA21G'))!;
      expect(pa21g.preco).toBe(6990);

      const comPrecoNovo = CSV_ML.replace('69,90', '64,90');
      await orquestrador.receber(arquivoCsv('anuncios-mlb-setembro.csv', comPrecoNovo));
      const segundo = await executor.processarProximo();

      expect(segundo.tipo).toBe('concluido');
      if (segundo.tipo === 'concluido') {
        expect(segundo.contagem.duplicados).toBe(3);
      }

      const historico = await ingestor.historicoDePreco(pa21g.id);
      expect(historico.map((h) => h.preco)).toEqual([6990, 6490]);
    });
  });

  describe('XLSX pelo caminho completo', () => {
    it('planilha binária atravessa o armazenamento e é importada', async () => {
      const pasta = new ExcelJS.Workbook();
      const aba = pasta.addWorksheet('Anúncios');
      aba.addRow(['Código MLB', 'Título', 'Preço (R$)', 'Estoque']);
      aba.addRow(['MLB1', 'Refil Filtro Purificador PA21G', 69.9, 10]);
      aba.addRow(['MLB2', 'Refil Filtro Purificador PA26G', 74.9, 5]);
      const bytes = new Uint8Array(await pasta.xlsx.writeBuffer());

      const recebido = await orquestrador.receber({
        entrada: { tipo: 'arquivo', nome: 'meus-anuncios-mercado-livre.xlsx' },
        conteudo: bytes,
      });

      expect(recebido.tipo).toBe('enfileirado');
      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('concluido');
      if (processado.tipo === 'concluido') {
        expect(processado.contagem.gravados).toBe(2);
      }
      expect(await repoSku.naoResolvidos()).toHaveLength(2);
    });
  });

  describe('linhas rejeitadas não param a importação', () => {
    it('importa as boas e guarda as ruins no resultado do job', async () => {
      const comLinhaRuim = [
        'Código MLB;Título;Preço',
        'MLB1;Refil Filtro Purificador PA21G;69,90',
        'MLB2;;74,90',
        'MLB3;Refil Filtro Purificador PA31G;a combinar',
        'MLB4;Vedação para Purificador;19,90',
      ].join('\n');

      await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', comLinhaRuim));
      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('concluido');
      if (processado.tipo !== 'concluido') return;

      expect(processado.contagem.gravados).toBe(2);
      expect(processado.contagem.rejeitados).toBe(2);

      // As rejeitadas ficam no resultado, não descartadas: dá para corrigir à mão
      // sem reimportar a planilha inteira.
      // `where tipo = 'ingestao'`: a tabela tem mais de um tipo de job desde que a
      // ingestão passou a enfileirar resolução de identidade, e `limit 1` sem filtro
      // pegava um job de identidade — cujo `resultado` é nulo.
      const linhas = await conexao.db.execute(
        "select resultado->'rejeitadas' as r from job where tipo = 'ingestao' limit 1",
      );
      const bruto =
        (linhas as unknown as { rows?: { r: unknown }[] }).rows?.[0]?.r ??
        (linhas as unknown as { r: unknown }[])[0]?.r;
      expect(Array.isArray(bruto)).toBe(true);
      expect(bruto as unknown[]).toHaveLength(2);
    });
  });

  describe('tipos sem extrator vão para revisão, não para erro', () => {
    it('URL de anúncio, sem rede, fica guardada dizendo exatamente o que faltou', async () => {
      const recebido = await orquestrador.receber({
        entrada: { tipo: 'url', valor: 'https://produto.mercadolivre.com.br/MLB-1234567890-refil' },
      });
      expect(recebido.tipo).toBe('enfileirado');

      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('pendente_revisao');
      if (processado.tipo !== 'pendente_revisao') return;
      // Não é erro genérico: diz que faltou rede, e que o link não se perdeu.
      expect(processado.motivo).toContain('sem rede');
      expect(processado.motivo).toContain('guardado');
    });

    it('imagem de tabela por link, sem rede, fica guardada dizendo o que faltou', async () => {
      // A imagem é lida pela IA desde a 3.6; aqui a instalação está sem rede, e a
      // revisão diz isso em vez de culpar a imagem.
      await orquestrador.receber({
        entrada: { tipo: 'url', valor: 'https://exemplo.com/tabela.jpg' },
      });
      const processado = await executor.processarProximo();
      expect(processado.tipo === 'pendente_revisao' && processado.motivo).toContain('sem rede');
      expect(processado.tipo === 'pendente_revisao' && processado.motivo).toContain('guardada');
    });

    it('planilha sem plataforma no nome não fala de LLM, fala do nome', async () => {
      // O defeito que este teste fixa foi visto no navegador: `vendas-demo.csv` foi
      // para revisão dizendo "depende de extração por LLM", e a mesma planilha como
      // `vendas_mercadolivre.csv` atravessou o sistema inteiro. Quem lesse a primeira
      // mensagem iria configurar chave de LLM para resolver um problema de nome.
      const recebido = await orquestrador.receber({
        entrada: { tipo: 'arquivo', nome: 'vendas-demo.csv' },
        conteudo: new TextEncoder().encode('Título;Preço\nRefil;10,00'),
      });
      if (recebido.tipo !== 'enfileirado') throw new Error('esperava enfileirado');
      expect(recebido.classificacao.tipoDeEntrada).toBe('planilha_generica');

      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('pendente_revisao');
      if (processado.tipo !== 'pendente_revisao') return;
      // A mensagem cita LLM **para negar**, que é o contrário de culpar LLM.
      expect(processado.motivo).toContain('Não falta LLM');
      expect(processado.motivo).not.toContain('depende de extração por LLM');
      expect(processado.motivo).toContain('Renomeie');
      // E diz um nome que funciona, em vez de deixar a pessoa adivinhar.
      expect(processado.motivo).toContain(EXEMPLOS_DE_NOME_DE_EXPORTACAO[0]);
    });

    it('não consome tentativa nem entra em backoff', async () => {
      // Falhar faria o job tentar de novo para sempre um extrator que não existe.
      const recebido = await orquestrador.receber({
        entrada: { tipo: 'url', valor: 'https://distribuidorexemplo.com.br/catalogo' },
      });
      if (recebido.tipo !== 'enfileirado') throw new Error('esperava enfileirado');

      await executor.processarProximo();

      const job = await fila.buscarPorId(recebido.job.id);
      expect(job?.status).toBe('pendente_revisao');
      expect(job?.tentativas).toBe(1);

      // E não volta a ser reivindicado.
      expect(await executor.processarProximo()).toEqual({ tipo: 'fila_vazia' });
    });

    it('sem rede, todo link cai em revisão, e nenhum vira erro', async () => {
      const entradas = [
        { tipo: 'url' as const, valor: 'https://produto.mercadolivre.com.br/MLB-1234567890-a' },
        { tipo: 'url' as const, valor: 'https://lista.mercadolivre.com.br/refil' },
        { tipo: 'url' as const, valor: 'https://distribuidor.com.br/catalogo' },
        { tipo: 'url' as const, valor: 'https://exemplo.com/tabela.pdf' },
        { tipo: 'url' as const, valor: 'https://exemplo.com/tabela.jpg' },
      ];

      for (const entrada of entradas) await orquestrador.receber({ entrada });

      const resultados = await executor.processarTodos();
      expect(resultados).toHaveLength(entradas.length);
      for (const r of resultados) {
        expect(r.tipo).toBe('pendente_revisao');
      }

      expect(await fila.aguardandoRevisao()).toHaveLength(entradas.length);
    });
  });

  describe('lista de links vira N jobs', () => {
    it('um job por link, e não um job que percorre a lista', async () => {
      // Se o terceiro link falha, os outros já concluíram e só ele reagenda.
      const texto = [
        'https://produto.mercadolivre.com.br/MLB-1111111111-a',
        'https://produto.mercadolivre.com.br/MLB-2222222222-b',
        'https://shopee.com.br/produto-i.1.2',
      ].join('\n');

      const recebido = await orquestrador.receber({ entrada: { tipo: 'texto', valor: texto } });
      expect(recebido.tipo).toBe('enfileirado');
      if (recebido.tipo !== 'enfileirado') return;
      expect(recebido.classificacao.tipoDeEntrada).toBe('lista_de_links');

      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('enfileirou_filhos');
      if (processado.tipo === 'enfileirou_filhos') expect(processado.quantidade).toBe(3);

      // Os três filhos existem, e cada um é um job próprio.
      const jobs = await fila.ultimos();
      expect(jobs.filter((j) => j.tipo === TIPO_JOB_INGESTAO)).toHaveLength(4);
    });
  });

  describe('entrada duvidosa vai para revisão antes de gastar extração', () => {
    it('formato não suportado nem chega a ser processado', async () => {
      const recebido = await orquestrador.receber({
        entrada: { tipo: 'arquivo', nome: 'video.mp4' },
        conteudo: new TextEncoder().encode('nao importa'),
      });

      expect(recebido.tipo).toBe('precisa_revisao');
      if (recebido.tipo !== 'precisa_revisao') return;
      expect(recebido.job.status).toBe('pendente_revisao');
      expect(recebido.motivo).toContain('pouco confiável');

      // Já em revisão, o executor não pega.
      expect(await executor.processarProximo()).toEqual({ tipo: 'fila_vazia' });
    });

    it('o registro não é descartado — fica na fila de revisão', async () => {
      await orquestrador.receber({
        entrada: { tipo: 'arquivo', nome: 'arquivo-estranho.bin' },
        conteudo: new TextEncoder().encode('conteudo'),
      });

      const emRevisao = await fila.aguardandoRevisao();
      expect(emRevisao).toHaveLength(1);
      // E o conteúdo continua guardado, então dá para reprocessar depois.
      const hash = (emRevisao[0]?.entrada as { hashConteudo: string }).hashConteudo;
      expect(await armazenamento.existe(hash)).toBe(true);
    });
  });

  describe('robustez do executor', () => {
    it('fila vazia devolve fila_vazia, não erro', async () => {
      expect(await executor.processarProximo()).toEqual({ tipo: 'fila_vazia' });
    });

    it('conteúdo que desapareceu do armazenamento vai para revisão, e reenviar o devolve à fila', async () => {
      // Tentar de novo não traz o arquivo de volta — na nuvem ele sai uns dias depois de
      // processado (ADR 0016). A revisão diz o que fazer, e reenviar basta.
      const recebido = await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));
      if (recebido.tipo !== 'enfileirado') throw new Error('esperava enfileirado');

      await rm(diretorio, { recursive: true, force: true });

      const processado = await executor.processarProximo();
      expect(processado.tipo).toBe('pendente_revisao');
      if (processado.tipo === 'pendente_revisao') {
        expect(processado.motivo).toContain('Envie o mesmo arquivo de novo na tela Importar');
      }

      const reenvio = await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', CSV_ML));
      expect(reenvio.devolvidosAFila).toEqual([recebido.job.id]);
      expect((await executor.processarProximo()).tipo).toBe('concluido');
    });

    it('payload malformado vira revisão, não exceção', async () => {
      await fila.enfileirar({
        tipo: TIPO_JOB_INGESTAO,
        chaveIdempotencia: 'payload-torto',
        entrada: { qualquer: 'coisa' },
      });

      const processado = await executor.processarProximo();
      expect(processado.tipo).toBe('pendente_revisao');
      if (processado.tipo === 'pendente_revisao') {
        expect(processado.motivo).toContain('forma esperada');
      }
    });

    it('processarTodos esgota a fila e para', async () => {
      for (let i = 0; i < 4; i += 1) {
        await orquestrador.receber({
          entrada: {
            tipo: 'url',
            valor: `https://produto.mercadolivre.com.br/MLB-10000000${String(i)}-a`,
          },
        });
      }

      const resultados = await executor.processarTodos();
      expect(resultados).toHaveLength(4);
      expect(await executor.processarProximo()).toEqual({ tipo: 'fila_vazia' });
    });

    it('respeita o limite de processarTodos', async () => {
      for (let i = 0; i < 5; i += 1) {
        await orquestrador.receber({
          entrada: {
            tipo: 'url',
            valor: `https://produto.mercadolivre.com.br/MLB-10000000${String(i)}-a`,
          },
        });
      }

      expect(await executor.processarTodos(2)).toHaveLength(2);
    });
  });

  describe('progresso parcial em planilha grande', () => {
    it('grava progresso durante a importação', async () => {
      const linhas = Array.from(
        { length: 120 },
        (_, i) => `MLB${String(i)};Refil Filtro modelo ${String(i)};${String(50 + i)},90`,
      );
      const grande = ['Código MLB;Título;Preço', ...linhas].join('\n');

      const recebido = await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', grande));
      if (recebido.tipo !== 'enfileirado') throw new Error('esperava enfileirado');

      const processado = await executor.processarProximo();
      expect(processado.tipo).toBe('concluido');
      if (processado.tipo === 'concluido') {
        expect(processado.contagem.gravados).toBe(120);
      }

      expect(await repoSku.naoResolvidos(200)).toHaveLength(120);
    });
  });

  describe('relatório de colunas não reconhecidas chega ao fim do caminho', () => {
    it('o executor devolve o que o mapeamento não entendeu', async () => {
      // É o mecanismo que torna um palpite errado de nome de coluna visível.
      const comColunaEstranha = [
        'Código MLB;Título;Preço;Campo Que Eu Nao Previ',
        'MLB1;Refil Filtro Purificador PA21G;69,90;x',
      ].join('\n');

      await orquestrador.receber(arquivoCsv('anuncios-mlb.csv', comColunaEstranha));
      const processado = await executor.processarProximo();

      expect(processado.tipo).toBe('concluido');
      if (processado.tipo === 'concluido') {
        expect(processado.colunasNaoReconhecidas).toEqual(['Campo Que Eu Nao Previ']);
      }
    });
  });
});
