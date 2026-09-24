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
import { ChamadorAusente, Orcamento, ServicoDeLlm, type PedidoAoModelo } from './index';
import { MODELOS_PADRAO, chamadorDoAmbiente, modelosDoAmbiente } from './ambiente';
import {
  ChamadorOpenRouter,
  ENDERECO_DO_OPENROUTER,
  RespostaSemJson,
  centavosDoCusto,
  lerJsonDaResposta,
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

  it('linha de modelo vazia no .env usa o padrão — o .env antigo traz as linhas vazias', () => {
    const modelos = modelosDoAmbiente(
      validarAmbiente({ ...minimo, LLM_MODELO_FISCAL: '', LLM_MODELO_JULGAMENTO: 'outro/modelo' }),
    );
    expect(modelos.fiscal).toBe(MODELOS_PADRAO.fiscal);
    expect(modelos.julgamento).toBe('outro/modelo');
    expect(modelos.extracao).toBe(MODELOS_PADRAO.extracao);
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

  it('grava custo e tokens informados pelo OpenRouter em llm_call', async () => {
    const { buscar } = fetchFalso(() => respostaDeChat('{"ncm":"84212100"}'));
    const servico = new ServicoDeLlm(conexao.db, chamador(buscar), new Orcamento(500, 10));

    const resultado = await servico.pedir(parametros);

    expect(resultado).toMatchObject({ tipo: 'ok', valor: { ncm: '84212100' } });
    const [linha] = await conexao.db.select().from(llmCall);
    expect(linha).toMatchObject({ custoCentavos: 1, tokensEntrada: 100, tokensSaida: 20 });
    expect(servico.gasto).toEqual({ centavos: 1, chamadas: 1 });
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

    expect(primeira.tipo).toBe('erro');
    expect(segunda).toMatchObject({ tipo: 'ok', deCache: false });
    expect(enviados).toHaveLength(2);
  });
});
