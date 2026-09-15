import { describe, expect, it } from 'vitest';
import type { Evento, GrupoDeEventos } from '@/dominio/monitor/eventos';
import { agruparEventos, eventoDePreco } from '@/dominio/monitor/eventos';
import { avaliarQueda } from '@/dominio/monitor/queda';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  descontoLegivel,
  descreverAviso,
  descreverEvento,
  inteiroDaUrl,
  ordenarGrupos,
  ordenarQuedas,
  percentual,
  resumoDoMonitor,
  type QuedaNaTela,
} from './apresentacao';

const AGORA = new Date('2026-09-15T12:00:00-03:00');

const eventoDe = (antes: number, depois: number, sobre: string, quando = AGORA): Evento => {
  const e = eventoDePreco(
    { antes: reaisParaCentavos(antes), depois: reaisParaCentavos(depois) },
    {
      id: `${sobre}-${String(antes)}-${String(depois)}`,
      sobre,
      entidadeTipo: 'produto_externo',
      detectadoEm: quando,
    },
  );
  if (e === null) throw new Error('o teste precisa de uma mudança acima do piso');
  return e;
};

describe('percentual', () => {
  it('traduz pontos-base para o que se fala', () => {
    expect(percentual(1_500)).toBe('15%');
    expect(percentual(320)).toBe('3,2%');
    expect(percentual(null)).toBe('—');
    // A casa decimal segue o módulo: com `pct < 10` direto, −17,3% ganhava casa
    // decimal e 17,3% não, e os dois apareciam na mesma tela.
    expect(percentual(-1_730)).toBe('-17%');
    expect(percentual(-320)).toBe('-3,2%');
  });
});

describe('descontoLegivel', () => {
  it('desconto positivo é desconto', () => {
    expect(descontoLegivel(1_500)).toEqual({ rotulo: 'desconto real', valor: '15%' });
  });

  it('preço acima da mediana troca o rótulo em vez de mostrar sinal negativo', () => {
    // "desconto real: −17,3%" obriga quem lê a interpretar um sinal para descobrir
    // que o preço subiu.
    expect(descontoLegivel(-1_730)).toEqual({ rotulo: 'acima da mediana', valor: '17%' });
  });

  it('sem referência não inventa número', () => {
    expect(descontoLegivel(null).valor).toBe('—');
  });
});

describe('descreverEvento', () => {
  it('diz o que mudou e quanto, com os dois preços no detalhe', () => {
    const d = descreverEvento(eventoDe(50, 40, 'Loja do Zé'));
    expect(d.titulo).toBe('Preço caiu 20%');
    expect(d.detalhe).toContain('50,00');
    expect(d.detalhe).toContain('40,00');
  });

  it('alta é dita como alta, e não como queda negativa', () => {
    expect(descreverEvento(eventoDe(40, 50, 'Loja do Zé')).titulo).toBe('Preço subiu 25%');
  });

  it('evento sem os dois valores não inventa detalhe', () => {
    const semValores: Evento = {
      ...eventoDe(50, 40, 'Loja do Zé'),
      tipo: 'concorrente_novo',
      valorAntes: null,
      valorDepois: null,
      variacaoBp: null,
    };
    const d = descreverEvento(semValores);
    expect(d.titulo).toBe('Vendedor novo no nicho');
    expect(d.detalhe).toBeNull();
  });
});

describe('ordenarGrupos', () => {
  it('vermelho antes de amarelo, e grupo maior antes de grupo menor no mesmo tom', () => {
    // Queda de 20% é vermelha; alta de 25% é amarela (a assimetria é do domínio).
    const grupos = agruparEventos([
      eventoDe(40, 50, 'Concorrente A'),
      eventoDe(50, 40, 'Concorrente B'),
    ]);

    const ordenados = ordenarGrupos(grupos);
    expect(ordenados[0]?.sobre).toBe('Concorrente B');
    expect(ordenados[0]?.severidade).toBe('vermelho');
  });

  it('não depende da ordem em que os grupos chegaram', () => {
    const grupos = agruparEventos([eventoDe(40, 50, 'A'), eventoDe(50, 40, 'B')]);
    const invertidos: readonly GrupoDeEventos[] = [...grupos].reverse();
    expect(ordenarGrupos(grupos).map((g) => g.sobre)).toEqual(
      ordenarGrupos(invertidos).map((g) => g.sobre),
    );
  });
});

describe('ordenarQuedas', () => {
  const queda = (titulo: string, precoAtual: number, serie: readonly number[]): QuedaNaTela => ({
    produtoExternoId: titulo,
    titulo,
    de: 'Loja do Zé',
    avaliacao: avaliarQueda(
      reaisParaCentavos(precoAtual),
      serie.map((p, i) => ({
        preco: reaisParaCentavos(p),
        em: new Date(AGORA.getTime() - (serie.length - i) * 86_400_000),
      })),
      { agora: AGORA },
    ),
  });

  it('o que vale publicar vem primeiro, com o desconto maior no topo', () => {
    const ordenadas = ordenarQuedas([
      queda('desconto fraco', 48, [50, 50, 50]),
      queda('queda pequena', 42, [50, 50, 50]),
      queda('queda grande', 30, [50, 50, 50]),
    ]);

    expect(ordenadas.map((q) => q.titulo)).toEqual([
      'queda grande',
      'queda pequena',
      'desconto fraco',
    ]);
  });

  it('preço inflado aparece antes do desconto fraco, porque é o que não se publica', () => {
    const ordenadas = ordenarQuedas([
      queda('desconto fraco', 48, [50, 50, 50]),
      queda('inflado', 60, [50, 50, 50]),
    ]);
    expect(ordenadas[0]?.titulo).toBe('inflado');
    expect(ordenadas[0]?.avaliacao.veredito).toBe('preco_inflado');
  });
});

describe('resumoDoMonitor', () => {
  it('urgência é contada e dita primeiro', () => {
    const grupos = agruparEventos([eventoDe(50, 40, 'A')]);
    expect(resumoDoMonitor({ grupos, ofertasComSerie: 3 })).toContain('não pode esperar');
  });

  it('sem urgência, conta as mudanças e diz que nenhuma é urgente', () => {
    const grupos = agruparEventos([eventoDe(40, 50, 'A')]);
    const resumo = resumoDoMonitor({ grupos, ofertasComSerie: 3 });
    expect(resumo).toContain('1 mudança');
    expect(resumo).toContain('nenhuma urgente');
  });

  it('distingue "nada mudou" de "nada foi observado ainda"', () => {
    // As duas frases levam a ações opostas: uma é ficar tranquilo, a outra é importar
    // a mesma planilha de novo amanhã.
    expect(resumoDoMonitor({ grupos: [], ofertasComSerie: 0 })).toContain('Nada observado ainda');
    expect(resumoDoMonitor({ grupos: [], ofertasComSerie: 7 })).toContain('acima do piso');
  });
});

describe('descreverAviso', () => {
  it('devolve null para código desconhecido, e não inventa aviso', () => {
    expect(descreverAviso(undefined)).toBeNull();
    expect(descreverAviso('inventado')).toBeNull();
  });

  it('conjuga o plural da quantidade', () => {
    expect(descreverAviso('lido', 1)?.titulo).toContain('1 mudança marcada');
    expect(descreverAviso('lido', 3)?.titulo).toContain('3 mudanças marcadas');
  });

  it('quantidade inválida na URL não vira texto estranho', () => {
    expect(descreverAviso('lido', -2)?.titulo).toContain('0 mudanças');
    expect(inteiroDaUrl('abc')).toBeNull();
    expect(inteiroDaUrl('-1')).toBeNull();
    expect(inteiroDaUrl('4')).toBe(4);
  });

  it('marcar nada não é erro, e o texto diz por quê', () => {
    expect(descreverAviso('nada_para_ler')?.tom).toBe('atencao');
    expect(descreverAviso('falha')?.tom).toBe('erro');
  });
});
