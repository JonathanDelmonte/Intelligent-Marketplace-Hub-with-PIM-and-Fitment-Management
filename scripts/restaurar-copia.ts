/**
 * Restaura a cópia dos dados baixada pela tela "Cópia dos dados" (ADR 0016).
 *
 * ```sh
 * npm run copia:restaurar -- copia-dos-dados-2026-09-26-1530.sql.gz        # só confere
 * npm run copia:restaurar -- copia-dos-dados-2026-09-26-1530.sql.gz --sim  # restaura
 * ```
 *
 * O destino é o banco do `DATABASE_URL` — o do computador, ou o da nuvem, se for ele que
 * está no `.env`. Sem `--sim`, o comando lê o arquivo inteiro, confere e diz o que ele
 * tem, e não muda nada: restaurar troca os dados, e troca de dado não acontece por
 * engano de digitação. Com `--sim`, troca numa transação só — ou volta tudo, ou nada
 * muda (`restaurarCopia`).
 *
 * Aceita o arquivo como baixou (`.sql.gz`) e também já descomprimido.
 */
// Primeiro de todos: o `.env` tem de estar em `process.env` antes de qualquer
// módulo ler ambiente. Ver o cabeçalho de `carregar-env.ts`.
import { carregarEnv } from '@/config/carregar-env';

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { lerAmbiente } from '@/config/ambiente';
import { criarBancoCom } from '@/infra/banco/cliente';
import { CopiaInvalida, restaurarCopia, type ResumoDaCopia } from '@/infra/banco/copia';

carregarEnv();

const AJUDA = `
Restaura a cópia dos dados baixada pela tela "Cópia dos dados".

  npm run copia:restaurar -- <arquivo>         confere o arquivo e diz o que ele tem
  npm run copia:restaurar -- <arquivo> --sim   troca os dados do banco pelos da cópia

O banco é o do DATABASE_URL. Contas de acesso não entram na cópia: depois de
restaurar, crie a conta de novo na tela de cadastro.
`.trim();

/** O arquivo, linha por linha, descomprimido se vier comprimido. */
async function linhasDoArquivo(caminho: string): Promise<AsyncIterable<string>> {
  const arquivo = await open(caminho, 'r');
  const inicio = Buffer.alloc(2);
  try {
    await arquivo.read(inicio, 0, 2, 0);
  } finally {
    await arquivo.close();
  }
  const comprimido = inicio[0] === 0x1f && inicio[1] === 0x8b;
  const bruto = createReadStream(caminho);
  return createInterface({
    input: comprimido ? bruto.pipe(createGunzip()) : bruto,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
}

/** Onde fica o banco, para conferir antes de trocar os dados — sem usuário nem senha. */
function destinoLegivel(url: string): string {
  try {
    const endereco = new URL(url);
    return `${endereco.hostname}${endereco.pathname}`;
  } catch {
    return 'o banco do DATABASE_URL';
  }
}

function descrever(resumo: ResumoDaCopia): string {
  const quando = resumo.geradaEm === null ? 'data desconhecida' : resumo.geradaEm;
  return `cópia de ${quando}, versão ${resumo.versao ?? 'desconhecida'}: ${String(resumo.tabelas)} tabelas, ${String(resumo.linhas)} linhas`;
}

async function principal(): Promise<number> {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes('--ajuda') || argumentos.includes('--help')) {
    console.log(AJUDA);
    return 0;
  }
  const caminho = argumentos.find((a) => !a.startsWith('--'));
  if (caminho === undefined) {
    console.error(AJUDA);
    return 1;
  }
  const confirmado = argumentos.includes('--sim');

  const url = lerAmbiente().DATABASE_URL;
  const { db, encerrar } = criarBancoCom(url, { max: 2, silenciarAvisos: true });
  try {
    console.log(`Banco de destino: ${destinoLegivel(url)}`);
    if (!confirmado) {
      const resumo = await restaurarCopia(db, await linhasDoArquivo(caminho), { conferir: true });
      console.log(`O arquivo está inteiro: ${descrever(resumo)}.`);
      console.log(
        'Nada foi mudado. Para restaurar, rode de novo com --sim: os dados destas tabelas neste banco serão trocados pelos da cópia.',
      );
      return 0;
    }

    console.log('Restaurando…');
    const resumo = await restaurarCopia(db, await linhasDoArquivo(caminho));
    console.log(`Pronto: ${descrever(resumo)}.`);
    console.log('As contas de acesso não vêm na cópia: crie a sua de novo na tela de cadastro.');
    return 0;
  } catch (erro) {
    if (erro instanceof CopiaInvalida) {
      console.error(`Não restaurou: ${erro.message}`);
      return 1;
    }
    throw erro;
  } finally {
    await encerrar();
  }
}

principal().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (erro: unknown) => {
    console.error('Falha ao restaurar:', erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  },
);
