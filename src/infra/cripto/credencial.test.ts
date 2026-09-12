import { describe, expect, it } from 'vitest';
import {
  CredencialCriptografiaInvalida,
  cifrar,
  decifrar,
  gerarChaveMestra,
  segredosIguais,
} from './credencial';
import type { EnderecoDoSegredo } from './credencial';

const CHAVE = gerarChaveMestra();
const OUTRA_CHAVE = gerarChaveMestra();

const endereco: EnderecoDoSegredo = {
  perfilId: '7364972a-45a3-40a9-b77c-e3fa75ed13fb',
  plataforma: 'ml',
  campo: 'token',
};

const TOKEN = 'APP_USR-1234567890abcdef-091200-abcdef1234567890abcdef1234567890-123456789';

describe('ida e volta', () => {
  it('decifra o que cifrou', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(decifrar({ cifrado, endereco, chaveMestraBase64: CHAVE })).toBe(TOKEN);
  });

  it('o texto cifrado não contém o segredo', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(cifrado).not.toContain(TOKEN);
    expect(cifrado).not.toContain('APP_USR');
  });

  it('preserva caractere não-ASCII e emoji', () => {
    const segredo = 'ação-çãõ-日本語-🔐';
    const cifrado = cifrar({ segredo, endereco, chaveMestraBase64: CHAVE });
    expect(decifrar({ cifrado, endereco, chaveMestraBase64: CHAVE })).toBe(segredo);
  });

  it('preserva segredo longo', () => {
    const segredo = 'x'.repeat(8000);
    const cifrado = cifrar({ segredo, endereco, chaveMestraBase64: CHAVE });
    expect(decifrar({ cifrado, endereco, chaveMestraBase64: CHAVE })).toBe(segredo);
  });
});

describe('IV aleatório por chamada', () => {
  it('cifrar o mesmo segredo duas vezes dá saídas diferentes', () => {
    // Saída determinística permitiria descobrir por comparação que dois perfis
    // usam o mesmo token.
    const a = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    const b = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(a).not.toBe(b);
    expect(decifrar({ cifrado: a, endereco, chaveMestraBase64: CHAVE })).toBe(
      decifrar({ cifrado: b, endereco, chaveMestraBase64: CHAVE }),
    );
  });
});

describe('AAD amarra o segredo ao seu endereço', () => {
  it('texto cifrado de um perfil não decifra no endereço de outro', () => {
    // É a proteção central: um UPDATE errado ou um copy-paste de linha não
    // transforma credencial de um perfil em credencial de outro.
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(() =>
      decifrar({
        cifrado,
        endereco: { ...endereco, perfilId: '00000000-0000-0000-0000-000000000000' },
        chaveMestraBase64: CHAVE,
      }),
    ).toThrow(CredencialCriptografiaInvalida);
  });

  it('token do ML não decifra como token da Shopee', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(() =>
      decifrar({
        cifrado,
        endereco: { ...endereco, plataforma: 'shopee' },
        chaveMestraBase64: CHAVE,
      }),
    ).toThrow(CredencialCriptografiaInvalida);
  });

  it('access token não decifra no campo de refresh token', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(() =>
      decifrar({
        cifrado,
        endereco: { ...endereco, campo: 'refresh_token' },
        chaveMestraBase64: CHAVE,
      }),
    ).toThrow(CredencialCriptografiaInvalida);
  });
});

describe('chave errada e dado adulterado', () => {
  it('chave diferente não decifra', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    expect(() => decifrar({ cifrado, endereco, chaveMestraBase64: OUTRA_CHAVE })).toThrow(
      CredencialCriptografiaInvalida,
    );
  });

  it('um byte alterado no dado quebra a autenticação', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    const partes = cifrado.split('.');
    const dados = Buffer.from(partes[3]!, 'base64url');
    dados[0] = (dados[0]! ^ 0xff) & 0xff;
    const adulterado = [partes[0], partes[1], partes[2], dados.toString('base64url')].join('.');

    expect(() => decifrar({ cifrado: adulterado, endereco, chaveMestraBase64: CHAVE })).toThrow(
      CredencialCriptografiaInvalida,
    );
  });

  it('tag alterada quebra a autenticação', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    const partes = cifrado.split('.');
    const tag = Buffer.from(partes[2]!, 'base64url');
    tag[0] = (tag[0]! ^ 0xff) & 0xff;
    const adulterado = [partes[0], partes[1], tag.toString('base64url'), partes[3]].join('.');

    expect(() => decifrar({ cifrado: adulterado, endereco, chaveMestraBase64: CHAVE })).toThrow(
      CredencialCriptografiaInvalida,
    );
  });
});

describe('validação de formato', () => {
  it('recusa chave mestra de tamanho errado', () => {
    const curta = Buffer.alloc(16).toString('base64');
    expect(() => cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: curta })).toThrow(
      /32 bytes/,
    );
  });

  it('recusa segredo vazio', () => {
    expect(() => cifrar({ segredo: '', endereco, chaveMestraBase64: CHAVE })).toThrow(
      CredencialCriptografiaInvalida,
    );
  });

  it('recusa texto cifrado com número errado de partes', () => {
    for (const ruim of ['', 'v1', 'v1.a.b', 'v1.a.b.c.d']) {
      expect(() => decifrar({ cifrado: ruim, endereco, chaveMestraBase64: CHAVE })).toThrow(
        CredencialCriptografiaInvalida,
      );
    }
  });

  it('recusa versão de cifragem desconhecida', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    const comOutraVersao = cifrado.replace(/^v1\./, 'v9.');
    expect(() => decifrar({ cifrado: comOutraVersao, endereco, chaveMestraBase64: CHAVE })).toThrow(
      /versão de cifragem desconhecida/,
    );
  });

  it('recusa IV de tamanho inválido', () => {
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: CHAVE });
    const partes = cifrado.split('.');
    const curto = [partes[0], Buffer.alloc(4).toString('base64url'), partes[2], partes[3]].join(
      '.',
    );
    expect(() => decifrar({ cifrado: curto, endereco, chaveMestraBase64: CHAVE })).toThrow(
      /tamanho inválido/,
    );
  });
});

describe('gerarChaveMestra', () => {
  it('gera 32 bytes utilizáveis', () => {
    const chave = gerarChaveMestra();
    expect(Buffer.from(chave, 'base64')).toHaveLength(32);
    const cifrado = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: chave });
    expect(decifrar({ cifrado, endereco, chaveMestraBase64: chave })).toBe(TOKEN);
  });

  it('não repete', () => {
    const chaves = new Set(Array.from({ length: 50 }, () => gerarChaveMestra()));
    expect(chaves.size).toBe(50);
  });
});

describe('rotação de chave mestra', () => {
  it('decifrar com a antiga e cifrar com a nova preserva o segredo', () => {
    const antiga = gerarChaveMestra();
    const nova = gerarChaveMestra();

    const comAntiga = cifrar({ segredo: TOKEN, endereco, chaveMestraBase64: antiga });
    const claro = decifrar({ cifrado: comAntiga, endereco, chaveMestraBase64: antiga });
    const comNova = cifrar({ segredo: claro, endereco, chaveMestraBase64: nova });

    expect(decifrar({ cifrado: comNova, endereco, chaveMestraBase64: nova })).toBe(TOKEN);
    expect(() => decifrar({ cifrado: comNova, endereco, chaveMestraBase64: antiga })).toThrow();
  });
});

describe('segredosIguais', () => {
  it('compara conteúdo', () => {
    expect(segredosIguais('abc', 'abc')).toBe(true);
    expect(segredosIguais('abc', 'abd')).toBe(false);
  });

  it('tamanhos diferentes não são iguais e não lançam', () => {
    expect(segredosIguais('abc', 'abcd')).toBe(false);
    expect(segredosIguais('', 'x')).toBe(false);
  });

  it('dois vazios são iguais', () => {
    expect(segredosIguais('', '')).toBe(true);
  });
});
