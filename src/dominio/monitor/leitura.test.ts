/**
 * A leitura do monitor por IA: o estado de um grupo (puro), e o lote contra Postgres de
 * verdade com um modelo falso — o que se prova é o que fica gravado em cada evento, e
 * que evento novo num grupo já lido faz o grupo ser lido de novo.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { precoHistorico, produtoExterno } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  LimiteDoProvedor,
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from '@/infra/llm';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { eventoDePreco } from './eventos';
import {
  LeitorDoMonitor,
  MAX_TENTATIVAS_DE_LEITURA,
  leituraDoGrupo,
  lerLeituraGravada,
  type LeituraGravada,
} from './leitura';
import { RepositorioDoMonitor } from './repositorio';
import { ExecutorDeLeituraDoMonitor } from './tarefa-de-leitura';

describe('leituraDoGrupo', () => {
  const lida = (em: string, hipotese = 'fornecedor novo'): LeituraGravada => ({
    estado: 'lida',
    hipotese,
    recomendacao: 'conferir o custo',
    modelo: 'm',
    em,
  });

  it('evento sem leitura deixa o grupo pendente, mesmo com os outros lidos', () => {
    expect(leituraDoGrupo([lida('2026-09-20T00:00:00Z'), null])).toEqual({
      tipo: 'pendente',
      tentativas: 0,
    });
    expect(
      leituraDoGrupo([{ estado: 'tentando', tentativas: 2, problemas: [] }, lida('2026-09-20')]),
    ).toEqual({ tipo: 'pendente', tentativas: 2 });
  });

  it('todos lidos: vale a leitura mais recente; nenhum, a IA desistiu', () => {
    expect(
      leituraDoGrupo([lida('2026-09-20T00:00:00Z', 'velha'), lida('2026-09-22T00:00:00Z', 'nova')]),
    ).toMatchObject({ tipo: 'lida', hipotese: 'nova' });
    expect(leituraDoGrupo([{ estado: 'sem_leitura', tentativas: 3, problemas: [] }])).toEqual({
      tipo: 'sem_leitura',
    });
  });

  it('coluna com texto que não é desta forma conta como sem leitura', () => {
    expect(lerLeituraGravada('uma frase solta')).toBeNull();
    expect(lerLeituraGravada(JSON.stringify(lida('2026-09-20')))).toMatchObject({ estado: 'lida' });
  });
});

const esquemaDoPedido = z.object({
  grupos: z.array(
    z.object({
      id: z.string(),
      sobre: z.string(),
      seriesDePreco: z.array(z.array(z.object({ dia: z.string(), reais: z.number() }))),
    }),
  ),
});

/** Lê cada grupo com uma frase que cita o alvo; ou devolve o que o teste mandar. */
class ModeloFalso implements Chamador {
  readonly nome = 'falso';
  pedidos: z.infer<typeof esquemaDoPedido>[] = [];
  resposta: 'boa' | 'sem_itens' | 'cota' = 'boa';

  async chamar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    const lido = esquemaDoPedido.parse(pedido.entrada);
    this.pedidos.push(lido);
    if (this.resposta === 'cota') {
      throw new LimiteDoProvedor('cota do dia', new Date(Date.now() + 60 * 60 * 1000), true);
    }
    const leituras =
      this.resposta === 'sem_itens'
        ? []
        : lido.grupos.map((g) => ({
            id: g.id,
            hipotese: `${g.sobre} baixou o preço com reposição: parece fornecedor novo.`,
            recomendacao: 'Confira o seu custo antes de mexer no preço.',
          }));
    return await Promise.resolve({ saida: { leituras }, custoCentavos: 0 });
  }
}

describe.skipIf(!temBancoDeTeste())('LeitorDoMonitor', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDoMonitor;
  let modelo: ModeloFalso;
  let ofertaId: string;
  const AGORA = new Date('2026-09-24T12:00:00Z');

  const leitor = () =>
    new LeitorDoMonitor(repo, {
      llm: new ServicoDeLlm(conexao.db, modelo, new Orcamento(1_000, 10)),
      modelo: 'modelo-de-teste',
      agora: () => AGORA,
    });

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, [
      'llm_call',
      'monitor_evento',
      'preco_historico',
      'produto_externo',
    ]);
    repo = new RepositorioDoMonitor(conexao.db);
    modelo = new ModeloFalso();
    const inseridos = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: 'Refil Electrolux PA21G',
        vendedor: 'Loja do Zé',
        plataformaOuSite: 'mercadolivre.com.br',
        preco: reaisParaCentavos(32),
        fonte: 'm0_link' as const,
        hashConteudo: randomUUID(),
      })
      .returning({ id: produtoExterno.id });
    ofertaId = inseridos[0]?.id ?? '';
    await conexao.db.insert(precoHistorico).values(
      [40, 40, 32].map((reais, i) => ({
        produtoExternoId: ofertaId,
        preco: reaisParaCentavos(reais),
        fonte: 'm0_link' as const,
        coletadoEm: new Date(AGORA.getTime() - (10 - i) * 86_400_000),
      })),
    );
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const gravarQueda = async (quando: Date) => {
    const evento = eventoDePreco(
      { antes: reaisParaCentavos(40), depois: reaisParaCentavos(32) },
      {
        id: randomUUID(),
        sobre: 'Loja do Zé',
        entidadeTipo: 'produto_externo',
        entidadeId: ofertaId,
        detectadoEm: quando,
      },
    );
    if (evento === null) throw new Error('esperava evento');
    await repo.registrar(evento);
    return evento;
  };

  it('lê o grupo com a série de preço, e grava a leitura em cada evento', async () => {
    await gravarQueda(new Date('2026-09-23T12:00:00Z'));
    const r = await leitor().lerLote();

    expect(r).toMatchObject({ tipo: 'lote', grupos: 1, lidos: 1, chamada: 'feita' });
    expect(modelo.pedidos[0]?.grupos[0]?.seriesDePreco).toEqual([
      [
        { dia: '2026-09-14', reais: 40 },
        { dia: '2026-09-15', reais: 40 },
        { dia: '2026-09-16', reais: 32 },
      ],
    ]);
    const [linha] = await repo.naoLidosComLeitura();
    const gravada = lerLeituraGravada(linha?.leitura ?? null);
    expect(gravada).toMatchObject({ estado: 'lida', modelo: 'modelo-de-teste' });
    expect(gravada?.estado === 'lida' && gravada.hipotese).toContain('fornecedor novo');
    // Lido: a próxima passada não tem o que ler, e não pergunta.
    expect(await leitor().lerLote()).toEqual({ tipo: 'nada_a_ler' });
    expect(modelo.pedidos).toHaveLength(1);
  });

  it('evento novo na mesma semana faz o grupo ser lido de novo, com ele', async () => {
    await gravarQueda(new Date('2026-09-22T12:00:00Z'));
    await leitor().lerLote();
    await gravarQueda(new Date('2026-09-23T12:00:00Z'));

    const r = await leitor().lerLote();
    expect(r).toMatchObject({ lidos: 1 });
    expect(modelo.pedidos).toHaveLength(2);
    const leituras = (await repo.naoLidosComLeitura()).map((l) => lerLeituraGravada(l.leitura));
    expect(leituras.every((l) => l?.estado === 'lida')).toBe(true);
  });

  it('resposta sem o grupo volta com a tentativa na pergunta, e desiste no teto', async () => {
    await gravarQueda(new Date('2026-09-23T12:00:00Z'));
    modelo.resposta = 'sem_itens';

    for (let i = 1; i <= MAX_TENTATIVAS_DE_LEITURA; i += 1) {
      const r = await leitor().lerLote();
      expect(r).toMatchObject({ tipo: 'lote', lidos: 0, loteInutilizavel: false });
    }
    // Três pedidos, e não um só com cache: a tentativa muda a pergunta.
    expect(modelo.pedidos).toHaveLength(MAX_TENTATIVAS_DE_LEITURA);
    const [linha] = await repo.naoLidosComLeitura();
    expect(lerLeituraGravada(linha?.leitura ?? null)).toMatchObject({ estado: 'sem_leitura' });
    expect(await leitor().lerLote()).toEqual({ tipo: 'nada_a_ler' });
  });

  it('cota esgotada vira espera no executor, sem marcar o grupo', async () => {
    await gravarQueda(new Date('2026-09-23T12:00:00Z'));
    modelo.resposta = 'cota';
    const executor = new ExecutorDeLeituraDoMonitor(() => leitor());

    expect((await executor.processarLote()).tipo).toBe('interrompido');
    expect((await executor.processarLote()).tipo).toBe('em_espera');
    const [linha] = await repo.naoLidosComLeitura();
    expect(linha?.leitura).toBeNull();
  });
});
