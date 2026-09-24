import { describe, expect, it } from 'vitest';
import { esquemaDaConsulta } from '@/dominio/assistente/consulta';
import { entenderPorRegra } from '@/dominio/assistente/entender';
import {
  caminhoDaPronta,
  lerPronta,
  PERGUNTAS_PRONTAS,
  PRONTAS_NA_VISAO_GERAL,
} from './constantes';

describe('perguntas prontas', () => {
  it('a regra, lendo a pergunta por extenso, chega na mesma consulta', () => {
    // A pronta não passa pela regra — mas quem digitar o mesmo texto tem de ter a mesma
    // resposta. Se a regra mudar e uma pronta deixar de bater, é aqui que aparece.
    for (const pronta of PERGUNTAS_PRONTAS) {
      expect(entenderPorRegra(pronta.pergunta), pronta.id).toEqual({
        tipo: 'entendida',
        consulta: pronta.consulta,
      });
    }
  });

  it('toda consulta pronta é consulta válida, e os ids não se repetem', () => {
    for (const pronta of PERGUNTAS_PRONTAS) {
      expect(esquemaDaConsulta.safeParse(pronta.consulta).success, pronta.id).toBe(true);
    }
    expect(new Set(PERGUNTAS_PRONTAS.map((p) => p.id)).size).toBe(PERGUNTAS_PRONTAS.length);
    expect(PERGUNTAS_PRONTAS.length).toBeGreaterThanOrEqual(PRONTAS_NA_VISAO_GERAL);
  });

  it('lerPronta aceita só id que existe', () => {
    expect(lerPronta('postar_hoje')?.consulta.metrica).toBe('postar_hoje');
    expect(lerPronta(['margem_por_loja', 'x'])?.id).toBe('margem_por_loja');
    expect(lerPronta('inventada')).toBeNull();
    expect(lerPronta(undefined)).toBeNull();
  });

  it('o endereço da pronta leva a loja da área, quando há', () => {
    expect(caminhoDaPronta('postar_hoje', undefined)).toBe('/assistente?pronta=postar_hoje');
    expect(caminhoDaPronta('postar_hoje', 'shopee')).toBe(
      '/assistente?pronta=postar_hoje&loja=shopee',
    );
  });
});
