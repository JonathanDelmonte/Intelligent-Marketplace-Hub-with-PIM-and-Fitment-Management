/**
 * Testes da navegação.
 *
 * A navegação é dado, não lógica, então o que se testa aqui são **invariantes da
 * lista** — e o motivo de testá-las é histórico: a barra já ficou sem uma tela que
 * existia, e ninguém percebeu porque nada quebrou. O que uma tela inalcançável
 * produz é uma tela inalcançável, não um erro.
 */
import { describe, expect, it } from 'vitest';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import {
  CAMINHO_DAS_LOJAS,
  GRUPOS,
  PORTAS,
  TITULO_DO_GRUPO,
  caminhoDaLoja,
  hrefAtual,
  portasDasLojas,
  portasPorGrupo,
  type Porta,
} from './navegacao';

const escrita = (href: string, extra: Partial<Porta> = {}): Porta => ({
  href,
  rotulo: href,
  descricao: href,
  grupo: 'produtos',
  icone: 'catalogo',
  tambem: [],
  destaque: false,
  ...extra,
});

describe('PORTAS', () => {
  it('não tem href repetido, nem entre as telas que moram dentro de outras', () => {
    const todos = PORTAS.flatMap((p) => [p.href, ...p.tambem]);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('toda porta que não é a visão geral tem descrição', () => {
    // Sem descrição a porta não aparece no índice da página inicial, e o índice é o
    // lugar onde quem está aprendendo descobre o que cada tela faz.
    const semDescricao = PORTAS.filter((p) => p.href !== '/' && p.descricao === null);
    expect(semDescricao).toEqual([]);
  });

  it('todo rótulo é curto o bastante para caber numa linha de barra', () => {
    // Não é frescura de estilo: rótulo comprido é o que fazia a barra passar de 390px
    // e dar rolagem horizontal na página inteira. Ver o comentário no `layout`.
    const compridos = PORTAS.filter((p) => p.rotulo.length > 16).map((p) => p.rotulo);
    expect(compridos).toEqual([]);
  });

  it('só há um destaque, e ele é importar', () => {
    // Tudo entra por ali — planilha, tabela, link, PDF, print —, e é a única porta
    // que é ação e não lugar. Dois destaques competem, e nenhum destaca.
    expect(PORTAS.filter((p) => p.destaque).map((p) => p.href)).toEqual(['/importar']);
  });

  it('juntar iguais e perguntas saíram da barra, e juntar iguais mora no catálogo', () => {
    const hrefs = PORTAS.map((p) => p.href);
    expect(hrefs).not.toContain('/juntar-iguais');
    expect(hrefs).not.toContain('/perguntas');
    expect(PORTAS.find((p) => p.href === '/catalogo')?.tambem).toContain('/juntar-iguais');
  });
});

describe('portasPorGrupo', () => {
  it('cobre todas as portas, uma vez cada', () => {
    const agrupadas = portasPorGrupo().flatMap((g) => g.portas);
    expect(agrupadas).toHaveLength(PORTAS.length);
    expect(new Set(agrupadas.map((p) => p.href))).toEqual(new Set(PORTAS.map((p) => p.href)));
  });

  it('segue a ordem de GRUPOS, e não a ordem em que as portas aparecem', () => {
    expect(portasPorGrupo().map((g) => g.grupo)).toEqual([...GRUPOS]);
  });

  it('dentro do grupo, mantém a ordem de PORTAS', () => {
    const produtos = portasPorGrupo().find((g) => g.grupo === 'produtos');
    expect(produtos?.portas.map((p) => p.href)).toEqual([
      '/catalogo',
      '/compatibilidade',
      '/anuncios',
    ]);
  });

  it('o topo não tem título, e os outros grupos têm', () => {
    expect(TITULO_DO_GRUPO.topo).toBeNull();
    const semTitulo = GRUPOS.filter((g) => g !== 'topo' && TITULO_DO_GRUPO[g] === null);
    expect(semTitulo).toEqual([]);
  });

  it('omite grupo sem porta nenhuma', () => {
    const so = portasPorGrupo([escrita('/x', { grupo: 'empresa' })]);
    expect(so).toHaveLength(1);
    expect(so[0]?.titulo).toBe(TITULO_DO_GRUPO.empresa);
  });
});

describe('portasDasLojas', () => {
  it('uma porta por plataforma, na ordem do domínio, com o nome que se lê', () => {
    const lojas = portasDasLojas();
    expect(lojas.map((l) => l.plataforma)).toEqual([...PLATAFORMAS]);
    expect(lojas[0]).toEqual({ plataforma: 'ml', href: '/lojas/ml', rotulo: 'Mercado Livre' });
  });

  it('a área de cada loja fica debaixo da porta de adicionar loja', () => {
    expect(caminhoDaLoja('shopee').startsWith(`${CAMINHO_DAS_LOJAS}/`)).toBe(true);
  });
});

describe('hrefAtual', () => {
  it('casa o caminho exato', () => {
    expect(hrefAtual('/fiscal')).toBe('/fiscal');
    expect(hrefAtual('/')).toBe('/');
  });

  it('casa a tela de dentro com a porta que leva a ela', () => {
    // `/importar/<id>` é a tela de importação vista de perto: marcar "Importar" na
    // barra é a resposta certa, e deixar a barra sem marca nenhuma seria pior.
    expect(hrefAtual('/importar/8f0c1a2b')).toBe('/importar');
  });

  it('marca o catálogo em juntar iguais, que mora dentro dele', () => {
    expect(hrefAtual('/juntar-iguais')).toBe('/catalogo');
  });

  it('marca a loja, e não a porta de adicionar loja, dentro da área dela', () => {
    expect(hrefAtual('/lojas/shopee')).toBe('/lojas/shopee');
    expect(hrefAtual('/lojas/shopee/conectar')).toBe('/lojas/shopee');
    expect(hrefAtual('/lojas')).toBe('/lojas');
  });

  it('não deixa a raiz casar com tudo', () => {
    expect(hrefAtual('/nao-existe')).toBeNull();
    expect(hrefAtual('/perguntas')).toBeNull();
  });

  it('prefixo parcial não conta como porta', () => {
    // `/fiscalizacao` não é `/fiscal` — a comparação inclui a barra, de propósito.
    expect(hrefAtual('/fiscalizacao')).toBeNull();
  });

  it('empate vai para a porta mais específica, qualquer que seja a ordem da lista', () => {
    const portas = [escrita('/a'), escrita('/a/b')];
    expect(hrefAtual('/a/b/c', portas, [])).toBe('/a/b');
    expect(hrefAtual('/a/b/c', [...portas].reverse(), [])).toBe('/a/b');
  });
});
