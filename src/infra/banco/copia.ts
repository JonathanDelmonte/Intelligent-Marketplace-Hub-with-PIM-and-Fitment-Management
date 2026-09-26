/**
 * Cópia do banco, para baixar no computador de quem usa (ADR 0016).
 *
 * O Supabase gratuito não faz cópia de segurança: se o projeto se perder, os dados vão
 * junto. A cópia é um arquivo que a pessoa baixa pelo navegador e guarda onde quiser —
 * sem custo, e sem depender de mais nenhum serviço.
 *
 * ## O formato: SQL comum, com um bloco `COPY` por tabela
 *
 * É o que o `pg_dump` escreve no formato texto, e por isso a cópia volta de dois jeitos:
 * pelo próprio sistema (`restaurarCopia`, que é o que `npm run copia:restaurar` usa) e
 * pelo `psql` de qualquer Postgres, sem este código. Nada de formato próprio que só este
 * programa sabe ler: cópia que depende do programa estar de pé é cópia pela metade.
 *
 * - Os dados saem de **uma fotografia só** do banco (transação `repeatable read`): uma
 *   venda gravada no meio da cópia não aparece numa tabela e falta na outra.
 * - As tabelas vão **na ordem em que podem voltar**: a referida antes de quem a refere,
 *   pelas chaves estrangeiras. Restaurar não precisa desligar verificação nenhuma — o
 *   que no Supabase nem é permitido.
 * - A primeira linha de dados só é escrita depois do cabeçalho, e o arquivo termina com
 *   uma linha de fechamento. Download interrompido não tem essa linha, e a restauração
 *   recusa a cópia pela metade antes de apagar qualquer coisa.
 *
 * ## O que fica de fora
 *
 * **Contas e sessões** (`usuario`, `sessao`). Com o cadastro aberto (ADR 0015), qualquer
 * conta baixa a cópia, e o hash da senha de uma pessoa não deve viajar num arquivo que
 * outra pode ter. Quem restaura cria a conta de novo. **Os arquivos enviados** também
 * não entram: não estão no banco, e o original está com quem enviou (ADR 0016).
 */
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { contagem } from '@/lib/texto';
import type { Banco } from './cliente';
import {
  CopiaInvalida,
  FIM_DO_BLOCO,
  FORMATO_DA_COPIA,
  percorrerCopia,
  type BlocoDaCopia,
  type ResumoDaCopia,
} from './formato-da-copia';

// O formato é lido também pelo navegador, e mora num arquivo sem nada de servidor.
export { CopiaInvalida, FORMATO_DA_COPIA, type ResumoDaCopia } from './formato-da-copia';

/** Tabelas que não entram na cópia. Ver o cabeçalho. */
export const TABELAS_FORA_DA_COPIA: readonly string[] = ['usuario', 'sessao'];

export interface TabelaDaCopia {
  readonly nome: string;
  readonly colunas: readonly string[];
}

export interface Referencia {
  /** A tabela que tem a chave estrangeira. */
  readonly de: string;
  /** A tabela referida. */
  readonly para: string;
}

/**
 * A ordem em que as tabelas podem ser restauradas: toda tabela depois das que ela
 * refere. Em ordem alfabética entre as que podem ir juntas, para duas cópias do mesmo
 * banco saírem iguais. Referência a si mesma não prende ninguém — a verificação da chave
 * é no fim do `COPY` —, e referência para fora da lista também não.
 *
 * Ciclo entre tabelas não tem ordem, e é erro: pediria desligar a verificação das
 * chaves, que o Supabase não deixa. O teste de ida e volta roda contra o schema inteiro,
 * e é ele que avisa se um dia uma migração criar um.
 */
export function ordenarParaRestaurar(
  tabelas: readonly string[],
  referencias: readonly Referencia[],
): readonly string[] {
  const nomes = new Set(tabelas);
  const faltam = new Map<string, Set<string>>(tabelas.map((t) => [t, new Set<string>()]));
  for (const { de, para } of referencias) {
    if (de === para || !nomes.has(de) || !nomes.has(para)) continue;
    faltam.get(de)?.add(para);
  }

  const ordem: string[] = [];
  const pendentes = new Set(tabelas);
  while (pendentes.size > 0) {
    const prontas = [...pendentes].filter((t) => faltam.get(t)?.size === 0).sort();
    if (prontas.length === 0) {
      throw new CopiaInvalida(
        `as tabelas ${[...pendentes].sort().join(', ')} se referem em ciclo, e não há ordem para restaurar`,
      );
    }
    for (const tabela of prontas) {
      ordem.push(tabela);
      pendentes.delete(tabela);
      for (const dependencias of faltam.values()) dependencias.delete(tabela);
    }
  }
  return ordem;
}

const NOME_SEGURO = /^[a-z_][a-z0-9_]*$/;

/** Nome de tabela ou coluna entre aspas. Só o que tem a forma de nome do schema passa. */
function identificador(nome: string): string {
  if (!NOME_SEGURO.test(nome))
    throw new CopiaInvalida(`nome fora do padrão: ${JSON.stringify(nome)}`);
  return `"${nome}"`;
}

function comandoDeCopia(tabela: TabelaDaCopia, direcao: 'TO stdout' | 'FROM stdin'): string {
  const colunas = tabela.colunas.map(identificador).join(', ');
  return `COPY public.${identificador(tabela.nome)} (${colunas}) ${direcao}`;
}

const linhasDeTabela = z.array(z.object({ tabela: z.string() }));
const linhasDeColuna = z.array(z.object({ tabela: z.string(), coluna: z.string() }));
const linhasDeReferencia = z.array(z.object({ de: z.string(), para: z.string() }));
const linhasDeMigracao = z.array(z.object({ quando: z.coerce.number().nullable() }));

/**
 * As tabelas do `public` que são do sistema — as que o usuário do banco é dono, o mesmo
 * critério de `fechar-tabelas.ts` —, menos as de fora, na ordem de restaurar. Coluna
 * gerada fica de fora: o `COPY` não a escreve de volta, e ela se recalcula sozinha.
 */
export async function tabelasDaCopia(db: Banco): Promise<readonly TabelaDaCopia[]> {
  const tabelas = linhasDeTabela
    .parse([
      ...(await db.execute(
        sql`select tablename as tabela from pg_tables
            where schemaname = 'public' and tableowner = current_user`,
      )),
    ])
    .map((l) => l.tabela)
    .filter((t) => !TABELAS_FORA_DA_COPIA.includes(t));

  const colunas = linhasDeColuna.parse([
    ...(await db.execute(
      sql`select c.relname as tabela, a.attname as coluna
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          order by c.relname, a.attnum`,
    )),
  ]);

  const referencias = linhasDeReferencia.parse([
    ...(await db.execute(
      sql`select de.relname as de, para.relname as para
          from pg_constraint k
          join pg_class de on de.oid = k.conrelid
          join pg_class para on para.oid = k.confrelid
          where k.contype = 'f' and k.connamespace = 'public'::regnamespace`,
    )),
  ]);

  const colunasPorTabela = new Map<string, string[]>();
  for (const { tabela, coluna } of colunas) {
    colunasPorTabela.set(tabela, [...(colunasPorTabela.get(tabela) ?? []), coluna]);
  }
  return ordenarParaRestaurar(tabelas, referencias).map((nome) => ({
    nome,
    colunas: colunasPorTabela.get(nome) ?? [],
  }));
}

export interface MedidaDaCopia {
  readonly tabelas: number;
  /** O que as tabelas ocupam no banco, com índices. O arquivo sai bem menor, comprimido. */
  readonly bytesNoBanco: number;
}

const linhasDeMedida = z.array(
  z.object({ tabelas: z.coerce.number(), bytes: z.coerce.number().nullable() }),
);

/** Quantas tabelas vão na cópia e quanto elas ocupam: o que a tela mostra antes de baixar. */
export async function medirCopia(db: Banco): Promise<MedidaDaCopia> {
  const fora = sql.join(
    TABELAS_FORA_DA_COPIA.map((t) => sql`${t}`),
    sql`, `,
  );
  const [medida] = linhasDeMedida.parse([
    ...(await db.execute(
      sql`select count(*) as tabelas,
                 sum(pg_total_relation_size(format('public.%I', tablename)::regclass)) as bytes
          from pg_tables
          where schemaname = 'public' and tableowner = current_user
            and tablename not in (${fora})`,
    )),
  ]);
  return { tabelas: medida?.tabelas ?? 0, bytesNoBanco: medida?.bytes ?? 0 };
}

/**
 * Quando foi criada a última migração aplicada — o carimbo que o Drizzle guarda. Serve
 * para a restauração recusar cópia de um banco mais novo que o de destino.
 */
async function ultimaMigracao(db: Banco): Promise<number | null> {
  try {
    const linhas = linhasDeMigracao.parse([
      ...(await db.execute(
        sql`select max(created_at) as quando from drizzle.__drizzle_migrations`,
      )),
    ]);
    return linhas[0]?.quando ?? null;
  } catch {
    return null;
  }
}

export interface OpcoesDaCopia {
  /** Nome do sistema, de configuração (ADR 0003): só o cabeçalho do arquivo o usa. */
  readonly nomeDoSistema: string;
  readonly versao: string | null;
  readonly agora: Date;
}

const QUEBRA = 0x0a;

/**
 * Gera a cópia, pedaço por pedaço, sem juntar o banco na memória: cada tabela sai do
 * `COPY` direto para quem está lendo.
 *
 * A lista de tabelas e a migração são lidas antes da fotografia, e isso não abre
 * brecha: as colunas vão nomeadas no `COPY`, então uma migração que acrescente coluna
 * no meio não muda o que sai, e o carimbo continua descrevendo o que saiu.
 *
 * **Quem para de ler no meio** — o navegador que cancelou o download — deixa um `COPY`
 * aberto na conexão. Ela só volta ao pool depois de o resto sair, lido e jogado fora:
 * devolvida com o `COPY` pela metade, ficaria parada para sempre, e no Render são cinco.
 */
export async function* gerarCopia(
  db: Banco,
  opcoes: OpcoesDaCopia,
): AsyncGenerator<Uint8Array, void, undefined> {
  const texto = new TextEncoder();
  const tabelas = await tabelasDaCopia(db);
  const migracao = await ultimaMigracao(db);

  const conexao = await db.$client.reserve();
  let aberta = false;
  let saida: Readable | null = null;
  try {
    await conexao.unsafe('begin isolation level repeatable read read only');
    aberta = true;

    yield texto.encode(
      [
        `-- Cópia dos dados: ${opcoes.nomeDoSistema.replace(/[\r\n]/g, ' ')}`,
        `-- copia-formato: ${String(FORMATO_DA_COPIA)}`,
        `-- gerada-em: ${opcoes.agora.toISOString()}`,
        `-- versao: ${opcoes.versao ?? 'desconhecida'}`,
        `-- migracao: ${migracao === null ? 'desconhecida' : String(migracao)}`,
        `-- tabelas: ${tabelas.map((t) => t.nome).join(' ')}`,
        '--',
        '-- Restaurar substitui os dados destas tabelas pelos da cópia, num banco já migrado',
        '-- até a versão da cópia ou depois. Contas e sessões não entram: quem restaura cria',
        '-- a conta de novo. Os arquivos enviados também não: o original está com quem enviou.',
        '--',
        '--   pelo sistema:  npm run copia:restaurar -- <este arquivo>',
        '--   pelo psql:     gunzip -c <este arquivo> | psql "<endereço do banco>"',
        '',
        "SET client_encoding = 'UTF8';",
        'SET standard_conforming_strings = on;',
        'BEGIN;',
        `TRUNCATE TABLE ${tabelas.map((t) => `public.${identificador(t.nome)}`).join(', ')};`,
        '',
        '',
      ].join('\n'),
    );

    let totalDeLinhas = 0;
    for (const tabela of tabelas) {
      yield texto.encode(`${comandoDeCopia(tabela, 'FROM stdin')};\n`);
      saida = await conexao.unsafe(comandoDeCopia(tabela, 'TO stdout')).readable();
      let linhas = 0;
      // `destroyOnReturn: false`: quem para de ler não destrói o `COPY` — o `finally` o
      // esvazia antes de devolver a conexão.
      for await (const pedaco of saida.iterator({ destroyOnReturn: false })) {
        if (!(pedaco instanceof Uint8Array)) throw new Error('o COPY devolveu algo que não é byte');
        for (const byte of pedaco) if (byte === QUEBRA) linhas += 1;
        yield pedaco;
      }
      saida = null;
      totalDeLinhas += linhas;
      yield texto.encode(
        `${FIM_DO_BLOCO}\n-- ${tabela.nome}: ${contagem(linhas, 'linha', 'linhas')}\n\n`,
      );
    }

    await conexao.unsafe('commit');
    aberta = false;
    yield texto.encode(
      `COMMIT;\n-- fim-da-copia: tabelas=${String(tabelas.length)} linhas=${String(totalDeLinhas)}\n`,
    );
  } finally {
    if (saida !== null && !saida.readableEnded) {
      saida.resume();
      await finished(saida).catch(() => undefined);
    }
    if (aberta) await conexao.unsafe('rollback').catch(() => undefined);
    conexao.release();
  }
}

// ─── Restaurar ───────────────────────────────────────────────────────────────

type Conexao = Awaited<ReturnType<Banco['$client']['reserve']>>;

/**
 * Um bloco da cópia para dentro do banco, com o erro do Postgres levado a sério.
 *
 * O driver só avisa o erro de `COPY … FROM stdin` que chega enquanto se escreve. O que o
 * Postgres descobre no fim — a chave estrangeira sem o registro referido, verificada no
 * fim do comando — chega depois do `end()`, e o driver o perde: o `COPY` não termina nem
 * falha, e esperar por ele seria esperar para sempre (o teste da cópia cortada ficou
 * parado assim). Por isso o fim é conferido com uma consulta a mais na mesma conexão:
 * ela só roda depois do `COPY`, e falha se ele falhou, porque a transação ficou abortada.
 * O driver recusa a consulta enquanto não mandou o fim do `COPY` — o que acontece logo
 * depois do `end()`, quando o que foi escrito termina de sair —, e ela é refeita até ele
 * mandar.
 *
 * Fonte que acaba antes da hora (`lotes` lança) não termina o `COPY`: desiste dele, e
 * nada do que foi escrito fica.
 */
async function copiarPara(
  conexao: Conexao,
  bloco: BlocoDaCopia,
  lotes: AsyncIterable<string>,
): Promise<void> {
  const destino = await conexao
    .unsafe(comandoDeCopia({ nome: bloco.tabela, colunas: bloco.colunas }, 'FROM stdin'))
    .writable();
  let falha: unknown = null;
  destino.on('error', (erro: unknown) => {
    falha ??= erro;
  });
  const recusa = () =>
    new CopiaInvalida(
      `o banco recusou os dados da tabela ${bloco.tabela}${falha instanceof Error ? ` (${falha.message})` : ''}. Nada foi mudado.`,
    );

  try {
    for await (const lote of lotes) {
      if (falha !== null) throw recusa();
      if (!destino.write(lote)) {
        await Promise.race([once(destino, 'drain'), once(destino, 'close')]);
      }
    }
  } catch (erro) {
    destino.destroy(erro instanceof Error ? erro : new Error(String(erro)));
    throw erro;
  }
  if (falha !== null) throw recusa();
  destino.end();
  const limite = Date.now() + ESPERA_PELO_FIM_DO_COPY_MS;
  for (;;) {
    try {
      await conexao.unsafe('select 1');
      return;
    } catch (erro) {
      const aindaCopiando =
        typeof erro === 'object' &&
        erro !== null &&
        'code' in erro &&
        erro.code === 'COPY_IN_PROGRESS';
      if (!aindaCopiando || Date.now() > limite) throw recusa();
      await new Promise((pronto) => setTimeout(pronto, 5));
    }
  }
}

/** Quanto esperar o driver mandar o fim de um `COPY` antes de desistir da restauração. */
const ESPERA_PELO_FIM_DO_COPY_MS = 60_000;

/**
 * Restaura a cópia: apaga os dados das tabelas dela e põe os da cópia, **numa transação
 * só** — ou volta tudo, ou nada muda.
 *
 * Não executa o SQL do arquivo. Lê o cabeçalho e os blocos `COPY` (`percorrerCopia`),
 * confere cada tabela e cada coluna contra o banco de destino, e monta os comandos
 * daqui. Arquivo com qualquer outra linha é recusado: a cópia é um arquivo que passou
 * pelo computador de alguém, e "restaurar" não pode virar "executar o que estiver
 * escrito".
 *
 * Recusa antes de apagar qualquer coisa: formato desconhecido, cópia de um banco mais
 * novo que o de destino, tabela ou coluna que o destino não tem. E recusa no fim, com a
 * transação desfeita, a cópia sem a linha de fechamento — o download interrompido.
 *
 * `conferir: true` lê o arquivo inteiro e diz o que ele tem, conferindo contra o banco,
 * sem mudar nada.
 */
export async function restaurarCopia(
  db: Banco,
  linhas: AsyncIterable<string>,
  opcoes: { readonly conferir?: boolean } = {},
): Promise<ResumoDaCopia> {
  const conexao = opcoes.conferir === true ? null : await db.$client.reserve();
  let aberta = false;
  let noDestino = new Map<string, ReadonlySet<string>>();
  try {
    const resumo = await percorrerCopia(linhas, {
      aoLerCabecalho: async (cabecalho) => {
        noDestino = new Map((await tabelasDaCopia(db)).map((t) => [t.nome, new Set(t.colunas)]));
        for (const tabela of cabecalho.tabelas) {
          if (!noDestino.has(tabela)) {
            throw new CopiaInvalida(`a tabela ${tabela} da cópia não existe neste banco`);
          }
        }
        const migracaoDoDestino = await ultimaMigracao(db);
        if (
          cabecalho.migracao !== null &&
          migracaoDoDestino !== null &&
          cabecalho.migracao > migracaoDoDestino
        ) {
          throw new CopiaInvalida(
            'a cópia é de uma versão mais nova do sistema que a deste banco: atualize o banco (npm run db:migrate) e restaure de novo',
          );
        }
        if (conexao === null) return;
        await conexao.unsafe('begin');
        aberta = true;
        if (cabecalho.tabelas.length > 0) {
          await conexao.unsafe(
            `TRUNCATE TABLE ${cabecalho.tabelas.map((t) => `public.${identificador(t)}`).join(', ')}`,
          );
        }
      },
      aoLerBloco: async (bloco, lotes) => {
        const existentes = noDestino.get(bloco.tabela) ?? new Set<string>();
        const faltando = bloco.colunas.filter((c) => !existentes.has(c));
        if (faltando.length > 0) {
          throw new CopiaInvalida(
            `a tabela ${bloco.tabela} deste banco não tem ${faltando.join(', ')}: atualize o banco (npm run db:migrate) e restaure de novo`,
          );
        }
        if (conexao === null) {
          for await (const lote of lotes) void lote;
        } else {
          await copiarPara(conexao, bloco, lotes);
        }
      },
    });

    if (conexao !== null) {
      await conexao.unsafe('commit');
      aberta = false;
    }
    return resumo;
  } finally {
    if (conexao !== null) {
      if (aberta) await conexao.unsafe('rollback').catch(() => undefined);
      conexao.release();
    }
  }
}
