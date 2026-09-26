/**
 * A restauração como chega pela tela: o arquivo em fluxo, comprimido ou não, contra o
 * banco de teste — e o perfil da loja com outro nome, que é o caso normal entre o
 * computador e a nuvem.
 */
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { carregarPerfil } from '@/dominio/perfil';
import { gerarCopia, tabelasDaCopia, TABELAS_FORA_DA_COPIA } from '@/infra/banco/copia';
import {
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from '@/infra/banco/teste';
import { avisoDaRestauracao } from './apresentacao';
import { restaurarDoNavegador } from './restauracao';

const OPCOES = { nomeDoSistema: 'Sistema de teste', versao: 'teste', agora: new Date() } as const;

function fluxo(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  let enviado = false;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controle) {
      if (enviado) {
        controle.close();
        return;
      }
      enviado = true;
      controle.enqueue(new Uint8Array(bytes));
    },
  });
}

async function juntar(pedacos: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  for await (const pedaco of pedacos) partes.push(pedaco);
  return new Uint8Array(Buffer.concat(partes));
}

describe.skipIf(!temBancoDeTeste())('restauração pela tela (Postgres de verdade)', () => {
  let conexao: ConexaoDeTeste;
  let copiadas: readonly string[];

  const slugs = async () =>
    z
      .array(z.object({ slug: z.string() }))
      .parse([...(await conexao.db.execute(sql`select slug from perfil_vendedor order by slug`))])
      .map((l) => l.slug);

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    copiadas = (await tabelasDaCopia(conexao.db)).map((t) => t.nome);
    await limparTabelas(conexao.db, [...copiadas, ...TABELAS_FORA_DA_COPIA]);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('a cópia da nuvem volta no computador: comprimida, em fluxo, e com o perfil acertado', async () => {
    // Na nuvem, o perfil se chama `principal`; no computador, pelo nome da loja.
    await conexao.db.execute(sql`
      with perfil as (
        insert into perfil_vendedor (slug, nome, regime) values ('principal', 'Loja', 'mei')
        returning id
      )
      insert into sku (perfil_id, titulo_interno) select id, 'Refil PA21G' from perfil
    `);
    const copia = gzipSync(await juntar(gerarCopia(conexao.db, OPCOES)));
    await limparTabelas(conexao.db, copiadas);
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('loja-do-computador', 'Semente', 'cpf')`,
    );

    const resposta = await restaurarDoNavegador(conexao.db, fluxo(copia), 'loja-do-computador');

    expect(resposta).toMatchObject({ situacao: 'restaurada', linhas: 2, perfil: 'renomeado' });
    expect(await slugs()).toEqual(['loja-do-computador']);
    const perfil = await carregarPerfil(conexao.db, 'loja-do-computador');
    expect(perfil.nome).toBe('Loja');
    expect(avisoDaRestauracao(resposta).tipo).toBe('ok');
  });

  it('a cópia da mesma instalação volta sem mexer no perfil', async () => {
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('principal', 'Loja', 'cpf')`,
    );
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));

    const resposta = await restaurarDoNavegador(conexao.db, fluxo(copia), 'principal');

    expect(resposta).toMatchObject({ situacao: 'restaurada', perfil: 'existia' });
    expect(await slugs()).toEqual(['principal']);
  });

  it('arquivo que não é cópia é recusado com o motivo, e nada muda', async () => {
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('principal', 'Loja', 'cpf')`,
    );

    const resposta = await restaurarDoNavegador(
      conexao.db,
      fluxo(new TextEncoder().encode('id;nome\n1;planilha\n')),
      'principal',
    );

    expect(resposta).toEqual({
      situacao: 'recusada',
      motivo: 'este arquivo não é uma cópia dos dados que este sistema saiba ler',
    });
    expect(await slugs()).toEqual(['principal']);
  });

  it('cópia cortada no envio é recusada, e o banco fica como estava', async () => {
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('principal', 'Loja', 'cpf')`,
    );
    const copia = gzipSync(await juntar(gerarCopia(conexao.db, OPCOES)));
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('depois', 'Depois', 'cpf')`,
    );

    const resposta = await restaurarDoNavegador(
      conexao.db,
      fluxo(copia.slice(0, copia.byteLength - 40)),
      'principal',
    );

    expect(resposta.situacao).toBe('recusada');
    expect(await slugs()).toEqual(['depois', 'principal']);
  });
});
