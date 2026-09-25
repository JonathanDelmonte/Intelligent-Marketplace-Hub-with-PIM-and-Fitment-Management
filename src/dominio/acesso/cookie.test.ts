import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinarSessao, chaveDeSessao, lerSessaoAssinada } from './cookie';

const MESTRA = randomBytes(32).toString('base64');
const CHAVE = chaveDeSessao(MESTRA);
const AGORA = new Date('2026-09-25T12:00:00.000Z');
const SESSAO = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  expiraEm: new Date('2026-10-25T12:00:00.000Z'),
};

describe('cookie de sessão assinado', () => {
  it('o que foi assinado aqui volta igual', () => {
    const valor = assinarSessao(SESSAO, CHAVE);
    expect(lerSessaoAssinada(valor, CHAVE, AGORA)).toEqual(SESSAO);
  });

  it('cookie alterado não vale: nem o id, nem o vencimento, nem a assinatura', () => {
    const valor = assinarSessao(SESSAO, CHAVE);
    const [id, vence, sinal] = valor.split('.');
    const outroId = '1f8fad5b-d9cb-469f-a165-70867728950e';
    expect(lerSessaoAssinada(`${outroId}.${vence ?? ''}.${sinal ?? ''}`, CHAVE, AGORA)).toBeNull();
    expect(lerSessaoAssinada(`${id ?? ''}.9999999999.${sinal ?? ''}`, CHAVE, AGORA)).toBeNull();
    expect(lerSessaoAssinada(`${id ?? ''}.${vence ?? ''}.AAAA`, CHAVE, AGORA)).toBeNull();
  });

  it('cookie de outro servidor (outra chave mestra) não vale', () => {
    const deOutro = assinarSessao(SESSAO, chaveDeSessao(randomBytes(32).toString('base64')));
    expect(lerSessaoAssinada(deOutro, CHAVE, AGORA)).toBeNull();
  });

  it('cookie vencido não vale', () => {
    const valor = assinarSessao(SESSAO, CHAVE);
    expect(lerSessaoAssinada(valor, CHAVE, new Date('2026-10-25T12:00:00.000Z'))).toBeNull();
  });

  it('lixo não vale, e não lança', () => {
    for (const lixo of [undefined, '', 'a.b', 'a.b.c.d', 'x'.repeat(500), 'não.é.cookie']) {
      expect(lerSessaoAssinada(lixo, CHAVE, AGORA)).toBeNull();
    }
  });

  it('a chave da sessão não é a chave mestra', () => {
    // O que cifra credencial não assina cookie: vazar uma não entrega a outra.
    expect(CHAVE.equals(Buffer.from(MESTRA, 'base64'))).toBe(false);
    expect(chaveDeSessao(MESTRA).equals(CHAVE)).toBe(true);
  });
});
