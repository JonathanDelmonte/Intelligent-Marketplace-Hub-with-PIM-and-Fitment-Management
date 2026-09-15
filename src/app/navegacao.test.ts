/**
 * Testes da navegação.
 *
 * A navegação é dado, não lógica, então o que se testa aqui são **invariantes da
 * lista** — e o motivo de testá-las é histórico: a barra já ficou sem uma tela que
 * existia, e ninguém percebeu porque nada quebrou. O que uma tela inalcançável
 * produz é uma tela inalcançável, não um erro.
 */
import { describe, expect, it } from 'vitest';
import { GRUPOS, PORTAS, TITULO_DO_GRUPO, portaAtual, portasPorGrupo } from './navegacao';

describe('PORTAS', () => {
  it('não tem href repetido', () => {
    const vistos = new Set(PORTAS.map((p) => p.href));
    expect(vistos.size).toBe(PORTAS.length);
  });

  it('toda porta que não é a inicial tem grupo e descrição', () => {
    // As duas coisas são a mesma regra vista de dois lados: sem grupo a porta não
    // aparece na barra, sem descrição não aparece na página inicial. Qualquer uma das
    // duas faltando esconde a tela.
    const semGrupo = PORTAS.filter((p) => p.href !== '/' && p.grupo === null);
    const semDescricao = PORTAS.filter((p) => p.href !== '/' && p.descricao === null);
    expect(semGrupo).toEqual([]);
    expect(semDescricao).toEqual([]);
  });

  it('a porta inicial não tem grupo nem descrição, porque não é um momento de trabalho', () => {
    const inicio = PORTAS.find((p) => p.href === '/');
    expect(inicio?.grupo).toBeNull();
    expect(inicio?.descricao).toBeNull();
  });

  it('todo rótulo é curto o bastante para caber numa linha de barra', () => {
    // Não é frescura de estilo: rótulo comprido é o que fazia a barra passar de 390px
    // e dar rolagem horizontal na página inteira. Ver o comentário no `layout`.
    const compridos = PORTAS.filter((p) => p.rotulo.length > 16).map((p) => p.rotulo);
    expect(compridos).toEqual([]);
  });
});

describe('portasPorGrupo', () => {
  it('cobre todas as portas com grupo, uma vez cada', () => {
    const agrupadas = portasPorGrupo().flatMap((g) => g.portas);
    const comGrupo = PORTAS.filter((p) => p.grupo !== null);
    expect(agrupadas).toHaveLength(comGrupo.length);
    expect(new Set(agrupadas.map((p) => p.href))).toEqual(new Set(comGrupo.map((p) => p.href)));
  });

  it('segue a ordem de GRUPOS, e não a ordem em que as portas aparecem', () => {
    expect(portasPorGrupo().map((g) => g.grupo)).toEqual([...GRUPOS]);
  });

  it('dentro do grupo, mantém a ordem de PORTAS', () => {
    const catalogo = portasPorGrupo().find((g) => g.grupo === 'catalogo');
    expect(catalogo?.portas.map((p) => p.href)).toEqual([
      '/importar',
      '/juntar-iguais',
      '/compatibilidade',
      '/anuncios',
    ]);
  });

  it('omite grupo sem porta nenhuma', () => {
    const so = portasPorGrupo([{ href: '/x', rotulo: 'X', descricao: 'x', grupo: 'hoje' }]);
    expect(so).toHaveLength(1);
    expect(so[0]?.titulo).toBe(TITULO_DO_GRUPO.hoje);
  });
});

describe('portaAtual', () => {
  it('casa o caminho exato', () => {
    expect(portaAtual('/fiscal')?.rotulo).toBe('Fiscal');
  });

  it('casa a tela de dentro com a porta que leva a ela', () => {
    // `/importar/<id>` é a tela de importação vista de perto: marcar "Importar" na
    // barra é a resposta certa, e deixar a barra sem marca nenhuma seria pior.
    expect(portaAtual('/importar/8f0c1a2b')?.href).toBe('/importar');
  });

  it('não deixa a raiz casar com tudo', () => {
    expect(portaAtual('/')?.href).toBe('/');
    expect(portaAtual('/nao-existe')).toBeNull();
  });

  it('prefixo parcial não conta como porta', () => {
    // `/fiscalizacao` não é `/fiscal` — a comparação inclui a barra, de propósito.
    expect(portaAtual('/fiscalizacao')).toBeNull();
  });

  it('empate vai para a porta mais específica', () => {
    const portas = [
      { href: '/a', rotulo: 'A', descricao: 'a', grupo: 'hoje' as const },
      { href: '/a/b', rotulo: 'AB', descricao: 'ab', grupo: 'hoje' as const },
    ];
    expect(portaAtual('/a/b/c', portas)?.href).toBe('/a/b');
  });
});
