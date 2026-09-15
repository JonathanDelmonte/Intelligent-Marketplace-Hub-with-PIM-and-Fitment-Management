import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { ESTADO_INICIAL, type Achado, type EstadoDaBusca, type Hipotese } from './fronteira';
import {
  OrcamentoDaBusca,
  OrcamentoDoDossieInvalido,
  achadosSemOrigem,
  paraGravar,
  resumirDossie,
} from './dossie';

const achado = (id: string, campos: Partial<Achado> = {}): Achado => ({
  id,
  familia: 'onde_e_mais_barato',
  oQue: 'distribuidor a R$ 18 a unidade',
  origemUrl: 'https://distribuidor.invalid/refil',
  achadoEm: '2026-09-15T00:00:00.000Z',
  ...campos,
});

const hipotese = (id: string, estado: Hipotese['estado']): Hipotese => ({
  id,
  familia: 'quem_distribui',
  enunciado: 'alguém distribui isso',
  estado,
});

const estado = (campos: Partial<EstadoDaBusca> = {}): EstadoDaBusca => ({
  ...ESTADO_INICIAL,
  ...campos,
});

const orcamento = () => new OrcamentoDaBusca(reaisParaCentavos(5), 20);

describe('OrcamentoDaBusca', () => {
  it('recusa teto ausente ou zero, no construtor', () => {
    // "Agente sem teto de orçamento por execução não roda", e isso é verificado no
    // construtor e não por convenção.
    expect(() => new OrcamentoDaBusca(reaisParaCentavos(0), 10)).toThrow(OrcamentoDoDossieInvalido);
    expect(() => new OrcamentoDaBusca(reaisParaCentavos(5), 0)).toThrow(OrcamentoDoDossieInvalido);
  });

  it('recusa teto fracionário, porque centavo é inteiro', () => {
    expect(() => new OrcamentoDaBusca(1.5 as never, 10)).toThrow(OrcamentoDoDossieInvalido);
  });

  it('conta o gasto e diz quanto resta', () => {
    const o = orcamento();
    expect(o.registrar(reaisParaCentavos(2))).toBe(true);
    expect(o.gasto).toBe(reaisParaCentavos(2));
    expect(o.restante).toBe(reaisParaCentavos(3));
    expect(o.estourou).toBe(false);
  });

  it('alcançar o teto exatamente já é estouro', () => {
    // Deixar passar o gasto que fecha o teto seria deixar o próximo passo rodar de
    // graça, e é onde um laço com defeito escapa.
    const o = orcamento();
    expect(o.registrar(reaisParaCentavos(5))).toBe(false);
    expect(o.estourou).toBe(true);
    expect(o.restante).toBe(0);
  });

  it('passar do teto não deixa o restante negativo', () => {
    const o = orcamento();
    o.registrar(reaisParaCentavos(9));
    expect(o.restante).toBe(0);
  });
});

describe('paraGravar', () => {
  it('monta dossiê salvável em qualquer ponto, com motivo nulo em andamento', () => {
    // Dossiê parcial é comportamento normal: perder o trabalho feito seria pagar duas
    // vezes pela mesma investigação.
    const d = paraGravar({
      alvo: 'refil purificador Electrolux',
      estado: estado({ achados: [achado('a1')], passosGastos: 3 }),
      orcamento: orcamento(),
    });

    expect(d.alvo).toBe('refil purificador Electrolux');
    expect(d.achados).toHaveLength(1);
    expect(d.passosGastos).toBe(3);
    expect(d.motivoParada).toBeNull();
  });

  it('guarda os dois tetos e o gasto, para o dossiê explicar a própria parada', () => {
    const o = orcamento();
    o.registrar(reaisParaCentavos(2));
    const d = paraGravar({ alvo: 'x', estado: estado(), orcamento: o });

    expect(d.orcamentoCentavos).toBe(reaisParaCentavos(5));
    expect(d.gastoCentavos).toBe(reaisParaCentavos(2));
    expect(d.orcamentoPassos).toBe(20);
  });

  it('a fronteira gravada é só o que ficou para investigar', () => {
    // Quem lê o dossiê quer saber o que sobrou, não o histórico da fila.
    const d = paraGravar({
      alvo: 'x',
      estado: estado({
        fronteira: [
          {
            id: 'feito',
            familia: 'quem_fabrica',
            alvo: 'buscar fabricante',
            valorEsperado: 80,
            custoEmPassos: 1,
            ferramenta: 'busca_web',
          },
          {
            id: 'pendente',
            familia: 'quem_distribui',
            alvo: 'buscar distribuidor',
            valorEsperado: 90,
            custoEmPassos: 1,
            ferramenta: 'busca_web',
          },
        ],
        investigados: ['feito'],
      }),
      orcamento: orcamento(),
    });

    expect(d.fronteira).toEqual([{ alvo: 'buscar distribuidor', familia: 'quem_distribui' }]);
  });
});

describe('achadosSemOrigem', () => {
  it('acha o achado sem fonte, que é o que torna a auditoria verificável', () => {
    // A especificação promete que cada item tem a URL de onde veio. Esta função é como
    // se prova a promessa, em vez de repeti-la.
    const d = paraGravar({
      alvo: 'x',
      estado: estado({ achados: [achado('a1'), achado('a2', { origemUrl: '  ' })] }),
      orcamento: orcamento(),
    });
    expect(achadosSemOrigem(d).map((a) => a.id)).toEqual(['a2']);
  });
});

describe('resumirDossie', () => {
  it('lidera pelo que foi confirmado, não pelo esforço', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({ achados: [achado('a1'), achado('a2')], passosGastos: 7 }),
        orcamento: orcamento(),
      }),
    );
    expect(r.achados).toBe(2);
    expect(r.mensagem.startsWith('2 achado(s)')).toBe(true);
  });

  it('zero achado é informação, e a mensagem diz o que isso significa', () => {
    // "Nenhum achado" pode ser alvo estreito ou ferramenta ausente, e as duas leituras
    // mudam o que fazer em seguida.
    const r = resumirDossie(
      paraGravar({ alvo: 'x', estado: estado({ passosGastos: 5 }), orcamento: orcamento() }),
    );
    expect(r.mensagem).toContain('Isso é informação');
    expect(r.mensagem).toContain('ferramentas');
  });

  it('conta achado por família, que é como se vê o que rendeu', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({
          achados: [achado('a1'), achado('a2'), achado('a3', { familia: 'quem_distribui' })],
        }),
        orcamento: orcamento(),
      }),
    );
    expect(r.porFamilia.onde_e_mais_barato).toBe(2);
    expect(r.porFamilia.quem_distribui).toBe(1);
    expect(r.porFamilia.demanda_publica).toBeUndefined();
  });

  it('conta hipótese aberta e confirmada separadas', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({
          hipoteses: [
            hipotese('h1', 'aberta'),
            hipotese('h2', 'confirmada'),
            hipotese('h3', 'descartada'),
          ],
        }),
        orcamento: orcamento(),
      }),
    );
    expect(r.hipotesesAbertas).toBe(1);
    expect(r.hipotesesConfirmadas).toBe(1);
    expect(r.mensagem).toContain('1 hipótese(s) em aberto');
  });

  it('parada por teto diz que continuar não recomeça', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({ achados: [achado('a1')], passosGastos: 20 }),
        orcamento: orcamento(),
        motivoParada: 'orcamento_passos',
      }),
    );
    expect(r.mensagem).toContain('não recomeça');
  });

  it('parada por saturação diz que aumentar o teto não ajuda', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({ achados: [achado('a1')] }),
        orcamento: orcamento(),
        motivoParada: 'saturacao',
      }),
    );
    expect(r.mensagem).toContain('não traria mais nada');
  });

  it('achado sem origem derruba a auditabilidade, e é dito', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({ achados: [achado('a1', { origemUrl: '' })] }),
        orcamento: orcamento(),
      }),
    );
    expect(r.auditavel).toBe(false);
    expect(r.mensagem).toContain('não é auditável');
  });

  it('dossiê inteiro com origem é auditável', () => {
    const r = resumirDossie(
      paraGravar({
        alvo: 'x',
        estado: estado({ achados: [achado('a1'), achado('a2')] }),
        orcamento: orcamento(),
      }),
    );
    expect(r.auditavel).toBe(true);
    expect(r.mensagem).not.toContain('Atenção');
  });
});
