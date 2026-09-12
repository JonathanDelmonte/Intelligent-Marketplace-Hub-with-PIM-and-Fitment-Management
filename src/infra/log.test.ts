/**
 * Testes do log estruturado.
 *
 * O que se verifica aqui não é formatação — é que o registrador **não derruba
 * quem o chamou**. Cada caso abaixo corresponde a uma forma real de
 * `JSON.stringify` lançar, e cada uma delas mataria o laço do poller.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ITENS,
  MAX_PROFUNDIDADE,
  MAX_TEXTO,
  OCULTO,
  criarRegistrador,
  ehCampoSensivel,
  nivelDoAmbiente,
  registradorSilencioso,
  sanear,
} from './log';

const NL = String.fromCharCode(10);

/** Coletor de linhas, já desserializadas. */
function coletor() {
  const linhas: string[] = [];
  const registrador = criarRegistrador({
    nivelMinimo: 'debug',
    escrever: (l) => linhas.push(l),
    agora: () => new Date('2026-09-12T09:00:00.000Z'),
  });
  return {
    registrador,
    linhas,
    objetos: () => linhas.map((l) => JSON.parse(l) as Record<string, unknown>),
    ultima: () => JSON.parse(linhas[linhas.length - 1] ?? '{}') as Record<string, unknown>,
  };
}

describe('formato da linha', () => {
  it('escreve uma linha de JSON com instante, nível e evento', () => {
    const c = coletor();
    c.registrador.info('job.concluido', { jobId: 'abc', gravados: 2 });

    expect(c.linhas).toHaveLength(1);
    expect(c.linhas[0]?.endsWith(NL)).toBe(true);
    expect(c.ultima()).toEqual({
      t: '2026-09-12T09:00:00.000Z',
      nivel: 'info',
      evento: 'job.concluido',
      jobId: 'abc',
      gravados: 2,
    });
  });

  it('respeita o nível mínimo', () => {
    const linhas: string[] = [];
    const log = criarRegistrador({ nivelMinimo: 'aviso', escrever: (l) => linhas.push(l) });

    log.debug('a');
    log.info('b');
    log.aviso('c');
    log.erro('d');

    expect(linhas).toHaveLength(2);
  });

  it('campo do chamador não sobrescreve instante, nível nem evento', () => {
    const c = coletor();
    c.registrador.info('real', { t: 'mentira', nivel: 'erro', evento: 'outro' });

    expect(c.ultima()['evento']).toBe('real');
    expect(c.ultima()['nivel']).toBe('info');
    expect(c.ultima()['t']).toBe('2026-09-12T09:00:00.000Z');
  });

  it('com() acrescenta contexto sem contaminar o registrador de origem', () => {
    const c = coletor();
    const filho = c.registrador.com({ poller: 'ingestao' });

    filho.info('filho');
    c.registrador.info('pai');

    const [primeira, segunda] = c.objetos();
    expect(primeira?.['poller']).toBe('ingestao');
    expect(segunda?.['poller']).toBeUndefined();
  });

  it('o registrador silencioso não escreve nada e continua encadeável', () => {
    expect(() => {
      registradorSilencioso.com({ a: 1 }).erro('nada', { erro: new Error('x') });
    }).not.toThrow();
  });
});

describe('valores que fariam JSON.stringify lançar', () => {
  it('bigint vira texto, não Number — centavo acima de 2^53 não perde precisão', () => {
    expect(sanear(12345678901234567890n)).toBe('12345678901234567890');

    const c = coletor();
    c.registrador.info('preco', { centavos: 6990n });
    expect(c.ultima()['centavos']).toBe('6990');
  });

  it('referência circular não derruba', () => {
    const a: Record<string, unknown> = { nome: 'a' };
    a['eu'] = a;

    const c = coletor();
    expect(() => {
      c.registrador.info('ciclo', { a });
    }).not.toThrow();
    expect(JSON.stringify(c.ultima())).toContain('[circular]');
  });

  it('Error não vira objeto vazio: nome, mensagem e pilha aparecem', () => {
    const c = coletor();
    c.registrador.erro('falhou', { erro: new TypeError('deu ruim') });

    const erro = c.ultima()['erro'] as Record<string, unknown>;
    expect(erro['nome']).toBe('TypeError');
    expect(erro['mensagem']).toBe('deu ruim');
    expect(Array.isArray(erro['pilha'])).toBe(true);
  });

  it('campo próprio de erro de domínio é preservado', () => {
    class ConteudoNaoEncontrado extends Error {
      override readonly name = 'ConteudoNaoEncontrado';
      constructor(readonly hash: string) {
        super(`não achei ${hash}`);
      }
    }

    const c = coletor();
    c.registrador.erro('leitura', { erro: new ConteudoNaoEncontrado('abc123') });

    const erro = c.ultima()['erro'] as Record<string, unknown>;
    expect(erro['hash']).toBe('abc123');
  });

  it('causa encadeada aparece', () => {
    const c = coletor();
    c.registrador.erro('falhou', {
      erro: new Error('externo', { cause: new Error('interno') }),
    });

    const erro = c.ultima()['erro'] as Record<string, unknown>;
    const causa = erro['causa'] as Record<string, unknown>;
    expect(causa['mensagem']).toBe('interno');
  });

  it('quando a escrita falha, tenta uma linha de recurso e não lança', () => {
    const linhas: string[] = [];
    let primeira = true;
    const log = criarRegistrador({
      escrever: (l) => {
        if (primeira) {
          primeira = false;
          throw new Error('destino de log quebrado');
        }
        linhas.push(l);
      },
    });

    expect(() => {
      log.info('evento.original');
    }).not.toThrow();

    const recurso = JSON.parse(linhas[0] ?? '{}') as Record<string, unknown>;
    expect(recurso['evento']).toBe('log.falhou_ao_serializar');
    expect(recurso['eventoOriginal']).toBe('evento.original');
  });

  it('destino completamente quebrado perde a linha em vez do processo', () => {
    const log = criarRegistrador({
      escrever: () => {
        throw new Error('sempre falha');
      },
    });
    expect(() => {
      log.erro('nada vai sair');
    }).not.toThrow();
  });
});

describe('redação de campo sensível', () => {
  it('reconhece os nomes que carregam segredo', () => {
    for (const nome of [
      'senha',
      'password',
      'accessToken',
      'refresh_token',
      'client_secret',
      'chaveMestra',
      'apiKey',
      'Authorization',
      'cookie',
      'credencial',
    ]) {
      expect(ehCampoSensivel(nome), nome).toBe(true);
    }
  });

  it('não esconde a chave de idempotência, que é o que liga log e banco', () => {
    expect(ehCampoSensivel('chaveIdempotencia')).toBe(false);
    expect(ehCampoSensivel('chave_idempotencia')).toBe(false);
  });

  it('redige no topo e dentro de objeto aninhado', () => {
    const c = coletor();
    c.registrador.info('credencial.usada', {
      token: 'segredo-de-verdade',
      credencial: { accessToken: 'outro', plataforma: 'ml' },
      chaveIdempotencia: 'abc',
    });

    const linha = c.ultima();
    expect(linha['token']).toBe(OCULTO);
    expect(linha['credencial']).toBe(OCULTO);
    expect(linha['chaveIdempotencia']).toBe('abc');
    expect(c.linhas[0]).not.toContain('segredo-de-verdade');
  });

  it('redige campo sensível dentro de erro', () => {
    class ErroComToken extends Error {
      readonly accessToken = 'nao-deve-aparecer';
    }
    const c = coletor();
    c.registrador.erro('x', { erro: new ErroComToken('falhou') });

    expect(c.linhas[0]).not.toContain('nao-deve-aparecer');
  });
});

describe('limites de tamanho', () => {
  it('recorta texto longo — payload de 8 KB não cabe numa linha de log', () => {
    const longo = 'a'.repeat(MAX_TEXTO + 500);
    const saida = sanear(longo);

    expect(typeof saida).toBe('string');
    expect(String(saida)).toHaveLength(MAX_TEXTO + `[+500]`.length);
    expect(String(saida).endsWith('[+500]')).toBe(true);
  });

  it('recorta lista longa e diz quantos ficaram de fora', () => {
    const saida = sanear(Array.from({ length: MAX_ITENS + 5 }, (_, i) => i));

    expect(Array.isArray(saida)).toBe(true);
    const lista = saida as unknown[];
    expect(lista).toHaveLength(MAX_ITENS + 1);
    expect(lista[MAX_ITENS]).toBe('[+5]');
  });

  it('corta profundidade', () => {
    let fundo: Record<string, unknown> = { fim: 'aqui' };
    for (let i = 0; i < MAX_PROFUNDIDADE + 2; i += 1) fundo = { dentro: fundo };

    expect(JSON.stringify(sanear(fundo))).toContain('[profundo]');
  });

  it('conta as chaves omitidas de um objeto largo', () => {
    const largo: Record<string, number> = {};
    for (let i = 0; i < MAX_ITENS + 3; i += 1) largo[`c${String(i)}`] = i;

    const saida = sanear(largo) as Record<string, unknown>;
    expect(saida['_omitidos']).toBe(3);
  });
});

describe('tipos diversos', () => {
  it('Date vira ISO, Map e Set viram estruturas legíveis', () => {
    expect(sanear(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(sanear(new Map([['a', 1]]))).toEqual({ a: 1 });
    expect(sanear(new Set([1, 2]))).toEqual([1, 2]);
  });

  it('número não finito vira texto em vez de null', () => {
    expect(sanear(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(sanear(Number.NaN)).toBe('NaN');
  });

  it('função e símbolo não viram undefined silencioso', () => {
    expect(sanear(function batata() {})).toBe('[função batata]');
    expect(sanear(Symbol('x'))).toBe('Symbol(x)');
  });

  it('undefined e null viram null', () => {
    expect(sanear(undefined)).toBeNull();
    expect(sanear(null)).toBeNull();
  });
});

describe('nivelDoAmbiente', () => {
  it('aceita os níveis conhecidos, com folga de caixa e espaço', () => {
    expect(nivelDoAmbiente('debug')).toBe('debug');
    expect(nivelDoAmbiente(' ERRO ')).toBe('erro');
  });

  it('cai no padrão para ausente ou desconhecido, em vez de lançar', () => {
    expect(nivelDoAmbiente(undefined)).toBe('info');
    expect(nivelDoAmbiente('verboso')).toBe('info');
    expect(nivelDoAmbiente('', 'aviso')).toBe('aviso');
  });
});
