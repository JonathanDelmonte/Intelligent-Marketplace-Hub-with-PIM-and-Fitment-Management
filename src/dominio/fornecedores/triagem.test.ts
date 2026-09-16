import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  CRITERIO_PADRAO,
  ETIQUETA_DO_VEREDITO,
  PERGUNTAS,
  TEXTO_DA_PERGUNTA,
  triarFornecedor,
  VEREDITOS_DE_TRIAGEM,
  type RespostasDoFornecedor,
} from './triagem';

/** Fornecedor que passa em tudo. Cada teste estraga um campo. */
const BOM: RespostasDoFornecedor = {
  postaComEtiqueta: true,
  emiteNf: true,
  prazoPostagemDias: 2,
  pedidoMinimoReais: reaisParaCentavos(300),
  pedidoMinimoUn: null,
  vendeDiretoMarketplace: false,
};

const triar = (campos: Partial<RespostasDoFornecedor> = {}) =>
  triarFornecedor({ ...BOM, ...campos });

describe('descarte automático', () => {
  it('vende direto na vitrine descarta, e é a única que descarta sozinha', () => {
    const r = triar({ vendeDiretoMarketplace: true });
    expect(r.veredito).toBe('descartar');
    expect(r.descarteAutomatico).toBe(true);
    expect(r.motivos[0]).toContain('preço de fábrica');
  });

  it('descarta mesmo com todo o resto perfeito', () => {
    expect(triar({ vendeDiretoMarketplace: true }).veredito).toBe('descartar');
  });

  it('descarta mesmo com as outras respostas em branco', () => {
    const r = triarFornecedor({
      postaComEtiqueta: null,
      emiteNf: null,
      prazoPostagemDias: null,
      pedidoMinimoReais: null,
      pedidoMinimoUn: null,
      vendeDiretoMarketplace: true,
    });
    expect(r.veredito).toBe('descartar');
    expect(r.pendentes).toEqual([]);
  });

  it('nenhuma outra resposta ruim descarta sozinha', () => {
    for (const campos of [
      { postaComEtiqueta: false },
      { emiteNf: false },
      { prazoPostagemDias: 30 },
    ] satisfies readonly Partial<RespostasDoFornecedor>[]) {
      expect(triar(campos).veredito, JSON.stringify(campos)).toBe('ressalva');
    }
  });
});

describe('pergunta sem resposta é tarefa, não veredito', () => {
  it('trava em "perguntar" e diz qual falta', () => {
    const r = triar({ emiteNf: null });
    expect(r.veredito).toBe('perguntar');
    expect(r.pendentes).toEqual(['emite_nf']);
  });

  it('uma pergunta pendente é "Falta 1 resposta", com o verbo no singular', () => {
    expect(triar({ emiteNf: null }).motivos.join(' ')).toContain('Falta 1 resposta das cinco');
  });

  it('lista todas as pendentes', () => {
    const r = triarFornecedor({
      postaComEtiqueta: null,
      emiteNf: null,
      prazoPostagemDias: null,
      pedidoMinimoReais: null,
      pedidoMinimoUn: null,
      vendeDiretoMarketplace: null,
    });
    expect(r.pendentes).toHaveLength(PERGUNTAS.length);
  });

  it('"perguntar" tem precedência sobre ressalva, porque aprovar sem saber é o erro caro', () => {
    const r = triar({ postaComEtiqueta: false, emiteNf: null });
    expect(r.veredito).toBe('perguntar');
    // A ressalva não se perde: aparece no motivo junto com a pendência.
    expect(r.motivos.some((m) => m.includes('etiqueta'))).toBe(true);
  });

  it('não confunde "não tem pedido mínimo" com "não perguntei"', () => {
    // Um fornecedor sem pedido mínimo responde "não tem", e isso é resposta. A
    // pendência só existe quando nenhum dos dois campos foi preenchido.
    const semMinimo = triar({ pedidoMinimoReais: null, pedidoMinimoUn: 0 });
    expect(semMinimo.pendentes).not.toContain('pedido_minimo');

    const naoPerguntado = triar({ pedidoMinimoReais: null, pedidoMinimoUn: null });
    expect(naoPerguntado.pendentes).toContain('pedido_minimo');
  });
});

describe('ressalva', () => {
  it('não postar com etiqueta explica o custo', () => {
    const r = triar({ postaComEtiqueta: false });
    expect(r.veredito).toBe('ressalva');
    expect(r.motivos[0]).toContain('reputação');
  });

  it('não emitir nota explica de quem é o risco', () => {
    expect(triar({ emiteNf: false }).motivos[0]).toContain('risco fiscal seu');
  });

  it('prazo acima do limite cita os dois números', () => {
    const r = triar({ prazoPostagemDias: 7 });
    expect(r.motivos[0]).toContain('7 dias');
    expect(r.motivos[0]).toContain(String(CRITERIO_PADRAO.prazoMaximoDias));
  });

  it('prazo no limite exato passa', () => {
    expect(triar({ prazoPostagemDias: CRITERIO_PADRAO.prazoMaximoDias }).veredito).toBe('aprovado');
  });

  it('pedido mínimo só pesa quando há limite configurado', () => {
    const alto = { pedidoMinimoReais: reaisParaCentavos(5_000) };
    expect(triar(alto).veredito).toBe('aprovado');
    expect(
      triarFornecedor(
        { ...BOM, ...alto },
        { ...CRITERIO_PADRAO, pedidoMinimoToleradoCentavos: reaisParaCentavos(1_000) },
      ).veredito,
    ).toBe('ressalva');
  });

  it('junta as ressalvas em vez de mostrar só a primeira', () => {
    const r = triar({ postaComEtiqueta: false, emiteNf: false });
    expect(r.motivos).toHaveLength(2);
  });
});

describe('aprovado', () => {
  it('passa nas cinco', () => {
    const r = triar();
    expect(r.veredito).toBe('aprovado');
    expect(r.pendentes).toEqual([]);
    expect(r.descarteAutomatico).toBe(false);
  });
});

describe('textos', () => {
  it('toda pergunta tem texto para mandar ao fornecedor', () => {
    for (const p of PERGUNTAS) {
      expect(TEXTO_DA_PERGUNTA[p], p).not.toBe('');
      expect(TEXTO_DA_PERGUNTA[p].endsWith('?'), p).toBe(true);
    }
  });

  it('todo veredito tem etiqueta', () => {
    for (const v of VEREDITOS_DE_TRIAGEM) {
      expect(ETIQUETA_DO_VEREDITO[v], v).not.toBe('');
    }
  });
});
