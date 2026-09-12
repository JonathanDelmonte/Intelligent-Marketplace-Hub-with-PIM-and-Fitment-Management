#!/usr/bin/env node
/**
 * Recusa arquivo-fonte com caractere literal que deveria ser escape.
 *
 * ## Por que isto existe
 *
 * Aconteceu quatro vezes durante a construção: escrever uma sequência de escape
 * numa ferramenta que serializa em JSON grava o **byte literal**, não o escape.
 * O resultado é um arquivo que:
 *
 * - o `git` trata como binário, então `git diff` e `git grep` param de funcionar
 * - o ESLint recusa com `no-irregular-whitespace`
 * - ninguém consegue ler nem editar com confiança
 *
 * É o tipo de problema que se conserta em dois minutos e se reintroduz em duas
 * semanas. Uma verificação mecânica custa uma vez.
 *
 * ## Por que sem expressão regular e sem sequência de escape
 *
 * A primeira versão usava faixas literais num regex e caiu na própria armadilha:
 * o separador de linha U+2028 virou quebra de linha de verdade e partiu a
 * expressão no meio. Este arquivo não contém **nenhuma** sequência de escape:
 * compara ponto de código numericamente e monta os caracteres especiais com
 * `String.fromCharCode`. É o único jeito honesto de escrever um verificador que
 * detecta exatamente o problema que ele próprio pode ter.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const QUEBRA_DE_LINHA = String.fromCharCode(10);
const TABULACAO = String.fromCharCode(9);
const RETORNO = String.fromCharCode(13);

/**
 * Faixas proibidas, por ponto de código.
 *
 * Todas são legítimas **como escape** no código; nenhuma é legítima como byte
 * dentro de um arquivo-fonte. Tabulação (9), quebra de linha (10) e retorno (13)
 * ficam de fora de propósito.
 */
const FAIXAS_PROIBIDAS = [
  { de: 0x00, ate: 0x08, nome: 'controle C0' },
  { de: 0x0b, ate: 0x0c, nome: 'controle C0' },
  { de: 0x0e, ate: 0x1f, nome: 'controle C0' },
  { de: 0x7f, ate: 0x7f, nome: 'DEL' },
  { de: 0xa0, ate: 0xa0, nome: 'espaco inquebravel' },
  { de: 0x0300, ate: 0x036f, nome: 'diacritico combinante solto' },
  { de: 0x1680, ate: 0x1680, nome: 'espaco tipografico' },
  { de: 0x2000, ate: 0x200f, nome: 'espaco tipografico ou formatador invisivel' },
  { de: 0x2028, ate: 0x2029, nome: 'separador de linha ou paragrafo' },
  { de: 0x202f, ate: 0x202f, nome: 'espaco estreito inquebravel' },
  { de: 0x205f, ate: 0x2060, nome: 'espaco matematico ou juntor invisivel' },
  { de: 0x3000, ate: 0x3000, nome: 'espaco ideografico' },
  { de: 0xfeff, ate: 0xfeff, nome: 'marca de ordem de byte no meio do arquivo' },
];

const EXTENSOES = ['.ts', '.tsx', '.mjs', '.cjs', '.js', '.json', '.yml', '.yaml', '.sh'];

function nomeDaFaixa(codigo) {
  return FAIXAS_PROIBIDAS.find((f) => codigo >= f.de && codigo <= f.ate)?.nome ?? null;
}

function arquivosVersionados() {
  const rastreados = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  const novos = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });

  return [...rastreados.split(QUEBRA_DE_LINHA), ...novos.split(QUEBRA_DE_LINHA)]
    .map((l) => l.trim())
    .filter((l) => l !== '' && EXTENSOES.some((e) => l.endsWith(e)));
}

const problemas = [];

for (const arquivo of arquivosVersionados()) {
  let conteudo;
  try {
    conteudo = readFileSync(arquivo, 'utf8');
  } catch {
    continue;
  }

  let linha = 1;
  let coluna = 1;

  for (const caractere of conteudo) {
    if (caractere === QUEBRA_DE_LINHA) {
      linha += 1;
      coluna = 1;
      continue;
    }
    if (caractere === TABULACAO || caractere === RETORNO) {
      coluna += 1;
      continue;
    }

    const codigo = caractere.codePointAt(0) ?? 0;
    const nome = nomeDaFaixa(codigo);

    if (nome !== null) {
      const hex = codigo.toString(16).toUpperCase().padStart(4, '0');
      problemas.push(
        `${arquivo}:${String(linha)}:${String(coluna)}  ${nome} U+${hex} — escreva como sequencia de escape, nao como byte`,
      );
    }

    coluna += 1;
  }
}

if (problemas.length > 0) {
  console.error(`FALHA: ${String(problemas.length)} caractere(s) literal(is) em arquivo-fonte:`);
  console.error('');
  for (const p of problemas.slice(0, 40)) console.error(`  ${p}`);
  if (problemas.length > 40) {
    console.error(`  ... e mais ${String(problemas.length - 40)}`);
  }
  console.error('');
  console.error('Caractere de controle ou invisivel como byte torna o arquivo binario para o git.');
  console.error('Ver docs/diario-de-bordo.md, entrada sobre arquivos-fonte binarios.');
  process.exit(1);
}

console.log('OK: nenhum caractere literal indevido em arquivo-fonte.');
