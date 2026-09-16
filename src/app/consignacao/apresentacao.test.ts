import { describe, expect, it } from 'vitest';
import { ESTADOS_DE_CONFERENCIA } from '@/dominio/consignacao/conferencia';
import type { QuadroDeConferencia } from '@/dominio/consignacao/conferencia';
import type { Fechamento } from '@/dominio/consignacao/fechamento';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  CODIGOS_DE_AVISO,
  descreverAviso,
  desdeAUltimaEmTexto,
  mesEmTexto,
  resumoDoFechamento,
  resumoDoQuadro,
  rotuloDoEstado,
  tomDoEstado,
} from './apresentacao';

const quadro = (campos: Partial<QuadroDeConferencia> = {}): QuadroDeConferencia => ({
  itens: [],
  porEstado: { nunca: 0, vencida: 0, vence_hoje: 0, em_dia: 0 },
  unidadesEmRisco: 0,
  parceirosEmRisco: [],
  ...campos,
});

const fechamento = (campos: Partial<Fechamento> = {}): Fechamento => ({
  de: '2026-09-01',
  ate: '2026-09-30',
  porParceiro: [],
  totalARepassar: reaisParaCentavos(0),
  unidades: 0,
  completo: true,
  ...campos,
});

describe('tomDoEstado', () => {
  it('nunca conferido é alerta junto com vencida, não um degrau abaixo', () => {
    // Não saber se o estoque existe é pior que saber que a conferência atrasou.
    expect(tomDoEstado('nunca')).toBe('alerta');
    expect(tomDoEstado('vencida')).toBe('alerta');
    expect(tomDoEstado('vence_hoje')).toBe('atencao');
    expect(tomDoEstado('em_dia')).toBe('neutro');
  });

  it('todo estado tem tom e rótulo', () => {
    for (const estado of ESTADOS_DE_CONFERENCIA) {
      expect(tomDoEstado(estado)).toBeTruthy();
      expect(rotuloDoEstado(estado).length).toBeGreaterThan(0);
    }
  });
});

describe('desdeAUltimaEmTexto', () => {
  it('fala como a pessoa fala', () => {
    expect(desdeAUltimaEmTexto(null)).toBe('nunca conferido');
    expect(desdeAUltimaEmTexto(0)).toBe('conferido hoje');
    expect(desdeAUltimaEmTexto(1)).toBe('conferido ontem');
    expect(desdeAUltimaEmTexto(9)).toBe('conferido há 9 dias');
  });
});

describe('resumoDoQuadro', () => {
  it('sem nada em consignação explica para que a tela serve', () => {
    // Tela vazia que só diz "nenhum item" é tela que não ensina nada.
    expect(resumoDoQuadro(quadro())).toContain('balcão');
  });

  it('lidera pelas unidades em risco, não pela contagem de linhas', () => {
    // "12 linhas de consignação" não muda comportamento.
    const r = resumoDoQuadro(
      quadro({
        itens: Array.from({ length: 12 }, () => ({}) as never),
        unidadesEmRisco: 7,
        parceirosEmRisco: ['Loja do Centro'],
      }),
    );
    expect(r.startsWith('7 unidades anunciadas')).toBe(true);
    expect(r).toContain('Loja do Centro');
    expect(r).toContain('cancelamento');
  });

  it('com vários parceiros conta parceiros em vez de listar todos', () => {
    const r = resumoDoQuadro(
      quadro({
        itens: [{} as never],
        unidadesEmRisco: 20,
        parceirosEmRisco: ['Loja A', 'Loja B', 'Loja C'],
      }),
    );
    expect(r).toContain('3 parceiros');
    expect(r).not.toContain('Loja A');
  });

  it('nada em risco diz que está em dia, sem alarme falso', () => {
    const r = resumoDoQuadro(quadro({ itens: [{} as never, {} as never], unidadesEmRisco: 0 }));
    expect(r).toContain('em dia');
    expect(r).toContain('2 itens');
  });
});

describe('resumoDoFechamento', () => {
  it('sem venda no período diz isso, e não R$ 0,00', () => {
    expect(resumoDoFechamento(fechamento())).toContain('Nenhuma venda');
  });

  it('completo autoriza pagar', () => {
    const r = resumoDoFechamento(
      fechamento({
        porParceiro: [
          {
            parceiroNome: 'Loja A',
            unidades: 2,
            aRepassar: reaisParaCentavos(80),
            pendencias: [],
            completo: true,
          },
        ],
        totalARepassar: reaisParaCentavos(80),
        unidades: 2,
      }),
    );
    expect(r).toContain('80,00');
    expect(r).toContain('dá para pagar');
  });

  it('com pendência avisa que o total ainda sobe', () => {
    // Pagar um total que vai crescer é pagar duas vezes e conferir três.
    const r = resumoDoFechamento(
      fechamento({
        porParceiro: [
          {
            parceiroNome: 'Loja A',
            unidades: 3,
            aRepassar: reaisParaCentavos(80),
            pendencias: [
              { pedidoId: 'p1', skuId: 's1', tituloDoProduto: 'Refil', qtd: 1, motivo: 'x' },
            ],
            completo: false,
          },
        ],
        totalARepassar: reaisParaCentavos(80),
        unidades: 3,
        completo: false,
      }),
    );
    expect(r).toContain('ainda vai subir');
    expect(r).toContain('1 parceiro ');
  });
});

describe('mesEmTexto', () => {
  it('escreve o mês como as pessoas escrevem', () => {
    expect(mesEmTexto('2026-09-01')).toBe('setembro de 2026');
    expect(mesEmTexto('2026-01-01')).toBe('janeiro de 2026');
  });

  it('entrada estranha não quebra a tela', () => {
    expect(mesEmTexto('xx')).toBe('xx');
  });
});

describe('descreverAviso', () => {
  it('código desconhecido não vira caixa vazia', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código declarado tem aviso com título e corpo', () => {
    for (const codigo of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(codigo);
      expect(aviso, codigo).not.toBeNull();
      expect(aviso?.titulo.length ?? 0).toBeGreaterThan(0);
      expect(aviso?.corpo.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('conferência registrada lembra que o estoque do anúncio pode precisar de ajuste', () => {
    // É a consequência que a pessoa esquece: conferiu, achou menos, e o anúncio
    // continua oferecendo o que não existe.
    expect(descreverAviso('conferido')?.corpo).toContain('estoque');
  });
});
