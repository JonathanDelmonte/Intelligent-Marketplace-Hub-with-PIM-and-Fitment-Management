import { describe, expect, it } from 'vitest';
import { linhaDoProduto, mensagemDePrimeiroContato } from './contato';
import { PERGUNTAS, TEXTO_DA_PERGUNTA } from './triagem';

const PRODUTO = { descricao: 'refil de purificador de água' };

describe('linhaDoProduto', () => {
  it('usa só a descrição quando é o que há', () => {
    expect(linhaDoProduto(PRODUTO)).toBe('refil de purificador de água');
  });

  it('acrescenta o código do fabricante, que é o que elimina ambiguidade', () => {
    expect(linhaDoProduto({ ...PRODUTO, codigo: 'EF-ELX-21' })).toContain('código EF-ELX-21');
  });

  it('lista os modelos em que serve, para o fornecedor achar o item', () => {
    expect(linhaDoProduto({ ...PRODUTO, modelos: ['PA21G', 'PA26G'] })).toContain(
      'serve em PA21G, PA26G',
    );
  });

  it('ignora código vazio e nulo em vez de escrever "código"', () => {
    expect(linhaDoProduto({ ...PRODUTO, codigo: '' })).toBe('refil de purificador de água');
    expect(linhaDoProduto({ ...PRODUTO, codigo: null })).toBe('refil de purificador de água');
  });
});

describe('mensagemDePrimeiroContato', () => {
  const base = { vendedor: 'João', produto: PRODUTO };

  it('diz quem fala, o que quer e quanto quer, nessa ordem', () => {
    const texto = mensagemDePrimeiroContato({ ...base, quantidadeInicial: 20 });
    const posicaoDoQuem = texto.indexOf('Sou João');
    const posicaoDoQuanto = texto.indexOf('20 unidades');
    expect(posicaoDoQuem).toBeGreaterThanOrEqual(0);
    expect(posicaoDoQuanto).toBeGreaterThan(posicaoDoQuem);
  });

  it('não inventa nome de fornecedor quando não há', () => {
    expect(mensagemDePrimeiroContato(base).startsWith('Olá!')).toBe(true);
  });

  it('cumprimenta pelo nome quando há', () => {
    expect(
      mensagemDePrimeiroContato({ ...base, fornecedor: 'Acme' }).startsWith('Olá, Acme!'),
    ).toBe(true);
  });

  it('pede preço sem quantidade quando a quantidade não foi decidida', () => {
    const texto = mensagemDePrimeiroContato(base);
    expect(texto).toContain('preço de revenda');
    expect(texto).not.toContain('unidades');
  });

  it('trata quantidade zero e negativa como ausente', () => {
    for (const q of [0, -5]) {
      expect(mensagemDePrimeiroContato({ ...base, quantidadeInicial: q })).not.toContain(
        'unidades',
      );
    }
  });

  it('inclui só as perguntas que faltam', () => {
    const texto = mensagemDePrimeiroContato({ ...base, pendentes: ['emite_nf'] });
    expect(texto).toContain(TEXTO_DA_PERGUNTA.emite_nf);
    expect(texto).not.toContain(TEXTO_DA_PERGUNTA.posta_com_etiqueta);
  });

  it('numera as perguntas na ordem informada', () => {
    const texto = mensagemDePrimeiroContato({
      ...base,
      pendentes: ['posta_com_etiqueta', 'emite_nf'],
    });
    expect(texto).toContain(`1. ${TEXTO_DA_PERGUNTA.posta_com_etiqueta}`);
    expect(texto).toContain(`2. ${TEXTO_DA_PERGUNTA.emite_nf}`);
  });

  it('sem pendências não pergunta nada, só cota', () => {
    const texto = mensagemDePrimeiroContato({ ...base, pendentes: [] });
    expect(texto).not.toContain('perguntas rápidas');
  });

  it('cabe as cinco perguntas quando nada se sabe', () => {
    const texto = mensagemDePrimeiroContato({ ...base, pendentes: PERGUNTAS });
    for (const p of PERGUNTAS) expect(texto, p).toContain(TEXTO_DA_PERGUNTA[p]);
  });

  it('não contém nome de marca do sistema — quem fala vem por parâmetro', () => {
    const texto = mensagemDePrimeiroContato(base);
    expect(texto.toLowerCase()).not.toContain('bancada');
    expect(texto.toLowerCase()).not.toContain('zirtuno');
  });
});
