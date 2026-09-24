import { describe, expect, it } from 'vitest';
import { DIAS_QUE_JA_SAO_AGORA } from '@/dominio/fiscal/prazos';
import { hrefAtual } from '../navegacao';
import {
  NAO_DEU_PARA_LER,
  estaCalma,
  montarPendencias,
  resumoDaCasa,
  separarCalmas,
  type LeiturasDaCasa,
  type Pendencia,
} from './apresentacao';

/** Casa calma: tudo lido, nada pendente. */
const CALMA: LeiturasDaCasa = {
  entradasEmRevisao: 0,
  paresEsperandoDecisao: 0,
  postagem: { atrasados: 0, hoje: 0, semPrazo: 0 },
  compatibilidadeEmRevisao: 0,
  consignacaoEmRisco: 0,
  produtosSemCodigoFiscal: 0,
  prazoFiscal: null,
};

const leituras = (parciais: Partial<LeiturasDaCasa> = {}): LeiturasDaCasa => ({
  ...CALMA,
  ...parciais,
});

const acharPor = (itens: readonly Pendencia[], chave: string): Pendencia | undefined =>
  itens.find((i) => i.chave === chave);

describe('montarPendencias', () => {
  it('toda pendência aponta para uma porta que existe', () => {
    // Um href com erro de digitação não quebra nada: dá 404 quando alguém clica, o
    // que é meses depois. Cruzar com a navegação pega isso na hora — inclusive a tela
    // que mora dentro de outra, como juntar iguais dentro do catálogo.
    const fora = montarPendencias(leituras())
      .map((p) => p.href)
      .filter((href) => hrefAtual(href) === null);
    expect(fora).toEqual([]);
  });

  it('pedido atrasado é agora; só "para hoje" é atenção', () => {
    const comAtraso = acharPor(
      montarPendencias(leituras({ postagem: { atrasados: 2, hoje: 1, semPrazo: 0 } })),
      'postagem',
    );
    expect(comAtraso?.tom).toBe('agora');
    expect(comAtraso?.quantidade).toBe(3);
    expect(comAtraso?.oQueE).toBe('2 atrasados, 1 para hoje');

    const soHoje = acharPor(
      montarPendencias(leituras({ postagem: { atrasados: 0, hoje: 4, semPrazo: 0 } })),
      'postagem',
    );
    expect(soHoje?.tom).toBe('atencao');
  });

  it('pedido sem prazo conta como urgente, e não como "depois"', () => {
    // É a regra que a tela de postagem já usa: não saber se atrasou é o problema.
    const p = acharPor(
      montarPendencias(leituras({ postagem: { atrasados: 0, hoje: 0, semPrazo: 1 } })),
      'postagem',
    );
    expect(p?.tom).toBe('agora');
    expect(p?.oQueE).toContain('sem prazo');
  });

  it('consignação em risco é agora, porque é venda cancelada e não papel errado', () => {
    const p = acharPor(montarPendencias(leituras({ consignacaoEmRisco: 3 })), 'consignacao');
    expect(p?.tom).toBe('agora');
    expect(p?.oQueE).toBe('3 unidades de parceiro sem conferência');
  });

  it('cadastro fiscal faltando vira agora quando o prazo está dentro da janela', () => {
    const perto = acharPor(
      montarPendencias(
        leituras({
          produtosSemCodigoFiscal: 4,
          prazoFiscal: { rotulo: 'NF-e com IBS', diasRestantes: DIAS_QUE_JA_SAO_AGORA - 1 },
        }),
      ),
      'fiscal',
    );
    expect(perto?.tom).toBe('agora');
    expect(perto?.oQueE).toContain('NF-e com IBS');

    const longe = acharPor(
      montarPendencias(
        leituras({
          produtosSemCodigoFiscal: 4,
          prazoFiscal: { rotulo: 'NF-e com IBS', diasRestantes: DIAS_QUE_JA_SAO_AGORA + 60 },
        }),
      ),
      'fiscal',
    );
    expect(longe?.tom).toBe('atencao');
  });

  it('cadastro completo com prazo chegando fica em atenção, não em calmo', () => {
    // Não há o que fazer no cadastro, mas a data continua vindo — e sumir com a linha
    // seria a tela dizendo que não há nada a saber.
    const p = acharPor(
      montarPendencias(leituras({ prazoFiscal: { rotulo: 'CNPJ obrigatório', diasRestantes: 5 } })),
      'fiscal',
    );
    expect(p?.tom).toBe('atencao');
    expect(p?.oQueE).toContain('cadastro completo');
  });

  it('leitura que falhou mostra a frase honesta, e não zero', () => {
    const p = acharPor(
      montarPendencias(leituras({ paresEsperandoDecisao: null })),
      'juntar-iguais',
    );
    expect(p?.quantidade).toBeNull();
    expect(p?.oQueE).toBe(NAO_DEU_PARA_LER);
    expect(p?.tom).toBe('atencao');
  });

  it('ordena por tom e, no mesmo tom, pela quantidade maior', () => {
    const itens = montarPendencias(
      leituras({
        postagem: { atrasados: 1, hoje: 0, semPrazo: 0 },
        entradasEmRevisao: 2,
        paresEsperandoDecisao: 9,
      }),
    );
    expect(itens[0]?.chave).toBe('postagem');
    expect(itens.map((i) => i.chave).slice(1, 3)).toEqual(['juntar-iguais', 'importar']);
  });

  it('não troca de ordem sozinha quando os números empatam', () => {
    const uma = montarPendencias(leituras({ entradasEmRevisao: 2, paresEsperandoDecisao: 2 }));
    const outra = montarPendencias(leituras({ entradasEmRevisao: 2, paresEsperandoDecisao: 2 }));
    expect(uma.map((i) => i.chave)).toEqual(outra.map((i) => i.chave));
  });
});

describe('resumoDaCasa', () => {
  it('casa calma diz que está calma', () => {
    expect(resumoDaCasa(montarPendencias(leituras()))).toContain('Nada esperando por você');
  });

  it('com urgência, nomeia o que não pode esperar', () => {
    const resumo = resumoDaCasa(
      montarPendencias(leituras({ consignacaoEmRisco: 2, entradasEmRevisao: 5 })),
    );
    expect(resumo).toContain('não pode esperar');
    expect(resumo).toContain('consignação');
    // A entrada em revisão tem trabalho, mas não é urgente: não entra na frase.
    expect(resumo).not.toContain('importar');
  });

  it('sem urgência mas com trabalho, conta as telas', () => {
    const resumo = resumoDaCasa(
      montarPendencias(leituras({ entradasEmRevisao: 5, compatibilidadeEmRevisao: 1 })),
    );
    expect(resumo).toContain('2 telas têm trabalho');
    expect(resumo).toContain('nenhuma urgente');
  });

  it('quando nada foi lido, não diz que está tudo em ordem', () => {
    // O pior texto possível nesta tela é um "nada esperando por você" produzido por
    // banco fora do ar.
    const tudoNulo: LeiturasDaCasa = {
      entradasEmRevisao: null,
      paresEsperandoDecisao: null,
      postagem: null,
      compatibilidadeEmRevisao: null,
      consignacaoEmRisco: null,
      produtosSemCodigoFiscal: null,
      prazoFiscal: null,
    };
    const resumo = resumoDaCasa(montarPendencias(tudoNulo));
    expect(resumo).toContain('Não deu para ler');
    expect(resumo).not.toContain('Nada esperando');
  });
});

describe('separarCalmas', () => {
  it('casa calma não tem cartão nenhum: tudo desce para a faixa recolhida', () => {
    const { ativas, calmas } = separarCalmas(montarPendencias(leituras()));
    expect(ativas).toEqual([]);
    expect(calmas.length).toBeGreaterThan(0);
  });

  it('leitura que falhou vira cartão, e não linha recolhida', () => {
    // É a distinção que justifica a função: zero pode ser recolhido, "não deu para ler"
    // não pode — recolher o que não se sabe é o jeito de deixar de conferir.
    const { ativas, calmas } = separarCalmas(
      montarPendencias(leituras({ entradasEmRevisao: null })),
    );
    expect(ativas.map((i) => i.chave)).toEqual(['importar']);
    expect(ativas[0]?.oQueE).toBe(NAO_DEU_PARA_LER);
    expect(calmas.map((i) => i.chave)).not.toContain('importar');
  });

  it('o que tem trabalho vira cartão', () => {
    const { ativas } = separarCalmas(montarPendencias(leituras({ consignacaoEmRisco: 4 })));
    expect(ativas.map((i) => i.chave)).toEqual(['consignacao']);
  });

  it('estaCalma é zero com leitura boa, nunca leitura falha', () => {
    const zerada = montarPendencias(leituras());
    expect(zerada.every(estaCalma)).toBe(true);

    const falhou = montarPendencias(leituras({ postagem: null }));
    expect(falhou.filter((i) => i.chave === 'postagem').every(estaCalma)).toBe(false);
  });
});
