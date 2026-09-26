import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Orquestrador } from '@/dominio/ingestao/orquestrador';
import { enfileirarImportacaoDePedidos } from '@/dominio/pedidos/tarefa';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '../banco/teste';
import { Fila, type UsoNaFila } from '../fila/fila';
import { registradorSilencioso, type Campos, type Registrador } from '../log';
import { ArmazenamentoDeConteudo, type ConteudoGuardado } from './conteudo';
import {
  CAMPO_DO_CONTEUDO_NA_ENTRADA,
  INTERVALO_APOS_FALHA_MS,
  INTERVALO_DA_LIMPEZA_MS,
  LimpezaDoConteudo,
  RETENCAO_NA_NUVEM_DIAS,
  escolherOQueApagar,
  tarefaDeLimpeza,
  type ResultadoDaLimpeza,
} from './limpeza';

const DIA = 24 * 60 * 60_000;
const AGORA = new Date('2026-09-26T12:00:00Z');
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * DIA);

function guardado(hash: string, gravadoHaDias: number): ConteudoGuardado {
  return { hash, bytes: 100, gravadoEm: diasAtras(gravadoHaDias) };
}

function uso(ativo: boolean, movimentoHaDias: number): UsoNaFila {
  return { ativo, ultimoMovimento: diasAtras(movimentoHaDias) };
}

describe('escolherOQueApagar', () => {
  const escolher = (
    guardados: readonly ConteudoGuardado[],
    usos: readonly (readonly [string, UsoNaFila])[] = [],
  ) =>
    escolherOQueApagar({ guardados, uso: new Map(usos), agora: AGORA, retencaoDias: 7 }).map(
      (g) => g.hash,
    );

  it('sai o arquivo de job parado há mais que o prazo, gravado há mais que o prazo', () => {
    expect(escolher([guardado('a', 10)], [['a', uso(false, 8)]])).toEqual(['a']);
  });

  it('fica o de job que ainda vai rodar, por mais velho que seja', () => {
    expect(escolher([guardado('a', 30)], [['a', uso(true, 30)]])).toEqual([]);
  });

  it('fica o de job que se mexeu dentro do prazo', () => {
    expect(escolher([guardado('a', 30)], [['a', uso(false, 2)]])).toEqual([]);
  });

  it('fica o gravado dentro do prazo, mesmo com o job parado há muito', () => {
    // É o arquivo que saiu e foi enviado de novo: a gravação nova renova o prazo.
    expect(escolher([guardado('a', 1)], [['a', uso(false, 30)]])).toEqual([]);
  });

  it('o que nenhum job cita sai pelo mesmo prazo da gravação', () => {
    expect(escolher([guardado('velho', 8), guardado('novo', 6)])).toEqual(['velho']);
  });

  it('o prazo vale no limite: sete dias exatos já saem', () => {
    expect(escolher([guardado('a', 7)], [['a', uso(false, 7)]])).toEqual(['a']);
  });
});

describe('tarefaDeLimpeza', () => {
  function registrador() {
    const avisos: { evento: string; campos?: Campos }[] = [];
    const log: Registrador = {
      ...registradorSilencioso,
      aviso: (evento, campos) => {
        avisos.push({ evento, ...(campos === undefined ? {} : { campos }) });
      },
      com: () => log,
    };
    return { log, avisos };
  }

  const vazio: ResultadoDaLimpeza = { temPrazo: true, guardados: 3, apagados: 0, bytesApagados: 0 };

  it('roda na primeira vez, e depois só a cada intervalo', async () => {
    let agora = AGORA.getTime();
    let chamadas = 0;
    const tarefa = tarefaDeLimpeza(
      {
        limpar: () => {
          chamadas += 1;
          return Promise.resolve(vazio);
        },
      },
      registradorSilencioso,
      { agora: () => new Date(agora) },
    );

    expect(await tarefa.executar()).toEqual({ ocioso: true });
    expect(await tarefa.executar()).toEqual({ ocioso: true });
    expect(chamadas).toBe(1);

    agora += INTERVALO_DA_LIMPEZA_MS;
    await tarefa.executar();
    expect(chamadas).toBe(2);
  });

  it('o tique que apagou não é ocioso, e diz quanto', async () => {
    const tarefa = tarefaDeLimpeza({
      limpar: () =>
        Promise.resolve({ temPrazo: true, guardados: 5, apagados: 2, bytesApagados: 300 }),
    });

    expect(await tarefa.executar()).toEqual({
      ocioso: false,
      campos: { guardados: 5, apagados: 2, bytesApagados: 300 },
    });
  });

  it('nuvem fora vira aviso, não para a fila, e tenta de novo antes do intervalo', async () => {
    let agora = AGORA.getTime();
    let chamadas = 0;
    const { log, avisos } = registrador();
    const tarefa = tarefaDeLimpeza(
      {
        limpar: () => {
          chamadas += 1;
          return Promise.reject(new Error('S3 fora'));
        },
      },
      log,
      { agora: () => new Date(agora) },
    );

    expect(await tarefa.executar()).toEqual({ ocioso: true });
    expect(avisos.map((a) => a.evento)).toEqual(['conteudo.limpeza_falhou']);

    agora += INTERVALO_APOS_FALHA_MS - 1;
    await tarefa.executar();
    expect(chamadas).toBe(1);
    agora += 1;
    await tarefa.executar();
    expect(chamadas).toBe(2);
  });
});

describe.skipIf(!temBancoDeTeste())('LimpezaDoConteudo (Postgres e disco de verdade)', () => {
  let conexao: ConexaoDeTeste;
  let pasta: string;
  let fila: Fila;
  let armazenamento: ArmazenamentoDeConteudo;
  let orquestrador: Orquestrador;

  const texto = (s: string) => new TextEncoder().encode(s);

  async function envelhecerArquivo(hash: string, dias: number): Promise<void> {
    const quando = diasAtras(dias);
    await utimes(join(pasta, hash.slice(0, 2), hash.slice(2)), quando, quando);
  }

  async function moverJobs(hash: string, dias: number): Promise<void> {
    await conexao.db.execute(
      sql`update job set atualizado_em = ${diasAtras(dias).toISOString()}::timestamptz
          where entrada ->> ${CAMPO_DO_CONTEUDO_NA_ENTRADA} = ${hash}`,
    );
  }

  async function enviar(nome: string, conteudo: string): Promise<string> {
    const recebido = await orquestrador.receber({
      entrada: { tipo: 'arquivo', nome },
      conteudo: texto(conteudo),
    });
    return (recebido.job.entrada as { hashConteudo: string }).hashConteudo;
  }

  const limpeza = (opcoes: { apagadosPorVez?: number } = {}) =>
    new LimpezaDoConteudo(armazenamento, fila, { agora: () => AGORA, ...opcoes });

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    pasta = await mkdtemp(join(tmpdir(), 'bancada-limpeza-'));
    fila = new Fila(conexao.db);
    armazenamento = new ArmazenamentoDeConteudo(pasta, { retencaoDias: RETENCAO_NA_NUVEM_DIAS });
    orquestrador = new Orquestrador(fila, armazenamento);
    await limparTabelas(conexao.db, ['job']);
  });

  afterEach(async () => {
    await rm(pasta, { recursive: true, force: true });
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('apaga o parado há mais que o prazo e o que ninguém cita; o resto fica', async () => {
    const concluidoVelho = await enviar('anuncios_mercadolivre_1.csv', 'a;b\n1;2');
    const concluidoNovo = await enviar('anuncios_mercadolivre_2.csv', 'a;b\n3;4');
    const pendenteVelho = await enviar('anuncios_mercadolivre_3.csv', 'a;b\n5;6');
    const orfaoVelho = await armazenamento.guardar(texto('sem job'));
    const orfaoNovo = await armazenamento.guardar(texto('sem job, recente'));

    for (const [hash, dias] of [
      [concluidoVelho, 8],
      [concluidoNovo, 2],
    ] as const) {
      await conexao.db.execute(
        sql`update job set status = 'concluido' where entrada ->> 'hashConteudo' = ${hash}`,
      );
      await moverJobs(hash, dias);
    }
    await moverJobs(pendenteVelho, 30);
    for (const hash of [concluidoVelho, concluidoNovo, pendenteVelho, orfaoVelho]) {
      await envelhecerArquivo(hash, 30);
    }
    await envelhecerArquivo(orfaoNovo, 1);

    const resultado = await limpeza().limpar();

    expect(resultado).toMatchObject({ temPrazo: true, guardados: 5, apagados: 2 });
    expect(await armazenamento.existe(concluidoVelho)).toBe(false);
    expect(await armazenamento.existe(orfaoVelho)).toBe(false);
    for (const fica of [concluidoNovo, pendenteVelho, orfaoNovo]) {
      expect(await armazenamento.existe(fica)).toBe(true);
    }
  });

  it('a importação de pedidos cita o arquivo pelo mesmo campo, e o protege', async () => {
    // A convenção de que a limpeza depende, pelos dois caminhos de verdade: o
    // orquestrador (acima) e o encaminhamento para pedidos (aqui).
    const hash = await armazenamento.guardar(texto('pedidos'));
    await enfileirarImportacaoDePedidos(fila, {
      hashConteudo: hash,
      plataforma: 'ml',
      nomeArquivo: 'vendas.csv',
    });
    await moverJobs(hash, 30);
    await envelhecerArquivo(hash, 30);

    expect((await fila.usoPorCampoDaEntrada(CAMPO_DO_CONTEUDO_NA_ENTRADA)).get(hash)).toEqual({
      ativo: true,
      ultimoMovimento: diasAtras(30),
    });
    expect((await limpeza().limpar()).apagados).toBe(0);
    expect(await armazenamento.existe(hash)).toBe(true);
  });

  it('sem prazo — o computador de quem usa —, nada sai', async () => {
    const hash = await armazenamento.guardar(texto('para sempre'));
    await envelhecerArquivo(hash, 365);

    const semPrazo = new LimpezaDoConteudo(new ArmazenamentoDeConteudo(pasta), fila, {
      agora: () => AGORA,
    });

    expect(await semPrazo.limpar()).toEqual({
      temPrazo: false,
      guardados: 0,
      apagados: 0,
      bytesApagados: 0,
    });
    expect(await armazenamento.existe(hash)).toBe(true);
  });

  it('apaga no máximo o teto por vez; o resto fica para a próxima', async () => {
    for (const conteudo of ['um', 'dois', 'três']) {
      await envelhecerArquivo(await armazenamento.guardar(texto(conteudo)), 30);
    }

    expect((await limpeza({ apagadosPorVez: 2 }).limpar()).apagados).toBe(2);
    expect((await limpeza({ apagadosPorVez: 2 }).limpar()).apagados).toBe(1);
  });
});
