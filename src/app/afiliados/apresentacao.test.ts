import { describe, expect, it } from 'vitest';
import {
  medirDesempenho,
  proximaPublicacao,
  type OfertaNaFila,
} from '@/dominio/afiliados/publicacao';
import { pontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import {
  descontoContra,
  descreverAviso,
  etiquetaDoDesconto,
  lerPreco,
  plataformasComTag,
  plataformasSemTag,
  resumoDaFila,
  tagsDoAmbiente,
  textoDaDecisao,
  VARIAVEL_DA_TAG,
} from './apresentacao';

describe('tagsDoAmbiente', () => {
  it('tag ausente e tag em branco são a mesma coisa', () => {
    // `AFILIADO_TAG_ML=""` no .env é o jeito mais comum de "ainda não configurei", e
    // gerar link com tag vazia seria pior que recusar.
    const tags = tagsDoAmbiente({ AFILIADO_TAG_ML: '  ', AFILIADO_TAG_SHOPEE: undefined });
    expect(tags.ml).toBeNull();
    expect(tags.shopee).toBeNull();
    expect(tags.amazon).toBeNull();
  });

  it('tira o espaço em volta, que é o que sobra de copiar do painel', () => {
    expect(tagsDoAmbiente({ AFILIADO_TAG_AMAZON: ' loja-20 ' }).amazon).toBe('loja-20');
  });

  it('separa o que tem tag do que não tem, e nomeia a variável que falta', () => {
    const tags = tagsDoAmbiente({ AFILIADO_TAG_ML: 'minha-tag' });
    expect(plataformasComTag(tags)).toEqual(['ml']);
    expect(plataformasSemTag(tags)).toEqual(['shopee', 'amazon']);
    expect(VARIAVEL_DA_TAG['shopee']).toBe('AFILIADO_TAG_SHOPEE');
  });
});

describe('descontoContra', () => {
  it('sem referência não existe desconto, e isso não é zero', () => {
    expect(descontoContra(reaisParaCentavos(50), null)).toBeNull();
  });

  it('referência zero ou negativa também não serve de referência', () => {
    expect(descontoContra(reaisParaCentavos(50), reaisParaCentavos(0))).toBeNull();
  });

  it('metade da mediana são 50%', () => {
    expect(descontoContra(reaisParaCentavos(50), reaisParaCentavos(100))).toBe(5_000);
  });

  it('preço no nível da mediana, ou acima, é desconto zero', () => {
    expect(descontoContra(reaisParaCentavos(100), reaisParaCentavos(100))).toBe(0);
    expect(descontoContra(reaisParaCentavos(120), reaisParaCentavos(100))).toBe(0);
  });
});

describe('etiquetaDoDesconto', () => {
  it('com desconto, diz quanto abaixo', () => {
    const e = etiquetaDoDesconto({
      scoreDescontoBp: pontosBase(3_000),
      medianaNoventaDias: reaisParaCentavos(100),
    });
    expect(e.texto).toBe('30% abaixo');
    expect(e.tom).toBe('ok');
  });

  it('sem referência não mostra 0%, porque 0% afirmaria algo que ninguém mediu', () => {
    const e = etiquetaDoDesconto({ scoreDescontoBp: pontosBase(0), medianaNoventaDias: null });
    expect(e.texto).toBe('sem referência');
    expect(e.tom).toBe('neutro');
  });

  it('com referência e sem desconto, é um terceiro estado', () => {
    const e = etiquetaDoDesconto({
      scoreDescontoBp: pontosBase(0),
      medianaNoventaDias: reaisParaCentavos(100),
    });
    expect(e.texto).toBe('sem desconto');
    expect(e.tom).toBe('atencao');
  });
});

describe('textoDaDecisao', () => {
  const oferta = (id: string, publicadoEmGrupo: Date | null): OfertaNaFila => ({
    id,
    plataforma: 'ml',
    scoreDescontoBp: pontosBase(3_000),
    publicadoEmGrupo,
  });

  it('fila vazia diz o que fazer, e não que deu erro', () => {
    const t = textoDaDecisao(proximaPublicacao([]));
    expect(t.tom).toBe('neutro');
    expect(t.titulo).toBe('Nada na fila.');
  });

  it('com oferta pendente e nada publicado, dá para publicar', () => {
    const t = textoDaDecisao(proximaPublicacao([oferta('a', null)]));
    expect(t.tom).toBe('ok');
    expect(t.corpo).toContain('8 por dia');
  });

  it('esperar é atenção, e o motivo do domínio vai no corpo', () => {
    const agora = new Date('2026-09-15T15:00:00Z');
    const t = textoDaDecisao(
      proximaPublicacao([oferta('a', null), oferta('b', new Date('2026-09-15T14:50:00Z'))], {
        agora,
      }),
    );
    expect(t.tom).toBe('atencao');
    expect(t.titulo).toBe('Esperar 35 minutos.');
    expect(t.corpo).toContain('spam');
  });

  it('conjuga o minuto no singular', () => {
    const agora = new Date('2026-09-15T15:00:00Z');
    const t = textoDaDecisao(
      proximaPublicacao([oferta('a', null), oferta('b', new Date('2026-09-15T14:16:00Z'))], {
        agora,
      }),
    );
    expect(t.titulo).toBe('Esperar 1 minuto.');
  });
});

describe('resumoDaFila', () => {
  const publicada = (cliques: number, conversoes: number) => ({
    cliques,
    conversoes,
    publicadoEmGrupo: new Date('2026-09-15T12:00:00Z'),
  });

  it('nada de nada manda para onde a mediana aparece', () => {
    const resumo = resumoDaFila({ pendentes: 0, desempenho: medirDesempenho([]) });
    expect(resumo).toContain('monitor de preço');
  });

  it('fila com pendente e nada publicado diz as duas coisas', () => {
    const resumo = resumoDaFila({ pendentes: 2, desempenho: medirDesempenho([]) });
    expect(resumo).toBe('2 ofertas esperam publicação, e nenhuma saiu ainda.');
  });

  it('conjuga o singular da oferta e do clique', () => {
    const resumo = resumoDaFila({ pendentes: 1, desempenho: medirDesempenho([publicada(1, 0)]) });
    expect(resumo).toBe('1 oferta espera publicação. 1 já saiu, com 1 clique.');
  });

  it('sem pendente, diz que não há nada esperando', () => {
    const resumo = resumoDaFila({ pendentes: 0, desempenho: medirDesempenho([publicada(9, 2)]) });
    expect(resumo).toBe('Nada esperando publicação. 1 já saiu, com 9 cliques.');
  });

  it('a leitura dos números não entra no resumo, para não ficar em dois lugares', () => {
    // A frase interpretativa de `medirDesempenho` mora junto do painel.
    const resumo = resumoDaFila({ pendentes: 0, desempenho: medirDesempenho([publicada(9, 0)]) });
    expect(resumo).not.toContain('texto do post');
  });
});

describe('lerPreco', () => {
  it('lê o que a pessoa digita, com vírgula', () => {
    expect(lerPreco('49,90')).toBe(4_990);
  });

  it('devolve null para o que não é preço, e a ação recusa antes de gravar', () => {
    expect(lerPreco('')).toBeNull();
    expect(lerPreco('barato')).toBeNull();
  });
});

describe('descreverAviso', () => {
  it('código desconhecido não vira aviso', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('a hora da primeira publicação é a que vale, e o aviso diz isso', () => {
    expect(descreverAviso('ja_publicada')?.tom).toBe('atencao');
    expect(descreverAviso('ja_publicada')?.corpo).toContain('primeira publicação');
  });

  it('sem tag é erro de configuração, e o texto diz por que importa', () => {
    const aviso = descreverAviso('sem_tag');
    expect(aviso?.tom).toBe('erro');
    expect(aviso?.corpo).toContain('não paga comissão');
  });

  it('número que não fecha explica a regra em vez de mandar olhar o log', () => {
    const aviso = descreverAviso('numero_invalido');
    expect(aviso?.tom).toBe('erro');
    expect(aviso?.corpo).toContain('sem clicar');
  });
});
