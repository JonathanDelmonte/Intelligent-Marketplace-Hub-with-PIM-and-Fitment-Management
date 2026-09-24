import { describe, expect, it } from 'vitest';
import { FalhaDeRede, ehEnderecoLocal, enderecoPermitido, lerTexto } from './rede';

describe('endereço permitido', () => {
  it('internet sim, rede local não', () => {
    expect(enderecoPermitido('https://loja.com.br/refil')).not.toBeNull();
    expect(enderecoPermitido('http://localhost:5433')).toBeNull();
    expect(enderecoPermitido('http://127.0.0.1/admin')).toBeNull();
    expect(enderecoPermitido('http://192.168.0.1/')).toBeNull();
    expect(enderecoPermitido('http://10.1.2.3/')).toBeNull();
    expect(enderecoPermitido('http://[::1]/')).toBeNull();
  });

  it('só http e https', () => {
    expect(enderecoPermitido('file:///etc/passwd')).toBeNull();
    expect(enderecoPermitido('javascript:alert(1)')).toBeNull();
    expect(enderecoPermitido('não é endereço')).toBeNull();
  });

  it('reconhece a rede local escondida em IPv6', () => {
    expect(ehEnderecoLocal('::ffff:127.0.0.1')).toBe(true);
    expect(ehEnderecoLocal('fd12:3456::1')).toBe(true);
    expect(ehEnderecoLocal('fdloja.com.br')).toBe(false);
  });
});

describe('lerTexto', () => {
  it('lê o corpo e diz o endereço final', async () => {
    const buscar: typeof fetch = () =>
      Promise.resolve(
        new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }),
      );
    const r = await lerTexto('https://loja.com.br/p', { buscar });
    expect(r).toMatchObject({ status: 200, texto: '<html>ok</html>', tipo: 'text/html' });
  });

  it('endereço recusado nem sai', async () => {
    let saiu = false;
    const buscar: typeof fetch = () => {
      saiu = true;
      return Promise.resolve(new Response(''));
    };
    await expect(lerTexto('http://localhost/', { buscar })).rejects.toThrow(FalhaDeRede);
    expect(saiu).toBe(false);
  });

  it('falha de rede vira FalhaDeRede com o motivo', async () => {
    const buscar: typeof fetch = () =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') }));
    await expect(lerTexto('https://loja.com.br/', { buscar })).rejects.toThrow('ENOTFOUND');
  });
});
