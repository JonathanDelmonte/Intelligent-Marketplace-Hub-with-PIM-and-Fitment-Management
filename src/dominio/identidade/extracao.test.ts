/**
 * Testes da extração em lote (5.1).
 *
 * A parte pura prova as regras que não dependem do modelo: o lote que encolhe, o item
 * torto que não derruba o lote, e o que o título não sustenta sendo descartado. A parte
 * de banco usa um chamador falso que responde como um modelo responderia — inclusive
 * pulando item e inventando marca — e prova o que fica gravado em cada caso.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmCall, produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { RespostaCortada } from '@/infra/llm/openrouter';
import {
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from '@/infra/llm';
import {
  ExtratorDeRegistros,
  MAX_TENTATIVAS_DE_EXTRACAO,
  conferirComOTitulo,
  esquemaDoLoteExtraido,
  lerMarcaDeExtracao,
  mesclarRegistro,
  pedidoDeExtracao,
  tamanhoDoLote,
} from './extracao';
import { REGISTRO_VAZIO, esquemaRegistroDeProduto, lerRegistro } from './registro';

const registro = (campos: Record<string, unknown>) => esquemaRegistroDeProduto.parse(campos);

describe('tamanhoDoLote', () => {
  it('metade a cada tentativa, nunca menos que um', () => {
    expect(tamanhoDoLote(0)).toBe(20);
    expect(tamanhoDoLote(1)).toBe(10);
    expect(tamanhoDoLote(2)).toBe(5);
    expect(tamanhoDoLote(9)).toBe(1);
  });
});

describe('pedidoDeExtracao', () => {
  it('id curto por posição, e os códigos que o sistema já reconheceu', () => {
    expect(
      pedidoDeExtracao(['Refil Electrolux PA21G PE11B', 'Correia de lavadora sem código']),
    ).toEqual({
      produtos: [
        { id: 'p1', titulo: 'Refil Electrolux PA21G PE11B', codigosNoTitulo: ['PA21G', 'PE11B'] },
        { id: 'p2', titulo: 'Correia de lavadora sem código' },
      ],
    });
  });
});

describe('pedidoDeExtracao na nova tentativa', () => {
  it('a tentativa entra na pergunta, e só a partir da segunda', () => {
    expect(pedidoDeExtracao(['Correia 30cm'], 0)).not.toHaveProperty('tentativa');
    expect(pedidoDeExtracao(['Correia 30cm'], 1)).toMatchObject({ tentativa: 2 });
  });
});

describe('esquemaDoLoteExtraido', () => {
  it('item torto vira recusa, e o resto do lote é aproveitado', () => {
    const lido = esquemaDoLoteExtraido.parse({
      registros: [
        { id: 'p1', marca: 'Electrolux', modeloPeca: 'EF-ELX-21' },
        { id: 'p2', quantidadeEmbalagem: 'três' },
        { id: 3, marca: 'N/A' },
      ],
    });
    expect(lido.registros[0]).toMatchObject({ tipo: 'ok', id: 'p1' });
    expect(lido.registros[1]).toMatchObject({ tipo: 'recusado', id: 'p2' });
    // Id em número é o mesmo item, e "N/A" é ausência, não marca.
    expect(lido.registros[2]).toMatchObject({ tipo: 'ok', id: 'p3', registro: { marca: null } });
  });

  it('resposta sem a lista é recusa do lote inteiro', () => {
    expect(esquemaDoLoteExtraido.safeParse({ produtos: [] }).success).toBe(false);
  });
});

describe('conferirComOTitulo', () => {
  it('marca que o título não diz é descartada: o modelo lembrou, o título não disse', () => {
    const r = conferirComOTitulo(registro({ marca: 'Electrolux' }), 'Refil para purificador PA21G');
    expect(r.registro.marca).toBeNull();
    expect(r.descartados).toEqual(['marca']);
  });

  it('código confere sem separador, e o que não está no título sai da lista', () => {
    const r = conferirComOTitulo(
      registro({ modeloPeca: 'EF-ELX-21', modelosCompativeis: ['PA21G', 'PA31G'] }),
      'Elemento filtrante ef elx 21 para PA21G',
    );
    expect(r.registro.modeloPeca).toBe('EF-ELX-21');
    expect(r.registro.modelosCompativeis).toEqual(['PA21G']);
    expect(r.descartados).toEqual(['modelosCompativeis']);
  });

  it('medida em centímetro no título sustenta a medida em milímetro', () => {
    const r = conferirComOTitulo(
      registro({ dimensoes: { comprimentoMm: 300, larguraMm: 45 } }),
      'Correia 30cm para lavadora',
    );
    expect(r.registro.dimensoes).toEqual({ comprimentoMm: 300, larguraMm: null, alturaMm: null });
    expect(r.descartados).toEqual(['dimensoes']);
  });

  it('quantidade só fica quando o título diz — com número, ou "par"', () => {
    expect(
      conferirComOTitulo(registro({ quantidadeEmbalagem: 1 }), 'Refil PA21G').registro
        .quantidadeEmbalagem,
    ).toBeNull();
    expect(
      conferirComOTitulo(registro({ quantidadeEmbalagem: 2 }), 'Kit 2 refis PA21G').registro
        .quantidadeEmbalagem,
    ).toBe(2);
    expect(
      conferirComOTitulo(registro({ quantidadeEmbalagem: 2 }), 'Par de palhetas').registro
        .quantidadeEmbalagem,
    ).toBe(2);
    // O número dentro de um código não é quantidade.
    expect(
      conferirComOTitulo(registro({ quantidadeEmbalagem: 1 }), 'Refil PE11B').registro
        .quantidadeEmbalagem,
    ).toBeNull();
  });

  it('tipo e unidade são descrição, e ficam', () => {
    const r = conferirComOTitulo(
      registro({ tipoProduto: 'refil de filtro', unidade: 'un' }),
      'Elemento filtrante PA21G',
    );
    expect(r.registro.tipoProduto).toBe('refil de filtro');
    expect(r.descartados).toEqual([]);
  });
});

describe('mesclarRegistro', () => {
  it('o que já estava ganha: a leitura de título é a origem mais fraca', () => {
    const atual = registro({ marca: 'Electrolux', modelosCompativeis: ['PA21G'] });
    const doTitulo = registro({
      marca: 'Eletrolux',
      modeloPeca: 'EF-ELX-21',
      modelosCompativeis: ['PE11B'],
    });
    expect(mesclarRegistro(atual, doTitulo)).toMatchObject({
      marca: 'Electrolux',
      modeloPeca: 'EF-ELX-21',
      modelosCompativeis: ['PA21G'],
    });
  });
});

// ─── Contra o banco ─────────────────────────────────────────────────────────

/** Responde como um modelo: pelo título de cada item, ou com o que o teste mandar. */
class ModeloFalso implements Chamador {
  readonly nome = 'falso';
  pedidos: PedidoAoModelo[] = [];
  resposta: ((pedido: PedidoAoModelo) => RespostaDoModelo) | null = null;

  constructor(private readonly porTitulo: Readonly<Record<string, Record<string, unknown>>>) {}

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.pedidos.push(pedido);
    if (this.resposta !== null) return await Promise.resolve(this.resposta(pedido));
    const lido = esquemaDoPedido.parse(pedido.entrada);
    const registros = lido.produtos.flatMap((p) => {
      const campos = this.porTitulo[p.titulo];
      return campos === undefined ? [] : [{ id: p.id, ...campos }];
    });
    return await Promise.resolve({ saida: { registros }, custoCentavos: 0 });
  }

  titulosDoUltimoPedido(): readonly string[] {
    const ultimo = this.pedidos.at(-1);
    return ultimo === undefined
      ? []
      : esquemaDoPedido.parse(ultimo.entrada).produtos.map((p) => p.titulo);
  }
}

const esquemaDoPedido = z.object({
  produtos: z.array(z.object({ id: z.string(), titulo: z.string() })),
});

const TITULO_A = 'Elemento filtrante Electrolux EF-ELX-21 para PA21G';
const TITULO_B = 'Refil purificador PA21G original pronta entrega';
const TITULO_C = 'Correia de lavadora 30cm';

describe.skipIf(!temBancoDeTeste())('ExtratorDeRegistros', () => {
  let conexao: ConexaoDeTeste;
  let modelo: ModeloFalso;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['llm_call', 'preco_historico', 'produto_externo']);
    modelo = new ModeloFalso({
      [TITULO_A]: {
        tipoProduto: 'refil de filtro',
        marca: 'Electrolux',
        modeloPeca: 'EF-ELX-21',
        modelosCompativeis: ['PA21G'],
      },
      // O modelo "lembra" a marca: o título não diz, e ela tem de sair.
      [TITULO_B]: {
        tipoProduto: 'refil de filtro',
        marca: 'Electrolux',
        modelosCompativeis: ['PA21G'],
      },
    });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  function extrator(chamador: Chamador = modelo): ExtratorDeRegistros {
    return new ExtratorDeRegistros(conexao.db, {
      llm: new ServicoDeLlm(conexao.db, chamador, new Orcamento(1_000, 10)),
      modelo: 'openrouter/free',
      agora: () => new Date('2026-09-24T12:00:00Z'),
    });
  }

  let sequencia = 0;
  async function produto(titulo: string, atributos: Record<string, unknown> | null = null) {
    sequencia += 1;
    const [linha] = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: titulo,
        hashConteudo: `hash-${String(sequencia)}`,
        atributosExtraidos: atributos,
        fonte: 'm1_planilha',
        coletadoEm: new Date(),
        criadoEm: new Date(Date.UTC(2026, 8, 24, 10, 0, sequencia)),
      })
      .returning({ id: produtoExterno.id });
    return linha?.id ?? '';
  }

  async function ler(id: string) {
    const [linha] = await conexao.db
      .select({
        atributos: produtoExterno.atributosExtraidos,
        chave: produtoExterno.chaveAgrupamento,
        forma: produtoExterno.formaCanonica,
      })
      .from(produtoExterno)
      .where(eq(produtoExterno.id, id));
    return linha;
  }

  it('um pedido para o lote: lê, confere com o título, e marca quem ficou sem resposta', async () => {
    const a = await produto(TITULO_A, { idExterno: 'MLB1' });
    const b = await produto(TITULO_B);
    const c = await produto(TITULO_C);

    const resultado = await extrator().extrairLote();

    expect(modelo.pedidos).toHaveLength(1);
    expect(resultado).toMatchObject({
      tipo: 'lote',
      selecionados: 3,
      enviados: 3,
      recusados: 0,
      paraTentarDeNovo: 1,
      descartes: 1,
      chamada: 'feita',
    });

    const linhaA = await ler(a);
    expect(linhaA?.chave).toBe('electrolux|efelx21');
    expect(linhaA?.forma).toBe('refil de filtro electrolux efelx21');
    // O que a planilha trouxe continua lá.
    expect(linhaA?.atributos).toMatchObject({ idExterno: 'MLB1', marca: 'Electrolux' });

    const linhaB = await ler(b);
    const leituraB = lerRegistro(linhaB?.atributos);
    expect(leituraB.tipo === 'ok' && leituraB.registro.marca).toBeNull();
    expect(lerMarcaDeExtracao(linhaB?.atributos)?.descartados).toEqual(['marca']);

    expect(lerMarcaDeExtracao((await ler(c))?.atributos)).toMatchObject({
      estado: 'tentar_de_novo',
      tentativas: 1,
    });
  });

  it('quem ficou sem resposta volta sozinho, num lote menor, e desiste na terceira', async () => {
    const c = await produto(TITULO_C);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_DE_EXTRACAO; tentativa += 1) {
      await extrator().extrairLote();
    }
    // Três perguntas de verdade, e não a mesma resposta torta do cache três vezes.
    expect(modelo.pedidos).toHaveLength(MAX_TENTATIVAS_DE_EXTRACAO);
    expect(lerMarcaDeExtracao((await ler(c))?.atributos)).toMatchObject({
      estado: 'recusado',
      tentativas: MAX_TENTATIVAS_DE_EXTRACAO,
    });
    expect(await extrator().extrairLote()).toEqual({ tipo: 'nada_a_extrair' });
  });

  it('o determinístico antes: marca e modelo já sabidos, e título igual a um já lido, não perguntam', async () => {
    const jaSabido = await produto('Peça qualquer', { marca: 'Consul', modeloPeca: 'W10' });
    await produto(TITULO_A);
    await extrator().extrairLote();
    expect(modelo.pedidos).toHaveLength(1);

    const repetido = await produto(TITULO_A);
    const resultado = await extrator().extrairLote();

    expect(modelo.pedidos).toHaveLength(1);
    expect(resultado).toMatchObject({ tipo: 'lote', semPedido: 1, chamada: 'nenhuma' });
    expect((await ler(repetido))?.chave).toBe('electrolux|efelx21');
    expect((await ler(jaSabido))?.chave).toBe('consul|w10');
  });

  it('título repetido no lote vai uma vez só', async () => {
    const um = await produto(TITULO_A);
    const outro = await produto(TITULO_A);

    await extrator().extrairLote();

    expect(modelo.titulosDoUltimoPedido()).toEqual([TITULO_A]);
    expect((await ler(um))?.chave).toBe('electrolux|efelx21');
    expect((await ler(outro))?.chave).toBe('electrolux|efelx21');
  });

  it('item recusado pelo esquema fica marcado, com o motivo, e não volta ao modelo', async () => {
    const torto = await produto(TITULO_C);
    modelo.resposta = () => ({
      saida: { registros: [{ id: 'p1', quantidadeEmbalagem: 'três' }] },
      custoCentavos: 0,
    });

    const resultado = await extrator().extrairLote();

    expect(resultado).toMatchObject({ recusados: 1, paraTentarDeNovo: 0 });
    const marca = lerMarcaDeExtracao((await ler(torto))?.atributos);
    expect(marca?.estado).toBe('recusado');
    expect(marca?.problemas.join(' ')).toContain('quantidade não numérica');
    expect(await extrator().extrairLote()).toEqual({ tipo: 'nada_a_extrair' });
  });

  it('falha do provedor não marca ninguém: não é culpa do item', async () => {
    const intocado = await produto(TITULO_A);
    const falha: Chamador = {
      nome: 'falho',
      chamar: () => Promise.reject(new Error('No endpoints found matching your data policy')),
    };

    const resultado = await extrator(falha).extrairLote();

    expect(resultado).toMatchObject({ chamada: 'erro' });
    expect(resultado.tipo === 'lote' ? resultado.erro : '').toContain('data policy');
    expect(lerMarcaDeExtracao((await ler(intocado))?.atributos)).toBeNull();
    // A chamada que falhou fica em `llm_call`, para a conta fechar.
    expect(await conexao.db.select({ id: llmCall.id }).from(llmCall)).toHaveLength(1);
  });

  it('resposta cortada no teto de tokens parte o lote: todos voltam, e o próximo lote é a metade', async () => {
    for (let i = 0; i < 12; i += 1) await produto(`Correia de lavadora modelo ${String(i)}`);
    const cortada: Chamador = {
      nome: 'cortada',
      chamar: () => Promise.reject(new RespostaCortada(4_000)),
    };

    const primeiro = await extrator(cortada).extrairLote();
    expect(primeiro).toMatchObject({ enviados: 12, paraTentarDeNovo: 12, chamada: 'feita' });

    await extrator().extrairLote();
    // Doze voltaram com uma tentativa, e o lote de quem já tentou uma vez é de dez.
    expect(modelo.titulosDoUltimoPedido()).toHaveLength(10);
  });

  it('sem nada esperando, não pergunta nada', async () => {
    expect(await extrator().extrairLote()).toEqual({ tipo: 'nada_a_extrair' });
    expect(modelo.pedidos).toHaveLength(0);
  });

  it('registro vazio é o ponto de partida de quem não tem atributo', () => {
    expect(lerRegistro(null)).toEqual({ tipo: 'ok', registro: REGISTRO_VAZIO });
  });
});
