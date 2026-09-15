import { describe, expect, it } from 'vitest';
import { abrirAlvo } from './abertura';
import { OrcamentoDaBusca, paraGravar, resumirDossie } from './dossie';
import { proximoPasso, valorPorCusto } from './fronteira';
import { FAMILIAS_DE_HIPOTESE } from './hipoteses';
import { reaisParaCentavos } from '@/lib/dinheiro';

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
