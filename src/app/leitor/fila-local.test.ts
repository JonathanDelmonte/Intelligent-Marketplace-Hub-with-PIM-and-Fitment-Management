/**
 * Testes da fila local de leituras.
 *
 * O que nunca pode acontecer é **perder leitura**: a pessoa escaneou quarenta
 * itens no balcão de um parceiro, e essa é a informação que transforma a conversa
 * de consignação em proposta no mesmo dia. Todo caso aqui é sobre isso.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ArmazenamentoEmMemoria,
  FilaDeLeituras,
  MAX_TENTATIVAS,
  TAMANHO_DA_DESCARGA,
  escolherArmazenamento,
  type EnviarLeituras,
  type LeituraLocal,
  type RespostaDaSincronizacao,
} from './fila-local';

const OK: RespostaDaSincronizacao = { gravadas: 0, atualizadas: 0, recusadas: [] };

function leitura(id: string, minutosAtras = 0): Omit<LeituraLocal, 'tentativas'> {
  return {
    idLocal: id,
    gtin: '7896541200121',
    custoUnitario: 1200,
    unidadesNoLote: null,
    veredito: 'compra',
    precoDeReferencia: 6990,
    margemBp: 5800,
    confiancaBp: 10_000,
    motivos: null,
    decisao: null,
    local: null,
    lidoEm: new Date(Date.parse('2026-09-12T12:00:00Z') - minutosAtras * 60_000).toISOString(),
  };
}

function montar(enviar: EnviarLeituras) {
  const armazenamento = new ArmazenamentoEmMemoria();
  return { armazenamento, fila: new FilaDeLeituras(armazenamento, enviar) };
}

describe('enfileirar', () => {
  it('grava sem tocar em rede', async () => {
    const enviar = vi.fn<EnviarLeituras>(() => Promise.resolve(OK));
    const { fila } = montar(enviar);

    await fila.enfileirar(leitura('l1'));

    expect(enviar).not.toHaveBeenCalled();
    expect(await fila.quantidadePendente()).toBe(1);
  });

  it('devolve as pendentes em ordem de quando aconteceram', async () => {
    const { fila } = montar(() => Promise.resolve(OK));

    await fila.enfileirar(leitura('recente', 1));
    await fila.enfileirar(leitura('antiga', 30));
    await fila.enfileirar(leitura('meio', 10));

    expect((await fila.pendentes()).map((l) => l.idLocal)).toEqual(['antiga', 'meio', 'recente']);
  });

  it('o mesmo idLocal sobrescreve em vez de duplicar', async () => {
    const { fila } = montar(() => Promise.resolve(OK));

    await fila.enfileirar(leitura('l1'));
    await fila.enfileirar({ ...leitura('l1'), decisao: 'comprou' });

    const pendentes = await fila.pendentes();
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.decisao).toBe('comprou');
  });
});

describe('descarga', () => {
  it('remove só o que o servidor confirmou', async () => {
    const { fila } = montar(() => Promise.resolve(OK));

    await fila.enfileirar(leitura('l1'));
    await fila.enfileirar(leitura('l2'));
    const r = await fila.descarregar();

    expect(r).toEqual({ enviadas: 2, confirmadas: 2, recusadas: 0, falhou: false });
    expect(await fila.quantidadePendente()).toBe(0);
  });

  it('falha de rede NÃO apaga nada — o dispositivo não sabe se chegou', async () => {
    const { fila } = montar(() => Promise.reject(new Error('Failed to fetch')));

    await fila.enfileirar(leitura('l1'));
    await fila.enfileirar(leitura('l2'));
    const r = await fila.descarregar();

    expect(r.falhou).toBe(true);
    expect(r.motivo).toBe('Failed to fetch');
    expect(r.confirmadas).toBe(0);
    // A regra que importa: nada foi perdido.
    expect(await fila.quantidadePendente()).toBe(2);
  });

  it('duplicar é aceitável, perder não é: reenvia depois de falha', async () => {
    let falhar = true;
    const enviadas: string[][] = [];
    const { fila } = montar((lote) => {
      enviadas.push(lote.map((l) => l.idLocal));
      if (falhar) return Promise.reject(new Error('sem rede'));
      return Promise.resolve(OK);
    });

    await fila.enfileirar(leitura('l1'));
    await fila.descarregar();
    falhar = false;
    await fila.descarregar();

    expect(enviadas).toEqual([['l1'], ['l1']]);
    expect(await fila.quantidadePendente()).toBe(0);
  });

  it('o que o servidor recusou fica na fila, com a tentativa contada', async () => {
    const { fila } = montar((lote) =>
      Promise.resolve({
        gravadas: lote.length - 1,
        atualizadas: 0,
        recusadas: [{ idLocal: 'ruim', motivo: 'veredito inválido' }],
      }),
    );

    await fila.enfileirar(leitura('boa'));
    await fila.enfileirar(leitura('ruim'));
    const r = await fila.descarregar();

    expect(r.confirmadas).toBe(1);
    expect(r.recusadas).toBe(1);

    const pendentes = await fila.pendentes();
    expect(pendentes.map((l) => l.idLocal)).toEqual(['ruim']);
    expect(pendentes[0]?.tentativas).toBe(1);
  });

  it('fila vazia não chama rede', async () => {
    const enviar = vi.fn<EnviarLeituras>(() => Promise.resolve(OK));
    const { fila } = montar(enviar);

    const r = await fila.descarregar();

    expect(enviar).not.toHaveBeenCalled();
    expect(r).toEqual({ enviadas: 0, confirmadas: 0, recusadas: 0, falhou: false });
  });

  it('manda em lotes: fila grande vai em mais de uma ida', async () => {
    const lotes: number[] = [];
    const { fila } = montar((lote) => {
      lotes.push(lote.length);
      return Promise.resolve(OK);
    });

    for (let i = 0; i < TAMANHO_DA_DESCARGA + 7; i += 1) {
      await fila.enfileirar(leitura(`l${String(i)}`, i));
    }

    await fila.descarregar();
    expect(lotes).toEqual([TAMANHO_DA_DESCARGA]);
    expect(await fila.quantidadePendente()).toBe(7);

    await fila.descarregar();
    expect(lotes).toEqual([TAMANHO_DA_DESCARGA, 7]);
    expect(await fila.quantidadePendente()).toBe(0);
  });
});

describe('desistência e retomada', () => {
  it('para de insistir depois do teto, mas não descarta', async () => {
    const { fila } = montar(() => Promise.reject(new Error('sem rede')));

    await fila.enfileirar(leitura('l1'));
    for (let i = 0; i < MAX_TENTATIVAS; i += 1) await fila.descarregar();

    const r = await fila.descarregar();
    expect(r.enviadas).toBe(0);

    // Continua guardada: insistir para sempre gasta bateria, apagar perde dado.
    expect(await fila.quantidadePendente()).toBe(1);
    expect(await fila.travadas()).toHaveLength(1);
  });

  it('destravar zera as tentativas para uma nova tentativa pedida à mão', async () => {
    let falhar = true;
    const { fila } = montar(() => (falhar ? Promise.reject(new Error('x')) : Promise.resolve(OK)));

    await fila.enfileirar(leitura('l1'));
    for (let i = 0; i < MAX_TENTATIVAS; i += 1) await fila.descarregar();
    expect(await fila.travadas()).toHaveLength(1);

    falhar = false;
    expect(await fila.destravar()).toBe(1);
    await fila.descarregar();

    expect(await fila.quantidadePendente()).toBe(0);
  });
});

describe('escolha do armazenamento', () => {
  it('cai para memória quando não há IndexedDB, e avisa que não persiste', () => {
    const escolhido = escolherArmazenamento();
    // Em Node não há IndexedDB, então o caminho de recurso é o exercitado.
    expect(escolhido.persistente).toBe(false);
    expect(escolhido.armazenamento).toBeInstanceOf(ArmazenamentoEmMemoria);
  });
});
