import { describe, expect, it } from 'vitest';
import { estadoDaFerramenta } from '@/dominio/prospector/ferramentas';
import { FAMILIAS_DE_HIPOTESE } from '@/dominio/prospector/hipoteses';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  descreverAviso,
  explicacaoAcrescenta,
  lerTeto,
  linhaDaFronteira,
  orcamentoLegivel,
  resumoDoGarimpo,
  ROTULO_DA_FAMILIA,
  situacaoDoDossie,
  textoDoEstadoDaFerramenta,
} from './apresentacao';

describe('situacaoDoDossie', () => {
  it('dossiê sem passo gasto está esperando a fila, e não em andamento', () => {
    // O domínio usa `motivoParada` nulo para "em andamento", e um dossiê recém-aberto
    // também tem motivo nulo. Chamar isso de "em andamento" afirmaria que o laço está
    // rodando, quando o que houve foi a tela gravar o plano e enfileirar o job.
    const s = situacaoDoDossie({ motivoParada: null, passosGastos: 0, hipotesesAbertas: 7 });
    expect(s.rotulo).toBe('esperando a fila');
    expect(s.explicacao).toContain('fila');
    expect(s.valeContinuar).toBe(false);
  });

  it('com passo gasto e sem motivo, aí sim está em andamento', () => {
    const s = situacaoDoDossie({ motivoParada: null, passosGastos: 3, hipotesesAbertas: 4 });
    expect(s.rotulo).toBe('em andamento');
  });

  it('saturação é ter terminado, e continuar não vale', () => {
    const s = situacaoDoDossie({
      motivoParada: 'saturacao',
      passosGastos: 9,
      hipotesesAbertas: 2,
    });
    expect(s.tom).toBe('ok');
    expect(s.valeContinuar).toBe(false);
    expect(s.explicacao).toContain('não traria mais nada');
  });

  it('teto com hipótese em aberto vale continuar; sem hipótese, não', () => {
    const com = situacaoDoDossie({
      motivoParada: 'orcamento_passos',
      passosGastos: 20,
      hipotesesAbertas: 3,
    });
    expect(com.valeContinuar).toBe(true);

    const sem = situacaoDoDossie({
      motivoParada: 'orcamento_reais',
      passosGastos: 20,
      hipotesesAbertas: 0,
    });
    expect(sem.valeContinuar).toBe(false);
  });

  it('fronteira vazia diz que teto maior não resolve', () => {
    const s = situacaoDoDossie({
      motivoParada: 'fronteira_vazia',
      passosGastos: 0,
      hipotesesAbertas: 7,
    });
    expect(s.explicacao).toContain('Aumentar o teto não resolve');
    expect(s.valeContinuar).toBe(false);
  });
});

describe('explicacaoAcrescenta', () => {
  it('só onde o resumo do domínio não explica', () => {
    // O resumo já diz "parou no teto, continuar não recomeça" e "saturou".
    expect(explicacaoAcrescenta(null)).toBe(true);
    expect(explicacaoAcrescenta('fronteira_vazia')).toBe(true);
    expect(explicacaoAcrescenta('saturacao')).toBe(false);
    expect(explicacaoAcrescenta('orcamento_passos')).toBe(false);
  });
});

describe('textoDoEstadoDaFerramenta', () => {
  it('o que falta vira detalhe, porque é o que diz o que fazer', () => {
    const busca = textoDoEstadoDaFerramenta(estadoDaFerramenta('busca_web', ['base_local']));
    expect(busca.rotulo).toBe('não existe ainda');
    expect(busca.detalhe).toContain('buscador');
  });

  it('o que dá para usar não precisa de detalhe', () => {
    const local = textoDoEstadoDaFerramenta(estadoDaFerramenta('base_local', ['base_local']));
    expect(local.tom).toBe('ok');
    expect(local.detalhe).toBeNull();
  });
});

describe('orcamentoLegivel', () => {
  it('mostra as duas moedas do teto', () => {
    const texto = orcamentoLegivel({
      gastoCentavos: centavos(0),
      orcamentoCentavos: reaisParaCentavos(5),
      passosGastos: 0,
      orcamentoPassos: 20,
    });
    expect(texto).toContain('de 20 passos');
    expect(texto).toContain('5,00');
  });
});

describe('resumoDoGarimpo', () => {
  const base = {
    dossies: 0,
    achados: 0,
    valeContinuar: 0,
    familiasPossiveis: 2,
    familiasTotais: 7,
  };

  it('sem dossiê, explica o que abrir um alvo faz', () => {
    const r = resumoDoGarimpo(base);
    expect(r).toContain('Nenhum alvo aberto');
    expect(r).toContain('2 perguntas de 7 dão para investigar');
  });

  it('o verbo concorda com a contagem de perguntas', () => {
    // "3 perguntas de 7 dá para investigar" foi o que a tela mostrou primeiro.
    expect(resumoDoGarimpo({ ...base, familiasPossiveis: 1 })).toContain('1 pergunta de 7 dá para');
    expect(resumoDoGarimpo({ ...base, familiasPossiveis: 3 })).toContain(
      '3 perguntas de 7 dão para',
    );
  });

  it('nenhuma ferramenta diz que não dá para investigar nenhuma pergunta', () => {
    // Sem isto, "nenhum achado" se lê como sinal sobre o alvo.
    const r = resumoDoGarimpo({ ...base, dossies: 1, familiasPossiveis: 0 });
    expect(r).toContain('Nenhuma das 7 perguntas');
  });

  it('conta dossiê, achado e o que parou no teto', () => {
    const r = resumoDoGarimpo({ ...base, dossies: 3, achados: 12, valeContinuar: 1 });
    expect(r).toContain('3 alvos abertos');
    expect(r).toContain('12 achados');
    expect(r).toContain('1 dossiê parou no teto');
  });

  it('conjuga o singular, e "nenhum achado" não é "0 achados"', () => {
    const r = resumoDoGarimpo({ ...base, dossies: 1, achados: 0 });
    expect(r).toContain('1 alvo aberto, nenhum achado ainda.');
  });
});

describe('linhaDaFronteira', () => {
  it('na abertura, os sete itens têm o mesmo alvo, e a informação é a família', () => {
    // Sete linhas com o mesmo texto e a família à direita são sete linhas iguais.
    const linha = linhaDaFronteira(
      { alvo: 'refil PA21G', familia: 'quem_distribui' },
      'refil PA21G',
    );
    expect(linha.principal).toBe('quem distribui');
    expect(linha.secundario).toBeNull();
  });

  it('quando a investigação ramifica, o alvo do item é o que interessa', () => {
    const linha = linhaDaFronteira(
      { alvo: 'https://distribuidor.invalid/catalogo', familia: 'onde_e_mais_barato' },
      'refil PA21G',
    );
    expect(linha.principal).toBe('https://distribuidor.invalid/catalogo');
    expect(linha.secundario).toBe('onde é mais barato');
  });
});

describe('lerTeto', () => {
  it('lê reais digitados', () => {
    expect(lerTeto('5,00')).toBe(500);
  });

  it('teto zero ou ilegível não passa, porque o construtor do orçamento recusa', () => {
    expect(lerTeto('0')).toBeNull();
    expect(lerTeto('0,00')).toBeNull();
    expect(lerTeto('barato')).toBeNull();
    expect(lerTeto('')).toBeNull();
  });
});

describe('rótulos', () => {
  it('toda família tem rótulo curto', () => {
    for (const familia of FAMILIAS_DE_HIPOTESE) {
      expect(ROTULO_DA_FAMILIA[familia].length).toBeGreaterThan(3);
      expect(ROTULO_DA_FAMILIA[familia].length).toBeLessThan(24);
    }
  });
});

describe('descreverAviso', () => {
  it('código desconhecido não vira aviso', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('alvo que já existe não é reaberto, e o aviso diz o que aconteceu', () => {
    // Reabrir gravaria plano em branco sobre os achados. O que acontece é enfileirar.
    const aviso = descreverAviso('na_fila');
    expect(aviso?.tom).toBe('ok');
    expect(aviso?.titulo).toContain('fila');
    expect(aviso?.corpo).toContain('duas vezes');
  });

  it('plano salvo e job não criado é erro que não mente sobre o plano', () => {
    const aviso = descreverAviso('nao_enfileirou');
    expect(aviso?.tom).toBe('erro');
    expect(aviso?.corpo).toContain('O plano está salvo');
  });

  it('teto inválido lembra por que o teto existe', () => {
    expect(descreverAviso('teto_invalido')?.corpo).toContain('fatura');
  });
});
