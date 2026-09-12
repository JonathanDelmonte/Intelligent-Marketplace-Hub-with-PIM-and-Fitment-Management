/**
 * Testes do poller.
 *
 * Nenhum deles espera de verdade: o temporizador é injetado e dispara na hora,
 * registrando **quanto** o poller pediu para esperar. É o que permite testar
 * espera adaptativa e backoff numa suíte que roda em milissegundos — esperar dois
 * segundos por caso viraria uma suíte que ninguém roda.
 */
import { describe, expect, it, vi } from 'vitest';
import { criarRegistrador } from '../log';
import {
  Poller,
  ligarSinaisDeEncerramento,
  type ResultadoDoTique,
  type Tarefa,
  type Temporizador,
} from './poller';

/** Temporizador que dispara de imediato e anota o que foi pedido. */
function temporizadorImediato(esperas: number[]): Temporizador {
  return (ms, acao) => {
    esperas.push(ms);
    acao();
    return () => undefined;
  };
}

/** Temporizador que nunca dispara: só `parar()` acorda. */
function temporizadorQueNuncaDispara(esperas: number[]): Temporizador {
  return (ms) => {
    esperas.push(ms);
    return () => undefined;
  };
}

function tarefaDeLista(resultados: readonly ResultadoDoTique[]): Tarefa {
  let i = 0;
  return {
    nome: 'teste',
    executar: () => {
      const resultado = resultados[Math.min(i, resultados.length - 1)];
      i += 1;
      return Promise.resolve(resultado ?? { ocioso: true });
    },
  };
}

describe('laço e espera adaptativa', () => {
  it('para no limite de tiques', async () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: false }]), {
      limiteDeTiques: 3,
      temporizador: temporizadorImediato(esperas),
    });

    const estatisticas = await poller.iniciar();

    expect(estatisticas.tiques).toBe(3);
    expect(estatisticas.comTrabalho).toBe(3);
    expect(estatisticas.rodando).toBe(false);
  });

  it('espera pouco depois de trabalhar e muito depois de ficar ocioso', async () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: false }, { ocioso: true }]), {
      limiteDeTiques: 2,
      intervaloAtivoMs: 7,
      intervaloOciosoMs: 4000,
      temporizador: temporizadorImediato(esperas),
    });

    await poller.iniciar();

    expect(esperas).toEqual([7, 4000]);
  });

  it('no modo drena e sai, termina no primeiro tique ocioso', async () => {
    const esperas: number[] = [];
    const poller = new Poller(
      tarefaDeLista([{ ocioso: false }, { ocioso: false }, { ocioso: true }, { ocioso: false }]),
      { pararQuandoOcioso: true, temporizador: temporizadorImediato(esperas) },
    );

    const estatisticas = await poller.iniciar();

    expect(estatisticas.tiques).toBe(3);
    expect(estatisticas.comTrabalho).toBe(2);
    expect(estatisticas.ociosos).toBe(1);
    // Não esperou depois do tique ocioso: saiu.
    expect(esperas).toHaveLength(2);
  });

  it('recusa iniciar duas vezes o mesmo poller', async () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: true }]), {
      temporizador: temporizadorQueNuncaDispara(esperas),
    });

    const rodando = poller.iniciar();
    await expect(poller.iniciar()).rejects.toThrow(/já está rodando/u);

    poller.parar();
    await rodando;
  });

  it('conta trabalho e ócio separados, e guarda o instante do último tique', async () => {
    const esperas: number[] = [];
    const instantes = [new Date('2026-09-12T09:00:00Z'), new Date('2026-09-12T09:00:01Z')];
    let i = 0;
    const poller = new Poller(tarefaDeLista([{ ocioso: false }, { ocioso: true }]), {
      limiteDeTiques: 2,
      temporizador: temporizadorImediato(esperas),
      agora: () => instantes[Math.min(i++, instantes.length - 1)] ?? new Date(0),
    });

    const estatisticas = await poller.iniciar();

    expect(estatisticas.comTrabalho).toBe(1);
    expect(estatisticas.ociosos).toBe(1);
    expect(estatisticas.iniciadoEm).not.toBeNull();
    expect(estatisticas.ultimoTiqueEm).not.toBeNull();
  });
});

describe('encerramento', () => {
  it('parar() acorda a espera em vez de esperar o prazo inteiro', async () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: true }]), {
      intervaloOciosoMs: 3_600_000,
      temporizador: temporizadorQueNuncaDispara(esperas),
    });

    const rodando = poller.iniciar();
    // Deixa o laço chegar até a espera antes de pedir parada.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    poller.parar();
    const estatisticas = await rodando;

    expect(esperas).toEqual([3_600_000]);
    expect(estatisticas.parando).toBe(true);
    expect(estatisticas.rodando).toBe(false);
  });

  it('parar() duas vezes é inofensivo', async () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: true }]), {
      temporizador: temporizadorQueNuncaDispara(esperas),
    });

    const rodando = poller.iniciar();
    await Promise.resolve();
    poller.parar();
    poller.parar();
    await rodando;

    expect(poller.estatisticas.rodando).toBe(false);
  });

  it('não interrompe o tique em andamento — job pela metade é pior que job lento', async () => {
    const esperas: number[] = [];
    let terminou = false;
    // Inicializado com função de verdade, e não com `null`: o compilador só vê a
    // atribuição dentro do callback, então com `null` inicial ele estreita a
    // variável para `never` no ponto da chamada e `liberar?.()` não compila.
    let liberar: () => void = () => undefined;

    const tarefa: Tarefa = {
      nome: 'lenta',
      executar: async () => {
        await new Promise<void>((r) => {
          liberar = r;
        });
        terminou = true;
        return { ocioso: false };
      },
    };

    const poller = new Poller(tarefa, { temporizador: temporizadorQueNuncaDispara(esperas) });
    const rodando = poller.iniciar();
    await Promise.resolve();

    poller.parar();
    expect(terminou).toBe(false);

    liberar();
    await rodando;

    expect(terminou).toBe(true);
    expect(poller.estatisticas.comTrabalho).toBe(1);
  });

  it('SIGINT e SIGTERM pedem parada; o segundo sinal encerra à força', () => {
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: true }]), {
      temporizador: temporizadorQueNuncaDispara(esperas),
    });
    const parar = vi.spyOn(poller, 'parar');

    const ouvintes = new Map<string, () => void>();
    const saidas: number[] = [];
    const processo = {
      on: (sinal: string, ouvinte: () => void) => {
        ouvintes.set(sinal, ouvinte);
        return processo;
      },
      off: (sinal: string) => {
        ouvintes.delete(sinal);
        return processo;
      },
      exit: (codigo?: number) => {
        saidas.push(codigo ?? 0);
        return undefined as never;
      },
    } as unknown as Pick<NodeJS.Process, 'on' | 'off' | 'exit'>;

    const desligar = ligarSinaisDeEncerramento(poller, { processo });

    expect([...ouvintes.keys()]).toEqual(['SIGINT', 'SIGTERM']);

    ouvintes.get('SIGINT')?.();
    expect(parar).toHaveBeenCalledTimes(1);
    expect(saidas).toEqual([]);

    ouvintes.get('SIGTERM')?.();
    expect(saidas).toEqual([130]);

    desligar();
    expect(ouvintes.size).toBe(0);
  });
});

describe('erro não mata o laço', () => {
  it('exceção da tarefa vira erro contado, e o laço continua', async () => {
    const esperas: number[] = [];
    let chamadas = 0;
    const tarefa: Tarefa = {
      nome: 'instavel',
      executar: () => {
        chamadas += 1;
        if (chamadas === 1) throw new Error('banco fora do ar');
        return Promise.resolve({ ocioso: false });
      },
    };

    const poller = new Poller(tarefa, {
      limiteDeTiques: 3,
      temporizador: temporizadorImediato(esperas),
    });

    const estatisticas = await poller.iniciar();

    expect(estatisticas.tiques).toBe(3);
    expect(estatisticas.errosTotais).toBe(1);
    expect(estatisticas.errosConsecutivos).toBe(0);
    expect(estatisticas.comTrabalho).toBe(2);
  });

  it('backoff dobra por erro consecutivo e respeita o teto', async () => {
    const esperas: number[] = [];
    const tarefa: Tarefa = {
      nome: 'sempre falha',
      executar: () => {
        throw new Error('fora do ar');
      },
    };

    const poller = new Poller(tarefa, {
      limiteDeTiques: 5,
      intervaloOciosoMs: 1000,
      intervaloMaximoAposErroMs: 5000,
      temporizador: temporizadorImediato(esperas),
    });

    await poller.iniciar();

    expect(esperas).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it('backoff não estoura para Infinity com muitos erros seguidos', async () => {
    const esperas: number[] = [];
    const tarefa: Tarefa = {
      nome: 'sempre falha',
      executar: () => {
        throw new Error('fora do ar');
      },
    };

    const poller = new Poller(tarefa, {
      limiteDeTiques: 60,
      intervaloOciosoMs: 1000,
      intervaloMaximoAposErroMs: 60_000,
      temporizador: temporizadorImediato(esperas),
    });

    await poller.iniciar();

    expect(esperas.every((e) => Number.isFinite(e) && e <= 60_000)).toBe(true);
    expect(esperas[esperas.length - 1]).toBe(60_000);
  });

  it('erro do laço é registrado com a exceção, não com uma mensagem genérica', async () => {
    const linhas: string[] = [];
    const esperas: number[] = [];
    const tarefa: Tarefa = {
      nome: 'quebrada',
      executar: () => {
        throw new Error('detalhe que importa');
      },
    };

    const poller = new Poller(tarefa, {
      limiteDeTiques: 1,
      temporizador: temporizadorImediato(esperas),
      registrador: criarRegistrador({ nivelMinimo: 'debug', escrever: (l) => linhas.push(l) }),
    });

    await poller.iniciar();

    const erro = linhas.find((l) => l.includes('poller.erro'));
    expect(erro).toBeDefined();
    expect(erro).toContain('detalhe que importa');
    expect(erro).toContain('"poller":"quebrada"');
  });
});

describe('campos da tarefa chegam ao log', () => {
  it('o que a tarefa devolve em campos aparece na linha do tique', async () => {
    const linhas: string[] = [];
    const esperas: number[] = [];
    const poller = new Poller(tarefaDeLista([{ ocioso: false, campos: { gravados: 42 } }]), {
      limiteDeTiques: 1,
      temporizador: temporizadorImediato(esperas),
      registrador: criarRegistrador({ escrever: (l) => linhas.push(l) }),
    });

    await poller.iniciar();

    expect(linhas.find((l) => l.includes('poller.trabalhou'))).toContain('"gravados":42');
  });
});
