/**
 * Testes do repositório de dossiê, contra Postgres de verdade.
 *
 * O que só o banco prova: que investigar o mesmo alvo duas vezes **continua** o
 * dossiê em vez de criar um segundo, que o resumo é recalculado na leitura, e que a
 * fila de "vale continuar" não oferece dossiê que saturou.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { OrcamentoDaBusca, paraGravar } from './dossie';
import { ESTADO_INICIAL, type Achado, type EstadoDaBusca, type Hipotese } from './fronteira';
import { RepositorioDeDossies, chaveDoAlvo } from './repositorio';

const achado = (id: string, campos: Partial<Achado> = {}): Achado => ({
  id,
  familia: 'onde_e_mais_barato',
  oQue: 'distribuidor a R$ 18 a unidade',
  origemUrl: 'https://distribuidor.invalid/refil',
  achadoEm: '2026-09-15T00:00:00.000Z',
  ...campos,
});

const aberta = (id: string): Hipotese => ({
  id,
  familia: 'quem_distribui',
  enunciado: 'alguém distribui isso',
  estado: 'aberta',
});

const estado = (campos: Partial<EstadoDaBusca> = {}): EstadoDaBusca => ({
  ...ESTADO_INICIAL,
  ...campos,
});

describe('chaveDoAlvo', () => {
  it('trata variação de caixa, acento e espaço como o mesmo alvo', () => {
    // Dois dossiês parciais do mesmo assunto é o jeito mais silencioso de perder
    // investigação paga.
    expect(chaveDoAlvo('Refil Purificador  PA21G ')).toBe(chaveDoAlvo('refil purificador pa21g'));
    expect(chaveDoAlvo('purificador de água')).toBe(chaveDoAlvo('PURIFICADOR DE AGUA'));
  });
});

describe.skipIf(!temBancoDeTeste())('RepositorioDeDossies', () => {
  let conexao: ConexaoDeTeste;
  let repo: RepositorioDeDossies;

  const orcamento = () => new OrcamentoDaBusca(reaisParaCentavos(5), 20);

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    await limparTabelas(conexao.db, ['dossie']);
    repo = new RepositorioDeDossies(conexao.db);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('grava e relê as três listas vivas', async () => {
    const gravado = await repo.salvar(
      paraGravar({
        alvo: 'refil purificador Electrolux',
        estado: estado({ achados: [achado('a1')], hipoteses: [aberta('h1')], passosGastos: 2 }),
        orcamento: orcamento(),
      }),
    );

    expect(gravado.achados).toHaveLength(1);
    expect(gravado.hipoteses).toHaveLength(1);
    expect(gravado.passosGastos).toBe(2);
    expect(gravado.resumo.achados).toBe(1);
  });

  it('o mesmo alvo continua o dossiê, não cria um segundo', async () => {
    // Dois dossiês do mesmo alvo: nenhum errado, nenhum completo.
    await repo.salvar(
      paraGravar({
        alvo: 'Refil Purificador PA21G',
        estado: estado({ achados: [achado('a1')], passosGastos: 1 }),
        orcamento: orcamento(),
      }),
    );
    await repo.salvar(
      paraGravar({
        alvo: 'refil purificador pa21g',
        estado: estado({ achados: [achado('a1'), achado('a2')], passosGastos: 4 }),
        orcamento: orcamento(),
      }),
    );

    const todos = await repo.ultimos();
    expect(todos).toHaveLength(1);
    expect(todos[0]?.achados).toHaveLength(2);
    expect(todos[0]?.passosGastos).toBe(4);
  });

  it('acha por alvo, com a mesma normalização', async () => {
    await repo.salvar(
      paraGravar({ alvo: 'purificador de água', estado: estado(), orcamento: orcamento() }),
    );
    expect(await repo.porAlvo('PURIFICADOR DE AGUA')).not.toBeNull();
    expect(await repo.porAlvo('outra coisa')).toBeNull();
  });

  it('salvar a cada passo é o que faz o teto não perder trabalho', async () => {
    // O executor chama isto a cada passo; o que está no banco é sempre o que foi
    // descoberto até agora.
    let atual = estado();
    for (let i = 1; i <= 3; i += 1) {
      atual = { ...atual, achados: [...atual.achados, achado(`a${String(i)}`)], passosGastos: i };
      await repo.salvar(paraGravar({ alvo: 'alvo', estado: atual, orcamento: orcamento() }));
    }

    const parcial = await repo.porAlvo('alvo');
    expect(parcial?.achados).toHaveLength(3);
    expect(parcial?.motivoParada).toBeNull();

    // E o passo final grava o motivo, sem perder nada.
    await repo.salvar(
      paraGravar({
        alvo: 'alvo',
        estado: atual,
        orcamento: orcamento(),
        motivoParada: 'orcamento_passos',
        recomendacao: 'vale comprar do distribuidor achado',
      }),
    );

    const final = await repo.porAlvo('alvo');
    expect(final?.achados).toHaveLength(3);
    expect(final?.motivoParada).toBe('orcamento_passos');
    expect(final?.recomendacao).toContain('distribuidor');
  });

  it('o resumo é recalculado na leitura, não gravado', async () => {
    const gravado = await repo.salvar(
      paraGravar({
        alvo: 'alvo',
        estado: estado({ achados: [achado('a1', { origemUrl: '' })] }),
        orcamento: orcamento(),
      }),
    );

    // Achado sem origem derruba a auditabilidade, e isso aparece na leitura.
    expect(gravado.resumo.auditavel).toBe(false);
    expect((await repo.porId(gravado.id))?.resumo.auditavel).toBe(false);
  });

  it('a fila de continuar traz quem parou no teto com hipótese aberta', async () => {
    await repo.salvar(
      paraGravar({
        alvo: 'parou no teto',
        estado: estado({ hipoteses: [aberta('h1')], achados: [achado('a1')] }),
        orcamento: orcamento(),
        motivoParada: 'orcamento_passos',
      }),
    );

    const fila = await repo.valeContinuar();
    expect(fila.map((d) => d.alvo)).toEqual(['parou no teto']);
  });

  it('quem saturou não entra na fila de continuar', async () => {
    // Aumentar o teto ali não traria nada, e oferecer isso seria vender passo inútil.
    await repo.salvar(
      paraGravar({
        alvo: 'saturou',
        estado: estado({ hipoteses: [aberta('h1')], achados: [achado('a1')] }),
        orcamento: orcamento(),
        motivoParada: 'saturacao',
      }),
    );
    expect(await repo.valeContinuar()).toHaveLength(0);
  });

  it('quem parou no teto sem hipótese aberta também não entra', async () => {
    await repo.salvar(
      paraGravar({
        alvo: 'sem o que perseguir',
        estado: estado({ achados: [achado('a1')] }),
        orcamento: orcamento(),
        motivoParada: 'orcamento_passos',
      }),
    );
    expect(await repo.valeContinuar()).toHaveLength(0);
  });

  it('os últimos vêm com os mais recentes primeiro', async () => {
    await repo.salvar(paraGravar({ alvo: 'antigo', estado: estado(), orcamento: orcamento() }));
    await repo.salvar(paraGravar({ alvo: 'novo', estado: estado(), orcamento: orcamento() }));

    const todos = await repo.ultimos();
    expect(todos[0]?.alvo).toBe('novo');
  });

  it('dossiê inexistente devolve nulo, e não lança', async () => {
    expect(await repo.porId('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
