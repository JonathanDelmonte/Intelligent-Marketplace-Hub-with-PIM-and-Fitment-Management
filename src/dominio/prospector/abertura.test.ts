import { describe, expect, it } from 'vitest';
import { abrirAlvo, rerotearFronteira } from './abertura';
import { OrcamentoDaBusca, paraGravar, resumirDossie } from './dossie';
import { itemDaFamilia, proximoPasso, valorPorCusto } from './fronteira';
import type { EstadoDaBusca } from './fronteira';
import { FAMILIAS_DE_HIPOTESE } from './hipoteses';
import { reaisParaCentavos } from '@/lib/dinheiro';

describe('rerotearFronteira', () => {
  it('leva o item de abertura para a ferramenta que existe hoje', () => {
    // Dossiê aberto quando a base local não existia tem item apontando para busca na
    // web, e ele ficaria parado para sempre — foi o que aconteceu com dossiê gravado
    // antes de haver executor.
    const aberto = abrirAlvo('refil PA21G', []);
    expect(aberto.fronteira.find((i) => i.familia === 'em_que_mais_serve')?.ferramenta).toBe(
      'busca_web',
    );

    const rerroteado = rerotearFronteira(aberto, ['base_local']);
    expect(rerroteado.fronteira.find((i) => i.familia === 'em_que_mais_serve')?.ferramenta).toBe(
      'base_local',
    );
  });

  it('família que não declara a ferramenta disponível fica como está', () => {
    const rerroteado = rerotearFronteira(abrirAlvo('refil', []), ['base_local']);
    expect(rerroteado.fronteira.find((i) => i.familia === 'onde_e_mais_barato')?.ferramenta).toBe(
      'busca_web',
    );
  });

  it('item ramificado tem rota própria, e não é mexido', () => {
    // Alvo que é URL precisa de leitor de página; trocar para busca na web seria buscar
    // o endereço que já está na mão.
    const base = abrirAlvo('refil', ['base_local']);
    const comRamo: EstadoDaBusca = {
      ...base,
      fronteira: [
        ...base.fronteira,
        itemDaFamilia({
          id: 'ramo-1',
          familia: 'em_que_mais_serve',
          alvo: 'https://loja.invalid/ficha',
          ferramenta: 'ler_pagina',
        }),
      ],
    };

    const rerroteado = rerotearFronteira(comRamo, ['base_local']);
    expect(rerroteado.fronteira.find((i) => i.id === 'ramo-1')?.ferramenta).toBe('ler_pagina');
  });

  it('item já investigado não é reescrito, porque o dossiê registra por onde passou', () => {
    const base = abrirAlvo('refil', []);
    const comInvestigado: EstadoDaBusca = { ...base, investigados: ['em_que_mais_serve'] };
    const rerroteado = rerotearFronteira(comInvestigado, ['base_local']);

    expect(rerroteado.fronteira.find((i) => i.familia === 'em_que_mais_serve')?.ferramenta).toBe(
      'busca_web',
    );
  });
});

describe('abrirAlvo', () => {
  it('levanta uma hipótese por família, todas abertas', () => {
    const estado = abrirAlvo('refil de purificador PA21G', ['base_local']);
    expect(estado.hipoteses).toHaveLength(FAMILIAS_DE_HIPOTESE.length);
    expect(estado.hipoteses.every((h) => h.estado === 'aberta')).toBe(true);
  });

  it('a hipótese é afirmação, e cita o alvo', () => {
    const estado = abrirAlvo('refil PA21G', ['base_local']);
    const custo = estado.hipoteses.find((h) => h.familia === 'onde_e_mais_barato');
    expect(custo?.enunciado).toContain('refil PA21G');
    expect(custo?.enunciado).not.toContain('?');
  });

  it('a família entra com a primeira ferramenta disponível dela', () => {
    // `em_que_mais_serve` aceita busca_web, ler_pagina e base_local. Gravar busca_web
    // faria a fronteira recusar um item que dava para investigar aqui dentro.
    const estado = abrirAlvo('refil', ['base_local']);
    const item = estado.fronteira.find((i) => i.familia === 'em_que_mais_serve');
    expect(item?.ferramenta).toBe('base_local');
  });

  it('com rede, a família abre no buscador e ainda consulta a base local, que é de graça', () => {
    const estado = abrirAlvo('refil PA21G', ['busca_web', 'ler_pagina', 'base_local']);
    const itens = estado.fronteira.filter((i) => i.familia === 'em_que_mais_serve');
    expect(itens.map((i) => i.ferramenta).sort()).toEqual(['base_local', 'busca_web']);
    // Família que não declara a base local não ganha item nela.
    expect(estado.fronteira.filter((i) => i.familia === 'onde_e_mais_barato')).toHaveLength(1);
  });

  it('família sem ferramenta disponível guarda a que ela precisaria', () => {
    const estado = abrirAlvo('refil', ['base_local']);
    const item = estado.fronteira.find((i) => i.familia === 'onde_e_mais_barato');
    expect(item?.ferramenta).toBe('busca_web');
  });

  it('a fronteira sai em ordem de valor por custo decrescente', () => {
    const estado = abrirAlvo('refil', []);
    const valores = estado.fronteira.map(valorPorCusto);
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
  });

  it('espaço em volta do alvo não entra no enunciado', () => {
    const estado = abrirAlvo('  refil PA21G  ', []);
    expect(estado.hipoteses[0]?.enunciado).toContain('de refil PA21G com');
    expect(estado.fronteira[0]?.alvo).toBe('refil PA21G');
  });

  it('nenhum passo gasto e nenhum achado: é plano, não resultado', () => {
    const estado = abrirAlvo('refil', ['base_local']);
    expect(estado.passosGastos).toBe(0);
    expect(estado.achados).toEqual([]);
    expect(estado.investigados).toEqual([]);
  });

  it('sem ferramenta nenhuma, o próximo passo é parar por fronteira vazia', () => {
    // E não "em andamento": é a diferença entre um plano que espera ferramenta e um
    // dossiê que alguém acha que está rodando.
    const passo = proximoPasso(abrirAlvo('refil', []), { passos: 20, ferramentas: [] });
    expect(passo.tipo).toBe('parar');
    if (passo.tipo === 'parar') expect(passo.motivo).toBe('fronteira_vazia');
  });

  it('com a base local, há o que investigar', () => {
    const passo = proximoPasso(abrirAlvo('refil', ['base_local']), {
      passos: 20,
      ferramentas: ['base_local'],
    });
    expect(passo.tipo).toBe('investigar');
    if (passo.tipo === 'investigar') expect(passo.item.ferramenta).toBe('base_local');
  });

  it('o estado aberto já é salvável, com as sete hipóteses na fronteira', () => {
    const dossie = paraGravar({
      alvo: 'refil PA21G',
      estado: abrirAlvo('refil PA21G', ['base_local']),
      orcamento: new OrcamentoDaBusca(reaisParaCentavos(5), 20),
    });

    expect(dossie.fronteira).toHaveLength(FAMILIAS_DE_HIPOTESE.length);
    expect(resumirDossie(dossie).hipotesesAbertas).toBe(FAMILIAS_DE_HIPOTESE.length);
    expect(resumirDossie(dossie).auditavel).toBe(true);
  });
});
