/**
 * Testes do serviço de LLM, contra Postgres de verdade.
 *
 * O que não é testável com dublê de banco é justamente o que decide a conta do mês:
 * a chave única `(proposito, modelo, hash_entrada)` é o cache, e é ela que
 * transforma uma falha registrada em bloqueio permanente se o `insert` não souber
 * atualizar. Nenhum dublê reproduz isso.
 *
 * Nenhum teste aqui chama provedor nenhum: o `Chamador` é a porta, e um dublê que
 * conta chamadas prova cache e orçamento sem gastar um centavo.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { llmCall } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  ChamadorAusente,
  Orcamento,
  OrcamentoEstourado,
  OrcamentoInvalido,
  SemChaveDeLlm,
  ServicoDeLlm,
  gastoPorProposito,
  hashDeEntrada,
  serializarEstavel,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from './index';

const esquemaSaida = z.object({ mesmoProduto: z.boolean(), justificativa: z.string() });

/** Dublê que conta chamadas e devolve o que o teste mandar. */
class ChamadorFalso implements Chamador {
  readonly nome = 'falso';
  chamadas: PedidoAoModelo[] = [];

  constructor(
    private readonly resposta: (n: number) => RespostaDoModelo | Promise<RespostaDoModelo>,
  ) {}

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.chamadas.push(pedido);
    return await this.resposta(this.chamadas.length);
  }
}

const boa = (): RespostaDoModelo => ({
  saida: { mesmoProduto: true, justificativa: 'mesmo código de peça' },
  tokensEntrada: 120,
  tokensSaida: 30,
  custoCentavos: 2,
});

describe('serializarEstavel', () => {
  it('não depende da ordem em que as chaves foram escritas', () => {
    expect(serializarEstavel({ b: 1, a: 2 })).toBe(serializarEstavel({ a: 2, b: 1 }));
    expect(hashDeEntrada({ x: { z: 1, y: 2 } })).toBe(hashDeEntrada({ x: { y: 2, z: 1 } }));
  });

  it('preserva a ordem de array, que é significativa', () => {
    expect(serializarEstavel([1, 2])).not.toBe(serializarEstavel([2, 1]));
  });

  it('ignora undefined e serializa data como ISO', () => {
    expect(serializarEstavel({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(serializarEstavel(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '"2026-01-02T03:04:05.000Z"',
    );
  });

  it('não deixa NaN virar string inválida', () => {
    expect(serializarEstavel({ a: Number.NaN })).toBe('{"a":null}');
  });
});

describe('Orcamento', () => {
  it('recusa nascer sem teto, porque agente sem teto não roda', () => {
    expect(() => new Orcamento(0, 10)).toThrow(OrcamentoInvalido);
    expect(() => new Orcamento(100, 0)).toThrow(OrcamentoInvalido);
    expect(() => new Orcamento(1.5, 10)).toThrow(OrcamentoInvalido);
  });

  it('estoura por chamada mesmo quando o provedor não informa custo', () => {
    const orcamento = new Orcamento(10_000, 2);
    orcamento.registrar(undefined);
    orcamento.registrar(undefined);
    expect(orcamento.esgotado).toBe(true);
    expect(() => orcamento.exigirFolga()).toThrow(OrcamentoEstourado);
  });

  it('estoura por centavos antes de esgotar as chamadas', () => {
    const orcamento = new Orcamento(5, 100);
    orcamento.registrar(5);
    expect(orcamento.esgotado).toBe(true);
  });
});

describe('ChamadorAusente', () => {
  it('falha explicitamente em vez de devolver vazio', async () => {
    await expect(new ChamadorAusente().chamar()).rejects.toThrow(SemChaveDeLlm);
  });
});

describe.skipIf(!temBancoDeTeste())('ServicoDeLlm', () => {
  let conexao: ConexaoDeTeste;

  const servico = (chamador: Chamador, orcamento = new Orcamento(1_000, 50)): ServicoDeLlm =>
    new ServicoDeLlm(conexao.db, chamador, orcamento);

  const pedido = (entrada: unknown) => ({
    proposito: 'julgamento_identidade' as const,
    modelo: 'modelo-de-teste',
    instrucoes: 'decida se são o mesmo produto',
    entrada,
    esquema: esquemaSaida,
  });

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['llm_call']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('chama uma vez e devolve o valor validado', async () => {
    const chamador = new ChamadorFalso(boa);
    const r = await servico(chamador).pedir(pedido({ a: 'x', b: 'y' }));

    expect(r.tipo).toBe('ok');
    if (r.tipo !== 'ok') throw new Error('esperava ok');
    expect(r.valor.mesmoProduto).toBe(true);
    expect(r.deCache).toBe(false);
    expect(chamador.chamadas).toHaveLength(1);
  });

  it('registra entrada, saída, custo, tokens e latência', async () => {
    await servico(new ChamadorFalso(boa)).pedir(pedido({ a: 'x' }));

    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha).toBeDefined();
    expect(linha?.proposito).toBe('julgamento_identidade');
    expect(linha?.entrada).toEqual({
      pergunta: { a: 'x' },
      contexto: null,
      instrucoes: 'decida se são o mesmo produto',
    });
    expect(linha?.custoCentavos).toBe(2);
    expect(linha?.tokensEntrada).toBe(120);
    expect(linha?.latenciaMs).toBeGreaterThanOrEqual(0);
    expect(linha?.erro).toBeNull();
  });

  it('a segunda chamada igual sai do cache e não gasta', async () => {
    const chamador = new ChamadorFalso(boa);
    const orcamento = new Orcamento(1_000, 50);
    const s = servico(chamador, orcamento);

    await s.pedir(pedido({ a: 'x' }));
    const segunda = await s.pedir(pedido({ a: 'x' }));

    expect(chamador.chamadas).toHaveLength(1);
    expect(segunda.tipo).toBe('ok');
    if (segunda.tipo !== 'ok') throw new Error('esperava ok');
    expect(segunda.deCache).toBe(true);
    expect(orcamento.gasto).toEqual({ centavos: 2, chamadas: 1 });
  });

  it('cache não depende da ordem das chaves da entrada', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);
    await s.pedir(pedido({ a: 1, b: 2 }));
    await s.pedir(pedido({ b: 2, a: 1 }));
    expect(chamador.chamadas).toHaveLength(1);
  });

  it('entrada diferente paga de novo', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);
    await s.pedir(pedido({ a: 1 }));
    await s.pedir(pedido({ a: 2 }));
    expect(chamador.chamadas).toHaveLength(2);
  });

  it('imagem entra no cache pelo hash, chega ao chamador, e não vai inteira para o registro', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);
    const comImagem = (base64: string) => ({
      ...pedido({ a: 1 }),
      imagens: [{ tipo: 'image/png', base64 }],
    });

    await s.pedir(comImagem('AAAA'));
    await s.pedir(comImagem('AAAA'));
    await s.pedir(comImagem('BBBB'));
    await s.pedir(pedido({ a: 1 }));

    // A mesma foto sai do cache; outra foto, e a pergunta sem foto, pagam.
    expect(chamador.chamadas).toHaveLength(3);
    expect(chamador.chamadas[0]?.imagens).toEqual([{ tipo: 'image/png', base64: 'AAAA' }]);
    const linhas = await conexao.db.select().from(llmCall);
    expect(JSON.stringify(linhas.map((l) => l.entrada))).not.toContain('AAAA');
    expect(linhas[0]?.entrada).toMatchObject({
      imagens: [{ tipo: 'image/png', bytes: 3 }],
    });
  });

  it('propósito diferente com a mesma entrada não compartilha cache', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);
    await s.pedir(pedido({ a: 1 }));
    await s.pedir({ ...pedido({ a: 1 }), proposito: 'extracao' });
    expect(chamador.chamadas).toHaveLength(2);
  });

  it('saída que não valida vira pendente_revisao com o bruto preservado', async () => {
    const chamador = new ChamadorFalso(() => ({ saida: { mesmoProduto: 'talvez' } }));
    const r = await servico(chamador).pedir(pedido({ a: 1 }));

    expect(r.tipo).toBe('pendente_revisao');
    if (r.tipo !== 'pendente_revisao') throw new Error('esperava pendente_revisao');
    expect(r.saidaBruta).toEqual({ mesmoProduto: 'talvez' });
    expect(r.problemas.join(' ')).toContain('mesmoProduto');
  });

  it('saída inválida fica registrada — foi paga, e o registro é o que explica a conta', async () => {
    await servico(new ChamadorFalso(() => ({ saida: { errado: true }, custoCentavos: 3 }))).pedir(
      pedido({ a: 1 }),
    );
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha?.custoCentavos).toBe(3);
  });

  it('falha do provedor não vira cache de falha — a tentativa seguinte chama de novo', async () => {
    // É a armadilha da chave única: `(proposito, modelo, hash_entrada)` é a chave
    // de cache, então a linha de erro ocupa o lugar exato da resposta boa.
    const chamador = new ChamadorFalso((n) => {
      if (n === 1) throw new Error('502 do provedor');
      return boa();
    });
    const s = servico(chamador);

    const primeira = await s.pedir(pedido({ a: 1 }));
    expect(primeira.tipo).toBe('erro');

    const segunda = await s.pedir(pedido({ a: 1 }));
    expect(segunda.tipo).toBe('ok');
    if (segunda.tipo !== 'ok') throw new Error('esperava ok');
    expect(segunda.deCache).toBe(false);
    expect(chamador.chamadas).toHaveLength(2);

    // Uma linha só: a segunda atualizou a primeira em vez de colidir.
    const [{ n } = { n: -1 }] = await conexao.db
      .select({ n: sql<number>`count(*)::int` })
      .from(llmCall);
    expect(n).toBe(1);
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha?.erro).toBeNull();
    expect(linha?.saida).not.toBeNull();
  });

  it('falha do provedor consome uma chamada do orçamento', async () => {
    const orcamento = new Orcamento(1_000, 50);
    const chamador = new ChamadorFalso(() => {
      throw new Error('timeout');
    });
    await servico(chamador, orcamento).pedir(pedido({ a: 1 }));
    expect(orcamento.gasto.chamadas).toBe(1);
  });

  it('orçamento esgotado lança antes de chamar o provedor', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador, new Orcamento(1_000, 1));

    await s.pedir(pedido({ a: 1 }));
    await expect(s.pedir(pedido({ a: 2 }))).rejects.toThrow(OrcamentoEstourado);
    expect(chamador.chamadas).toHaveLength(1);
  });

  it('orçamento esgotado ainda entrega resposta que já está em cache', async () => {
    // A resposta já foi paga; recusá-la por falta de teto puniria o cache.
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador, new Orcamento(1_000, 1));
    await s.pedir(pedido({ a: 1 }));

    const repetida = await s.pedir(pedido({ a: 1 }));
    expect(repetida.tipo).toBe('ok');
  });

  it('sem chave devolve sem_chave, sem gastar orçamento e sem sujar llm_call', async () => {
    const orcamento = new Orcamento(1_000, 50);
    const r = await servico(new ChamadorAusente(), orcamento).pedir(pedido({ a: 1 }));

    expect(r.tipo).toBe('sem_chave');
    expect(orcamento.gasto).toEqual({ centavos: 0, chamadas: 0 });
    const linhas = await conexao.db.select().from(llmCall);
    expect(linhas).toHaveLength(0);
  });

  it('contexto vai para o registro e não para o hash — senão aprender invalidaria o cache', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);

    await s.pedir({ ...pedido({ a: 1 }), contexto: { exemplos: ['um'] } });
    // Mesmo par, exemplos diferentes: continua sendo cache.
    const segunda = await s.pedir({ ...pedido({ a: 1 }), contexto: { exemplos: ['um', 'dois'] } });

    expect(chamador.chamadas).toHaveLength(1);
    expect(segunda.tipo).toBe('ok');
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha?.entrada).toEqual({
      pergunta: { a: 1 },
      contexto: { exemplos: ['um'] },
      instrucoes: 'decida se são o mesmo produto',
    });
  });

  it('o contexto chega ao chamador', async () => {
    const chamador = new ChamadorFalso(boa);
    await servico(chamador).pedir({ ...pedido({ a: 1 }), contexto: { exemplos: [] } });
    expect(chamador.chamadas[0]?.contexto).toEqual({ exemplos: [] });
  });

  it('as instruções e o formato da resposta chegam ao chamador', async () => {
    const chamador = new ChamadorFalso(boa);
    await servico(chamador).pedir(pedido({ a: 1 }));

    const [enviado] = chamador.chamadas;
    expect(enviado?.instrucoes).toBe('decida se são o mesmo produto');
    // O formato é o JSON Schema do mesmo Zod que valida a volta: os dois não divergem.
    expect(enviado?.formato).toMatchObject({
      type: 'object',
      properties: { mesmoProduto: { type: 'boolean' }, justificativa: { type: 'string' } },
      required: ['mesmoProduto', 'justificativa'],
    });
  });

  it('instruções ficam fora do hash: melhorar o texto não paga a pergunta de novo', async () => {
    const chamador = new ChamadorFalso(boa);
    const s = servico(chamador);

    await s.pedir(pedido({ a: 1 }));
    const segunda = await s.pedir({ ...pedido({ a: 1 }), instrucoes: 'texto melhorado' });

    expect(chamador.chamadas).toHaveLength(1);
    expect(segunda).toMatchObject({ tipo: 'ok', deCache: true });
  });

  it('gastoPorProposito soma por finalidade', async () => {
    const s = servico(new ChamadorFalso(boa));
    await s.pedir(pedido({ a: 1 }));
    await s.pedir(pedido({ a: 2 }));
    await s.pedir({ ...pedido({ a: 1 }), proposito: 'extracao' });

    const relatorio = await gastoPorProposito(conexao.db, new Date(Date.now() - 60_000));
    expect(relatorio).toEqual([
      { proposito: 'extracao', chamadas: 1, centavos: 2 },
      { proposito: 'julgamento_identidade', chamadas: 2, centavos: 4 },
    ]);
  });
});
