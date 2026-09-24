import { describe, expect, it } from 'vitest';
import { TETO_MEI_ANUAL } from '@/dominio/fiscal/teto';
import type { ValoresDoFormulario } from './apresentacao';
import { lerFormularioDoNegocio, valoresDoFormulario } from './leitura';

const VALIDO: ValoresDoFormulario = {
  nome: 'Loja de teste',
  regime: 'mei',
  documento: '12.ABC.345/01DE-35',
  inscricaoEstadual: '',
  uf: 'PR',
  abertoEm: '2026-07-20',
  certificadoValidoAte: '',
  dasMensal: '81,05',
  aliquotaSimples: '',
  tetoAnual: '',
};

function motivo(valores: ValoresDoFormulario): string {
  const lido = lerFormularioDoNegocio(valores);
  return lido.tipo === 'invalido' ? lido.motivo : '';
}

describe('valoresDoFormulario', () => {
  it('apara o texto, e campo ausente é vazio', () => {
    const dados = new FormData();
    dados.set('nome', '  Loja  ');
    dados.set('regime', 'mei');
    const valores = valoresDoFormulario(dados);
    expect(valores.nome).toBe('Loja');
    expect(valores.documento).toBe('');
    expect(valores.tetoAnual).toBe('');
  });
});

describe('lerFormularioDoNegocio', () => {
  it('lê reais, percentual e datas para o que o domínio grava', () => {
    const lido = lerFormularioDoNegocio({
      ...VALIDO,
      regime: 'simples',
      aliquotaSimples: '6,5',
      tetoAnual: '4800000',
    });
    expect(lido.tipo).toBe('ok');
    if (lido.tipo !== 'ok') return;
    expect(lido.dados.dasMensal).toBe(8105);
    expect(lido.dados.aliquotaSimplesBp).toBe(650);
    expect(lido.dados.tetoAnual).toBe(480_000_000);
    expect(lido.dados.abertoEm?.toISOString().slice(0, 10)).toBe('2026-07-20');
  });

  it('MEI com teto em branco fica com o teto da lei', () => {
    const lido = lerFormularioDoNegocio(VALIDO);
    expect(lido.tipo === 'ok' && lido.dados.tetoAnual).toBe(TETO_MEI_ANUAL);
  });

  it('recusa dinheiro com ponto de milhar, dizendo em que campo e como escrever', () => {
    expect(motivo({ ...VALIDO, tetoAnual: '81.000' })).toBe(
      'Teto de receita do ano, em reais — use um valor como 81,05, sem ponto de milhar.',
    );
  });

  it('recusa alíquota acima de 100%', () => {
    expect(motivo({ ...VALIDO, aliquotaSimples: '150' })).toContain('Alíquota efetiva do Simples');
  });

  it('a recusa do esquema também diz o campo', () => {
    expect(motivo({ ...VALIDO, documento: '529.982.247-25' })).toMatch(/^CPF ou CNPJ — /);
    expect(motivo({ ...VALIDO, uf: 'XX' })).toBe('Estado — estado desconhecido');
    expect(motivo({ ...VALIDO, certificadoValidoAte: '2027-02-30' })).toMatch(
      /^Certificado válido até — /,
    );
  });

  it('regime fora da lista é recusado em português', () => {
    expect(motivo({ ...VALIDO, regime: 'lucro_real' })).toBe('Regime — regime desconhecido');
  });
});
