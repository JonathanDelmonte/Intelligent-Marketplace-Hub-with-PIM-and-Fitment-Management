import { describe, expect, it } from 'vitest';
import { LimiteDeTentativas } from './tentativas';

const T0 = new Date('2026-09-25T12:00:00.000Z');
const minutos = (n: number): Date => new Date(T0.getTime() + n * 60_000);

describe('LimiteDeTentativas', () => {
  it('bloqueia na quinta falha, e libera quando a janela passa', () => {
    const limite = new LimiteDeTentativas(5, 15 * 60_000);
    const chaves = ['email:eu@loja.com', 'ip:1.2.3.4'];
    for (let i = 0; i < 4; i += 1) limite.registrarFalha(chaves, minutos(i));
    expect(limite.bloqueadoAte(chaves, minutos(4))).toBeNull();

    limite.registrarFalha(chaves, minutos(4));
    expect(limite.bloqueadoAte(chaves, minutos(5))).toEqual(minutos(15));
    expect(limite.bloqueadoAte(chaves, minutos(16))).toBeNull();
  });

  it('trocar de e-mail não libera o endereço de rede', () => {
    const limite = new LimiteDeTentativas(3, 15 * 60_000);
    limite.registrarFalha(['email:a@x.com', 'ip:9.9.9.9'], minutos(0));
    limite.registrarFalha(['email:b@x.com', 'ip:9.9.9.9'], minutos(1));
    limite.registrarFalha(['email:c@x.com', 'ip:9.9.9.9'], minutos(2));
    expect(limite.bloqueadoAte(['email:d@x.com', 'ip:9.9.9.9'], minutos(3))).not.toBeNull();
    expect(limite.bloqueadoAte(['email:d@x.com', 'ip:8.8.8.8'], minutos(3))).toBeNull();
  });

  it('entrar zera a contagem do e-mail', () => {
    const limite = new LimiteDeTentativas(2, 15 * 60_000);
    limite.registrarFalha(['email:eu@loja.com'], minutos(0));
    limite.limpar('email:eu@loja.com');
    limite.registrarFalha(['email:eu@loja.com'], minutos(1));
    expect(limite.bloqueadoAte(['email:eu@loja.com'], minutos(2))).toBeNull();
  });
});
