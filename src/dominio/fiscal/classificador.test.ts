/**
 * Testes do classificador fiscal, contra Postgres de verdade — porque o
 * `ServicoDeLlm` grava cada chamada em `llm_call`, e metade do que importa aqui é
 * **não chamar duas vezes**.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChamadorAusente,
  Orcamento,
  OrcamentoEstourado,
  ServicoDeLlm,
  type Chamador,
  type RespostaDoModelo,
} from '@/infra/llm';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import {
  CANDIDATOS_NA_TELA,
  CONFIANCA_POR_CERTEZA,
  esquemaSugestaoFiscal,
  ordenarCandidatos,
  perguntaDeClassificacao,
  sugerirClassificacao,
  temSinalParaClassificar,
  type ProdutoParaClassificar,
} from './classificador';

const MODELO = 'modelo-de-teste';

const produto = (campos: Partial<ProdutoParaClassificar> = {}): ProdutoParaClassificar => ({
  tituloInterno: 'Refil para purificador de água Electrolux PA21G',
  tipoProduto: 'refil de purificador de água',
  marca: 'Electrolux',
  modelosCompativeis: ['PA21G', 'PA26G'],
  ...campos,
});

/** Chamador que devolve o que o teste quiser, contando as chamadas. */
function chamadorFixo(saida: unknown): Chamador & { chamadas: number } {
  return {
    nome: 'fixo',
    chamadas: 0,
    // eslint-disable-next-line @typescript-eslint/require-await
    async chamar(): Promise<RespostaDoModelo> {
      this.chamadas += 1;
      return { saida, custoCentavos: 1 };
    },
  };
}

describe('perguntaDeClassificacao', () => {
  it('normaliza, para espaço a mais não custar uma segunda chamada', () => {
    // A pergunta define o hash de cache. Se ela variar com espaço, o cache não pega.
    const a = perguntaDeClassificacao(produto({ tituloInterno: 'Refil  PA21G ' }));
    const b = perguntaDeClassificacao(produto({ tituloInterno: 'Refil PA21G' }));
    expect(a).toEqual(b);
  });

  it('ordena os modelos compatíveis, pelo mesmo motivo', () => {
    const a = perguntaDeClassificacao(produto({ modelosCompativeis: ['PA26G', 'PA21G'] }));
    const b = perguntaDeClassificacao(produto({ modelosCompativeis: ['PA21G', 'PA26G'] }));
    expect(a).toEqual(b);
  });

  it('campo em branco vira nulo, não string vazia', () => {
    const pergunta = perguntaDeClassificacao(produto({ marca: '  ', descricao: null }));
    expect(pergunta).toMatchObject({ marca: null, descricao: null });
  });
});

describe('temSinalParaClassificar', () => {
  it('título curto não vale uma chamada paga', () => {
    // Pagar por chamada sem chance de acertar é o desperdício que o ADR 0005 evita.
    expect(temSinalParaClassificar(produto({ tituloInterno: 'x' }))).toBe(false);
    expect(temSinalParaClassificar(produto({ tituloInterno: '  ' }))).toBe(false);
    expect(temSinalParaClassificar(produto({ tituloInterno: 'EF-ELX-21' }))).toBe(true);
  });
});

describe('ordenarCandidatos', () => {
  const bruta = (candidatos: unknown) => esquemaSugestaoFiscal.parse({ candidatos });

  it('ordena por certeza declarada e corta na quantidade da tela', () => {
    const r = ordenarCandidatos(
      bruta([
        {
          ncm: '84212100',
          justificativa: 'justificativa suficientemente longa 1',
          certeza: 'baixa',
        },
        {
          ncm: '84212900',
          justificativa: 'justificativa suficientemente longa 2',
          certeza: 'alta',
        },
        {
          ncm: '84213100',
          justificativa: 'justificativa suficientemente longa 3',
          certeza: 'media',
        },
        {
          ncm: '84219900',
          justificativa: 'justificativa suficientemente longa 4',
          certeza: 'baixa',
        },
      ]),
    );
    expect(r).toHaveLength(CANDIDATOS_NA_TELA);
    expect(r.map((c) => c.certeza)).toEqual(['alta', 'media', 'baixa']);
    expect(r[0]?.confiancaBp).toBe(CONFIANCA_POR_CERTEZA.alta);
  });

  it('limpa o ponto do NCM que o modelo devolve formatado', () => {
    const r = ordenarCandidatos(
      bruta([
        {
          ncm: '8421.21.00',
          justificativa: 'justificativa suficientemente longa',
          certeza: 'alta',
        },
      ]),
    );
    expect(r[0]?.ncm).toBe('84212100');
  });

  it('descarta candidato com NCM fora de forma em vez de oferecê-lo', () => {
    // Oferecer um código que a nota vai recusar é pior que oferecer menos opções.
    const r = ordenarCandidatos(
      bruta([
        // Caractere errado, não comprimento curto: o schema já recusa menos de oito
        // caracteres, e a faixa de 8 a 10 existe para aceitar "8421.21.00" com ponto.
        // O que passa pelo schema e precisa morrer aqui é "8421.21.0X".
        {
          ncm: '8421.21.0X',
          justificativa: 'justificativa suficientemente longa',
          certeza: 'alta',
        },
        {
          ncm: '84212900',
          justificativa: 'outra justificativa suficientemente longa',
          certeza: 'media',
        },
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.ncm).toBe('84212900');
  });

  it('CEST fora de forma vira ausente, e não descarta o candidato', () => {
    // O NCM é o que a nota exige; o CEST só vale em substituição tributária.
    const r = ordenarCandidatos(
      bruta([
        {
          ncm: '84212100',
          // Sete caracteres, então passa o schema, e com letra — então morre aqui.
          cest: '280100X',
          justificativa: 'justificativa suficientemente longa',
          certeza: 'alta',
        },
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r[0]?.cest).toBeNull();
  });

  it('justificativa curta é recusada pelo schema, antes de chegar à tela', () => {
    // Sem justificativa não há revisão de trinta segundos: "84212100" sozinho não dá
    // para conferir.
    expect(() => bruta([{ ncm: '84212100', justificativa: 'porque', certeza: 'alta' }])).toThrow();
  });
});

describe.skipIf(!temBancoDeTeste())('sugerirClassificacao', () => {
  let conexao: ConexaoDeTeste;

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['llm_call']);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  const servico = (chamador: Chamador, orcamento = new Orcamento(1_000, 10)) =>
    new ServicoDeLlm(conexao.db, chamador, orcamento);

  const SAIDA = {
    candidatos: [
      {
        ncm: '8421.21.00',
        cest: null,
        justificativa: 'aparelho para filtrar líquidos, posição de partes e peças',
        certeza: 'alta',
      },
    ],
  };

  it('sem serviço de LLM devolve sem_chave, que é estado e não falha', async () => {
    // O cadastro fiscal continua preenchível à mão: nada aqui é pré-requisito.
    expect(await sugerirClassificacao(produto())).toEqual({ tipo: 'sem_chave' });
  });

  it('com o chamador ausente também é sem_chave, sem sujar o registro de custo', async () => {
    const r = await sugerirClassificacao(produto(), {
      llm: servico(new ChamadorAusente()),
      modelo: MODELO,
    });
    expect(r.tipo).toBe('sem_chave');

    const chamadas = await conexao.db.query.llmCall?.findMany?.();
    if (chamadas !== undefined) expect(chamadas).toHaveLength(0);
  });

  it('título curto não chega a chamar o modelo', async () => {
    const chamador = chamadorFixo(SAIDA);
    const r = await sugerirClassificacao(produto({ tituloInterno: 'x' }), {
      llm: servico(chamador),
      modelo: MODELO,
    });
    expect(r.tipo).toBe('nada_a_classificar');
    expect(chamador.chamadas).toBe(0);
  });

  it('sugere com justificativa e confiança graduada', async () => {
    const r = await sugerirClassificacao(produto(), {
      llm: servico(chamadorFixo(SAIDA)),
      modelo: MODELO,
    });

    expect(r.tipo).toBe('sugerido');
    if (r.tipo !== 'sugerido') return;
    expect(r.candidatos[0]?.ncm).toBe('84212100');
    expect(r.candidatos[0]?.confiancaBp).toBe(CONFIANCA_POR_CERTEZA.alta);
    expect(r.candidatos[0]?.justificativa).toContain('filtrar');
  });

  it('a segunda pergunta igual sai do cache, sem segunda chamada', async () => {
    // É a disciplina do ADR 0005: classificar o mesmo produto duas vezes é o jeito
    // mais rápido de transformar um projeto barato em conta alta.
    const chamador = chamadorFixo(SAIDA);
    const llm = servico(chamador);

    const primeira = await sugerirClassificacao(produto(), { llm, modelo: MODELO });
    const segunda = await sugerirClassificacao(produto(), { llm, modelo: MODELO });

    expect(primeira.tipo).toBe('sugerido');
    expect(segunda.tipo).toBe('sugerido');
    if (segunda.tipo === 'sugerido') expect(segunda.deCache).toBe(true);
    expect(chamador.chamadas).toBe(1);
  });

  it('resposta fora do schema não vira sugestão inventada', async () => {
    const r = await sugerirClassificacao(produto(), {
      llm: servico(chamadorFixo({ candidatos: [{ ncm: '84212100' }] })),
      modelo: MODELO,
    });
    expect(r.tipo).toBe('falhou');
    if (r.tipo === 'falhou') expect(r.motivo).toContain('formato');
  });

  it('orçamento estourado sobe, em vez de virar "esse item falhou"', async () => {
    // Um laço que trata estouro como falha do item segue para o próximo e estoura de
    // novo, uma vez por item.
    // O teto é de **uma** chamada e não de zero: `Orcamento` recusa teto zero na
    // construção, com razão — orçamento zero é configuração errada, não execução sem
    // orçamento. Então a primeira passa e a segunda estoura.
    const llm = servico(chamadorFixo(SAIDA), new Orcamento(1_000, 1));

    expect((await sugerirClassificacao(produto(), { llm, modelo: MODELO })).tipo).toBe('sugerido');

    await expect(
      sugerirClassificacao(produto({ tituloInterno: 'Outro produto qualquer' }), {
        llm,
        modelo: MODELO,
      }),
    ).rejects.toThrow(OrcamentoEstourado);
  });
});
