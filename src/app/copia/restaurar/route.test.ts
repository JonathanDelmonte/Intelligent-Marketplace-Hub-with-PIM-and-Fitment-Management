/**
 * A rota que restaura a cópia fica fora do porteiro, e por isso confere a conta ela
 * mesma. É o que este teste prova: sem sessão, ou sem o cabeçalho da tela, nada chega à
 * restauração. A restauração em si é testada contra o banco em `restauracao.test.ts`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Conferir from '../../acesso/conferir';
import type * as Log from '@/infra/log';
import type * as Restauracao from '../restauracao';

const { contaDoCookie, restaurarDoNavegador } = vi.hoisted(() => ({
  contaDoCookie: vi.fn<typeof Conferir.contaDoCookie>(),
  restaurarDoNavegador: vi.fn<typeof Restauracao.restaurarDoNavegador>(),
}));
vi.mock('../../acesso/conferir', () => ({ contaDoCookie }));
vi.mock('../restauracao', () => ({ restaurarDoNavegador }));
// Nenhum banco de verdade: a rota só o repassa.
vi.mock('@/infra/banco/cliente', () => ({ banco: () => ({}) }));
// E nada no log do teste: o de erro sairia com pilha no log do CI, que é público.
vi.mock('@/infra/log', async (original) => {
  const log = await original<typeof Log>();
  return { ...log, criarRegistrador: () => log.registradorSilencioso };
});

const { POST } = await import('./route');

const CONTA = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  nome: 'Maria',
  email: 'maria@exemplo.com',
};

function pedido(cabecalhos: Record<string, string>, corpo: string | null = 'cópia') {
  return new NextRequest(new URL('/copia/restaurar', 'http://localhost:3100'), {
    method: 'POST',
    headers: cabecalhos,
    ...(corpo === null ? {} : { body: corpo }),
  });
}

beforeEach(() => {
  contaDoCookie.mockReset();
  restaurarDoNavegador.mockReset();
});

describe('a rota da restauração', () => {
  it('sem sessão: 401, e nada chega à restauração', async () => {
    contaDoCookie.mockResolvedValue(null);

    const resposta = await POST(pedido({ 'x-restaurar': 'sim' }));

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toMatchObject({ situacao: 'recusada' });
    expect(restaurarDoNavegador).not.toHaveBeenCalled();
  });

  it('com sessão, mas sem o cabeçalho que só a tela manda: 403', async () => {
    contaDoCookie.mockResolvedValue(CONTA);

    const resposta = await POST(pedido({ cookie: 'sessao=assinada' }));

    expect(resposta.status).toBe(403);
    expect(restaurarDoNavegador).not.toHaveBeenCalled();
  });

  it('a sessão vem do cookie da sessão, e não de cabeçalho nenhum', async () => {
    contaDoCookie.mockResolvedValue(null);

    await POST(pedido({ cookie: 'sessao=assinada', 'x-restaurar': 'sim', 'x-conta': 'forjada' }));

    expect(contaDoCookie).toHaveBeenCalledWith('assinada', expect.any(Date));
  });

  it('com sessão e cabeçalho, o arquivo vai para a restauração, e a resposta volta como veio', async () => {
    contaDoCookie.mockResolvedValue(CONTA);
    restaurarDoNavegador.mockResolvedValue({
      situacao: 'restaurada',
      geradaEm: '2026-09-26T15:30:00.000Z',
      versao: 'teste',
      tabelas: 25,
      linhas: 9,
      perfil: 'existia',
    });

    const resposta = await POST(pedido({ cookie: 'sessao=assinada', 'x-restaurar': 'sim' }));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('cache-control')).toBe('no-store');
    expect(await resposta.json()).toMatchObject({ situacao: 'restaurada', tabelas: 25 });
    expect(restaurarDoNavegador).toHaveBeenCalledTimes(1);
  });

  it('cópia recusada é 422, com o motivo', async () => {
    contaDoCookie.mockResolvedValue(CONTA);
    restaurarDoNavegador.mockResolvedValue({ situacao: 'recusada', motivo: 'cópia cortada' });

    const resposta = await POST(pedido({ cookie: 'sessao=assinada', 'x-restaurar': 'sim' }));

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({ situacao: 'recusada', motivo: 'cópia cortada' });
  });

  it('banco fora no meio: 500, com resposta que a tela entende', async () => {
    contaDoCookie.mockResolvedValue(CONTA);
    restaurarDoNavegador.mockRejectedValue(new Error('conexão caiu'));

    const resposta = await POST(pedido({ cookie: 'sessao=assinada', 'x-restaurar': 'sim' }));

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toMatchObject({ situacao: 'recusada' });
  });

  it('sem arquivo: 400', async () => {
    contaDoCookie.mockResolvedValue(CONTA);

    const resposta = await POST(pedido({ cookie: 'sessao=assinada', 'x-restaurar': 'sim' }, null));

    expect(resposta.status).toBe(400);
    expect(restaurarDoNavegador).not.toHaveBeenCalled();
  });
});
