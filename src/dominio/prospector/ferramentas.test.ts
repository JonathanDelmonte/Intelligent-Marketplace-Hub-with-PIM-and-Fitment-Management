import { describe, expect, it } from 'vitest';
import { estadoDaFerramenta, ferramentasDisponiveis, O_QUE_A_FERRAMENTA_FAZ } from './ferramentas';
import { escolherDaFronteira, ESTADO_INICIAL, itemDaFamilia, proximoPasso } from './fronteira';
import { familiasPossiveis, FERRAMENTAS } from './hipoteses';

const SEM_CHAVE = { temChaveDeLlm: false };
const COM_CHAVE = { temChaveDeLlm: true };

describe('estadoDaFerramenta', () => {
  it('toda ferramenta declarada tem estado e uma linha do que faz', () => {
    for (const f of FERRAMENTAS) {
      expect(estadoDaFerramenta(f, SEM_CHAVE).tipo).toBeTruthy();
      expect(O_QUE_A_FERRAMENTA_FAZ[f].length).toBeGreaterThan(20);
    }
  });

  it('a base local não depende de nada de fora', () => {
    expect(estadoDaFerramenta('base_local', SEM_CHAVE)).toEqual({ tipo: 'disponivel' });
  });

  it('visão depende de chave, e o estado nomeia a variável', () => {
    const sem = estadoDaFerramenta('visao', SEM_CHAVE);
    expect(sem.tipo).toBe('falta_chave');
    if (sem.tipo === 'falta_chave') expect(sem.variavel).toBe('LLM_API_KEY');
    expect(estadoDaFerramenta('visao', COM_CHAVE).tipo).toBe('disponivel');
  });

  it('o que não tem adaptador diz o que falta, e não só que falta', () => {
    // "indisponível" manda procurar; "nenhum buscador implementado" manda construir.
    for (const f of ['busca_web', 'ler_pagina', 'cnpj', 'pncp'] as const) {
      const estado = estadoDaFerramenta(f, COM_CHAVE);
      expect(estado.tipo).toBe('sem_adaptador');
      if (estado.tipo === 'sem_adaptador') expect(estado.oQueFalta.length).toBeGreaterThan(20);
    }
  });
});

describe('ferramentasDisponiveis', () => {
  it('sem chave de LLM, só a base local', () => {
    expect(ferramentasDisponiveis(SEM_CHAVE)).toEqual(['base_local']);
  });

  it('com chave, entra a visão', () => {
    expect([...ferramentasDisponiveis(COM_CHAVE)].sort()).toEqual(['base_local', 'visao']);
  });

  it('entra direto nos limites da busca, sem tradução', () => {
    // É o ponto do módulo: a fronteira já sabe recusar item de ferramenta ausente, e
    // faltava quem respondesse quais estão presentes.
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

    const escolhido = escolherDaFronteira(estado, ferramentasDisponiveis(SEM_CHAVE));
    expect(escolhido?.id).toBe('b');

    const passo = proximoPasso(estado, {
      passos: 10,
      ferramentas: ferramentasDisponiveis(SEM_CHAVE),
    });
    expect(passo.tipo).toBe('investigar');
  });

  it('as famílias possíveis hoje são as que a base local alcança', () => {
    // Duas: "que outras peças" e "em que mais serve". As de custo e de distribuidor
    // exigem sair para fora, e é isso que a tela precisa dizer.
    expect([...familiasPossiveis(ferramentasDisponiveis(SEM_CHAVE))].sort()).toEqual([
      'em_que_mais_serve',
      'que_outras_pecas',
    ]);
  });
});
