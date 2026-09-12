import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '../banco/teste';
import { Fila, FilaError, STATUS_JOB, atrasoDaTentativa } from './fila';

describe('atrasoDaTentativa', () => {
  it('cresce exponencialmente e tem teto', () => {
    // Reexecutar em seguida é a forma mais rápida de levar bloqueio permanente.
    expect(atrasoDaTentativa(1)).toBe(30_000);
    expect(atrasoDaTentativa(2)).toBe(60_000);
    expect(atrasoDaTentativa(3)).toBe(120_000);
    expect(atrasoDaTentativa(20)).toBe(30 * 60_000);
  });

  it('é monotônico e nunca negativo', () => {
    let anterior = 0;
    for (let t = 0; t <= 12; t += 1) {
      const atual = atrasoDaTentativa(t);
      expect(atual).toBeGreaterThanOrEqual(anterior);
      expect(atual).toBeGreaterThan(0);
      anterior = atual;
    }
  });
});

// A fila só é testável de verdade contra Postgres: ON CONFLICT e SKIP LOCKED não
// têm equivalente em dublê.
describe.skipIf(!temBancoDeTeste())('Fila (contra Postgres real)', () => {
  let conexao: ConexaoDeTeste;
  let fila: Fila;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    fila = new Fila(conexao.db);
    await limparTabelas(conexao.db, ['job']);
  });

  afterAll(async () => {
    if (conexao !== undefined) await conexao.encerrar();
  });

  describe('idempotência', () => {
    it('enfileirar duas vezes a mesma chave devolve o mesmo job', async () => {
      // Colar o mesmo link duas vezes não paga extração duas vezes. Como
      // extração usa LLM, isso é dinheiro.
      const a = await fila.enfileirar({
        tipo: 'extrair_anuncio',
        chaveIdempotencia: 'https://produto.mercadolivre.com.br/MLB-1',
        entrada: { url: 'https://produto.mercadolivre.com.br/MLB-1' },
      });
      const b = await fila.enfileirar({
        tipo: 'extrair_anuncio',
        chaveIdempotencia: 'https://produto.mercadolivre.com.br/MLB-1',
        entrada: { url: 'https://produto.mercadolivre.com.br/MLB-1' },
      });

      expect(a.jaExistia).toBe(false);
      expect(b.jaExistia).toBe(true);
      expect(b.job.id).toBe(a.job.id);
    });

    it('a mesma chave em tipos diferentes são jobs diferentes', async () => {
      const a = await fila.enfileirar({ tipo: 'extrair', chaveIdempotencia: 'k', entrada: {} });
      const b = await fila.enfileirar({ tipo: 'resolver', chaveIdempotencia: 'k', entrada: {} });
      expect(b.job.id).not.toBe(a.job.id);
    });

    it('resolve corrida de enfileiramento simultâneo no banco', async () => {
      // Dez enfileiramentos paralelos da mesma chave: o banco resolve, não um
      // `if` na aplicação.
      const resultados = await Promise.all(
        Array.from({ length: 10 }, () =>
          fila.enfileirar({ tipo: 'extrair', chaveIdempotencia: 'concorrente', entrada: {} }),
        ),
      );

      const ids = new Set(resultados.map((r) => r.job.id));
      expect(ids.size).toBe(1);
      expect(resultados.filter((r) => !r.jaExistia)).toHaveLength(1);
    });

    it('recusa tipo ou chave vazios', async () => {
      await expect(
        fila.enfileirar({ tipo: '', chaveIdempotencia: 'k', entrada: {} }),
      ).rejects.toThrow(FilaError);
      await expect(
        fila.enfileirar({ tipo: 't', chaveIdempotencia: '  ', entrada: {} }),
      ).rejects.toThrow(FilaError);
    });
  });

  describe('reivindicação', () => {
    it('reivindica em ordem de agendamento', async () => {
      const agora = Date.now();
      await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'tarde',
        entrada: { ordem: 2 },
        agendadoPara: new Date(agora - 1000),
      });
      await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'cedo',
        entrada: { ordem: 1 },
        agendadoPara: new Date(agora - 5000),
      });

      const primeiro = await fila.reivindicar({ tipos: ['t'] });
      expect(primeiro?.chaveIdempotencia).toBe('cedo');
      const segundo = await fila.reivindicar({ tipos: ['t'] });
      expect(segundo?.chaveIdempotencia).toBe('tarde');
    });

    it('marca como rodando e incrementa tentativas', async () => {
      await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      const reivindicado = await fila.reivindicar({ tipos: ['t'] });
      expect(reivindicado?.status).toBe('rodando');
      expect(reivindicado?.tentativas).toBe(1);
    });

    it('não reivindica job agendado para o futuro', async () => {
      await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'k',
        entrada: {},
        agendadoPara: new Date(Date.now() + 60_000),
      });
      expect(await fila.reivindicar({ tipos: ['t'] })).toBeNull();
    });

    it('dois consumidores nunca pegam o mesmo job', async () => {
      // É o que SKIP LOCKED garante, e o que dispensa Redis.
      for (let i = 0; i < 6; i += 1) {
        await fila.enfileirar({ tipo: 't', chaveIdempotencia: `k${String(i)}`, entrada: { i } });
      }

      const reivindicados = await Promise.all(
        Array.from({ length: 6 }, () => fila.reivindicar({ tipos: ['t'] })),
      );

      const ids = reivindicados.filter((j) => j !== null).map((j) => j.id);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
    });

    it('filtra por tipo', async () => {
      await fila.enfileirar({ tipo: 'a', chaveIdempotencia: 'k', entrada: {} });
      expect(await fila.reivindicar({ tipos: ['b'] })).toBeNull();
      expect(await fila.reivindicar({ tipos: ['a'] })).not.toBeNull();
    });

    it('sem filtro, reivindica qualquer tipo', async () => {
      await fila.enfileirar({ tipo: 'qualquer', chaveIdempotencia: 'k', entrada: {} });
      expect(await fila.reivindicar()).not.toBeNull();
    });

    it('recupera job abandonado por processo que morreu', async () => {
      // Sem isso um job ficaria `rodando` para sempre e a fila travaria.
      await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      const primeiro = await fila.reivindicar({ tipos: ['t'] });
      expect(primeiro).not.toBeNull();

      // Nada mais a pegar enquanto o prazo não estoura.
      expect(await fila.reivindicar({ tipos: ['t'] })).toBeNull();

      const recuperado = await fila.reivindicar({ tipos: ['t'], prazoDeExecucaoMs: 0 });
      expect(recuperado?.id).toBe(primeiro!.id);
      expect(recuperado?.tentativas).toBe(2);
    });

    it('devolve null quando a fila está vazia', async () => {
      expect(await fila.reivindicar()).toBeNull();
    });

    it('enfileirar e reivindicar em sequência imediata sempre funciona', async () => {
      // Regressão de um defeito intermitente que custou uma investigação inteira:
      // `agendado_para` é escrito pelo relógio do banco, com precisão de
      // microssegundo, e `new Date()` do JavaScript trunca em milissegundo.
      // Comparar os dois deixava o job invisível quando enfileirado e reivindicado
      // dentro do mesmo milissegundo.
      //
      // Trinta repetições porque a falha era de timing: uma só passaria por sorte.
      for (let i = 0; i < 30; i += 1) {
        await limparTabelas(conexao.db, ['job']);
        await fila.enfileirar({
          tipo: 't',
          chaveIdempotencia: `imediato${String(i)}`,
          entrada: {},
        });

        const reivindicado = await fila.reivindicar({ tipos: ['t'] });
        expect(reivindicado, `repetição ${String(i)}`).not.toBeNull();
      }
    });

    it('quantidadePronta conta job enfileirado no mesmo instante', async () => {
      // Mesmo defeito, outra consulta: esta é a que decide se o poller tem
      // trabalho, então contar zero faria a fila parecer vazia.
      for (let i = 0; i < 20; i += 1) {
        await limparTabelas(conexao.db, ['job']);
        await fila.enfileirar({ tipo: 't', chaveIdempotencia: `conta${String(i)}`, entrada: {} });
        expect(await fila.quantidadePronta(), `repetição ${String(i)}`).toBe(1);
      }
    });
  });

  describe('retomabilidade', () => {
    it('progresso parcial sobrevive e não muda o status', async () => {
      // Uma listagem que caiu na página 7 de 20 retoma da 7, não da 1.
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });

      await fila.salvarProgresso(job.id, { paginaAtual: 7, itensExtraidos: 140 });

      const lido = await fila.buscarPorId(job.id);
      expect(lido?.progresso).toEqual({ paginaAtual: 7, itensExtraidos: 140 });
      expect(lido?.status).toBe('rodando');
    });

    it('o progresso continua legível depois de falhar e reagendar', async () => {
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.salvarProgresso(job.id, { paginaAtual: 7 });
      await fila.falhar(job.id, 'timeout na página 8');

      const lido = await fila.buscarPorId(job.id);
      expect(lido?.status).toBe('pendente');
      expect(lido?.progresso).toEqual({ paginaAtual: 7 });
      expect(lido?.erro).toContain('página 8');
    });
  });

  describe('falha e backoff', () => {
    it('reagenda enquanto houver tentativa', async () => {
      const { job } = await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'k',
        entrada: {},
        maxTentativas: 3,
      });

      await fila.reivindicar({ tipos: ['t'] });
      expect((await fila.falhar(job.id, 'erro 1')).reagendado).toBe(true);
      expect((await fila.buscarPorId(job.id))?.status).toBe('pendente');
    });

    it('desiste depois de esgotar as tentativas, e o erro fica visível', async () => {
      const { job } = await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'k',
        entrada: {},
        maxTentativas: 2,
      });

      await fila.reivindicar({ tipos: ['t'], prazoDeExecucaoMs: 0 });
      await fila.falhar(job.id, 'erro 1');
      await fila.reivindicar({
        tipos: ['t'],
        prazoDeExecucaoMs: 0,
        agora: new Date(Date.now() + 120_000),
      });
      const segunda = await fila.falhar(job.id, 'erro definitivo');

      expect(segunda.reagendado).toBe(false);
      const lido = await fila.buscarPorId(job.id);
      expect(lido?.status).toBe('falhou');
      // O job não desaparece: a tela dos últimos 100 existe para isso.
      expect(lido?.erro).toBe('erro definitivo');
    });

    it('falhar job inexistente lança', async () => {
      await expect(fila.falhar('00000000-0000-0000-0000-000000000000', 'x')).rejects.toThrow(
        FilaError,
      );
    });
  });

  describe('pendente_revisao', () => {
    it('é status, não falha, e não consome tentativa', async () => {
      // Descartar registro é o erro que a especificação proíbe explicitamente.
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.mandarParaRevisao(job.id, 'schema de saída falhou: preço ausente');

      const lido = await fila.buscarPorId(job.id);
      expect(lido?.status).toBe('pendente_revisao');
      expect(lido?.tentativas).toBe(1);
      expect(lido?.erro).toContain('preço ausente');
    });

    it('job em revisão não volta a ser reivindicado', async () => {
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.mandarParaRevisao(job.id, 'motivo');

      expect(await fila.reivindicar({ tipos: ['t'], prazoDeExecucaoMs: 0 })).toBeNull();
    });

    it('a fila de revisão lista o que espera decisão humana', async () => {
      for (const chave of ['a', 'b']) {
        const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: chave, entrada: {} });
        await fila.reivindicar({ tipos: ['t'] });
        await fila.mandarParaRevisao(job.id, `motivo ${chave}`);
      }
      await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'c', entrada: {} });

      const emRevisao = await fila.aguardandoRevisao();
      expect(emRevisao).toHaveLength(2);
      expect(emRevisao.map((j) => j.chaveIdempotencia).sort()).toEqual(['a', 'b']);
    });
  });

  describe('conclusão e reenfileiramento', () => {
    it('concluir grava resultado e limpa o erro', async () => {
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.falhar(job.id, 'erro transitório');
      await fila.reivindicar({ tipos: ['t'], agora: new Date(Date.now() + 120_000) });
      await fila.concluir(job.id, { produtosExternos: 3 });

      const lido = await fila.buscarPorId(job.id);
      expect(lido?.status).toBe('concluido');
      expect(lido?.erro).toBeNull();
    });

    it('reenfileirar zera tentativas e limpa o erro', async () => {
      const { job } = await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'k',
        entrada: {},
        maxTentativas: 1,
      });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.falhar(job.id, 'erro');

      await fila.reenfileirar(job.id);
      const lido = await fila.buscarPorId(job.id);
      expect(lido?.status).toBe('pendente');
      expect(lido?.tentativas).toBe(0);
      expect(lido?.erro).toBeNull();
    });

    it('recusa reenfileirar job em execução', async () => {
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'k', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await expect(fila.reenfileirar(job.id)).rejects.toThrow(/rodando/);
    });
  });

  describe('observabilidade', () => {
    it('conta por status', async () => {
      const a = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'a', entrada: {} });
      const b = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'b', entrada: {} });
      await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'c', entrada: {} });

      await fila.reivindicar({ tipos: ['t'] });
      await fila.concluir(a.job.id, {});
      await fila.reivindicar({ tipos: ['t'] });
      await fila.mandarParaRevisao(b.job.id, 'motivo');

      const contagem = await fila.contagemPorStatus();
      expect(contagem.concluido).toBe(1);
      expect(contagem.pendente_revisao).toBe(1);
      expect(contagem.pendente).toBe(1);

      // Todo status conhecido aparece na contagem, mesmo zerado.
      for (const status of STATUS_JOB) {
        expect(typeof contagem[status]).toBe('number');
      }
    });

    it('quantidadePronta ignora o que está agendado para o futuro', async () => {
      await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'agora', entrada: {} });
      await fila.enfileirar({
        tipo: 't',
        chaveIdempotencia: 'depois',
        entrada: {},
        agendadoPara: new Date(Date.now() + 600_000),
      });
      expect(await fila.quantidadePronta()).toBe(1);
    });

    it('ultimos devolve os mais recentes primeiro, com limite', async () => {
      for (let i = 0; i < 5; i += 1) {
        await fila.enfileirar({ tipo: 't', chaveIdempotencia: `k${String(i)}`, entrada: { i } });
      }
      const ultimos = await fila.ultimos(3);
      expect(ultimos).toHaveLength(3);
    });
  });

  describe('limpeza', () => {
    it('remove concluído antigo e preserva o resto', async () => {
      const concluido = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'c', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.concluir(concluido.job.id, {});

      const pendente = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'p', entrada: {} });

      const removidos = await fila.limparConcluidos(new Date(Date.now() + 1000));
      expect(removidos).toBe(1);
      expect(await fila.buscarPorId(concluido.job.id)).toBeNull();
      expect(await fila.buscarPorId(pendente.job.id)).not.toBeNull();
    });

    it('não remove concluído recente quando o corte é anterior', async () => {
      const { job } = await fila.enfileirar({ tipo: 't', chaveIdempotencia: 'c', entrada: {} });
      await fila.reivindicar({ tipos: ['t'] });
      await fila.concluir(job.id, {});

      expect(await fila.limparConcluidos(new Date(Date.now() - 600_000))).toBe(0);
      expect(await fila.buscarPorId(job.id)).not.toBeNull();
    });
  });
});
