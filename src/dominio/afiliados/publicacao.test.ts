import { describe, expect, it } from 'vitest';
import { pontosBase } from '@/lib/dinheiro';
import {
  ESPACAMENTO_MINIMO_MINUTOS,
  LinkDeAfiliadoInvalido,
  OFERTAS_POR_DIA,
  linkDeAfiliado,
  medirDesempenho,
  proximaPublicacao,
  type OfertaMedida,
  type OfertaNaFila,
} from './publicacao';

const AGORA = new Date('2026-09-15T15:00:00-03:00');

const oferta = (campos: Partial<OfertaNaFila> = {}): OfertaNaFila => ({
  id: 'o1',
  plataforma: 'ml',
  scoreDescontoBp: pontosBase(2000),
  publicadoEmGrupo: null,
  ...campos,
});

/** `n` ofertas publicadas hoje, espaçadas o bastante entre si. */
const publicadasHoje = (n: number): OfertaNaFila[] =>
  Array.from({ length: n }, (_, i) =>
    oferta({
      id: `pub${String(i)}`,
      publicadoEmGrupo: new Date(AGORA.getTime() - (i + 2) * 60 * 60_000),
    }),
  );

describe('linkDeAfiliado', () => {
  it('põe a tag no parâmetro da plataforma', () => {
    const link = linkDeAfiliado('https://produto.mercadolivre.com.br/MLB-1', 'ml', 'minha-tag');
    expect(new URL(link).searchParams.get('matt_word')).toBe('minha-tag');
  });

  it('cada plataforma tem o seu parâmetro', () => {
    expect(linkDeAfiliado('https://shopee.com.br/x-i.1.2', 'shopee', 't')).toContain('af_siteid=t');
    expect(linkDeAfiliado('https://amazon.com.br/dp/B01', 'amazon', 't')).toContain('tag=t');
  });

  it('preserva a query que já existe na URL', () => {
    // Link de produto carrega parâmetro de busca e de posição, e jogar isso fora às
    // vezes muda a página que abre.
    const link = linkDeAfiliado(
      'https://produto.mercadolivre.com.br/MLB-1?searchVariation=9&position=2',
      'ml',
      't',
    );
    const query = new URL(link).searchParams;
    expect(query.get('searchVariation')).toBe('9');
    expect(query.get('position')).toBe('2');
    expect(query.get('matt_word')).toBe('t');
  });

  it('sobrescreve a tag de outra pessoa, em vez de duplicar', () => {
    const link = linkDeAfiliado('https://amazon.com.br/dp/B01?tag=de-outro', 'amazon', 'minha');
    expect(new URL(link).searchParams.getAll('tag')).toEqual(['minha']);
  });

  it('recusa URL inválida e tag vazia, porque link quebrado no grupo é pior que silêncio', () => {
    expect(() => linkDeAfiliado('nao é url', 'ml', 't')).toThrow(LinkDeAfiliadoInvalido);
    expect(() => linkDeAfiliado('https://x.com', 'ml', '  ')).toThrow(LinkDeAfiliadoInvalido);
  });

  it('recusa esquema que não é http', () => {
    expect(() => linkDeAfiliado('javascript:alert(1)', 'ml', 't')).toThrow(LinkDeAfiliadoInvalido);
  });
});

describe('proximaPublicacao', () => {
  it('fila vazia de pendentes não é espera, é nada a fazer', () => {
    expect(proximaPublicacao([], { agora: AGORA }).tipo).toBe('nada_na_fila');
    expect(proximaPublicacao(publicadasHoje(2), { agora: AGORA }).tipo).toBe('nada_na_fila');
  });

  it('publica a de maior desconto primeiro, porque a última pode não sair', () => {
    const decisao = proximaPublicacao(
      [
        oferta({ id: 'fraca', scoreDescontoBp: pontosBase(1600) }),
        oferta({ id: 'forte', scoreDescontoBp: pontosBase(4000) }),
      ],
      { agora: AGORA },
    );
    expect(decisao.tipo).toBe('publicar');
    if (decisao.tipo === 'publicar') expect(decisao.oferta.id).toBe('forte');
  });

  it('empate de desconto desempata pelo id, para a fila ser reproduzível', () => {
    const decisao = proximaPublicacao([oferta({ id: 'zz' }), oferta({ id: 'aa' })], {
      agora: AGORA,
    });
    if (decisao.tipo !== 'publicar') throw new Error('esperava publicar');
    expect(decisao.oferta.id).toBe('aa');
  });

  it('respeita o espaçamento, e diz por que', () => {
    // Duas ofertas seguidas são lidas como spam mesmo quando as duas são boas.
    const decisao = proximaPublicacao(
      [oferta(), oferta({ id: 'pub', publicadoEmGrupo: new Date(AGORA.getTime() - 10 * 60_000) })],
      { agora: AGORA },
    );
    expect(decisao.tipo).toBe('esperar');
    if (decisao.tipo !== 'esperar') return;
    expect(decisao.motivo).toContain('spam');
    expect(decisao.minutosRestantes).toBe(ESPACAMENTO_MINIMO_MINUTOS - 10);
  });

  it('a mensagem do espaçamento não sai com parêntese de plural', () => {
    // "A última saiu há 0 minuto(s)" é o que a tela mostrava: torto, e errado — zero
    // minuto é "agora". Apareceu ao ligar a tela, e é texto que o usuário lê inteiro.
    const agoraMesmo = proximaPublicacao(
      [oferta(), oferta({ id: 'pub', publicadoEmGrupo: AGORA })],
      { agora: AGORA },
    );
    if (agoraMesmo.tipo !== 'esperar') throw new Error('esperava esperar');
    expect(agoraMesmo.motivo).toContain('agora mesmo');
    expect(agoraMesmo.motivo).not.toContain('(s)');

    const umMinuto = proximaPublicacao(
      [oferta(), oferta({ id: 'pub', publicadoEmGrupo: new Date(AGORA.getTime() - 60_000) })],
      { agora: AGORA },
    );
    if (umMinuto.tipo !== 'esperar') throw new Error('esperava esperar');
    expect(umMinuto.motivo).toContain('há 1 minuto.');
  });

  it('passado o espaçamento, publica', () => {
    const decisao = proximaPublicacao(
      [
        oferta(),
        oferta({
          id: 'pub',
          publicadoEmGrupo: new Date(AGORA.getTime() - (ESPACAMENTO_MINIMO_MINUTOS + 1) * 60_000),
        }),
      ],
      { agora: AGORA },
    );
    expect(decisao.tipo).toBe('publicar');
  });

  it('o teto diário para a fila, e a mensagem diz o custo de furá-lo', () => {
    // Grupo silenciado não dá erro e continua recebendo publicação para ninguém.
    const decisao = proximaPublicacao([oferta(), ...publicadasHoje(OFERTAS_POR_DIA)], {
      agora: AGORA,
    });
    expect(decisao.tipo).toBe('esperar');
    if (decisao.tipo !== 'esperar') return;
    expect(decisao.motivo).toContain('silenciado');
    expect(decisao.minutosRestantes).toBeGreaterThan(0);
  });

  it('publicação de ontem não conta no teto de hoje', () => {
    const ontem = oferta({
      id: 'ontem',
      publicadoEmGrupo: new Date(AGORA.getTime() - 20 * 60 * 60_000),
    });
    const decisao = proximaPublicacao([oferta(), ontem], { agora: AGORA });
    expect(decisao.tipo).toBe('publicar');
  });

  it('o dia é o do fuso do vendedor', () => {
    // 22h em São Paulo é 01h do dia seguinte em UTC: contar em UTC zeraria o teto cedo.
    const noite = new Date('2026-09-16T01:00:00Z');
    const cheia = [oferta(), ...publicadasHoje(OFERTAS_POR_DIA)].map((o) =>
      o.publicadoEmGrupo === null
        ? o
        : { ...o, publicadoEmGrupo: new Date(noite.getTime() - 60 * 60_000) },
    );
    expect(proximaPublicacao(cheia, { agora: noite }).tipo).toBe('esperar');
  });

  it('aceita teto e espaçamento próprios', () => {
    const decisao = proximaPublicacao([oferta(), ...publicadasHoje(2)], {
      agora: AGORA,
      porDia: 2,
    });
    expect(decisao.tipo).toBe('esperar');
  });
});

describe('medirDesempenho', () => {
  const medida = (campos: Partial<OfertaMedida> = {}): OfertaMedida => ({
    cliques: 10,
    conversoes: 1,
    publicadoEmGrupo: AGORA,
    ...campos,
  });

  it('nada publicado diz isso, sem número inventado', () => {
    const d = medirDesempenho([medida({ publicadoEmGrupo: null })]);
    expect(d.publicadas).toBe(0);
    expect(d.conversaoBp).toBeNull();
  });

  it('sem clique a conversão é nula, não zero', () => {
    // Zero afirmaria que o grupo não converte, quando o que houve foi ninguém clicar —
    // e as duas leituras levam a ações opostas.
    const d = medirDesempenho([medida({ cliques: 0, conversoes: 0 })]);
    expect(d.conversaoBp).toBeNull();
    expect(d.mensagem).toContain('texto do post');
  });

  it('com clique calcula conversão em pontos-base', () => {
    const d = medirDesempenho([medida({ cliques: 40, conversoes: 3 })]);
    expect(d.cliques).toBe(40);
    expect(d.conversaoBp).toBe(750);
  });

  it('soma só o que foi publicado', () => {
    const d = medirDesempenho([medida(), medida({ publicadoEmGrupo: null, cliques: 999 })]);
    expect(d.cliques).toBe(10);
    expect(d.publicadas).toBe(1);
  });

  it('a mensagem conjuga singular e plural, sem parêntese', () => {
    const uma = medirDesempenho([{ cliques: 1, conversoes: 1, publicadoEmGrupo: AGORA }]);
    expect(uma.mensagem).toContain('1 clique e 1 venda em 1 oferta.');

    const varias = medirDesempenho([
      { cliques: 4, conversoes: 2, publicadoEmGrupo: AGORA },
      { cliques: 3, conversoes: 0, publicadoEmGrupo: AGORA },
    ]);
    expect(varias.mensagem).toContain('7 cliques e 2 vendas em 2 ofertas.');
  });

  it('a mensagem nomeia a leitura de clique sem conversão', () => {
    // É o diagnóstico que muda a ação: o preço na página não é o do post.
    const d = medirDesempenho([medida({ cliques: 50, conversoes: 0 })]);
    expect(d.mensagem).toContain('não é o do post');
  });
});
