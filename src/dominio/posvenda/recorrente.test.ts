import { describe, expect, it } from 'vitest';
import {
  REPETICOES_QUE_ACUSAM,
  TEMAS,
  assuntoDaPergunta,
  duvidasRecorrentes,
  oQueAcrescentar,
  type PerguntaRecebida,
} from './recorrente';

let contador = 0;
const pergunta = (texto: string, anuncioId = 'anuncio-1'): PerguntaRecebida => {
  contador += 1;
  return { id: `p${String(contador)}`, texto, em: new Date('2026-09-15T12:00:00Z'), anuncioId };
};

/** `n` perguntas com o mesmo texto. */
const repetir = (texto: string, n: number, anuncioId = 'anuncio-1'): PerguntaRecebida[] =>
  Array.from({ length: n }, () => pergunta(texto, anuncioId));

describe('assuntoDaPergunta', () => {
  it('a mesma dúvida escrita de três formas cai na mesma chave', () => {
    // Agrupar por texto contaria uma cada e nunca chegaria a cinco — o detector nunca
    // dispararia, e ninguém saberia por quê.
    const chaves = [
      'serve no PA26G?',
      'essa vela cabe no meu purificador PA26G',
      'compatível com PA26G???',
    ].map((t) => assuntoDaPergunta(t).chave);

    expect(new Set(chaves).size).toBe(1);
    expect(chaves[0]).toBe('compatibilidade:PA26G');
  });

  it('código de modelo vence palavra-chave', () => {
    // "serve no PA26G 220v?" é pergunta de compatibilidade com um detalhe de voltagem,
    // e é a lista de compatibilidade que resolve as duas.
    const a = assuntoDaPergunta('serve no PA26G 220v?');
    expect(a.tema).toBe('compatibilidade');
    expect(a.codigo).toBe('PA26G');
  });

  it('reconhece os temas sem código de modelo', () => {
    expect(assuntoDaPergunta('é 110 ou 220?').tema).toBe('voltagem');
    expect(assuntoDaPergunta('qual o diâmetro em mm?').tema).toBe('medida');
    expect(assuntoDaPergunta('vem quantas unidades?').tema).toBe('quantidade');
    // `vem 1 ou 2 unidades?` era classificada como compatibilidade, porque `vem 1`
    // virava um código de modelo. É pergunta de quantidade, e a diferença decide o
    // que acrescentar no anúncio.
    expect(assuntoDaPergunta('vem 1 ou 2 unidades?').tema).toBe('quantidade');
    expect(assuntoDaPergunta('vem 1 ou 2 unidades?').codigo).toBeNull();
    // O plural também: a lista tem `unidade`, e a pergunta real vem no plural.
    expect(assuntoDaPergunta('quantas unidades vêm?').tema).toBe('quantidade');
    expect(assuntoDaPergunta('vem em embalagens de 2?').tema).toBe('quantidade');
    expect(assuntoDaPergunta('qual o prazo de entrega?').tema).toBe('prazo');
    expect(assuntoDaPergunta('tem garantia?').tema).toBe('garantia');
    expect(assuntoDaPergunta('é original ou paralelo?').tema).toBe('originalidade');
  });

  it('palavra curta não casa dentro de outra palavra', () => {
    // `par` (de "vem em par?") casava dentro de "paralelo", e "é original ou paralelo?"
    // virava pergunta de quantidade. Substring é a forma errada de procurar palavra
    // curta em português: "par" mora dentro de parafuso, aparelho e separado.
    expect(assuntoDaPergunta('é original ou paralelo?').tema).toBe('originalidade');
    expect(assuntoDaPergunta('serve no aparelho de cozinha?').tema).not.toBe('quantidade');
  });

  it('é indiferente a acento', () => {
    expect(assuntoDaPergunta('qual a tensão?').tema).toBe('voltagem');
    expect(assuntoDaPergunta('tem devolução?').tema).toBe('garantia');
  });

  it('pergunta sem tema conhecido cai em outro, e não é descartada', () => {
    // Descartar esconderia uma dúvida repetida que o sistema não sabe nomear.
    expect(assuntoDaPergunta('bom dia, tudo bem com você?').tema).toBe('outro');
  });

  it('todo tema declarado é alcançável', () => {
    const vistos = new Set(
      [
        'serve no PA26G?',
        'é 110 ou 220?',
        'qual o diâmetro?',
        'vem quantas?',
        'qual o prazo?',
        'tem garantia?',
        'é original?',
        'olá',
      ].map((t) => assuntoDaPergunta(t).tema),
    );
    expect([...TEMAS].filter((t) => !vistos.has(t))).toEqual([]);
  });
});

describe('duvidasRecorrentes', () => {
  it('quatro vezes não acusa; cinco acusa', () => {
    // Abaixo do corte é comprador distraído; a partir dele é o anúncio que não
    // respondeu.
    expect(duvidasRecorrentes(repetir('é 110 ou 220?', REPETICOES_QUE_ACUSAM - 1))).toEqual([]);
    expect(duvidasRecorrentes(repetir('é 110 ou 220?', REPETICOES_QUE_ACUSAM))).toHaveLength(1);
  });

  it('conta variações da mesma dúvida como a mesma dúvida', () => {
    const perguntas = [
      pergunta('serve no PA26G?'),
      pergunta('cabe no purificador PA26G'),
      pergunta('compatível com PA26G???'),
      pergunta('esse refil é do PA26G'),
      pergunta('PA26G serve?'),
    ];
    const duvidas = duvidasRecorrentes(perguntas);
    expect(duvidas).toHaveLength(1);
    expect(duvidas[0]?.vezes).toBe(5);
    expect(duvidas[0]?.codigo).toBe('PA26G');
  });

  it('a saída é o que acrescentar, não a contagem', () => {
    // O módulo é detector de defeito no anúncio; as perguntas são o sintoma.
    const duvidas = duvidasRecorrentes(repetir('serve no PA26G?', 5));
    expect(duvidas[0]?.oQueAcrescentar).toContain('título');
    expect(duvidas[0]?.oQueAcrescentar).toContain('PA26G');
  });

  it('diz em quais anúncios a dúvida aparece', () => {
    // Agrupar entre anúncios sem dizer quais esconderia qual é o furado.
    const perguntas = [
      ...repetir('é 110 ou 220?', 3, 'anuncio-1'),
      ...repetir('é 110 ou 220?', 2, 'anuncio-2'),
    ];
    const duvidas = duvidasRecorrentes(perguntas);
    expect(duvidas[0]?.anuncios).toEqual(['anuncio-1', 'anuncio-2']);
  });

  it('a mais repetida vem primeiro, porque é o pior buraco da descrição', () => {
    const perguntas = [...repetir('tem garantia?', 5), ...repetir('é 110 ou 220?', 9)];
    const duvidas = duvidasRecorrentes(perguntas);
    expect(duvidas.map((d) => d.tema)).toEqual(['voltagem', 'garantia']);
  });

  it('mostra três exemplos, o bastante para reconhecer a dúvida', () => {
    const duvidas = duvidasRecorrentes(repetir('qual a medida?', 8));
    expect(duvidas[0]?.exemplos).toHaveLength(3);
  });

  it('aceita corte próprio, para anúncio de giro baixo', () => {
    expect(duvidasRecorrentes(repetir('tem garantia?', 2), 2)).toHaveLength(1);
  });

  it('nenhuma pergunta devolve lista vazia', () => {
    expect(duvidasRecorrentes([])).toEqual([]);
  });

  it('modelos diferentes são dúvidas diferentes', () => {
    // Cinco perguntas sobre PA26G e cinco sobre PA31G são dois buracos, não um.
    const perguntas = [...repetir('serve no PA26G?', 5), ...repetir('serve no PA31G?', 5)];
    expect(duvidasRecorrentes(perguntas)).toHaveLength(2);
  });
});

describe('oQueAcrescentar', () => {
  it('toda instrução diz onde escrever, não só que falta', () => {
    // "O anúncio está incompleto" não é acionável; "acrescente à descrição" é.
    for (const tema of TEMAS) {
      const texto = oQueAcrescentar({ tema, codigo: null, chave: tema });
      expect(texto.length, tema).toBeGreaterThan(80);
      expect(/descri|título|configura|linha/i.test(texto), tema).toBe(true);
    }
  });

  it('em compatibilidade, cobre também o caso de não servir', () => {
    // "Não serve em X" evita devolução e evita a pergunta — as duas coisas.
    const texto = oQueAcrescentar({
      tema: 'compatibilidade',
      codigo: 'PA26G',
      chave: 'compatibilidade:PA26G',
    });
    expect(texto).toContain('não serve');
    expect(texto).toContain('devolução');
  });
});
