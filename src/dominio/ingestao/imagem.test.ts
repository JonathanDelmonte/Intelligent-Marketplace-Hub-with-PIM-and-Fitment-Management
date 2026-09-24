/**
 * Imagem de tabela (3.6): o tipo pela assinatura, o leitor com um modelo falso, e o print
 * enviado virando um produto por linha — contra Postgres e disco de verdade.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import {
  ChamadorAusente,
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from '@/infra/llm';
import { ExecutorDeIngestao } from './executor';
import { leitorDeImagemCom, tipoDaImagem } from './imagem';
import { Orquestrador } from './orquestrador';
import { IngestorDeProdutoExterno } from './produto-externo';

/** Os primeiros bytes de cada formato, e o resto é enchimento. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

describe('tipoDaImagem', () => {
  it('reconhece pela assinatura, e não pelo nome', () => {
    expect(tipoDaImagem(PNG)).toBe('image/png');
    expect(tipoDaImagem(JPEG)).toBe('image/jpeg');
    expect(tipoDaImagem(WEBP)).toBe('image/webp');
    expect(tipoDaImagem(new TextEncoder().encode('GIF89a...'))).toBe('image/gif');
    expect(tipoDaImagem(HEIC)).toBeNull();
    expect(tipoDaImagem(new Uint8Array([]))).toBeNull();
  });
});

/** Transcreve sempre a mesma tabela, como se lesse o print. */
class ModeloQueLe implements Chamador {
  readonly nome = 'falso';
  pedidos: PedidoAoModelo[] = [];
  constructor(private readonly responder: () => RespostaDoModelo = transcricao) {}
  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.pedidos.push(pedido);
    return await Promise.resolve(this.responder());
  }
}

function transcricao(): RespostaDoModelo {
  return {
    saida: {
      linhas: [
        'Bom dia! Segue a tabela 👇',
        'Refil PA21G ..... R$ 38,00',
        'Refil PE11B ..... R$ 42,50',
        'Pagamento à vista ou 30 dias',
      ],
    },
  };
}

describe.skipIf(!temBancoDeTeste())('leitura de imagem de tabela', () => {
  let conexao: ConexaoDeTeste;
  let diretorio: string;
  let fila: Fila;
  let orquestrador: Orquestrador;

  const servico = (chamador: Chamador) =>
    new ServicoDeLlm(conexao.db, chamador, new Orcamento(1_000, 10));

  function executor(modelo: Chamador | null): ExecutorDeIngestao {
    return new ExecutorDeIngestao(
      fila,
      new ArmazenamentoDeConteudo(diretorio),
      new IngestorDeProdutoExterno(conexao.db),
      orquestrador,
      null,
      () => new Date('2026-09-24T12:00:00Z'),
      modelo === null ? null : leitorDeImagemCom(servico(modelo), 'modelo-com-visao'),
    );
  }

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    diretorio = await mkdtemp(join(tmpdir(), 'bancada-imagem-'));
    fila = new Fila(conexao.db);
    orquestrador = new Orquestrador(fila, new ArmazenamentoDeConteudo(diretorio));
    await limparTabelas(conexao.db, ['job', 'produto_externo', 'preco_historico', 'llm_call']);
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const enviarPrint = () =>
    orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'WhatsApp Image.jpeg', tipoMime: 'image/jpeg' },
      conteudo: JPEG,
    });

  it('o print vira um produto por linha; saudação e pagamento ficam de fora', async () => {
    const modelo = new ModeloQueLe();
    await enviarPrint();

    const processado = await executor(modelo).processarProximo();

    expect(processado).toMatchObject({ tipo: 'concluido', contagem: { gravados: 2 } });
    const linhas = await conexao.db
      .select({ titulo: produtoExterno.tituloBruto, preco: produtoExterno.preco })
      .from(produtoExterno)
      .orderBy(produtoExterno.tituloBruto);
    expect(linhas.map((l) => l.titulo)).toEqual(['Refil PA21G', 'Refil PE11B']);
    // A imagem foi como data URL, do tipo certo pela assinatura.
    expect(modelo.pedidos[0]?.imagens?.[0]?.tipo).toBe('image/jpeg');
  });

  it('sem chave, a imagem fica guardada em revisão dizendo o que falta', async () => {
    await enviarPrint();
    const semChave = await executor(new ChamadorAusente()).processarProximo();
    expect(semChave.tipo === 'pendente_revisao' && semChave.motivo).toContain('LLM_API_KEY');
  });

  it('HEIC diz para mandar print, sem gastar pedido', async () => {
    const modelo = new ModeloQueLe();
    await orquestrador.receber({
      entrada: { tipo: 'arquivo', nome: 'IMG_0001.heic', tipoMime: 'image/heic' },
      conteudo: HEIC,
    });
    const r = await executor(modelo).processarProximo();
    expect(r.tipo === 'pendente_revisao' && r.motivo).toContain('HEIC');
    expect(modelo.pedidos).toHaveLength(0);
  });

  it('provedor fora reagenda o job, em vez de mandar para revisão', async () => {
    const modelo = new ModeloQueLe(() => {
      throw new Error('o OpenRouter respondeu 502');
    });
    await enviarPrint();
    const r = await executor(modelo).processarProximo();
    expect(r).toMatchObject({ tipo: 'falhou', reagendado: true });
  });

  it('a segunda tentativa leva o número na pergunta, e não repete o cache', async () => {
    const modelo = new ModeloQueLe();
    const ler = leitorDeImagemCom(servico(modelo), 'modelo-com-visao');
    await ler(PNG, 1);
    await ler(PNG, 1);
    await ler(PNG, 2);
    expect(modelo.pedidos).toHaveLength(2);
    expect(modelo.pedidos[1]?.entrada).toMatchObject({ tentativa: 2 });
  });
});
