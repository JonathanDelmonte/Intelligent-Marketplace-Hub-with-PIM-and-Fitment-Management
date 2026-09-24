/**
 * Testes do chamador do OpenRouter, com `fetch` falso.
 *
 * Nenhum teste fala com o OpenRouter de verdade: a política de rede deste ambiente não
 * alcança o site, e a suíte não pode gastar crédito nem depender de rede. O formato
 * das respostas segue a API de chat do OpenAI, que o OpenRouter repete, com o custo em
 * dólar em `usage.cost` — conferido na documentação do OpenRouter em 24/09/2026.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validarAmbiente } from '@/config/ambiente';
import { llmCall } from '@/infra/banco/schema';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  ChamadorAusente,
  LimiteDoProvedor,
  Orcamento,
  ServicoDeLlm,
  type PedidoAoModelo,
} from './index';
import { MODELOS_PADRAO, chamadorDoAmbiente, modelosDoAmbiente } from './ambiente';
import {
  ChamadorOpenRouter,
  CotaGratuita,
  ENDERECO_DO_OPENROUTER,
  ROTEADOR_GRATUITO,
  RespostaSemJson,
  centavosDoCusto,
  ehModeloGratuito,
  lerJsonDaResposta,
  lerLimite,
  mensagemDeRecusa,
  mensagensDoPedido,
} from './openrouter';

const CHAVE = 'sk-or-v1-chave-de-teste-que-nunca-pode-vazar';

const pedido: PedidoAoModelo = {
  proposito: 'fiscal',
  modelo: 'anthropic/claude-sonnet-5',
  instrucoes: 'Classifique o produto.',
  formato: { type: 'object', properties: { ncm: { type: 'string' } }, required: ['ncm'] },
  entrada: { titulo: 'Refil filtro Electrolux PA21G' },
};

interface Enviado {
  readonly url: string;
  readonly init: RequestInit;
}

/** Um `fetch` que grava o que recebeu e devolve o que o teste mandar. */
function fetchFalso(responder: () => Response | Promise<Response>) {
  const enviados: Enviado[] = [];
  const buscar: typeof fetch = async (url, init) => {
    const endereco = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    enviados.push({ url: endereco, init: init ?? {} });
    return await responder();
  };
  return { buscar, enviados };
}

function respostaDeChat(
  conteudo: string,
  extra: { readonly usage?: unknown; readonly finish_reason?: string } = {},
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: conteudo }, finish_reason: extra.finish_reason ?? 'stop' }],
      usage: extra.usage ?? { prompt_tokens: 100, completion_tokens: 20, cost: 0.0012 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function recusa(status: number, mensagem: string): Response {
  return new Response(JSON.stringify({ error: { message: mensagem } }), { status });
}

function chamador(buscar: typeof fetch): ChamadorOpenRouter {
  return new ChamadorOpenRouter({ chave: CHAVE, centavosPorDolar: 600, buscar });
}

function corpoEnviado(enviado: Enviado | undefined): unknown {
  const corpo = enviado?.init.body;
  return typeof corpo === 'string' ? JSON.parse(corpo) : undefined;
}

describe('ChamadorOpenRouter — o que vai', () => {
  it('manda modelo, conversa e temperatura zero, com a chave no cabeçalho', async () => {
    const { buscar, enviados } = fetchFalso(() => respostaDeChat('{"ncm":"84212100"}'));
    await chamador(buscar).chamar(pedido);

    const [enviado] = enviados;
    expect(enviado?.url).toBe(`${ENDERECO_DO_OPENROUTER}/chat/completions`);
    expect(enviado?.init.method).toBe('POST');
    expect(new Headers(enviado?.init.headers).get('authorization')).toBe(`Bearer ${CHAVE}`);
    expect(corpoEnviado(enviado)).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      temperature: 0,
      messages: [{ role: 'system' }, { role: 'user' }],
    });
  });

  it('põe instruções e formato no sistema, e contexto antes da pergunta', () => {
    const [sistema, usuario] = mensagensDoPedido({
      ...pedido,
      contexto: { exemplos: ['PA21G = EF-ELX-21'] },
    });

    expect(sistema?.content).toContain('Classifique o produto.');
    expect(sistema?.content).toContain(JSON.stringify(pedido.formato));
    const texto = usuario?.content ?? '';
    expect(texto.indexOf('Contexto:')).toBeLessThan(texto.indexOf('Pergunta:'));
    expect(texto).toContain('Refil filtro Electrolux PA21G');
  });

  it('sem contexto, a mensagem do usuário é só a pergunta', () => {
    const [, usuario] = mensagensDoPedido(pedido);
    expect(usuario?.content.startsWith('Pergunta:')).toBe(true);
  });
});

describe('ChamadorOpenRouter — o que volta', () => {
  it('devolve a saída lida como JSON, com tokens e custo em centavos', async () => {
    const { buscar } = fetchFalso(() => respostaDeChat('{"ncm":"84212100"}'));
    const resposta = await chamador(buscar).chamar(pedido);

    // US$ 0,0012 a R$ 6,00 são 0,72 centavo, que conta como 1: o teto é pessimista.
    expect(resposta).toEqual({
      saida: { ncm: '84212100' },
      tokensEntrada: 100,
      tokensSaida: 20,
      custoCentavos: 1,
    });
  });

  it('tolera bloco de código e frase antes do JSON', async () => {
    const { buscar } = fetchFalso(() =>
      respostaDeChat('Segue a classificação:\n```json\n{"ncm":"84212100"}\n```'),
    );
    const resposta = await chamador(buscar).chamar(pedido);
    expect(resposta.saida).toEqual({ ncm: '84212100' });
  });

  it('sem custo informado, o custo fica indefinido e o teto de chamadas protege', async () => {
    const { buscar } = fetchFalso(() =>
      respostaDeChat('{"ncm":"84212100"}', { usage: { prompt_tokens: 10 } }),
    );
    const resposta = await chamador(buscar).chamar(pedido);
    expect(resposta.custoCentavos).toBeUndefined();
    expect(resposta.tokensEntrada).toBe(10);
  });

  it('resposta em prosa é erro, e não saída', async () => {
    const { buscar } = fetchFalso(() => respostaDeChat('Não consigo classificar este item.'));
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(RespostaSemJson);
  });

  it('resposta cortada no limite de tokens é erro', async () => {
    const { buscar } = fetchFalso(() =>
      respostaDeChat('{"ncm":"8421', { finish_reason: 'length' }),
    );
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(/cortada no limite/);
  });

  it('erro do provedor de origem com status 200 vira erro com a mensagem dele', async () => {
    const { buscar } = fetchFalso(
      () => new Response(JSON.stringify({ error: { message: 'Provider returned error' } })),
    );
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(
      'o OpenRouter devolveu erro: Provider returned error',
    );
  });
});

describe('ChamadorOpenRouter — recusas', () => {
  it('chave recusada diz onde conferir e nunca repete a chave', async () => {
    const { buscar } = fetchFalso(() => recusa(401, 'User not found.'));
    const erro = await chamador(buscar)
      .chamar(pedido)
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(Error);
    const mensagem = erro instanceof Error ? erro.message : '';
    expect(mensagem).toContain('LLM_API_KEY');
    expect(mensagem).not.toContain(CHAVE);
  });

  it('sem crédito diz para pôr crédito', () => {
    expect(mensagemDeRecusa(402, '{}')).toMatch(/sem crédito/);
  });

  it('modelo inexistente traz a mensagem do provedor', async () => {
    const { buscar } = fetchFalso(() =>
      recusa(400, 'anthropic/modelo-errado is not a valid model ID'),
    );
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(
      'o OpenRouter respondeu 400: anthropic/modelo-errado is not a valid model ID',
    );
  });

  it('falha de rede diz o motivo de verdade, que mora na causa', async () => {
    const buscar: typeof fetch = () =>
      Promise.reject(
        new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND openrouter.ai') }),
      );
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(
      /ENOTFOUND openrouter\.ai\. Confira a internet/,
    );
  });

  it('tempo esgotado diz quanto esperou', async () => {
    const buscar: typeof fetch = () =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(chamador(buscar).chamar(pedido)).rejects.toThrow(
      'o OpenRouter não respondeu em 120 segundos.',
    );
  });
});

describe('ChamadorOpenRouter — embedding', () => {
  const MODELO_DE_EMBEDDING = 'liquid/lfm-2.5-embedding-350m:free';

  function respostaDeEmbedding(dados: readonly { embedding: number[]; index: number }[]): Response {
    return Response.json({
      model: MODELO_DE_EMBEDDING,
      data: dados,
      usage: { prompt_tokens: 12, cost: 0 },
    });
  }

  it('manda todos os textos num pedido só, na rota de embeddings', async () => {
    const { buscar, enviados } = fetchFalso(() =>
      respostaDeEmbedding([
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
      ]),
    );
    const cota = new CotaGratuita(0);
    await new ChamadorOpenRouter({ chave: CHAVE, centavosPorDolar: 600, buscar, cota }).embeddings({
      modelo: MODELO_DE_EMBEDDING,
      textos: ['refil electrolux efelx21', 'vedacao electrolux vd10'],
    });

    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.url).toBe(`${ENDERECO_DO_OPENROUTER}/embeddings`);
    expect(corpoEnviado(enviados[0])).toEqual({
      model: MODELO_DE_EMBEDDING,
      input: ['refil electrolux efelx21', 'vedacao electrolux vd10'],
    });
  });

  it('põe os vetores na ordem do índice, que é o que liga cada um ao seu texto', async () => {
    const { buscar } = fetchFalso(() =>
      respostaDeEmbedding([
        { embedding: [0.3, 0.4], index: 1 },
        { embedding: [0.1, 0.2], index: 0 },
      ]),
    );
    const resposta = await new ChamadorOpenRouter({
      chave: CHAVE,
      centavosPorDolar: 600,
      buscar,
      cota: new CotaGratuita(0),
    }).embeddings({ modelo: MODELO_DE_EMBEDDING, textos: ['a', 'b'] });

    expect(resposta.vetores).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(resposta).toMatchObject({ tokensEntrada: 12, custoCentavos: 0 });
  });

  it('a cota do gratuito vale para embedding também: esgotada, o pedido nem sai', async () => {
    const volta = Date.now() + 60 * 60 * 1000;
    const cota = new CotaGratuita(0);
    cota.bloquear(new Date(volta), 'acabou a cota diária');
    const { buscar, enviados } = fetchFalso(() => respostaDeEmbedding([]));

    const erro = await new ChamadorOpenRouter({ chave: CHAVE, centavosPorDolar: 600, buscar, cota })
      .embeddings({ modelo: MODELO_DE_EMBEDDING, textos: ['a'] })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(LimiteDoProvedor);
    expect(enviados).toHaveLength(0);
  });
});

describe('peças puras', () => {
  it('centavosDoCusto arredonda para cima sem cobrar o erro de ponto flutuante', () => {
    expect(centavosDoCusto(0.01, 600)).toBe(6);
    expect(centavosDoCusto(0.0012, 600)).toBe(1);
    expect(centavosDoCusto(0, 600)).toBe(0);
    expect(centavosDoCusto(1, 550)).toBe(550);
  });

  it('lerJsonDaResposta recusa texto sem objeto', () => {
    expect(() => lerJsonDaResposta('sem chaves aqui')).toThrow(RespostaSemJson);
    expect(() => lerJsonDaResposta('{ quebrado')).toThrow(RespostaSemJson);
  });

  it('o construtor recusa chave vazia e cotação que não é centavo inteiro', () => {
    expect(() => new ChamadorOpenRouter({ chave: ' ', centavosPorDolar: 600 })).toThrow();
    expect(() => new ChamadorOpenRouter({ chave: CHAVE, centavosPorDolar: 5.5 })).toThrow();
  });
});

describe('ambiente', () => {
  const minimo = {
    DATABASE_URL: 'postgres://localhost:5432/bancada',
    CREDENCIAL_CHAVE_MESTRA: Buffer.alloc(32, 7).toString('base64'),
    BANCADA_PERFIL_PADRAO: 'perfil-de-teste',
  };

  it('sem chave, o chamador é o ausente', () => {
    expect(chamadorDoAmbiente(validarAmbiente(minimo))).toBeInstanceOf(ChamadorAusente);
    expect(chamadorDoAmbiente(validarAmbiente({ ...minimo, LLM_API_KEY: '  ' }))).toBeInstanceOf(
      ChamadorAusente,
    );
  });

  it('com chave, o chamador é o do OpenRouter', () => {
    expect(chamadorDoAmbiente(validarAmbiente({ ...minimo, LLM_API_KEY: CHAVE }))).toBeInstanceOf(
      ChamadorOpenRouter,
    );
  });

  it('todo modelo padrão é gratuito: é a regra do dono', () => {
    for (const modelo of Object.values(MODELOS_PADRAO)) expect(ehModeloGratuito(modelo)).toBe(true);
  });

  it('linha de modelo vazia no .env usa o padrão — o .env antigo traz as linhas vazias', () => {
    const modelos = modelosDoAmbiente(
      validarAmbiente({ ...minimo, LLM_MODELO_FISCAL: '', LLM_MODELO_JULGAMENTO: 'outro/modelo' }),
    );
    expect(modelos.fiscal).toBe(MODELOS_PADRAO.fiscal);
    expect(modelos.julgamento).toBe('outro/modelo');
    expect(modelos.extracao).toBe(MODELOS_PADRAO.extracao);
  });
});

describe('plano gratuito', () => {
  const gratuito: PedidoAoModelo = { ...pedido, modelo: ROTEADOR_GRATUITO };

  function chamadorGratuito(buscar: typeof fetch, cota: CotaGratuita): ChamadorOpenRouter {
    return new ChamadorOpenRouter({ chave: CHAVE, centavosPorDolar: 600, buscar, cota });
  }

  function cotaDiariaEsgotada(resetMs: number): Response {
    return new Response(
      JSON.stringify({
        error: {
          message:
            'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
          code: 429,
          metadata: {
            headers: {
              'X-RateLimit-Limit': '50',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(resetMs),
            },
          },
        },
      }),
      { status: 429 },
    );
  }

  it('reconhece modelo gratuito pelo sufixo e pelo roteador', () => {
    expect(ehModeloGratuito('openrouter/free')).toBe(true);
    expect(ehModeloGratuito('google/gemma-4-31b-it:free')).toBe(true);
    expect(ehModeloGratuito('anthropic/claude-sonnet-5')).toBe(false);
  });

  it('cota diária esgotada interrompe com a hora de volta, e o pedido seguinte nem sai', async () => {
    const volta = Date.now() + 6 * 60 * 60 * 1000;
    const { buscar, enviados } = fetchFalso(() => cotaDiariaEsgotada(volta));
    const cota = new CotaGratuita(0);
    const chamador = chamadorGratuito(buscar, cota);

    const primeira = await chamador.chamar(gratuito).catch((e: unknown) => e);
    expect(primeira).toBeInstanceOf(LimiteDoProvedor);
    if (!(primeira instanceof LimiteDoProvedor)) throw new Error('esperava LimiteDoProvedor');
    expect(primeira.ate.getTime()).toBe(volta);
    expect(primeira.houveChamada).toBe(true);
    expect(primeira.message).toContain('cota diária');
    expect(primeira.message).toContain('50 pedidos por dia');

    // Pedido recusado por cota também conta: o segundo é recusado aqui, sem rede.
    const segunda = await chamador.chamar(gratuito).catch((e: unknown) => e);
    expect(segunda).toBeInstanceOf(LimiteDoProvedor);
    expect(segunda instanceof LimiteDoProvedor && segunda.houveChamada).toBe(false);
    expect(enviados).toHaveLength(1);
  });

  it('o bloqueio acaba na hora que o provedor disse', () => {
    let agora = 1_000_000;
    const cota = new CotaGratuita(0, () => agora);
    cota.bloquear(new Date(agora + 60_000), 'pausa');
    expect(cota.vigente()).not.toBeNull();
    agora += 60_000;
    expect(cota.vigente()).toBeNull();
  });

  it('espaça os pedidos gratuitos para não passar de 20 por minuto', async () => {
    let agora = 0;
    const esperas: number[] = [];
    const cota = new CotaGratuita(
      3_100,
      () => agora,
      (ms) => {
        esperas.push(ms);
        agora += ms;
        return Promise.resolve();
      },
    );

    await cota.aguardarVez();
    await cota.aguardarVez();
    await cota.aguardarVez();

    expect(esperas).toEqual([3_100, 3_100]);
  });

  it('modelo pago não espera vez nem consulta a cota gratuita', async () => {
    const cota = new CotaGratuita(0);
    cota.bloquear(new Date(Date.now() + 60_000), 'cota gratuita esgotada');
    const { buscar } = fetchFalso(() => respostaDeChat('{"ncm":"84212100"}'));

    const resposta = await chamadorGratuito(buscar, cota).chamar(pedido);
    expect(resposta.saida).toEqual({ ncm: '84212100' });
  });

  it('registra o modelo que o roteador escolheu', async () => {
    const { buscar } = fetchFalso(
      () =>
        new Response(
          JSON.stringify({
            model: 'google/gemma-4-31b-it:free',
            choices: [{ message: { content: '{"ncm":"84212100"}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 50, completion_tokens: 10, cost: 0 },
          }),
        ),
    );
    const resposta = await chamadorGratuito(buscar, new CotaGratuita(0)).chamar(gratuito);
    expect(resposta.modeloServido).toBe('google/gemma-4-31b-it:free');
    expect(resposta.custoCentavos).toBe(0);
  });

  it('conta sem a opção de privacidade dos gratuitos diz onde clicar', async () => {
    const { buscar } = fetchFalso(() =>
      recusa(404, 'No endpoints found matching your data policy (Free model publication).'),
    );
    await expect(chamadorGratuito(buscar, new CotaGratuita(0)).chamar(gratuito)).rejects.toThrow(
      /openrouter\.ai\/settings\/privacy/,
    );
  });

  it('lerLimite: sem dado do provedor, a do dia vira na meia-noite UTC e a do minuto em um minuto', () => {
    const agora = Date.UTC(2026, 8, 24, 15, 0, 0);
    const diaria = lerLimite(
      JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day' } }),
      agora,
    );
    expect(diaria.ate.getTime()).toBe(Date.UTC(2026, 8, 25, 0, 0, 0));

    const doMinuto = lerLimite('não é json', agora);
    expect(doMinuto.ate.getTime()).toBe(agora + 60_000);
    expect(doMinuto.mensagem).toContain('pausa');
  });

  it('lerLimite aceita o instante de volta em segundos', () => {
    const agora = 1_780_000_000_000;
    const emSegundos = Math.floor((agora + 30_000) / 1000);
    const limite = lerLimite(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-min',
          metadata: { headers: { 'X-RateLimit-Reset': emSegundos } },
        },
      }),
      agora,
    );
    expect(limite.ate.getTime()).toBe(emSegundos * 1000);
  });
});

describe.skipIf(!temBancoDeTeste())('ChamadorOpenRouter com o ServicoDeLlm', () => {
  let conexao: ConexaoDeTeste;

  const esquema = z.object({ ncm: z.string().length(8) });
  const parametros = {
    proposito: 'fiscal' as const,
    modelo: 'anthropic/claude-sonnet-5',
    instrucoes: 'Classifique o produto.',
    entrada: { titulo: 'Refil filtro Electrolux PA21G' },
    esquema,
  };

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['llm_call']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('embedding fica em llm_call com um resumo, e não com os vetores', async () => {
    const { buscar } = fetchFalso(() =>
      Response.json({
        model: 'liquid/lfm-2.5-embedding-350m',
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
        usage: { prompt_tokens: 8, cost: 0 },
      }),
    );
    const servico = new ServicoDeLlm(conexao.db, chamador(buscar), new Orcamento(500, 10));

    const resultado = await servico.gerarEmbeddings({
      modelo: 'liquid/lfm-2.5-embedding-350m:free',
      textos: ['a', 'b'],
    });

    expect(resultado).toMatchObject({
      tipo: 'ok',
      vetores: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    });
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha).toMatchObject({
      proposito: 'embedding',
      saida: { vetores: 2, dimensoes: 3 },
      modeloServido: 'liquid/lfm-2.5-embedding-350m',
    });
    expect(servico.gasto.chamadas).toBe(1);
  });

  it('vetores a menos que textos é erro, e não vetor no produto errado', async () => {
    const { buscar } = fetchFalso(() => Response.json({ data: [{ embedding: [0.1], index: 0 }] }));
    const servico = new ServicoDeLlm(conexao.db, chamador(buscar), new Orcamento(500, 10));

    const resultado = await servico.gerarEmbeddings({ modelo: 'm', textos: ['a', 'b'] });

    expect(resultado).toMatchObject({ tipo: 'erro' });
    expect(resultado.tipo === 'erro' ? resultado.mensagem : '').toContain(
      '1 vetores para 2 textos',
    );
  });

  it('provedor sem embedding diz que não suporta, sem gastar nada', async () => {
    const servico = new ServicoDeLlm(
      conexao.db,
      { nome: 'so-chat', chamar: () => Promise.reject(new Error('não usado')) },
      new Orcamento(500, 10),
    );
    expect(await servico.gerarEmbeddings({ modelo: 'm', textos: ['a'] })).toEqual({
      tipo: 'nao_suportado',
    });
    expect(servico.gasto.chamadas).toBe(0);
  });

  it('grava custo e tokens informados pelo OpenRouter em llm_call', async () => {
    const { buscar } = fetchFalso(() => respostaDeChat('{"ncm":"84212100"}'));
    const servico = new ServicoDeLlm(conexao.db, chamador(buscar), new Orcamento(500, 10));

    const resultado = await servico.pedir(parametros);

    expect(resultado).toMatchObject({ tipo: 'ok', valor: { ncm: '84212100' } });
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha).toMatchObject({ custoCentavos: 1, tokensEntrada: 100, tokensSaida: 20 });
    expect(servico.gasto).toEqual({ centavos: 1, chamadas: 1 });
  });

  it('cota do provedor interrompe e fica registrada; a recusa decidida aqui não', async () => {
    const volta = Date.now() + 60 * 60 * 1000;
    const { buscar } = fetchFalso(
      () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Rate limit exceeded: free-models-per-day',
              metadata: { headers: { 'X-RateLimit-Reset': String(volta) } },
            },
          }),
          { status: 429 },
        ),
    );
    const servico = new ServicoDeLlm(
      conexao.db,
      new ChamadorOpenRouter({
        chave: CHAVE,
        centavosPorDolar: 600,
        buscar,
        cota: new CotaGratuita(0),
      }),
      new Orcamento(500, 10),
    );
    const gratuitos = { ...parametros, modelo: ROTEADOR_GRATUITO };

    await expect(servico.pedir(gratuitos)).rejects.toBeInstanceOf(LimiteDoProvedor);
    await expect(
      servico.pedir({ ...gratuitos, entrada: { titulo: 'outro produto' } }),
    ).rejects.toBeInstanceOf(LimiteDoProvedor);

    const linhas = await conexao.db.select().from(llmCall);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.erro).toContain('cota diária');
  });

  it('resposta em prosa não vira cache: a segunda tentativa pergunta de novo', async () => {
    let vez = 0;
    const { buscar, enviados } = fetchFalso(() => {
      vez += 1;
      return vez === 1 ? respostaDeChat('Não sei.') : respostaDeChat('{"ncm":"84212100"}');
    });
    const servico = new ServicoDeLlm(conexao.db, chamador(buscar), new Orcamento(500, 10));

    const primeira = await servico.pedir(parametros);
    const segunda = await servico.pedir(parametros);

    // "Resposta": o modelo respondeu, e não serve — quem trabalha em lote parte o lote.
    expect(primeira).toMatchObject({ tipo: 'erro', natureza: 'resposta' });
    expect(segunda).toMatchObject({ tipo: 'ok', deCache: false });
    expect(enviados).toHaveLength(2);
  });

  it('resposta cortada no teto de tokens também é "resposta", e chave recusada é "provedor"', async () => {
    const cortada = fetchFalso(() =>
      Response.json({
        choices: [{ message: { content: '{"registros": [' }, finish_reason: 'length' }],
      }),
    );
    const recusada = fetchFalso(
      () =>
        new Response(JSON.stringify({ error: { message: 'User not found.' } }), { status: 401 }),
    );

    const porCorte = await new ServicoDeLlm(
      conexao.db,
      chamador(cortada.buscar),
      new Orcamento(500, 10),
    ).pedir(parametros);
    const porChave = await new ServicoDeLlm(
      conexao.db,
      chamador(recusada.buscar),
      new Orcamento(500, 10),
    ).pedir(parametros);

    expect(porCorte).toMatchObject({ tipo: 'erro', natureza: 'resposta' });
    expect(porChave).toMatchObject({ tipo: 'erro', natureza: 'provedor' });
  });
});
