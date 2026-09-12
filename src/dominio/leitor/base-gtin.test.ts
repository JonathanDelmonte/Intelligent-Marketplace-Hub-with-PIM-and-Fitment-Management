/**
 * Testes da porta de base de GTIN.
 *
 * O que se verifica é a distinção de três desfechos. Colapsar "o provedor não
 * conhece este código" com "não há como perguntar" faria a pessoa procurar um
 * produto que talvez exista, numa loja, com o celular na mão.
 */
import { describe, expect, it } from 'vitest';
import { normalizarGtin, type Gtin } from '@/dominio/gtin';
import type { EstadoDaCapacidade } from '@/plataformas/capacidades';
import {
  BaseDeGtinAusente,
  BaseDeGtinIndisponivel,
  resolverFicha,
  type BaseDeGtin,
  type FichaDeGtin,
} from './base-gtin';

const GTIN = normalizarGtin('7896541200121')!;

function baseFalsa(params: {
  readonly estado: EstadoDaCapacidade;
  readonly resposta?: FichaDeGtin | null;
  readonly erro?: Error;
}): BaseDeGtin {
  return {
    nome: 'provedor de teste',
    estadoDaConsulta: () => params.estado,
    consultar: (_gtin: Gtin) => {
      if (params.erro !== undefined) return Promise.reject(params.erro);
      return Promise.resolve(params.resposta ?? null);
    },
  };
}

describe('base ausente', () => {
  it('declara sem_credencial em vez de fingir que não existe base', async () => {
    const base = new BaseDeGtinAusente();

    expect(base.estadoDaConsulta()).toEqual({ tipo: 'sem_credencial', modo: 'm2_publico' });
    await expect(base.consultar(GTIN)).rejects.toThrow(BaseDeGtinIndisponivel);
  });

  it('resolverFicha traduz isso em indisponivel, não em desconhecido', async () => {
    const r = await resolverFicha(new BaseDeGtinAusente(), GTIN);

    expect(r.tipo).toBe('indisponivel');
    if (r.tipo === 'indisponivel') {
      expect(r.motivo).toBe('nenhuma base de GTIN configurada');
    }
  });
});

describe('os três desfechos', () => {
  it('achou devolve a ficha', async () => {
    const ficha: FichaDeGtin = {
      gtin: '7896541200121',
      descricao: 'Refil Filtro Purificador',
      marca: 'Electrolux',
      ncm: '84219999',
      pesoGramas: 300,
      provedor: 'provedor de teste',
    };
    const r = await resolverFicha(
      baseFalsa({
        estado: { tipo: 'disponivel', modo: 'm2_publico', rotulo: 'ok' },
        resposta: ficha,
      }),
      GTIN,
    );

    expect(r).toEqual({ tipo: 'achou', ficha });
  });

  it('provedor que responde e não conhece é desconhecido, não indisponivel', async () => {
    const r = await resolverFicha(
      baseFalsa({
        estado: { tipo: 'disponivel', modo: 'm2_publico', rotulo: 'ok' },
        resposta: null,
      }),
      GTIN,
    );

    expect(r).toEqual({ tipo: 'desconhecido', provedor: 'provedor de teste' });
  });

  it('falha de rede é indisponivel, não ausência de produto', async () => {
    // A pessoa está numa loja com sinal ruim. Dizer "não existe" seria mentira.
    const r = await resolverFicha(
      baseFalsa({
        estado: { tipo: 'disponivel', modo: 'm2_publico', rotulo: 'ok' },
        erro: new Error('fetch failed'),
      }),
      GTIN,
    );

    expect(r.tipo).toBe('indisponivel');
    if (r.tipo === 'indisponivel') expect(r.motivo).toBe('fetch failed');
  });

  it('estado presumido é tratado como utilizável, como na matriz de plataformas', async () => {
    const r = await resolverFicha(
      baseFalsa({ estado: { tipo: 'presumido', modo: 'm2_publico' }, resposta: null }),
      GTIN,
    );

    expect(r.tipo).toBe('desconhecido');
  });

  it('bloqueado não é consultado: não adianta tentar', async () => {
    const r = await resolverFicha(
      baseFalsa({
        estado: { tipo: 'bloqueado', desde: '2026-01', evidencia: '403 consistente' },
        resposta: null,
      }),
      GTIN,
    );

    expect(r.tipo).toBe('indisponivel');
    if (r.tipo === 'indisponivel') expect(r.motivo).toContain('bloqueado');
  });
});

describe('mensagem de erro', () => {
  it('diz qual provedor e por quê', () => {
    const erro = new BaseDeGtinIndisponivel('cosmos', {
      tipo: 'sem_credencial',
      modo: 'm2_publico',
    });

    expect(erro.message).toContain('cosmos');
    expect(erro.message).toContain('sem conexão');
    expect(erro.provedor).toBe('cosmos');
  });
});
