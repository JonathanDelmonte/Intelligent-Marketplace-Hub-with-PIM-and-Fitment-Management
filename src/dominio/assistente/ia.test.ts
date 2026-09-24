/**
 * Testes da tradução pela IA, contra Postgres de verdade — o `ServicoDeLlm` grava cada
 * chamada em `llm_call`, e o que importa aqui é **não pagar duas vezes a mesma pergunta**.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  ChamadorAusente,
  LimiteDoProvedor,
  Orcamento,
  ServicoDeLlm,
  type Chamador,
  type RespostaDoModelo,
} from '@/infra/llm';
import { esquemaDaTraducao, INSTRUCOES_DO_ASSISTENTE, traduzirComIa } from './ia';

const MODELO = 'modelo-de-teste';

/** Chamador que devolve o que o teste quiser, contando as chamadas. */
function chamadorFixo(saida: unknown): Chamador & { chamadas: number } {
  return {
    nome: 'fixo',
    chamadas: 0,
    // eslint-disable-next-line @typescript-eslint/require-await
    async chamar(): Promise<RespostaDoModelo> {
      this.chamadas += 1;
      return { saida, custoCentavos: 0 };
    },
  };
}

describe('instruções e formato', () => {
  it('as instruções citam toda loja do domínio, pelo código e pelo nome', () => {
    expect(INSTRUCOES_DO_ASSISTENTE).toContain('"ml" (Mercado Livre)');
    expect(INSTRUCOES_DO_ASSISTENTE).toContain('"shopee" (Shopee)');
    expect(INSTRUCOES_DO_ASSISTENTE).toContain('"amazon" (Amazon)');
  });

  it('campo esquecido pelo modelo tem padrão; só a métrica é obrigatória', () => {
    expect(esquemaDaTraducao.parse({ metrica: 'margem' })).toEqual({
      metrica: 'margem',
      lojas: [],
      periodo: null,
      porLoja: false,
    });
    expect(() => esquemaDaTraducao.parse({ lojas: [] })).toThrow();
    expect(() => esquemaDaTraducao.parse({ metrica: 'lucro_liquido' })).toThrow();
  });
});

describe.skipIf(!temBancoDeTeste())('traduzirComIa', () => {
  let conexao: ConexaoDeTeste;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['llm_call']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const servico = (chamador: Chamador) =>
    new ServicoDeLlm(conexao.db, chamador, new Orcamento(1_000, 10));

  it('traduz para a consulta fechada, com padrão onde o modelo calou', async () => {
    const chamador = chamadorFixo({ metrica: 'faturamento', lojas: ['amazon', 'ml'] });
    const r = await traduzirComIa('quanto entrou de grana na amazon e no meli?', {
      llm: servico(chamador),
      modelo: MODELO,
    });
    expect(r).toEqual({
      tipo: 'entendida',
      consulta: {
        metrica: 'faturamento',
        // Na ordem do domínio, e duas lojas são comparação mesmo sem o modelo dizer.
        lojas: ['ml', 'amazon'],
        periodo: 'ultimos_30',
        porLoja: true,
      },
      deCache: false,
    });
  });

  it('a mesma pergunta, escrita de outro jeito, não paga de novo', async () => {
    const chamador = chamadorFixo({ metrica: 'pedidos', periodo: 'hoje' });
    const opcoes = { llm: servico(chamador), modelo: MODELO };

    await traduzirComIa('Quantas encomendas saíram hoje?', opcoes);
    const segunda = await traduzirComIa('  quantas encomendas SAIRAM hoje ', opcoes);

    expect(chamador.chamadas).toBe(1);
    expect(segunda).toMatchObject({ tipo: 'entendida', deCache: true });
  });

  it('métrica nula é pergunta fora do que o assistente sabe', async () => {
    const r = await traduzirComIa('qual o NCM de uma capa de celular?', {
      llm: servico(chamadorFixo({ metrica: null })),
      modelo: MODELO,
    });
    expect(r).toEqual({ tipo: 'fora_do_alcance' });
  });

  it('pergunta sem sinal nem chega a chamar', async () => {
    const chamador = chamadorFixo({ metrica: 'resumo' });
    const r = await traduzirComIa('oi?', { llm: servico(chamador), modelo: MODELO });
    expect(r).toEqual({ tipo: 'fora_do_alcance' });
    expect(chamador.chamadas).toBe(0);
  });

  it('sem chave é estado, e resposta fora do formato é falha com motivo', async () => {
    expect(
      await traduzirComIa('quanto entrou?', {
        llm: servico(new ChamadorAusente()),
        modelo: MODELO,
      }),
    ).toEqual({ tipo: 'sem_chave' });

    const r = await traduzirComIa('quanto entrou ontem?', {
      llm: servico(chamadorFixo({ metrica: 'lucro_liquido' })),
      modelo: MODELO,
    });
    expect(r.tipo).toBe('falhou');
  });

  it('cota esgotada sobe, para a tela dizer quando volta', async () => {
    const volta = new Date('2026-09-25T00:00:00.000Z');
    const esgotado: Chamador = {
      nome: 'esgotado',
      chamar: () => Promise.reject(new LimiteDoProvedor('cota diária esgotada', volta, true)),
    };
    await expect(
      traduzirComIa('quanto entrou?', { llm: servico(esgotado), modelo: MODELO }),
    ).rejects.toBeInstanceOf(LimiteDoProvedor);
  });
});
