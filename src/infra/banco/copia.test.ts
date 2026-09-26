import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarBancoCom } from './cliente';
import {
  TABELAS_FORA_DA_COPIA,
  gerarCopia,
  ordenarParaRestaurar,
  restaurarCopia,
  tabelasDaCopia,
} from './copia';
import {
  VARIAVEL_DE_TESTE,
  abrirBancoDeTeste,
  limparTabelas,
  temBancoDeTeste,
  type ConexaoDeTeste,
} from './teste';

describe('ordenarParaRestaurar', () => {
  it('põe cada tabela depois das que ela refere, e em ordem alfabética quando tanto faz', () => {
    const ordem = ordenarParaRestaurar(
      ['pedido', 'sku', 'perfil', 'anuncio', 'aparelho'],
      [
        { de: 'pedido', para: 'anuncio' },
        { de: 'pedido', para: 'sku' },
        { de: 'anuncio', para: 'sku' },
        { de: 'sku', para: 'perfil' },
      ],
    );
    expect(ordem).toEqual(['aparelho', 'perfil', 'sku', 'anuncio', 'pedido']);
  });

  it('referência a si mesma e para fora da lista não prendem ninguém', () => {
    const ordem = ordenarParaRestaurar(
      ['sessao', 'categoria'],
      [
        { de: 'categoria', para: 'categoria' },
        { de: 'sessao', para: 'usuario' },
      ],
    );
    expect(ordem).toEqual(['categoria', 'sessao']);
  });

  it('ciclo não tem ordem, e é erro que diz quais tabelas', () => {
    expect(() =>
      ordenarParaRestaurar(
        ['a', 'b', 'c'],
        [
          { de: 'a', para: 'b' },
          { de: 'b', para: 'a' },
        ],
      ),
    ).toThrow(/a, b se referem em ciclo/);
  });
});

const texto = new TextDecoder();

async function juntar(pedacos: AsyncIterable<Uint8Array>): Promise<string> {
  let tudo = '';
  for await (const pedaco of pedacos) tudo += texto.decode(pedaco, { stream: true });
  return tudo + texto.decode();
}

async function* linhasDe(conteudo: string): AsyncGenerator<string> {
  await Promise.resolve();
  for (const linha of conteudo.split('\n')) yield linha;
}

const OPCOES = {
  nomeDoSistema: 'Sistema de teste',
  versao: 'teste',
  agora: new Date('2026-09-26T15:30:00Z'),
} as const;

const fotografia = z.array(z.object({ linhas: z.string() }));

describe.skipIf(!temBancoDeTeste())('cópia do banco (Postgres de verdade)', () => {
  let conexao: ConexaoDeTeste;
  let copiadas: readonly string[];

  /** O conteúdo de cada tabela, em texto, numa ordem que não depende do disco. */
  async function fotografar(tabelas: readonly string[]): Promise<Record<string, string>> {
    const retrato: Record<string, string> = {};
    for (const tabela of tabelas) {
      const linhas = fotografia.parse([
        ...(await conexao.db.execute(
          sql`select coalesce(json_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::json)::text as linhas
              from ${sql.identifier('public')}.${sql.identifier(tabela)} t`,
        )),
      ]);
      retrato[tabela] = linhas[0]?.linhas ?? '';
    }
    return retrato;
  }

  /** Dado com o que costuma quebrar cópia: tab, quebra de linha, barra, acento, json, vetor, nulo. */
  async function semear(): Promise<void> {
    await conexao.db.execute(sql`
      with perfil as (
        insert into perfil_vendedor (slug, nome, regime)
        values ('perfil-copia', E'Loja\tcom tab', 'mei') returning id
      ), produto as (
        insert into sku (perfil_id, titulo_interno, custo_atual, ean)
        select id, E'Refil PA21G\nsegunda linha \\ barra ''aspas'' ação 😀', 3890, '7896541200121'
        from perfil returning id
      ), externo as (
        insert into produto_externo (titulo_bruto, hash_conteudo, fonte, sku_id)
        select 'Refil Filtro PA21G', 'hash-da-copia', 'm1_planilha', id from produto returning id
      ), vetor as (
        insert into embedding (produto_externo_id, texto_canonico, modelo, vetor)
        select id, 'refil pa21g', 'modelo-de-teste', array_fill(0.25::real, array[1536])::vector
        from externo returning id
      ), fila as (
        insert into job (tipo, entrada, chave_idempotencia, status)
        values ('ingestao', '{"hashConteudo": null, "lista": [1, "dois", {"tres": true}]}', 'chave', 'concluido')
        returning id
      )
      insert into llm_call (proposito, modelo, hash_entrada, entrada, saida, job_id)
      select 'extracao', 'modelo', 'h', '{"t": "x"}', null, id from fila
    `);
  }

  beforeEach(async () => {
    conexao ??= abrirBancoDeTeste();
    copiadas = (await tabelasDaCopia(conexao.db)).map((t) => t.nome);
    await limparTabelas(conexao.db, [...copiadas, ...TABELAS_FORA_DA_COPIA]);
  });

  afterAll(async () => {
    await conexao?.encerrar();
  });

  it('ida e volta: o que sai é o que volta, tabela por tabela', async () => {
    await semear();
    const antes = await fotografar(copiadas);
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));

    // O banco muda depois da cópia: some tudo, e entra um perfil que a cópia não tem.
    await limparTabelas(conexao.db, copiadas);
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('outro', 'Outro', 'cpf')`,
    );

    const resumo = await restaurarCopia(conexao.db, linhasDe(copia));

    expect(await fotografar(copiadas)).toEqual(antes);
    expect(resumo).toEqual({
      geradaEm: '2026-09-26T15:30:00.000Z',
      versao: 'teste',
      tabelas: copiadas.length,
      linhas: 6,
    });
  });

  it('o arquivo diz o que é, e termina com a linha de fechamento', async () => {
    await semear();
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));

    expect(copia.startsWith('-- Cópia dos dados: Sistema de teste\n-- copia-formato: 1\n')).toBe(
      true,
    );
    expect(copia).toContain(`-- tabelas: ${copiadas.join(' ')}\n`);
    expect(copia).toContain('\nBEGIN;\nTRUNCATE TABLE public."');
    expect(copia).toContain('-- sku: 1 linha\n');
    expect(
      copia.endsWith(`COMMIT;\n-- fim-da-copia: tabelas=${String(copiadas.length)} linhas=6\n`),
    ).toBe(true);
  });

  it('contas e sessões ficam fora da cópia, e restaurar não mexe nelas', async () => {
    await conexao.db.execute(
      sql`insert into usuario (nome, email, senha_hash) values ('Dono', 'dono@exemplo.com', 'hash-secreto')`,
    );
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));

    expect(copia).not.toContain('hash-secreto');
    expect(copia).not.toContain('"usuario"');
    expect(copia).not.toContain('"sessao"');

    await restaurarCopia(conexao.db, linhasDe(copia));
    expect((await fotografar(['usuario']))['usuario']).toContain('dono@exemplo.com');
  });

  it('cópia cortada no meio é recusada, e o banco fica como estava', async () => {
    await semear();
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime) values ('depois', 'Depois', 'cpf')`,
    );
    const antes = await fotografar(copiadas);

    // O download que parou no meio: sem a linha de fechamento, e sem o fim de uma tabela.
    const cortada = copia.slice(0, copia.indexOf('-- sku: 1 linha') - 5);

    await expect(restaurarCopia(conexao.db, linhasDe(cortada))).rejects.toThrow(
      /a cópia termina no meio de uma tabela/,
    );
    expect(await fotografar(copiadas)).toEqual(antes);
  });

  it('dado que o banco recusa no fim do COPY — chave estrangeira — desfaz tudo, e diz a tabela', async () => {
    await semear();
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    const perfil = /^([0-9a-f-]{36})\t/m.exec(
      copia.slice(copia.indexOf('COPY public."perfil_vendedor"')),
    )?.[1];
    if (perfil === undefined) throw new Error('perfil não achado na cópia');
    // O produto passa a apontar para um perfil que não existe: o Postgres só confere a
    // chave no fim do COPY, depois de a escrita acabar — o caso que o driver perde.
    const inexistente = '00000000-0000-4000-8000-000000000000';
    const blocoDoSku = copia.indexOf('COPY public."sku"');
    const adulterada =
      copia.slice(0, blocoDoSku) + copia.slice(blocoDoSku).replace(perfil, inexistente);
    const antes = await fotografar(copiadas);

    await expect(restaurarCopia(conexao.db, linhasDe(adulterada))).rejects.toThrow(
      /o banco recusou os dados da tabela sku/,
    );
    expect(await fotografar(copiadas)).toEqual(antes);
  });

  it('linha com coluna a menos é recusada no meio da escrita, e nada muda', async () => {
    await semear();
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    const inicio = copia.indexOf('\n', copia.indexOf('COPY public."perfil_vendedor"')) + 1;
    const fimDaLinha = copia.indexOf('\n', inicio);
    const linha = copia.slice(inicio, fimDaLinha);
    const curta = linha.slice(0, linha.lastIndexOf('\t'));
    const adulterada = copia.slice(0, inicio) + curta + copia.slice(fimDaLinha);
    const antes = await fotografar(copiadas);

    await expect(restaurarCopia(conexao.db, linhasDe(adulterada))).rejects.toThrow(
      /o banco recusou os dados da tabela perfil_vendedor/,
    );
    expect(await fotografar(copiadas)).toEqual(antes);
  });

  it('sem a linha de fechamento também é cópia incompleta', async () => {
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    const semFim = copia.slice(0, copia.indexOf('-- fim-da-copia'));

    await expect(restaurarCopia(conexao.db, linhasDe(semFim))).rejects.toThrow(
      /a cópia está incompleta/,
    );
  });

  it('cópia de um banco mais novo é recusada antes de apagar qualquer coisa', async () => {
    await semear();
    const copia = (await juntar(gerarCopia(conexao.db, OPCOES))).replace(
      /^-- migracao: .*$/m,
      '-- migracao: 99999999999999',
    );
    const antes = await fotografar(copiadas);

    await expect(restaurarCopia(conexao.db, linhasDe(copia))).rejects.toThrow(
      /versão mais nova do sistema/,
    );
    expect(await fotografar(copiadas)).toEqual(antes);
  });

  it('não executa o que estiver escrito: linha estranha recusa a cópia inteira', async () => {
    await semear();
    const copia = (await juntar(gerarCopia(conexao.db, OPCOES))).replace(
      '\nBEGIN;\n',
      '\nBEGIN;\nDROP TABLE sku;\n',
    );
    const antes = await fotografar(copiadas);

    await expect(restaurarCopia(conexao.db, linhasDe(copia))).rejects.toThrow(
      /linha que não é de uma cópia: DROP TABLE sku;/,
    );
    expect(await fotografar(copiadas)).toEqual(antes);
  });

  it('arquivo que não é cópia é recusado', async () => {
    await expect(
      restaurarCopia(conexao.db, linhasDe('id;nome\n1;planilha qualquer\n')),
    ).rejects.toThrow(/não é uma cópia dos dados/);
  });

  it('conferir lê o arquivo inteiro e diz o que ele tem, sem mudar o banco', async () => {
    await semear();
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    await limparTabelas(conexao.db, copiadas);

    const resumo = await restaurarCopia(conexao.db, linhasDe(copia), { conferir: true });

    expect(resumo.linhas).toBe(6);
    expect(Object.values(await fotografar(copiadas)).every((l) => l === '[]')).toBe(true);
  });

  it('cópia grande volta sem deixar escuta pendurada no fluxo do COPY', async () => {
    // Uns 3 MB: dezenas de lotes, e dezenas de esperas para o banco escoar. Cada espera
    // que deixasse uma escuta para trás faria o Node avisar vazamento depois de dez.
    await semear();
    await conexao.db.execute(
      sql`insert into llm_call (proposito, modelo, hash_entrada, entrada)
          select 'volume', 'modelo', md5(n::text), jsonb_build_object('texto', repeat(md5(n::text), 40))
          from generate_series(1, 2000) n`,
    );
    const antes = await fotografar(['llm_call']);
    const copia = await juntar(gerarCopia(conexao.db, OPCOES));
    await limparTabelas(conexao.db, copiadas);

    const avisos: string[] = [];
    const escutar = (aviso: Error) => {
      avisos.push(aviso.name);
    };
    process.on('warning', escutar);
    try {
      await restaurarCopia(conexao.db, linhasDe(copia));
      // O aviso do Node sai no tique seguinte ao excesso.
      await new Promise((pronto) => setImmediate(pronto));
    } finally {
      process.off('warning', escutar);
    }

    expect(avisos).not.toContain('MaxListenersExceededWarning');
    expect(await fotografar(['llm_call'])).toEqual(antes);
  });

  it('quem para de ler no meio de uma tabela devolve a conexão pronta para o próximo', async () => {
    await semear();
    await conexao.db.execute(
      sql`insert into perfil_vendedor (slug, nome, regime)
          select 'p' || n, 'Perfil ' || n, 'cpf' from generate_series(1, 50) n`,
    );
    const url = process.env[VARIAVEL_DE_TESTE];
    if (url === undefined) throw new Error('sem banco de teste');
    // Uma conexão só: se ela voltasse ao pool com o COPY pela metade, a consulta
    // seguinte ficaria parada, e o teste estouraria o tempo.
    const unica = criarBancoCom(url, { max: 1, silenciarAvisos: true });
    try {
      const copia = gerarCopia(unica.db, OPCOES);
      let lido = '';
      for await (const pedaco of copia) {
        lido += texto.decode(pedaco);
        if (lido.includes('COPY public."perfil_vendedor"') && !lido.endsWith(';\n')) break;
      }

      const resposta = z
        .array(z.object({ um: z.number() }))
        .parse([...(await unica.db.execute(sql`select 1 as um`))]);
      expect(resposta).toEqual([{ um: 1 }]);
    } finally {
      await unica.encerrar();
    }
  });

  it('nenhuma tabela de fora da cópia aponta para uma de dentro', async () => {
    // Se apontasse, o TRUNCATE da restauração falharia — ou, com CASCADE, apagaria contas.
    const referencias = z.array(z.object({ de: z.string(), para: z.string() })).parse([
      ...(await conexao.db.execute(
        sql`select de.relname as de, para.relname as para
            from pg_constraint k
            join pg_class de on de.oid = k.conrelid
            join pg_class para on para.oid = k.confrelid
            where k.contype = 'f' and k.connamespace = 'public'::regnamespace`,
      )),
    ]);
    const cruzam = referencias.filter(
      (r) => TABELAS_FORA_DA_COPIA.includes(r.de) && !TABELAS_FORA_DA_COPIA.includes(r.para),
    );
    expect(cruzam).toEqual([]);
    expect(copiadas).not.toContain('usuario');
    expect(copiadas).toContain('perfil_vendedor');
  });
});
