/**
 * Testes do repositório do monitor, contra Postgres de verdade.
 *
 * O que só o banco prova: que o `sobre` sai do vendedor de hoje e não de um nome
 * gravado no evento, que a fila de candidatos à queda descarta quem tem série curta
 * antes de carregar a série, e que marcar lido tira o evento da fila.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { monitorEvento, precoHistorico, produtoExterno } from '@/infra/banco/schema';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { eventoDePreco } from './eventos';
import { avaliarQueda } from './queda';
import { RepositorioDoMonitor } from './repositorio';

const TABELAS = ['monitor_evento', 'preco_historico', 'produto_externo'];

/** Uma data a N dias atrás, para montar série de preço. */
const diasAtras = (n: number): Date => new Date(Date.now() - n * 86_400_000);

describe.skipIf(!temBancoDeTeste())('RepositorioDoMonitor', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDoMonitor;
  let ofertaId: string;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, TABELAS);
    repo = new RepositorioDoMonitor(conexao.db);

    const inseridos = await conexao.db
      .insert(produtoExterno)
      .values({
        tituloBruto: 'Refil Filtro Purificador Electrolux PA21G',
        vendedor: 'Loja do Zé',
        plataformaOuSite: 'mercadolivre.com.br',
        preco: reaisParaCentavos(40),
        fonte: 'm1_planilha' as const,
        hashConteudo: randomUUID(),
      })
      .returning({ id: produtoExterno.id });
    ofertaId = inseridos[0]?.id ?? '';
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const gravarEvento = async (antes: number, depois: number, quando = new Date()) => {
    const evento = eventoDePreco(
      { antes: reaisParaCentavos(antes), depois: reaisParaCentavos(depois) },
      {
        id: randomUUID(),
        sobre: 'nome que não vai ser gravado',
        entidadeTipo: 'produto_externo',
        entidadeId: ofertaId,
        detectadoEm: quando,
      },
    );
    if (evento === null) throw new Error('o teste precisa de uma mudança acima do piso');
    await repo.registrar(evento);
    return evento;
  };

  it('grava e devolve o evento, com o sobre vindo do vendedor de agora', async () => {
    await gravarEvento(50, 40);

    const lidos = await repo.naoLidos();
    expect(lidos).toHaveLength(1);
    expect(lidos[0]?.tipo).toBe('preco_concorrente_caiu');
    expect(lidos[0]?.sobre).toBe('Loja do Zé');
    expect(lidos[0]?.severidade).toBe('vermelho');
  });

  it('o sobre acompanha a troca de nome do vendedor, porque é derivado na leitura', async () => {
    // Nome de vendedor muda. Gravado no evento, o de três meses atrás agruparia
    // separado do de hoje — e o agrupamento por concorrente é o ponto do monitor.
    await gravarEvento(50, 40);
    await conexao.db
      .update(produtoExterno)
      .set({ vendedor: 'Zé Peças ME' })
      .where(eq(produtoExterno.id, ofertaId));

    expect((await repo.naoLidos())[0]?.sobre).toBe('Zé Peças ME');
  });

  it('a variação é recalculada na leitura, a partir dos dois valores', async () => {
    const evento = await gravarEvento(50, 40);
    expect((await repo.naoLidos())[0]?.variacaoBp).toBe(evento.variacaoBp);
  });

  it('marcar lido tira da fila, e marcar de novo não conta duas vezes', async () => {
    const evento = await gravarEvento(50, 40);

    expect(await repo.marcarLidos([evento.id])).toBe(1);
    expect(await repo.naoLidos()).toHaveLength(0);
    // O `update` casa a linha de novo, então o número volta 1 — o que importa é que
    // ela não reaparece na fila.
    expect(await repo.marcarLidos([])).toBe(0);
  });

  it('tipo de mudança desconhecido é descartado na leitura, e fica no banco', async () => {
    // Evento gravado por uma versão que conhecia um tipo que hoje não existe.
    await conexao.db.insert(monitorEvento).values({
      entidadeTipo: 'produto_externo',
      entidadeId: ofertaId,
      tipoMudanca: 'tipo_que_nao_existe_mais',
      severidade: 'amarelo' as const,
    });

    expect(await repo.naoLidos()).toHaveLength(0);
    const todos = await conexao.db.select({ id: monitorEvento.id }).from(monitorEvento);
    expect(todos).toHaveLength(1);
  });

  describe('candidatosAQueda', () => {
    const observar = async (precos: readonly number[]) => {
      await conexao.db.insert(precoHistorico).values(
        precos.map((preco, i) => ({
          produtoExternoId: ofertaId,
          preco: reaisParaCentavos(preco),
          fonte: 'm1_planilha' as const,
          coletadoEm: diasAtras(precos.length - i),
        })),
      );
    };

    it('série curta não entra, porque o veredito seria sempre sem_referencia', async () => {
      await observar([50, 48]);
      expect(await repo.candidatosAQueda()).toHaveLength(0);
    });

    it('série suficiente entra com o histórico, e o veredito sai da função pura', async () => {
      await observar([50, 50, 50, 40]);

      const candidatos = await repo.candidatosAQueda();
      expect(candidatos).toHaveLength(1);
      expect(candidatos[0]?.historico).toHaveLength(4);
      expect(candidatos[0]?.vendedor).toBe('Loja do Zé');

      const primeiro = candidatos[0];
      if (primeiro === undefined) return;
      const avaliacao = avaliarQueda(primeiro.precoAtual, primeiro.historico);
      expect(avaliacao.veredito).toBe('queda_real');
      expect(avaliacao.valePublicar).toBe(true);
    });

    it('observação fora da janela não conta para o mínimo', async () => {
      await conexao.db.insert(precoHistorico).values(
        [120, 110, 100].map((dias) => ({
          produtoExternoId: ofertaId,
          preco: reaisParaCentavos(50),
          fonte: 'm1_planilha' as const,
          coletadoEm: diasAtras(dias),
        })),
      );

      expect(await repo.candidatosAQueda()).toHaveLength(0);
    });

    it('oferta sem preço atual não entra: não há o que comparar com a mediana', async () => {
      await observar([50, 50, 50]);
      await conexao.db
        .update(produtoExterno)
        .set({ preco: null })
        .where(eq(produtoExterno.id, ofertaId));

      expect(await repo.candidatosAQueda()).toHaveLength(0);
    });
  });
});
