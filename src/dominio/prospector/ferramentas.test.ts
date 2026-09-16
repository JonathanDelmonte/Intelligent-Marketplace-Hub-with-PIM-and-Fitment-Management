import { describe, expect, it } from 'vitest';
import {
  O_QUE_A_FERRAMENTA_FAZ,
  O_QUE_FALTA_PARA_A_FERRAMENTA,
  estadoDaFerramenta,
  ferramentasQueFaltam,
} from './ferramentas';
import { escolherDaFronteira, ESTADO_INICIAL, itemDaFamilia, proximoPasso } from './fronteira';
import { familiasPossiveis, FERRAMENTAS } from './hipoteses';
import { FERRAMENTAS_PRONTAS } from './registro';

describe('estadoDaFerramenta', () => {
  it('toda ferramenta tem uma linha do que faz e uma do que falta', () => {
    for (const f of FERRAMENTAS) {
      expect(O_QUE_A_FERRAMENTA_FAZ[f].length).toBeGreaterThan(20);
      expect(O_QUE_FALTA_PARA_A_FERRAMENTA[f].length).toBeGreaterThan(20);
    }
  });

  it('disponível é ter investigador, e não ter configuração', () => {
    // A primeira versão derivava a visão da chave de LLM no ambiente, e isso enganava:
    // a tela dizia "falta chave", o que implica que pôr a chave a faria rodar.
    expect(estadoDaFerramenta('base_local', ['base_local'])).toEqual({ tipo: 'disponivel' });

    const visao = estadoDaFerramenta('visao', ['base_local']);
    expect(visao.tipo).toBe('falta');
    if (visao.tipo === 'falta') expect(visao.oQueFalta).toContain('imagem');
  });

  it('o que falta diz o nome do que alguém tem de escrever', () => {
    // "Indisponível" manda procurar; "nenhum buscador implementado" manda construir.
    const busca = estadoDaFerramenta('busca_web', []);
    if (busca.tipo === 'falta') expect(busca.oQueFalta).toContain('buscador');
  });

  it('as que faltam saem na ordem declarada', () => {
    expect(ferramentasQueFaltam(['base_local'])).toEqual([
      'busca_web',
      'ler_pagina',
      'visao',
      'cnpj',
      'pncp',
    ]);
  });
});

describe('FERRAMENTAS_PRONTAS', () => {
  it('hoje é a base local, e só', () => {
    expect(FERRAMENTAS_PRONTAS).toEqual(['base_local']);
  });

  it('entra direto nos limites da busca, sem tradução', () => {
    const estado = {
      ...ESTADO_INICIAL,
      fronteira: [
        itemDaFamilia({
          id: 'a',
          familia: 'onde_e_mais_barato',
          alvo: 'refil',
          ferramenta: 'busca_web',
        }),
        itemDaFamilia({
          id: 'b',
          familia: 'em_que_mais_serve',
          alvo: 'refil',
          ferramenta: 'base_local',
        }),
      ],
    };

    expect(escolherDaFronteira(estado, FERRAMENTAS_PRONTAS)?.id).toBe('b');
    expect(proximoPasso(estado, { passos: 10, ferramentas: FERRAMENTAS_PRONTAS }).tipo).toBe(
      'investigar',
    );
  });

  it('as famílias possíveis hoje são as duas que a base local alcança', () => {
    // As de custo e de distribuidor exigem sair para fora, e é isso que a tela diz.
    expect([...familiasPossiveis(FERRAMENTAS_PRONTAS)].sort()).toEqual([
      'em_que_mais_serve',
      'que_outras_pecas',
    ]);
  });
});
