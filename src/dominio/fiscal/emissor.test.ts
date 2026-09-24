import { describe, expect, it } from 'vitest';
import { NOTAS_A_MAO_POR_MES, recomendarEmissor, type EntradaDoEmissor } from './emissor';

const AGORA = new Date('2026-09-24T15:00:00Z');

const completo: EntradaDoEmissor = {
  regime: 'mei',
  documento: { tipo: 'cnpj', valor: '12ABC34501DE35' },
  inscricaoEstadual: '123456789',
  uf: 'SP',
  certificadoValidoAte: new Date('2027-06-30T12:00:00Z'),
  vendasNoMes: { ml: 0, shopee: 0, amazon: 0 },
  agora: AGORA,
};

describe('recomendarEmissor', () => {
  it('pessoa física: nota não se aplica, e o caminho é o CNPJ', () => {
    const r = recomendarEmissor({ ...completo, regime: 'cpf', documento: null });
    expect(r.situacao).toBe('sem_cnpj');
    expect(r.opcao).toBe('nenhuma');
    expect(r.porque.join(' ')).toContain('MEI');
  });

  it('MEI sem CNPJ informado também é "sem CNPJ": a nota sairia sem emitente', () => {
    expect(recomendarEmissor({ ...completo, documento: null }).situacao).toBe('sem_cnpj');
  });

  it('com CNPJ, lista o que falta — estado, inscrição e certificado', () => {
    const r = recomendarEmissor({
      ...completo,
      uf: null,
      inscricaoEstadual: null,
      certificadoValidoAte: null,
    });
    expect(r.situacao).toBe('falta_dado');
    expect(r.falta).toHaveLength(3);
    expect(r.falta.join(' ')).toMatch(/certificado digital/i);
  });

  it('certificado vencido entra no que falta, com a data', () => {
    const r = recomendarEmissor({
      ...completo,
      certificadoValidoAte: new Date('2026-08-01T12:00:00Z'),
    });
    expect(r.situacao).toBe('falta_dado');
    expect(r.falta.join(' ')).toContain('venceu em 01/08/2026');
  });

  it('tudo em ordem é "pronto"', () => {
    expect(recomendarEmissor(completo).situacao).toBe('pronto');
  });

  it('sem vendas importadas: começa pelo gratuito do Sebrae, e lembra do Mercado Livre', () => {
    const r = recomendarEmissor(completo);
    expect(r.opcao).toBe('sebrae');
    expect(r.porque.join(' ')).toContain('Mercado Livre');
  });

  it('venda concentrada no Mercado Livre: o emissor dele, gratuito', () => {
    const r = recomendarEmissor({ ...completo, vendasNoMes: { ml: 40, shopee: 3, amazon: 1 } });
    expect(r.opcao).toBe('emissor_ml');
    expect(r.porque.join(' ')).toContain('As 4 das outras plataformas');
  });

  it('muita venda fora do Mercado Livre: o hub pago aparece, com o caminho gratuito dito junto', () => {
    const r = recomendarEmissor({
      ...completo,
      vendasNoMes: { ml: 10, shopee: NOTAS_A_MAO_POR_MES, amazon: 1 },
    });
    expect(r.opcao).toBe('hub');
    expect(r.porque.join(' ')).toContain('R$ 55');
    expect(r.porque.join(' ')).toContain('caminho gratuito continua valendo');
  });

  it('exatamente o limite ainda cabe à mão: o hub só aparece acima dele', () => {
    const r = recomendarEmissor({
      ...completo,
      vendasNoMes: { ml: 0, shopee: NOTAS_A_MAO_POR_MES, amazon: 0 },
    });
    expect(r.opcao).toBe('sebrae');
  });

  it('estado com credenciamento prévio no emissor do Mercado Livre ganha a ressalva', () => {
    const r = recomendarEmissor({
      ...completo,
      uf: 'PR',
      vendasNoMes: { ml: 5, shopee: 0, amazon: 0 },
    });
    expect(r.opcao).toBe('emissor_ml');
    expect(r.porque.join(' ')).toContain('Em PR');

    const semRessalva = recomendarEmissor({
      ...completo,
      vendasNoMes: { ml: 5, shopee: 0, amazon: 0 },
    });
    expect(semRessalva.porque.join(' ')).not.toContain('credenciamento');
  });
});
