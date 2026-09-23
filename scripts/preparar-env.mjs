#!/usr/bin/env node
/**
 * Cria o `.env` a partir do `.env.example`, com a chave mestra já gerada.
 *
 * Existe porque a sequência manual — copiar o exemplo, rodar um `node -e` para
 * gerar 32 bytes em base64, colar no lugar certo, colar a URL do banco — tem quatro
 * passos e três formas de errar. A que mais aconteceu: **editar o `.env.example` em
 * vez do `.env`**, que é fácil porque o `.env` não existe até alguém criá-lo (é
 * ignorado pelo git, então não vem no clone) e o editor mostra o exemplo primeiro.
 *
 * Nunca sobrescreve um `.env` existente. Rodar de novo por engano não pode apagar a
 * configuração de ninguém.
 *
 * ```sh
 * npm run preparar:env
 * npm run preparar:env -- --database-url="postgresql://usuario:senha@host/banco?sslmode=require"
 * npm run preparar:env -- --database-url="..." --database-url-teste="...banco_teste"
 * ```
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = process.cwd();
const exemplo = resolve(raiz, '.env.example');
const destino = resolve(raiz, '.env');

function argumento(nome) {
  const prefixo = `--${nome}=`;
  const bruto = process.argv.find((a) => a.startsWith(prefixo));
  return bruto === undefined ? undefined : bruto.slice(prefixo.length).replace(/^["']|["']$/g, '');
}

/**
 * Limpa uma URL de banco antes de gravar.
 *
 * `channel_binding` sai da URL, sempre. Painel de banco gerenciado entrega a string
 * com `channel_binding=require`, e o `postgres.js` repassa parâmetro que não conhece
 * ao servidor como parâmetro de startup — onde o Postgres derruba a conexão com
 * `unrecognized configuration parameter "channel_binding"`. Medido. Tirar aqui é o
 * que impede a armadilha de chegar ao `.env`.
 *
 * A conexão também tira (`urlParaODriver`, em `src/infra/banco/url.ts`), para a URL
 * colada à mão no `.env`; este script não pode importar TypeScript porque roda antes do
 * `npm install`, e por isso a regra está repetida aqui, igual. Por nome de parâmetro, e
 * não por expressão regular: a versão anterior levava o `?` junto quando o parâmetro
 * vinha primeiro, e o resto da consulta virava parte do nome do banco.
 */
function limparUrl(bruta) {
  const url = bruta.trim();
  const interrogacao = url.indexOf('?');
  if (interrogacao === -1) return { url, removeu: false };
  const parametros = url.slice(interrogacao + 1).split('&');
  const mantidos = parametros.filter((parametro) => parametro.split('=')[0] !== 'channel_binding');
  if (mantidos.length === parametros.length) return { url, removeu: false };
  const base = url.slice(0, interrogacao);
  return { url: mantidos.length === 0 ? base : `${base}?${mantidos.join('&')}`, removeu: true };
}

/**
 * `.env` que já existe só é tocado numa situação, e só numa linha.
 *
 * A garantia de nunca sobrescrever configuração de ninguém continua valendo. Mas
 * quem já tinha `.env` antes de `DATABASE_URL_TESTE` existir fica sem a variável, e
 * a única saída seria editar o arquivo à mão — que é exatamente o passo manual que
 * este script existe para eliminar. Então, **quando a variável é informada e está
 * faltando**, o script acrescenta essa linha e diz que acrescentou. Nada mais é
 * lido, alterado ou reordenado.
 */
if (existsSync(destino)) {
  const urlDeTeste = argumento('database-url-teste');
  if (urlDeTeste === undefined || urlDeTeste.trim() === '') {
    console.log('.env já existe. Nada foi alterado — apague o arquivo se quiser recomeçar.');
    console.log('Para só acrescentar o banco de teste, rode com --database-url-teste="..."');
    process.exit(0);
  }

  const atual = readFileSync(destino, 'utf8');
  const jaTem = /^DATABASE_URL_TESTE=.+$/m.test(atual);
  if (jaTem) {
    console.log('.env já tem DATABASE_URL_TESTE preenchido. Nada foi alterado.');
    process.exit(0);
  }

  const daAplicacao = /^DATABASE_URL="?([^"\n]*)"?$/m.exec(atual)?.[1]?.trim();
  const { url } = limparUrl(urlDeTeste);
  if (daAplicacao !== undefined && daAplicacao !== '' && daAplicacao === url) {
    console.error('A URL de teste é igual à da aplicação, e a suíte apaga tabelas.');
    console.error('Use um banco separado — em banco gerenciado, uma branch de teste serve.');
    process.exit(1);
  }

  const linha = `DATABASE_URL_TESTE="${url}"`;
  const atualizado = /^DATABASE_URL_TESTE=.*$/m.test(atual)
    ? atual.replace(/^DATABASE_URL_TESTE=.*$/m, linha)
    : `${atual.replace(/\n*$/, '')}\n\n${linha}\n`;
  writeFileSync(destino, atualizado, 'utf8');
  console.log('.env já existia: acrescentei só DATABASE_URL_TESTE, e nada mais foi tocado.');
  console.log('Falta dar schema ao banco novo:');
  console.log('  DATABASE_URL="$DATABASE_URL_TESTE" npm run db:migrate');
  process.exit(0);
}

if (!existsSync(exemplo)) {
  console.error('.env.example não encontrado. Você está na raiz do projeto?');
  process.exit(1);
}

let conteudo = readFileSync(exemplo, 'utf8');

/**
 * A chave mestra cifra credencial de plataforma em repouso (ADR 0007).
 *
 * Gerada aqui e não pedida ao usuário: são 32 bytes aleatórios em base64, e não há
 * decisão humana nenhuma nisso — só oportunidade de errar o tamanho.
 */
const chave = randomBytes(32).toString('base64');
conteudo = conteudo.replace(/^CREDENCIAL_CHAVE_MESTRA=.*$/m, `CREDENCIAL_CHAVE_MESTRA=${chave}`);

const urlInformada = argumento('database-url');
const urlDeTesteInformada = argumento('database-url-teste');
const avisos = [];

if (urlInformada !== undefined && urlInformada.trim() !== '') {
  const { url, removeu } = limparUrl(urlInformada);
  if (removeu) {
    avisos.push(
      'removi `channel_binding` da URL: o driver o repassaria ao servidor e a conexão cairia',
    );
  }
  conteudo = conteudo.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`);
}

/**
 * O banco da suíte é **outro**, e o script recusa igualar os dois.
 *
 * A suíte faz `truncate` nas tabelas a cada teste. Apontar a variável de teste para
 * o banco da aplicação apaga os dados de verdade — e o `CLAUDE.md` manda rodar
 * `npm run check` antes de todo commit, então o estrago aconteceria obedecendo às
 * instruções do projeto. Recusar aqui é mais barato que explicar depois.
 */
if (urlDeTesteInformada !== undefined && urlDeTesteInformada.trim() !== '') {
  const { url, removeu } = limparUrl(urlDeTesteInformada);
  if (removeu) avisos.push('removi `channel_binding` também da URL de teste');

  const daAplicacao = urlInformada === undefined ? undefined : limparUrl(urlInformada).url;
  if (daAplicacao !== undefined && daAplicacao === url) {
    console.error('A URL de teste é igual à da aplicação, e a suíte apaga tabelas.');
    console.error('Use um banco separado — em banco gerenciado, uma branch de teste serve.');
    process.exit(1);
  }

  conteudo = conteudo.replace(/^DATABASE_URL_TESTE=.*$/m, `DATABASE_URL_TESTE="${url}"`);
}

writeFileSync(destino, conteudo, 'utf8');

const mascarada = (conteudo.match(/^DATABASE_URL=.*$/m) ?? [''])[0].replace(
  /:\/\/([^:]+):[^@]+@/,
  '://$1:***@',
);

console.log('.env criado.');
console.log(`  chave mestra gerada (32 bytes em base64)`);
console.log(`  ${mascarada}`);
for (const aviso of avisos) console.log(`  aviso: ${aviso}`);
if (urlInformada === undefined) {
  console.log('');
  console.log('Falta o banco: abra o `.env` e preencha DATABASE_URL, ou rode de novo com');
  console.log('  npm run preparar:env -- --database-url="postgresql://..."');
}
if (urlDeTesteInformada === undefined) {
  console.log('');
  console.log('DATABASE_URL_TESTE ficou vazio, e vazio é seguro: os testes de banco pulam.');
  console.log('Para rodá-los, aponte para um banco DESCARTÁVEL — nunca o da aplicação, que');
  console.log('a suíte trunca tabelas. Em banco gerenciado, uma branch de teste serve.');
}
