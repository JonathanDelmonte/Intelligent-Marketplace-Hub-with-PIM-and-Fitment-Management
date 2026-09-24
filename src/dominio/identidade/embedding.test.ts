/**
 * Testes do embedding em lote (5.2).
 *
 * A parte pura prova que completar o vetor com zeros não muda a distância de cosseno —
 * é a premissa que deixa um modelo gratuito de 1024 dimensões morar num índice de 1536.
 * A parte de banco prova o lote, a cópia por texto igual, a recusa de vetor inválido e,
 * de ponta a ponta pelo poller, dois produtos sem código de peça que só a vizinhança de
 * vetor aproxima, julgados num pedido só.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { embedding, parIdentidade, produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  resolvedorDePerfilDeTeste,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { Fila } from '@/infra/fila/fila';
import {
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type PedidoDeEmbedding,
  type RespostaDeEmbedding,
  type RespostaDoModelo,
} from '@/infra/llm';
import { drenar, montarNucleoCom, tarefaCompleta } from '@/infra/montagem';
import { GeradorDeEmbeddings, noTamanhoDoIndice } from './embedding';
import { ExecutorDeEmbedding } from './tarefa-de-embedding';
import { DIMENSAO_EMBEDDING, EmbeddingInvalido } from './vizinhos';

function cosseno(a: readonly number[], b: readonly number[]): number {
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    produto += x * y;
    normaA += x * x;
    normaB += y * y;
  }
  return produto / Math.sqrt(normaA * normaB);
}

/** Um vetor de 1024 dimensões, perto do eixo 0, com um desvio que o teste escolhe. */
function vetor1024(desvio: number): number[] {
  const v = new Array<number>(1024).fill(0);
  v[0] = 1;
  v[1] = desvio;
  v[1023] = 0.1;
  return v;
}

describe('noTamanhoDoIndice', () => {
  it('completa com zeros até o tamanho do índice, sem mudar a distância de cosseno', () => {
    const a = vetor1024(0.2);
    const b = vetor1024(0.7);
    const aCompleto = noTamanhoDoIndice(a);
    expect(aCompleto).toHaveLength(DIMENSAO_EMBEDDING);
    expect(cosseno(aCompleto, noTamanhoDoIndice(b))).toBeCloseTo(cosseno(a, b), 12);
  });

  it('maior que o índice é recusado: cortar mudaria a distância', () => {
    expect(() => noTamanhoDoIndice(new Array<number>(DIMENSAO_EMBEDDING + 1).fill(0.1))).toThrow(
      EmbeddingInvalido,
    );
  });

  it('vetor todo zero é recusado: a distância de cosseno seria indefinida', () => {
    expect(() => noTamanhoDoIndice(new Array<number>(1024).fill(0))).toThrow(EmbeddingInvalido);
  });
});

const esquemaDoPedidoDeJulgamento = z.object({
  pares: z.array(z.object({ id: z.string() })),
});

/**
 * Um provedor falso com embedding: o vetor sai do texto — tudo que fala de Electrolux
 * fica perto —, e o julgamento diz "mesmo" para todo par.
 */
class ProvedorFalso implements Chamador {
  readonly nome = 'falso';
  textosPedidos: string[][] = [];
  julgamentos = 0;
  vetorInvalidoPara: string | null = null;

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    // Este provedor não extrai: a extração fica esperando, e o teste é do vetor.
    if (pedido.proposito === 'extracao') throw new Error('este provedor falso não extrai');
    this.julgamentos += 1;
    const pares = esquemaDoPedidoDeJulgamento.parse(pedido.entrada).pares;
    return await Promise.resolve({
      saida: {
        julgamentos: pares.map((par) => ({
          id: par.id,
          mesmoProduto: true,
          certeza: 'alta',
          justificativa: 'mesmo refil, nomes de catálogo diferentes',
        })),
      },
    });
  }

  async embeddings(pedido: PedidoDeEmbedding): Promise<RespostaDeEmbedding> {
    this.textosPedidos.push([...pedido.textos]);
    return await Promise.resolve({
      vetores: pedido.textos.map((texto) =>
        texto === this.vetorInvalidoPara
          ? new Array<number>(1024).fill(0)
          : vetor1024(texto.includes('electrolux') ? texto.length / 1000 : 5),
      ),
    });
  }
}

describe.skipIf(!temBancoDeTeste())('GeradorDeEmbeddings', () => {
  let conexao: ConexaoDeTeste;
  let provedor: ProvedorFalso;
  const MODELO = 'embedding-de-teste';

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    provedor = new ProvedorFalso();
    await limparTabelas(conexao.db, [
      'job',
      'par_identidade',
      'exemplo_identidade',
      'llm_call',
      'embedding',
      'preco_historico',
      'produto_externo',
    ]);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  function gerador(): GeradorDeEmbeddings {
    return new GeradorDeEmbeddings(conexao.db, {
      llm: new ServicoDeLlm(conexao.db, provedor, new Orcamento(1_000, 10)),
      modelo: MODELO,
    });
  }

  let sequencia = 0;
  async function produto(forma: string | null): Promise<string> {
    sequencia += 1;
    const [linha] = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: `Produto ${String(sequencia)}`,
        hashConteudo: `e-${String(sequencia)}`,
        formaCanonica: forma,
        fonte: 'm1_planilha',
        coletadoEm: new Date(),
        criadoEm: new Date(Date.UTC(2026, 8, 24, 10, 0, sequencia)),
      })
      .returning({ id: produtoExterno.id });
    return linha?.id ?? '';
  }

  async function vetores(): Promise<number> {
    return (await conexao.db.select({ id: embedding.id }).from(embedding)).length;
  }

  it('um pedido para o lote, e forma canônica repetida vai uma vez só', async () => {
    await produto('refil de filtro electrolux');
    await produto('refil de filtro electrolux');
    await produto('vedacao electrolux vd10');
    // Sem forma canônica, ou vazia: não há de onde tirar vetor.
    await produto(null);
    await produto('');

    const resultado = await gerador().gerarLote();

    expect(provedor.textosPedidos).toEqual([
      ['refil de filtro electrolux', 'vedacao electrolux vd10'],
    ]);
    expect(resultado).toMatchObject({
      tipo: 'lote',
      selecionados: 3,
      enviados: 2,
      chamada: 'feita',
    });
    expect(await vetores()).toBe(3);
    expect(await gerador().gerarLote()).toEqual({ tipo: 'nada_a_gerar' });
  });

  it('texto que já tem vetor neste modelo é copiado, sem pedir', async () => {
    await produto('refil de filtro electrolux');
    await gerador().gerarLote();

    await produto('refil de filtro electrolux');
    const resultado = await gerador().gerarLote();

    expect(provedor.textosPedidos).toHaveLength(1);
    expect(resultado).toMatchObject({ copiados: 1, enviados: 0, chamada: 'nenhuma' });
    expect(await vetores()).toBe(2);
  });

  it('vetor inválido fica marcado no produto e não volta para a fila deste modelo', async () => {
    const invalido = await produto('texto que vira zero');
    provedor.vetorInvalidoPara = 'texto que vira zero';

    const resultado = await gerador().gerarLote();

    expect(resultado).toMatchObject({ recusados: 1, gerados: [] });
    const [linha] = await conexao.db
      .select({ atributos: produtoExterno.atributosExtraidos })
      .from(produtoExterno)
      .where(eq(produtoExterno.id, invalido));
    expect(linha?.atributos).toMatchObject({ embeddingRecusado: { modelo: MODELO } });
    expect(await gerador().gerarLote()).toEqual({ tipo: 'nada_a_gerar' });
  });

  it('provedor sem embedding espera, em vez de perguntar a cada tique', async () => {
    await produto('refil de filtro electrolux');
    const soChat: Chamador = { nome: 'so-chat', chamar: () => Promise.reject(new Error('x')) };
    const executor = new ExecutorDeEmbedding(
      new Fila(conexao.db),
      () =>
        new GeradorDeEmbeddings(conexao.db, {
          llm: new ServicoDeLlm(conexao.db, soChat, new Orcamento(1_000, 10)),
          modelo: MODELO,
        }),
    );

    expect(await executor.processarLote()).toMatchObject({
      resultado: { chamada: 'nao_suportado' },
    });
    expect(await executor.processarLote()).toMatchObject({ tipo: 'em_espera' });
  });

  it('de ponta a ponta: sem código de peça, a vizinhança de vetor aproxima, e um pedido julga', async () => {
    const diretorio = await mkdtemp(join(tmpdir(), 'bancada-embedding-'));
    try {
      const nucleo = montarNucleoCom(
        conexao.db,
        diretorio,
        resolvedorDePerfilDeTeste(conexao.db, 'perfil-embedding'),
        {
          llmDeJob: () => ({
            servico: new ServicoDeLlm(conexao.db, provedor, new Orcamento(1_000, 10)),
            modeloDeJulgamento: 'julgador-de-teste',
            modeloDeExtracao: 'extrator-de-teste',
            modeloDeEmbedding: MODELO,
          }),
        },
      );

      // Marca e tipo, sem código de peça: sem chave de agrupamento, só o vetor aproxima.
      const registros = [
        { tipoProduto: 'refil de filtro', marca: 'Electrolux' },
        { tipoProduto: 'elemento filtrante', marca: 'Electrolux' },
      ];
      const ids: string[] = [];
      for (const [i, atributos] of registros.entries()) {
        const [linha] = await conexao.db
          .insert(produtoExterno)
          .values({
            tituloBruto: `${atributos.tipoProduto} ${atributos.marca}`,
            hashConteudo: `pp-${String(i)}`,
            atributosExtraidos: atributos,
            fonte: 'm1_planilha',
            coletadoEm: new Date(),
          })
          .returning({ id: produtoExterno.id });
        ids.push(linha?.id ?? '');
      }
      for (const id of ids) {
        await nucleo.fila.enfileirar({
          tipo: 'resolver_identidade',
          chaveIdempotencia: id,
          entrada: { produtoExternoId: id },
        });
      }

      await drenar(tarefaCompleta(nucleo), 40);

      const pares = await conexao.db
        .select({ decisao: parIdentidade.decisao, nivel: parIdentidade.nivel })
        .from(parIdentidade);
      expect(pares).toEqual([{ decisao: 'mesmo', nivel: 'embedding' }]);
      // Os dois vetores num pedido só.
      expect(provedor.textosPedidos).toHaveLength(1);
    } finally {
      await rm(diretorio, { recursive: true, force: true });
    }
  });
});
