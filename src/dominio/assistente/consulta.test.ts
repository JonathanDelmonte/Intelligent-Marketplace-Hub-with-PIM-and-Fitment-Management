import { describe, expect, it } from 'vitest';
import {
  comLojaDoContexto,
  janelasDoPeriodo,
  lojasDaConsulta,
  olhaJanela,
  type Consulta,
} from './consulta';

/** Quinta, 24/09/2026, 12h em São Paulo. */
const AGORA = new Date('2026-09-24T15:00:00.000Z');

const consulta = (campos: Partial<Consulta> = {}): Consulta => ({
  metrica: 'faturamento',
  lojas: [],
  periodo: 'ultimos_30',
  porLoja: false,
  ...campos,
});

/** O primeiro e o último dia de uma janela, que é o que se confere a olho. */
function extremos(janela: { readonly dias: readonly string[] }): readonly [string, string] {
  return [janela.dias[0] ?? '', janela.dias.at(-1) ?? ''];
}

describe('janelasDoPeriodo', () => {
  it('hoje compara com ontem, e ontem com anteontem', () => {
    const hoje = janelasDoPeriodo('hoje', AGORA);
    expect(extremos(hoje.atual)).toEqual(['2026-09-24', '2026-09-24']);
    expect(extremos(hoje.anterior)).toEqual(['2026-09-23', '2026-09-23']);

    const ontem = janelasDoPeriodo('ontem', AGORA);
    expect(extremos(ontem.atual)).toEqual(['2026-09-23', '2026-09-23']);
    expect(extremos(ontem.anterior)).toEqual(['2026-09-22', '2026-09-22']);
  });

  it('os últimos dias comparam com os mesmos tantos dias antes', () => {
    const semana = janelasDoPeriodo('ultimos_7', AGORA);
    expect(extremos(semana.atual)).toEqual(['2026-09-18', '2026-09-24']);
    expect(extremos(semana.anterior)).toEqual(['2026-09-11', '2026-09-17']);
    expect(janelasDoPeriodo('ultimos_90', AGORA).atual.dias).toHaveLength(90);
  });

  it('o mês corrente compara com o mesmo trecho do mês anterior', () => {
    // 24 dias contra o mês inteiro pareceria queda todo mês até o dia 31.
    const mes = janelasDoPeriodo('mes_atual', AGORA);
    expect(extremos(mes.atual)).toEqual(['2026-09-01', '2026-09-24']);
    expect(extremos(mes.anterior)).toEqual(['2026-08-01', '2026-08-24']);
  });

  it('o trecho do mês anterior para no fim dele, quando ele é mais curto', () => {
    const fimDeMarco = new Date('2026-03-31T15:00:00.000Z');
    const mes = janelasDoPeriodo('mes_atual', fimDeMarco);
    expect(extremos(mes.atual)).toEqual(['2026-03-01', '2026-03-31']);
    expect(extremos(mes.anterior)).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('o mês passado é o mês inteiro, e compara com o mês antes dele', () => {
    const passado = janelasDoPeriodo('mes_passado', AGORA);
    expect(extremos(passado.atual)).toEqual(['2026-08-01', '2026-08-31']);
    expect(extremos(passado.anterior)).toEqual(['2026-07-01', '2026-07-31']);

    // Janeiro olha para dezembro do ano anterior.
    const janeiro = janelasDoPeriodo('mes_passado', new Date('2026-01-10T15:00:00.000Z'));
    expect(extremos(janeiro.atual)).toEqual(['2025-12-01', '2025-12-31']);
    expect(extremos(janeiro.anterior)).toEqual(['2025-11-01', '2025-11-30']);
  });

  it('o dia é o do vendedor: 23h de São Paulo ainda é o mesmo dia', () => {
    const noite = new Date('2026-09-25T02:00:00.000Z');
    expect(extremos(janelasDoPeriodo('hoje', noite).atual)).toEqual(['2026-09-24', '2026-09-24']);
  });
});

describe('lojasDaConsulta', () => {
  it('nenhuma loja citada é todas, e a ordem é a do domínio', () => {
    expect(lojasDaConsulta(consulta())).toEqual(['ml', 'shopee', 'amazon']);
    expect(lojasDaConsulta(consulta({ lojas: ['amazon', 'ml', 'amazon'] }))).toEqual([
      'ml',
      'amazon',
    ]);
  });
});

describe('comLojaDoContexto', () => {
  it('a pergunta sem loja, feita na área de uma loja, é sobre ela', () => {
    expect(comLojaDoContexto(consulta(), 'shopee').lojas).toEqual(['shopee']);
  });

  it('a loja citada e a comparação vencem o contexto', () => {
    expect(comLojaDoContexto(consulta({ lojas: ['ml'] }), 'shopee').lojas).toEqual(['ml']);
    expect(comLojaDoContexto(consulta({ porLoja: true }), 'shopee').lojas).toEqual([]);
    expect(comLojaDoContexto(consulta(), undefined).lojas).toEqual([]);
  });
});

describe('olhaJanela', () => {
  it('a fila e o repasse aberto são de agora', () => {
    expect(olhaJanela('postar_hoje')).toBe(false);
    expect(olhaJanela('repasse_divergente')).toBe(false);
    expect(olhaJanela('margem')).toBe(true);
  });
});
