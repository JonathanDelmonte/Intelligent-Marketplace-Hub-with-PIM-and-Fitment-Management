import { describe, expect, it } from 'vitest';
import { URGENCIAS, montarFilaDoDia, type PedidoParaPostar } from '@/dominio/pedidos/fila-do-dia';
import { centavos, reaisParaCentavos } from '@/lib/dinheiro';
import {
  CODIGOS_DE_AVISO,
  avisoDeConsignacao,
  descreverAviso,
  diferencaCurta,
  gruposDaFila,
  hojeEmTexto,
  numerosDaFila,
  rotuloDaUrgencia,
  semProdutoEmTexto,
  tempoRestanteEmTexto,
  tomDaUrgencia,
  repasseDaLojaEmTexto,
} from './apresentacao';

/** Meio-dia de uma quarta-feira em São Paulo. */
const AGORA = new Date('2026-09-30T15:00:00Z');
const HORA = 60 * 60 * 1000;

/** Um pedido com o prazo a tantas horas de agora (negativo é atraso), ou sem prazo. */
function pedido(id: string, horas: number | null, postado = false): PedidoParaPostar {
  return {
    id,
    idExterno: `pedido-${id}`,
    plataforma: 'ml',
    qtd: 1,
    tituloDoProduto: 'Refil',
    prazoPostagemAte: horas === null ? null : new Date(AGORA.getTime() + horas * HORA),
    postagemConfirmadaEm: postado ? AGORA : null,
    rastreio: null,
  };
}

describe('tomDaUrgencia', () => {
  it('só o atraso é alerta', () => {
    expect(tomDaUrgencia('atrasado')).toBe('alerta');
    expect(tomDaUrgencia('hoje')).toBe('atencao');
    expect(tomDaUrgencia('sem_prazo')).toBe('atencao');
    expect(tomDaUrgencia('amanha')).toBe('neutro');
    expect(tomDaUrgencia('depois')).toBe('neutro');
  });

  it('toda urgência tem rótulo', () => {
    for (const u of URGENCIAS) expect(rotuloDaUrgencia(u), u).not.toBe('');
  });
});

describe('tempoRestanteEmTexto', () => {
  it('hora é a unidade de quem vai postar agora', () => {
    expect(tempoRestanteEmTexto(5)).toBe('faltam 5h');
  });

  it('vence agora é dito assim, não "faltam 0h"', () => {
    expect(tempoRestanteEmTexto(0)).toBe('vence agora');
  });

  it('atraso em horas quando é do dia', () => {
    expect(tempoRestanteEmTexto(-3)).toBe('3h de atraso');
  });

  it('atraso em dias quando passou de um dia, com singular certo', () => {
    expect(tempoRestanteEmTexto(-30)).toBe('1 dia de atraso');
    expect(tempoRestanteEmTexto(-72)).toBe('3 dias de atraso');
  });

  it('acima de 48h vira dia, porque a hora exata deixou de importar', () => {
    expect(tempoRestanteEmTexto(47)).toBe('faltam 47h');
    expect(tempoRestanteEmTexto(72)).toBe('faltam 3 dias');
  });

  it('sem prazo não inventa número', () => {
    expect(tempoRestanteEmTexto(null)).toBe('sem prazo');
  });
});

describe('diferencaCurta', () => {
  it('diz de que lado está a diferença, com o valor sem sinal', () => {
    expect(diferencaCurta(centavos(0 - reaisParaCentavos(4)))).toMatch(/^R\$\s4,00 a menos$/u);
    expect(diferencaCurta(reaisParaCentavos(4))).toMatch(/^R\$\s4,00 a mais$/u);
  });
});

describe('avisoDeConsignacao', () => {
  it('sem unidade em risco não devolve texto, para a tela não ter caixa vazia', () => {
    expect(avisoDeConsignacao(0)).toBeNull();
    // Negativo não deveria acontecer, e mesmo assim não vira frase absurda.
    expect(avisoDeConsignacao(-1)).toBeNull();
  });

  it('uma unidade está anunciada, e não "estão anunciadas"', () => {
    expect(avisoDeConsignacao(1)).toContain('1 unidade em consignação está anunciada');
  });

  it('com risco diz o número e o que fazer antes de vender', () => {
    const texto = avisoDeConsignacao(7);
    expect(texto).toContain('7 unidades');
    expect(texto).toContain('antes de vender');
  });
});

describe('descreverAviso', () => {
  it('devolve nulo sem código e para código desconhecido', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('todo código tem título e corpo', () => {
    for (const c of CODIGOS_DE_AVISO) {
      const aviso = descreverAviso(c);
      expect(aviso, c).not.toBeNull();
      expect(aviso?.titulo, c).not.toBe('');
      expect(aviso?.corpo, c).not.toBe('');
    }
  });

  it('"não encontrado" sugere a causa provável em vez de culpar', () => {
    expect(descreverAviso('nao_encontrado')?.corpo).toContain('outra aba');
  });
});

describe('aviso de repasse conferido', () => {
  it('diz que a linha saiu da lista e que o pedido não mudou', () => {
    // A frase precisa dizer as duas: conferir tira da lista, e não corrige nada.
    const aviso = descreverAviso('repasse_conferido');
    expect(aviso?.tom).toBe('ok');
    expect(aviso?.corpo).toContain('saiu da lista');
    expect(aviso?.corpo).toContain('já olhou');
  });

  it('desfazer tem aviso próprio, dizendo para onde a linha voltou', () => {
    const aviso = descreverAviso('repasse_de_volta');
    expect(aviso?.tom).toBe('ok');
    expect(aviso?.corpo).toContain('voltou');
  });
});

describe('repasseDaLojaEmTexto', () => {
  it('diz quanto espera conferência na loja, e nada quando não há', () => {
    expect(repasseDaLojaEmTexto(0)).toBe('nada para conferir');
    expect(repasseDaLojaEmTexto(1)).toBe('1 pedido com repasse diferente do esperado');
    expect(repasseDaLojaEmTexto(3)).toBe('3 pedidos com repasse diferente do esperado');
  });
});

describe('numerosDaFila', () => {
  it('diz os quatro números na ordem do alto', () => {
    const fila = montarFilaDoDia(
      [pedido('a', -2), pedido('b', null), pedido('c', null), pedido('d', 3, true)],
      AGORA,
    );
    expect(numerosDaFila(fila).map((n) => [n.chave, n.valor])).toEqual([
      ['atrasado', 1],
      ['hoje', 0],
      ['sem_prazo', 2],
      ['postados', 1],
    ]);
  });

  it('o número com fila atrás leva ao grupo dele, e o zero não leva a lugar nenhum', () => {
    const fila = montarFilaDoDia([pedido('a', -2), pedido('b', 3, true)], AGORA);
    const [atrasados, hoje, , postados] = numerosDaFila(fila);
    expect(atrasados?.ancora).toBe('#grupo-atrasado');
    expect(hoje?.ancora).toBeNull();
    // O que já saiu da fila não tem grupo na tabela.
    expect(postados?.ancora).toBeNull();
  });

  it('o zero fala: nenhum atraso é boa notícia, e vem em verde', () => {
    const [atrasados] = numerosDaFila(montarFilaDoDia([], AGORA));
    expect(atrasados).toMatchObject({ valor: 0, tom: 'alta', nota: 'nenhum passou do prazo' });
  });

  it('atraso é vermelho, e o dia e o sem prazo pedem atenção', () => {
    const fila = montarFilaDoDia([pedido('a', -2), pedido('b', 3), pedido('c', null)], AGORA);
    expect(numerosDaFila(fila).map((n) => n.tom)).toEqual([
      'baixa',
      'atencao',
      'atencao',
      'neutro',
    ]);
  });
});

describe('gruposDaFila', () => {
  it('corta a fila onde a urgência muda, na ordem em que ela vem', () => {
    const fila = montarFilaDoDia(
      [pedido('a', -2), pedido('b', null), pedido('c', 3), pedido('d', null)],
      AGORA,
    );
    const grupos = gruposDaFila(fila);
    expect(grupos.map((g) => g.urgencia)).toEqual(['sem_prazo', 'atrasado', 'hoje']);
    expect(grupos[0]?.itens.map((i) => i.id)).toEqual(['b', 'd']);
    expect(grupos[0]?.ancora).toBe('grupo-sem_prazo');
  });

  it('fila vazia não tem grupo, para a tabela não mostrar cabeçalho sem linha', () => {
    expect(gruposDaFila(montarFilaDoDia([], AGORA))).toEqual([]);
  });

  it('todo grupo tem título, frase e o tom da urgência', () => {
    // Uma de cada: sem prazo, atraso, hoje, amanhã (24h depois do meio-dia) e depois.
    const fila = montarFilaDoDia(
      [pedido('a', null), pedido('b', -2), pedido('c', 3), pedido('d', 24), pedido('e', 72)],
      AGORA,
    );
    const grupos = gruposDaFila(fila);
    expect(grupos.map((g) => g.urgencia)).toEqual([...URGENCIAS]);
    for (const grupo of grupos) {
      expect(grupo.titulo, grupo.urgencia).not.toBe('');
      expect(grupo.explicacao, grupo.urgencia).not.toBe('');
      expect(grupo.tom, grupo.urgencia).toBe(tomDaUrgencia(grupo.urgencia));
    }
  });
});

describe('semProdutoEmTexto', () => {
  it('sem pedido sem produto, não há frase', () => {
    expect(semProdutoEmTexto(0)).toBeNull();
  });

  it('concorda o verbo com o número, e diz o que fazer', () => {
    expect(semProdutoEmTexto(1)).toContain('1 pedido não casou');
    expect(semProdutoEmTexto(1)).toContain('não tem margem');
    expect(semProdutoEmTexto(3)).toContain('3 pedidos não casaram');
    expect(semProdutoEmTexto(3)).toContain('não têm margem');
    expect(semProdutoEmTexto(3)).toContain('código de barras');
  });
});

describe('hojeEmTexto', () => {
  it('diz o dia por extenso, com a primeira letra maiúscula', () => {
    expect(hojeEmTexto(AGORA)).toBe('Quarta-feira, 30 de setembro');
  });

  it('o dia é o de São Paulo, e não o do servidor', () => {
    // 1h de quinta em UTC ainda é 22h de quarta em São Paulo.
    expect(hojeEmTexto(new Date('2026-10-01T01:00:00Z'))).toBe('Quarta-feira, 30 de setembro');
  });
});
