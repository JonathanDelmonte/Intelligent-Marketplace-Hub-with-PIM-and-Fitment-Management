/**
 * Link colado e texto colado (3.2 a 3.4), de ponta a ponta contra Postgres e disco de
 * verdade — com a internet falsa, porque a daqui recusa as plataformas.
 *
 * O que se prova é o encaixe: o link que o orquestrador guardou é lido pelo executor,
 * vira `produto_externo` com preço, GTIN e marca do dado estruturado, e entra na fila de
 * identidade; a página de lista vira um job por anúncio; e a tabela colada vira um
 * produto por linha.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArmazenamentoDeConteudo } from '@/infra/armazenamento/conteudo';
import { produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { Fila } from '@/infra/fila/fila';
import { TIPO_JOB_IDENTIDADE } from '@/dominio/identidade/tarefa';
import { pdfComLinhas } from '@/infra/pdf/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { ExecutorDeIngestao } from './executor';
import { Orquestrador, MAX_TEXTO_NO_PAYLOAD, TIPO_JOB_INGESTAO } from './orquestrador';
import { IngestorDeProdutoExterno } from './produto-externo';

const ANUNCIO = 'https://produto.mercadolivre.com.br/MLB-1234567890-refil-pa21g-_JM';

function paginaDoAnuncio(preco: string): string {
  return `<html><head><title>Refil PA21G Electrolux | Mercado Livre</title>
<script type="application/ld+json">{"@type":"Product","name":"Refil Purificador Electrolux PA21G",
"brand":{"name":"Electrolux"},"gtin13":"7896541200909",
"offers":{"@type":"Offer","price":"${preco}","priceCurrency":"BRL","availability":"https://schema.org/InStock","seller":{"name":"LOJA FILTROS"}}}</script>
</head><body>Refil</body></html>`;
}

const LISTA = `<html><body>
<a href="https://produto.mercadolivre.com.br/MLB-1111111111-refil-a-_JM">Refil A</a>
<a href="https://produto.mercadolivre.com.br/MLB-1111111111-refil-a-_JM#reviews">Refil A de novo</a>
<a href="https://produto.mercadolivre.com.br/MLB-2222222222-refil-b-_JM">Refil B</a>
<a href="https://www.mercadolivre.com.br/ajuda">Ajuda</a>
<a href="/categorias">Categorias</a>
</body></html>`;

describe.skipIf(!temBancoDeTeste())('link colado e texto colado', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let fila: Fila;
  let orquestrador: Orquestrador;
  let respostas: Map<string, () => Response>;

  function executor(): ExecutorDeIngestao {
    const armazenamento = new ArmazenamentoDeConteudo(diretorio);
    const buscar: typeof fetch = (entrada) => {
      const url =
        typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      const responder = respostas.get(url);
      return Promise.resolve(
        responder === undefined ? new Response('', { status: 404 }) : responder(),
      );
    };
    return new ExecutorDeIngestao(
      fila,
      armazenamento,
      new IngestorDeProdutoExterno(conexao.db),
      orquestrador,
      { buscar },
      () => new Date('2026-09-24T12:00:00Z'),
    );
  }

  const html = (corpo: string, status = 200) =>
    new Response(corpo, { status, headers: { 'content-type': 'text/html' } });

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-link-'));
    fila = new Fila(conexao.db);
    orquestrador = new Orquestrador(fila, new ArmazenamentoDeConteudo(diretorio));
    respostas = new Map();
    await limparTabelas(conexao.db, ['job', 'produto_externo', 'preco_historico']);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('link de anúncio vira produto com preço, GTIN e marca da loja, e entra na fila de identidade', async () => {
    respostas.set(ANUNCIO, () => html(paginaDoAnuncio('69.90')));
    await orquestrador.receber({ entrada: { tipo: 'url', valor: ANUNCIO } });

    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ tipo: 'concluido', contagem: { gravados: 1 } });
    const [linha] = await conexao.db.select().from(produtoExterno);
    expect(linha).toMatchObject({
      tituloBruto: 'Refil Purificador Electrolux PA21G',
      ean: '7896541200909',
      preco: reaisParaCentavos(69.9),
      vendedor: 'LOJA FILTROS',
      fonte: 'm0_link',
      plataformaOuSite: 'ml',
      url: 'https://produto.mercadolivre.com.br/MLB-1234567890-refil-pa21g-_JM',
    });
    expect(linha?.atributosExtraidos).toMatchObject({ marca: 'Electrolux' });
    const identidade = (await fila.ultimos()).filter((j) => j.tipo === TIPO_JOB_IDENTIDADE);
    expect(identidade).toHaveLength(1);
  });

  it('colar o mesmo link de novo, com preço novo, atualiza o preço em vez de duplicar', async () => {
    respostas.set(ANUNCIO, () => html(paginaDoAnuncio('69.90')));
    await orquestrador.receber({ entrada: { tipo: 'url', valor: ANUNCIO } });
    await executor().processarProximo();

    respostas.set(ANUNCIO, () => html(paginaDoAnuncio('64.90')));
    const job = (await fila.ultimos()).find((j) => j.tipo === TIPO_JOB_INGESTAO);
    if (job === undefined) throw new Error('sem job de ingestão');
    await fila.reenfileirar(job.id);
    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ contagem: { gravados: 0, duplicados: 1 } });
    const linhas = await conexao.db.select({ preco: produtoExterno.preco }).from(produtoExterno);
    expect(linhas).toEqual([{ preco: reaisParaCentavos(64.9) }]);
  });

  it('página de lista vira um job por anúncio, sem repetir e sem menu', async () => {
    const endereco = 'https://lista.mercadolivre.com.br/refil-pa21g';
    respostas.set(endereco, () => html(LISTA));
    await orquestrador.receber({ entrada: { tipo: 'url', valor: endereco } });

    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ tipo: 'enfileirou_filhos', quantidade: 2 });
  });

  it('página que pede confirmação de robô vai para revisão, dizendo o caminho do texto', async () => {
    respostas.set(ANUNCIO, () => html('<title>Captcha</title><p>Are you a robot?</p>'));
    await orquestrador.receber({ entrada: { tipo: 'url', valor: ANUNCIO } });

    const processado = await executor().processarProximo();

    expect(processado.tipo === 'pendente_revisao' && processado.motivo).toContain('como texto');
  });

  it('site que recusa é revisão; site fora do ar é tentar de novo mais tarde', async () => {
    const recusa = 'https://produto.mercadolivre.com.br/MLB-5555555555-x';
    const fora = 'https://produto.mercadolivre.com.br/MLB-6666666666-y';
    respostas.set(recusa, () => html('', 403));
    respostas.set(fora, () => html('', 503));
    await orquestrador.receber({ entrada: { tipo: 'url', valor: recusa } });
    await orquestrador.receber({ entrada: { tipo: 'url', valor: fora } });

    const [primeiro, segundo] = await executor().processarTodos();

    expect(primeiro?.tipo).toBe('pendente_revisao');
    expect(segundo).toMatchObject({ tipo: 'falhou', reagendado: true });
  });

  it('tabela colada vira um produto por linha, com o preço, e pula o que não é produto', async () => {
    const texto = [
      'Bom dia! Segue a tabela de hoje:',
      'Refil Electrolux PA21G ....... 38,00',
      '• Refil PE11B - R$ 42,50',
      'Vedação VD-10',
      'Pagamento à vista ou 30 dias',
    ].join('\n');
    await orquestrador.receber({ entrada: { tipo: 'texto', valor: texto } });

    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ tipo: 'concluido', contagem: { gravados: 3 } });
    const linhas = await conexao.db
      .select({
        titulo: produtoExterno.tituloBruto,
        preco: produtoExterno.preco,
        fonte: produtoExterno.fonte,
      })
      .from(produtoExterno)
      .orderBy(produtoExterno.tituloBruto);
    expect(linhas).toEqual([
      { titulo: 'Refil Electrolux PA21G', preco: reaisParaCentavos(38), fonte: 'manual' },
      { titulo: 'Refil PE11B', preco: reaisParaCentavos(42.5), fonte: 'manual' },
      { titulo: 'Vedação VD-10', preco: null, fonte: 'manual' },
    ]);
  });

  it('PDF de tabela de preços, enviado como arquivo, vira um produto por linha', async () => {
    const pdf = pdfComLinhas([
      'Distribuidora Agua Pura - Tabela de precos',
      'Refil PA21G ........ 38,00',
      'Refil PE11B ........ R$ 42,50',
    ]);
    await orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'tabela-agua-pura.pdf', tipoMime: 'application/pdf' },
      conteudo: pdf,
    });

    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ tipo: 'concluido', contagem: { gravados: 2 } });
    const linhas = await conexao.db
      .select({ titulo: produtoExterno.tituloBruto, origem: produtoExterno.plataformaOuSite })
      .from(produtoExterno)
      .orderBy(produtoExterno.tituloBruto);
    expect(linhas).toEqual([
      { titulo: 'Refil PA21G', origem: 'tabela-agua-pura.pdf' },
      { titulo: 'Refil PE11B', origem: 'tabela-agua-pura.pdf' },
    ]);
  });

  it('PDF por link é baixado e lido; PDF sem texto diz que é imagem', async () => {
    respostas.set(
      'https://aguapura.com.br/tabela.pdf',
      () =>
        new Response(pdfComLinhas(['Refil PA21G - 38,00']), {
          headers: { 'content-type': 'application/pdf' },
        }),
    );
    respostas.set(
      'https://aguapura.com.br/escaneada.pdf',
      () => new Response(pdfComLinhas([]), { headers: { 'content-type': 'application/pdf' } }),
    );
    await orquestrador.receber({
      entrada: { tipo: 'url', valor: 'https://aguapura.com.br/tabela.pdf' },
    });
    await orquestrador.receber({
      entrada: { tipo: 'url', valor: 'https://aguapura.com.br/escaneada.pdf' },
    });

    const [lida, escaneada] = await executor().processarTodos();

    expect(lida).toMatchObject({ tipo: 'concluido', contagem: { gravados: 1 } });
    expect(escaneada?.tipo === 'pendente_revisao' && escaneada.motivo).toContain(
      'imagem escaneada',
    );
  });

  it('tabela longa demais para o payload é guardada e lida inteira', async () => {
    const linhas = Array.from(
      { length: 400 },
      (_, i) => `Peça modelo XK${String(1000 + i)} - ${String(10 + (i % 50))},90`,
    );
    const texto = linhas.join('\n');
    expect(texto.length).toBeGreaterThan(MAX_TEXTO_NO_PAYLOAD);
    await orquestrador.receber({ entrada: { tipo: 'texto', valor: texto } });

    const processado = await executor().processarProximo();

    expect(processado).toMatchObject({ contagem: { gravados: 400 } });
    const [uma] = await conexao.db
      .select({ preco: produtoExterno.preco })
      .from(produtoExterno)
      .where(eq(produtoExterno.tituloBruto, 'Peça modelo XK1000'));
    expect(uma?.preco).toBe(reaisParaCentavos(10.9));
  });
});
