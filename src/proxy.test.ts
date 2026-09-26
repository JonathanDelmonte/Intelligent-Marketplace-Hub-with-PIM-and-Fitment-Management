import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Conferir from './app/acesso/conferir';

const { contaDoCookie } = vi.hoisted(() => ({
  contaDoCookie: vi.fn<typeof Conferir.contaDoCookie>(),
}));
vi.mock('./app/acesso/conferir', () => ({ contaDoCookie }));

// Importado depois do `vi.mock`, que o vitest sobe para o topo do arquivo.
const { config, proxy } = await import('./proxy');
const { codificarConta } = await import('./app/acesso/caminhos');
const { CAMINHOS_FORA_DO_PORTEIRO } = await import('./app/acesso/constantes');

const CONTA = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  nome: 'Maria',
  email: 'maria@exemplo.com',
};

function pedido(caminho: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(new URL(caminho, 'http://localhost:3100'), init);
}

/** O cabeçalho que o proxy passou adiante para as telas (`NextResponse.next({ request })`). */
function contaRepassada(resposta: Response): string | null {
  return resposta.headers.get('x-middleware-request-x-conta');
}

beforeEach(() => {
  contaDoCookie.mockReset();
});

describe('o matcher do porteiro', () => {
  const pega = (caminho: string) => {
    const [padrao] = config.matcher;
    return new RegExp(`^${padrao ?? ''}$`).test(caminho);
  };

  it('pega toda tela, rota e ação — inclusive as que baixam arquivo', () => {
    for (const caminho of [
      '/',
      '/catalogo',
      '/lojas/mercado_livre/pedidos',
      '/barra',
      '/anuncios/baixar',
      '/compatibilidade/baixar',
      '/entrar',
      '/saude',
    ]) {
      expect(pega(caminho), caminho).toBe(true);
    }
  });

  it('deixa de fora a restauração da cópia, que confere a conta sozinha, e nada perto dela', () => {
    // Com o porteiro na frente, o Next cortaria em 10 MB o arquivo da cópia.
    for (const caminho of CAMINHOS_FORA_DO_PORTEIRO) expect(pega(caminho), caminho).toBe(false);
    for (const caminho of [
      '/copia',
      '/copia/baixar',
      '/copia/restaurar/outra',
      '/copia/restaurarx',
    ]) {
      expect(pega(caminho), caminho).toBe(true);
    }
  });

  it('deixa de fora só o que é arquivo estático', () => {
    for (const caminho of [
      '/_next/static/chunks/app.js',
      '/_next/image',
      '/icone.svg',
      '/sw.js',
      '/wasm/zxing_reader.wasm',
      '/manifest.webmanifest',
      '/favicon.ico',
    ]) {
      expect(pega(caminho), caminho).toBe(false);
    }
  });
});

describe('o porteiro', () => {
  it('rota pública passa sem ir ao banco, e sem o cabeçalho de conta forjado', async () => {
    const resposta = await proxy(pedido('/entrar', { headers: { 'x-conta': 'forjado' } }));
    expect(resposta.headers.get('x-middleware-next')).toBe('1');
    expect(contaRepassada(resposta)).toBeNull();
    expect(contaDoCookie).not.toHaveBeenCalled();
  });

  it('sem sessão, a leitura vai para a tela de entrar com a volta', async () => {
    contaDoCookie.mockResolvedValue(null);
    const resposta = await proxy(pedido('/catalogo?aba=custos'));
    expect(resposta.status).toBe(307);
    expect(new URL(resposta.headers.get('location') ?? '').pathname).toBe('/entrar');
    expect(new URL(resposta.headers.get('location') ?? '').searchParams.get('volta')).toBe(
      '/catalogo?aba=custos',
    );
  });

  it('sem sessão, a ação de servidor recebe o destino no cabeçalho que o Next entende', async () => {
    contaDoCookie.mockResolvedValue(null);
    const resposta = await proxy(
      pedido('/catalogo', { method: 'POST', headers: { 'next-action': 'abc123' } }),
    );
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get('x-action-redirect')).toBe('/entrar?volta=%2Fcatalogo');
  });

  it('sem sessão, outro pedido de escrita recebe 401', async () => {
    contaDoCookie.mockResolvedValue(null);
    const resposta = await proxy(pedido('/importar', { method: 'POST' }));
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get('location')).toBeNull();
  });

  it('cookie que não abre nada é apagado do navegador', async () => {
    contaDoCookie.mockResolvedValue(null);
    const resposta = await proxy(pedido('/catalogo', { headers: { cookie: 'sessao=velho' } }));
    expect(contaDoCookie).toHaveBeenCalledWith('velho', expect.any(Date));
    expect(resposta.headers.get('set-cookie')).toMatch(/^sessao=;/);
  });

  it('com sessão, segue com a conta no cabeçalho — e o forjado some', async () => {
    contaDoCookie.mockResolvedValue(CONTA);
    const resposta = await proxy(
      pedido('/catalogo', { headers: { cookie: 'sessao=bom', 'x-conta': 'forjado' } }),
    );
    expect(resposta.headers.get('x-middleware-next')).toBe('1');
    expect(contaRepassada(resposta)).toBe(codificarConta(CONTA));
  });

  it('sem banco, a porta fica fechada (503), e não aberta', async () => {
    contaDoCookie.mockRejectedValue(new Error('ECONNREFUSED'));
    const resposta = await proxy(pedido('/catalogo', { headers: { cookie: 'sessao=bom' } }));
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('x-middleware-next')).toBeNull();
  });
});
