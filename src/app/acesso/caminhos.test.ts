import { describe, expect, it } from 'vitest';
import {
  caminhoDeEntrar,
  codificarConta,
  cookieDeveSerSeguro,
  decodificarConta,
  ehCaminhoPublico,
  enderecoDeQuemPede,
  lerDestino,
} from './caminhos';
import { CAMINHOS_FORA_DO_PORTEIRO, CAMINHOS_PUBLICOS } from './constantes';

describe('caminhos públicos', () => {
  it('são exatamente as três telas de acesso e a saúde', () => {
    // Um caminho a mais nesta lista é uma tela do sistema aberta para a internet.
    // Quem precisar mudar este teste precisa de um motivo escrito no ADR 0011.
    expect([...CAMINHOS_PUBLICOS].sort()).toEqual(['/cadastro', '/entrar', '/recuperar', '/saude']);
  });

  it('a comparação é do caminho inteiro, não do começo', () => {
    expect(ehCaminhoPublico('/entrar')).toBe(true);
    expect(ehCaminhoPublico('/entrarx')).toBe(false);
    expect(ehCaminhoPublico('/entrar/outra')).toBe(false);
    expect(ehCaminhoPublico('/saude/detalhe')).toBe(false);
    expect(ehCaminhoPublico('/')).toBe(false);
  });
});

describe('caminhos fora do porteiro', () => {
  it('são exatamente a restauração da cópia, que confere a conta sozinha', () => {
    // Um caminho a mais nesta lista é uma rota que tem de conferir a sessão por conta
    // própria. Quem precisar mudar este teste precisa de um motivo escrito num ADR — o
    // desta é o 0017.
    expect([...CAMINHOS_FORA_DO_PORTEIRO]).toEqual(['/copia/restaurar']);
  });
});

describe('destino depois de entrar', () => {
  it('volta para o caminho deste sistema, com a busca', () => {
    expect(lerDestino('/catalogo')).toBe('/catalogo');
    expect(lerDestino('/lojas/mercado_livre/pedidos?pagina=2')).toBe(
      '/lojas/mercado_livre/pedidos?pagina=2',
    );
  });

  it('nunca leva para outro site', () => {
    for (const fora of [
      'https://outro.site/x',
      '//outro.site/x',
      '/\\outro.site',
      '\\\\outro.site',
      'javascript:alert(1)',
      'catalogo',
      '',
    ]) {
      expect(lerDestino(fora)).toBe('/');
    }
  });

  it('não volta para as telas de acesso, e aceita o que não é texto', () => {
    expect(lerDestino('/entrar')).toBe('/');
    expect(lerDestino('/cadastro?x=1')).toBe('/');
    expect(lerDestino(null)).toBe('/');
    expect(lerDestino(undefined)).toBe('/');
  });

  it('a tela de entrar leva a volta na URL, e sem volta quando é a visão geral', () => {
    expect(caminhoDeEntrar('/catalogo?aba=custos')).toBe(
      '/entrar?volta=%2Fcatalogo%3Faba%3Dcustos',
    );
    expect(caminhoDeEntrar('/')).toBe('/entrar');
    expect(caminhoDeEntrar('https://outro.site')).toBe('/entrar');
  });
});

describe('cookie seguro', () => {
  it('segue o protocolo que o Caddy avisa', () => {
    expect(cookieDeveSerSeguro('https', 'exemplo.sslip.io')).toBe(true);
    expect(cookieDeveSerSeguro('https,http', 'exemplo.sslip.io')).toBe(true);
    expect(cookieDeveSerSeguro('http', 'localhost:3000')).toBe(false);
  });

  it('sem aviso, só o próprio computador fica sem Secure', () => {
    expect(cookieDeveSerSeguro(null, 'localhost:3000')).toBe(false);
    expect(cookieDeveSerSeguro(null, '127.0.0.1:3100')).toBe(false);
    expect(cookieDeveSerSeguro(null, '[::1]:3000')).toBe(false);
    expect(cookieDeveSerSeguro(null, 'exemplo.sslip.io')).toBe(true);
    expect(cookieDeveSerSeguro(null, 'localhost.exemplo.com')).toBe(true);
    expect(cookieDeveSerSeguro(null, null)).toBe(true);
  });
});

describe('endereço de quem pede', () => {
  it('o primeiro do X-Forwarded-For, e "desconhecido" sem ele', () => {
    expect(enderecoDeQuemPede('203.0.113.7, 10.0.0.2')).toBe('203.0.113.7');
    expect(enderecoDeQuemPede(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(enderecoDeQuemPede(null)).toBe('desconhecido');
    expect(enderecoDeQuemPede('')).toBe('desconhecido');
  });
});

describe('conta no cabeçalho', () => {
  const CONTA = {
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    nome: 'João Conceição',
    email: 'joao@exemplo.com',
  };

  it('vai e volta igual, com acento', () => {
    const valor = codificarConta(CONTA);
    expect(valor).toMatch(/^[\x21-\x7e]+$/);
    expect(decodificarConta(valor)).toEqual(CONTA);
  });

  it('lixo vira nenhuma conta, sem lançar', () => {
    for (const lixo of [null, undefined, '', '%E0%A4%A', 'nao-e-json', '%7B%7D', '%5B%5D']) {
      expect(decodificarConta(lixo)).toBeNull();
    }
    expect(decodificarConta(encodeURIComponent(JSON.stringify({ ...CONTA, id: 7 })))).toBeNull();
  });
});
