import { describe, expect, it } from 'vitest';
import { reaisParaCentavos } from '@/lib/dinheiro';
import {
  PncpIndisponivel,
  SensorDePncpAusente,
  descricaoCasa,
  esquemaItemDoPncp,
  medianaDeCentavos,
  medirDemandaPublica,
  referenciaDePreco,
  type ItemDoPncp,
  type SensorDePncp,
} from './pncp';

const item = (campos: Partial<ItemDoPncp> = {}): ItemDoPncp =>
  esquemaItemDoPncp.parse({
    descricao: 'AQUISIÇÃO DE REFIL PARA PURIFICADOR DE ÁGUA, TIPO VELA, CONFORME ANEXO',
    quantidade: 50,
    valorUnitario: 42.5,
    orgao: 'Prefeitura de Exemplo',
    data: '2026-08-10',
    urlOrigem: 'https://pncp.gov.br/app/contratacoes/1',
    ...campos,
  });

/** Sensor que responde o que o teste quiser. */
const sensorFixo = (itens: readonly ItemDoPncp[]): SensorDePncp => ({
  nome: 'fixo',
  estadoDaConsulta: () => ({ tipo: 'disponivel', modo: 'm2_publico', rotulo: 'consulta pública' }),
  consultar: () => Promise.resolve(itens),
});

describe('descricaoCasa', () => {
  it('casa por palavra, porque a descrição do órgão é longa e burocrática', () => {
    // Procurar a frase inteira não casaria com "AQUISIÇÃO DE REFIL PARA PURIFICADOR
    // DE ÁGUA, TIPO VELA, CONFORME ESPECIFICAÇÃO EM ANEXO".
    expect(descricaoCasa(item().descricao, 'refil de purificador de água')).toBe(true);
  });

  it('exige todas as palavras, não alguma', () => {
    // "refil purificador" não pode casar com a compra de um purificador inteiro, que
    // é outro produto e outro preço.
    expect(descricaoCasa('AQUISIÇÃO DE PURIFICADOR DE ÁGUA DE BANCADA', 'refil purificador')).toBe(
      false,
    );
  });

  it('é indiferente a acento e caixa', () => {
    expect(descricaoCasa('COMPRA DE REFIL DE AGUA', 'refil de água')).toBe(true);
  });

  it('ignora palavra curta do termo, que não discrimina nada', () => {
    // "de" casaria com qualquer descrição; incluí-la só encurtaria o resultado sem
    // ganho nenhum.
    expect(descricaoCasa('REFIL PARA PURIFICADOR', 'refil de purificador')).toBe(true);
  });

  it('termo só de palavras curtas não casa com tudo', () => {
    expect(descricaoCasa('QUALQUER COISA', 'de a o')).toBe(false);
  });
});

describe('medianaDeCentavos', () => {
  it('não se move por causa de um valor absurdo', () => {
    // Um item cadastrado com preço errado por dois zeros arrasta a média e não a
    // mediana. É a razão de a referência ser mediana.
    const valores = [10, 12, 11, 13, 100_000].map((v) => reaisParaCentavos(v));
    expect(medianaDeCentavos(valores)).toBe(reaisParaCentavos(12));
  });

  it('com quantidade par devolve o menor dos centrais, sem inventar meio centavo', () => {
    const valores = [reaisParaCentavos(10), reaisParaCentavos(11)];
    expect(medianaDeCentavos(valores)).toBe(reaisParaCentavos(10));
  });

  it('lista vazia devolve zero em vez de quebrar', () => {
    expect(medianaDeCentavos([])).toBe(0);
  });
});

describe('referenciaDePreco', () => {
  it('resume as compras que casam, com órgãos distintos contados', () => {
    // Um órgão só não é demanda, é um contrato.
    const r = referenciaDePreco(
      [
        item({ valorUnitario: 40, orgao: 'Prefeitura A' }),
        item({ valorUnitario: 44, orgao: 'Prefeitura B' }),
        item({ valorUnitario: 42, orgao: 'Prefeitura A' }),
      ],
      'refil purificador',
    );

    expect(r?.itens).toBe(3);
    expect(r?.orgaos).toBe(2);
    expect(r?.unidades).toBe(150);
    expect(r?.medianaUnitario).toBe(reaisParaCentavos(42));
    expect(r?.menorUnitario).toBe(reaisParaCentavos(40));
    expect(r?.maiorUnitario).toBe(reaisParaCentavos(44));
  });

  it('descarta a compra que não é do item procurado', () => {
    const r = referenciaDePreco(
      [
        item({ valorUnitario: 40 }),
        item({ descricao: 'AQUISIÇÃO DE TONER PARA IMPRESSORA', valorUnitario: 300 }),
      ],
      'refil purificador',
    );
    expect(r?.itens).toBe(1);
    expect(r?.maiorUnitario).toBe(reaisParaCentavos(40));
  });

  it('nenhum item que case devolve nulo, não preço zero', () => {
    // Zero faria o prospector recomendar vender a qualquer preço.
    expect(referenciaDePreco([item()], 'correia de secadora')).toBeNull();
    expect(referenciaDePreco([], 'refil purificador')).toBeNull();
  });
});

describe('medirDemandaPublica', () => {
  it('sem sensor configurado é indisponível, e não "sem demanda"', async () => {
    // Colapsar os dois faria o prospector concluir que não existe demanda pública
    // quando ele apenas não conseguiu olhar.
    const r = await medirDemandaPublica(new SensorDePncpAusente(), {
      termo: 'refil purificador',
      diasParaTras: 30,
    });
    expect(r.tipo).toBe('indisponivel');
    if (r.tipo === 'indisponivel') expect(r.motivo).toContain('nenhum sensor');
  });

  it('o sensor ausente recusa a consulta com erro nomeado', async () => {
    await expect(
      new SensorDePncpAusente().consultar({ termo: 'x', diasParaTras: 30 }),
    ).rejects.toThrow(PncpIndisponivel);
  });

  it('achou devolve a referência e só os itens que casam', async () => {
    const r = await medirDemandaPublica(
      sensorFixo([item({ valorUnitario: 40 }), item({ descricao: 'TONER', valorUnitario: 300 })]),
      { termo: 'refil purificador', diasParaTras: 30 },
    );

    expect(r.tipo).toBe('achou');
    if (r.tipo !== 'achou') return;
    expect(r.itens).toHaveLength(1);
    expect(r.referencia.medianaUnitario).toBe(reaisParaCentavos(40));
    // A URL de origem vem junto: é o que torna o achado auditável no dossiê.
    expect(r.itens[0]?.urlOrigem).toContain('pncp.gov.br');
  });

  it('respondeu e não há compra do item é "sem demanda"', async () => {
    const r = await medirDemandaPublica(sensorFixo([item({ descricao: 'TONER' })]), {
      termo: 'refil purificador',
      diasParaTras: 30,
    });
    expect(r.tipo).toBe('sem_demanda');
  });

  it('falha de rede é indisponibilidade, não ausência de demanda', async () => {
    const quebrado: SensorDePncp = {
      nome: 'quebrado',
      estadoDaConsulta: () => ({
        tipo: 'disponivel',
        modo: 'm2_publico',
        rotulo: 'consulta pública',
      }),
      consultar: () => Promise.reject(new Error('conexão recusada')),
    };
    const r = await medirDemandaPublica(quebrado, { termo: 'refil', diasParaTras: 30 });
    expect(r.tipo).toBe('indisponivel');
    if (r.tipo === 'indisponivel') expect(r.motivo).toContain('conexão recusada');
  });
});

describe('esquemaItemDoPncp', () => {
  it('recusa linha sem URL de origem', () => {
    // Sem origem o achado não é auditável, e o dossiê promete que cada item tem uma.
    expect(() => esquemaItemDoPncp.parse({ ...item(), urlOrigem: 'não é url' })).toThrow();
  });

  it('recusa quantidade zero e data fora de formato', () => {
    expect(() => esquemaItemDoPncp.parse({ ...item(), quantidade: 0 })).toThrow();
    expect(() => esquemaItemDoPncp.parse({ ...item(), data: '10/08/2026' })).toThrow();
  });

  it('aceita valor unitário zero, que existe em item de registro de preço', () => {
    expect(() => esquemaItemDoPncp.parse({ ...item(), valorUnitario: 0 })).not.toThrow();
  });
});
