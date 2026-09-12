import { describe, expect, it } from 'vitest';
import { CORTE_AGRUPAMENTO_BP, CORTE_REVISAO_BP } from '@/dominio/identidade/resolucao';
import {
  confiancaLegivel,
  descreverAviso,
  estadoDaBase,
  fonteLegivel,
  inteiroDaUrl,
  cabecalhoDoPar,
  precoLegivel,
  rotuloDoNivel,
} from './apresentacao';

describe('descreverAviso', () => {
  it('devolve null para ausência e para código desconhecido', () => {
    expect(descreverAviso(undefined, undefined)).toBeNull();
    expect(descreverAviso('inventado', undefined)).toBeNull();
  });

  it('conjuga o plural da quantidade', () => {
    expect(descreverAviso('decidido_com_ligacao', 1)?.corpo).toContain('1 ocorrência ligada');
    expect(descreverAviso('decidido_com_ligacao', 3)?.corpo).toContain('3 ocorrências ligadas');
  });

  it('trata quantidade ausente como zero em vez de mostrar undefined', () => {
    expect(descreverAviso('resolucao_feita', undefined)?.corpo).toBe('0 ocorrências avaliadas.');
  });

  it('o aviso de decisão sem exemplo explica por que não ensinou', () => {
    const aviso = descreverAviso('resolvido_sem_exemplo', undefined);
    expect(aviso?.tom).toBe('atencao');
    expect(aviso?.corpo).toContain('forma canônica');
  });

  it('propagação falhada não diz que a decisão falhou', () => {
    // A decisão e o exemplo ficaram gravados; só a ligação ao SKU não foi. Dizer
    // "não foi gravada" faria a pessoa clicar de novo.
    const aviso = descreverAviso('decidido_sem_propagar', undefined);
    expect(aviso?.tom).toBe('atencao');
    expect(aviso?.titulo).toContain('Decisão registrada');
    expect(aviso?.corpo).toContain('gravada');
  });

  it('falha é erro, não atenção', () => {
    expect(descreverAviso('falha', undefined)?.tom).toBe('erro');
  });
});

describe('inteiroDaUrl', () => {
  it('lê inteiro e ignora lixo', () => {
    expect(inteiroDaUrl('7')).toBe(7);
    expect(inteiroDaUrl('0')).toBe(0);
    expect(inteiroDaUrl('-1')).toBeUndefined();
    expect(inteiroDaUrl('abc')).toBeUndefined();
    expect(inteiroDaUrl(undefined)).toBeUndefined();
  });

  it('usa o primeiro valor quando o parâmetro vem repetido', () => {
    expect(inteiroDaUrl(['2', '5'])).toBe(2);
  });
});

describe('confiancaLegivel', () => {
  it('mostra ponto-base como percentual', () => {
    expect(confiancaLegivel(8_500)).toBe('85%');
    expect(confiancaLegivel(10_000)).toBe('100%');
  });
});

describe('cabecalhoDoPar', () => {
  it('promove a justificativa ao título quando não há confiança para explicar', () => {
    // Sem isto o destaque de todo cartão dizia a mesma frase inútil ("a comparação
    // determinística não decidiu") e a informação de verdade ficava embaixo.
    const cabecalho = cabecalhoDoPar({
      decisao: 'indeciso',
      origem: 'deterministico',
      confiancaBp: 0,
      nivel: 'marca_modelo',
      justificativa: 'mesma marca e modelo, mas a quantidade difere: 1 contra 3',
    });
    expect(cabecalho.titulo).toContain('quantidade difere');
    expect(cabecalho.detalhe).toBeNull();
  });

  it('sem confiança e sem justificativa, diz o que fazer em vez de nada', () => {
    const cabecalho = cabecalhoDoPar({
      decisao: 'indeciso',
      origem: 'deterministico',
      confiancaBp: 0,
      nivel: 'nenhum',
      justificativa: null,
    });
    expect(cabecalho.titulo).toContain('sua leitura');
    expect(cabecalho.detalhe).toBeNull();
  });

  it('trata justificativa em branco como ausente', () => {
    const cabecalho = cabecalhoDoPar({
      decisao: 'indeciso',
      origem: 'deterministico',
      confiancaBp: 0,
      nivel: 'nenhum',
      justificativa: '   ',
    });
    expect(cabecalho.titulo).toContain('sua leitura');
  });

  it('com confiança, o título explica por que ela não bastou', () => {
    const cabecalho = cabecalhoDoPar({
      decisao: 'mesmo',
      origem: 'llm',
      confiancaBp: 7_000,
      nivel: 'embedding',
      justificativa: 'mesmo elemento filtrante, nomes de catálogo diferentes',
    });
    expect(cabecalho.titulo).toContain('julgamento por LLM');
    expect(cabecalho.titulo).toContain('70%');
    expect(cabecalho.titulo).toContain(confiancaLegivel(CORTE_AGRUPAMENTO_BP));
    expect(cabecalho.detalhe).toContain('elemento filtrante');
  });

  it('aspas só quando alguém falou: julgamento de LLM sim, conta determinística não', () => {
    const doModelo = cabecalhoDoPar({
      decisao: 'diferente',
      origem: 'llm',
      confiancaBp: 9_000,
      nivel: 'embedding',
      justificativa: 'um é refil avulso, o outro é o filtro completo',
    });
    expect(doModelo.detalheEhCitacao).toBe(true);

    const daConta = cabecalhoDoPar({
      decisao: 'diferente',
      origem: 'deterministico',
      confiancaBp: 7_500,
      nivel: 'marca_modelo',
      justificativa: 'mesma marca, código de peça diferente',
    });
    expect(daConta.detalheEhCitacao).toBe(false);
  });

  it('cita a zona de revisão quando a decisão é indecisa com alguma confiança', () => {
    const cabecalho = cabecalhoDoPar({
      decisao: 'indeciso',
      origem: 'llm',
      confiancaBp: 6_000,
      nivel: 'embedding',
      justificativa: null,
    });
    expect(cabecalho.titulo).toContain(confiancaLegivel(CORTE_REVISAO_BP));
  });

  it('o título começa com maiúscula, porque é uma frase', () => {
    const cabecalho = cabecalhoDoPar({
      decisao: 'diferente',
      origem: 'deterministico',
      confiancaBp: 7_500,
      nivel: 'marca_modelo',
      justificativa: null,
    });
    expect(cabecalho.titulo.charAt(0)).toBe(cabecalho.titulo.charAt(0).toUpperCase());
  });
});

describe('rotuloDoNivel', () => {
  it('traduz o nível sem jargão de banco', () => {
    expect(rotuloDoNivel('gtin')).toBe('código de barras');
    expect(rotuloDoNivel('marca_modelo')).toBe('marca e código de peça');
    expect(rotuloDoNivel('embedding')).toBe('semelhança de descrição');
    expect(rotuloDoNivel('nenhum')).toBe('sem evidência forte');
  });

  it('não quebra com nível que ainda não existe', () => {
    expect(rotuloDoNivel('futuro')).toBe('sem evidência forte');
  });
});

describe('precoLegivel e fonteLegivel', () => {
  it('diz a ausência de preço por extenso', () => {
    expect(precoLegivel(null)).toBe('sem preço na fonte');
    expect(precoLegivel(4_990)).toContain('49,90');
  });

  it('traduz a procedência usando a tabela do domínio', () => {
    expect(fonteLegivel('m1_planilha')).toBe('planilha importada');
    expect(fonteLegivel('desconhecida')).toBe('desconhecida');
  });
});

describe('estadoDaBase', () => {
  it('distingue base vazia de nada avaliado e de fila zerada', () => {
    expect(estadoDaBase({ ocorrencias: 0, pendentes: 0, avaliadas: 0 })?.titulo).toContain('vazia');
    expect(estadoDaBase({ ocorrencias: 10, pendentes: 0, avaliadas: 0 })?.titulo).toContain(
      'Nada foi avaliado',
    );
    const nadaPendente = estadoDaBase({ ocorrencias: 10, pendentes: 0, avaliadas: 4 });
    expect(nadaPendente?.tom).toBe('ok');
    expect(nadaPendente?.titulo).toContain('Nada esperando');
  });

  it('não diz nada quando há fila, porque a fila fala por si', () => {
    expect(estadoDaBase({ ocorrencias: 10, pendentes: 3, avaliadas: 5 })).toBeNull();
  });

  it('base vazia manda para a tela de entrada, que é a ação que resolve', () => {
    expect(estadoDaBase({ ocorrencias: 0, pendentes: 0, avaliadas: 0 })?.corpo).toContain('/jobs');
  });
});
