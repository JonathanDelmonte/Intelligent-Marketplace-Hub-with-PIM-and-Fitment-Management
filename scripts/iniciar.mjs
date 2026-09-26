#!/usr/bin/env node
/**
 * Sobe o sistema no localhost com um clique: banco, dependências, migrações, versão
 * de uso, servidor e fila — e abre o navegador quando o servidor responde.
 *
 * É o que `Atalhos/Iniciar.bat` chama. A lógica mora aqui, em Node, e não no `.bat`,
 * por três motivos:
 *
 * 1. Batch de Windows quebra por detalhe invisível. A primeira versão do atalho tinha
 *    acento dentro de um bloco `if (...)` logo depois de `chcp 65001`, e no Windows
 *    do dono **a janela abria e fechava sem fazer nada**: o `cmd.exe` morria lendo o
 *    bloco, antes de chegar à linha do Node. O `.bat` agora é só ASCII, e todo texto
 *    com acento é escrito por este script.
 * 2. O mesmo script roda em macOS e Linux sem mudança — `node scripts/iniciar.mjs`.
 * 3. **Sem dependência nenhuma além do Node**, ele roda antes do `npm install`, que é
 *    justamente uma das coisas que ele faz. Por isso é `.mjs` e não `.ts`: `tsx` é
 *    dependência de desenvolvimento e ainda não existe no primeiro clique.
 *
 * ## Tudo o que ele escreve vai também para `Atalhos/iniciar.log`
 *
 * O atalho roda numa máquina que quem mantém o sistema não vê. Quando algo falha lá, a
 * pergunta é "o que apareceu na tela?", e janela de terminal fechada não responde. O
 * registro é refeito a cada clique e guarda a saída inteira — a deste script e a de
 * cada programa que ele chama —, então o arquivo é a resposta. Nada nele contém
 * senha: a URL do banco nunca é impressa, só host e porta.
 *
 * ## Uma janela só, e fechar a janela desliga tudo
 *
 * Servidor e fila são filhos deste processo, com a saída de cada um prefixada. Fechar
 * a janela (ou Ctrl+C) encerra os três: não sobra processo órfão segurando a porta,
 * que é o que faz o segundo clique falhar num lançador comum. A fila pode ser
 * interrompida no meio de um job sem perda — todo job é idempotente e retomável
 * (CLAUDE.md, seção 4), e o próximo arranque o reivindica de novo.
 *
 * ## Clicar de novo com tudo rodando só abre o navegador
 *
 * Antes de qualquer passo pesado, o script procura o sistema na porta preferida e nas
 * seguintes — e confere que é **este** sistema, pelo `application-name` que o layout
 * escreve no `<head>`, e não outro programa na mesma porta.
 *
 * ## Porta ocupada: a próxima livre
 *
 * Pedido do dono, que roda mais de um projeto ao mesmo tempo, e a 3000 é a porta padrão
 * de meio mundo de servidor de desenvolvimento. Com a preferida ocupada (`PORT` do
 * `.env`, ou 3000), o sistema sobe na primeira livre das dezenove seguintes, e a janela
 * diz qual. Por isso o segundo clique procura na faixa inteira: procurar só na preferida,
 * que pode ter vagado desde então, subiria um segundo sistema ao lado do primeiro.
 *
 * ## O que ele faz sozinho, e por isso ninguém mais precisa lembrar
 *
 * - `npm ci` quando falta `node_modules` ou quando o **conteúdo** do lockfile mudou.
 * - `db:migrate` e `db:seed` **a cada arranque**: os dois são idempotentes, rodam em
 *   segundos, e é o que acaba com o "depois do `git pull`, rode `db:migrate`".
 * - `npm run build` só quando o código mudou desde a última montagem (commit do git).
 * - Sobe o banco do Docker quando o `.env` aponta para o banco local e ele não
 *   responde — e abre o Docker Desktop, no Windows, se ele estiver fechado.
 *
 * Versão de uso (`next start`), e não de desenvolvimento (`next dev`): o modo de
 * desenvolvimento compila cada tela na primeira visita, e medimos 34 segundos na
 * primeira abertura de um produto. Para quem só quer usar o sistema, isso é defeito.
 *
 * ## Só neste computador
 *
 * O servidor escuta em `127.0.0.1`, e não em todas as interfaces. O sistema não tem
 * login ainda (pendência 3.3), e escutar em todas as interfaces o deixaria aberto para
 * qualquer aparelho da rede — além de fazer o Firewall do Windows perguntar, no
 * primeiro arranque, se o Node pode receber conexão, que é uma janela que ninguém
 * sabe responder.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// O módulo inteiro, e não `{ parseEnv }`: import com nome que o Node não tem é erro
// **antes** de a primeira linha rodar, e aí um Node antigo veria um SyntaxError em vez
// da frase do passo 1 dizendo qual versão instalar. `parseEnv` existe desde o 20.12.
import * as util from 'node:util';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(RAIZ);

const EH_WINDOWS = process.platform === 'win32';
/** Só este computador. Ver o cabeçalho, "Só neste computador". */
const INTERFACE = '127.0.0.1';
const PASSOS = 7;
const NODE_MINIMO = 22;

/** Quantas portas tentar, a partir da preferida, antes de desistir. */
const PORTAS_A_TENTAR = 20;

/** Marca, dentro de `.next`, de qual commit gerou a versão de uso que está lá. */
const MARCA_DO_BUILD = join('.next', 'commit-do-build.txt');

/** Marca, dentro de `node_modules`, de qual lockfile gerou a instalação que está lá. */
const MARCA_DA_INSTALACAO = join('node_modules', 'lockfile-instalado.txt');

/** O registro do último clique. Ignorado pelo git (`*.log`). */
const REGISTRO = join('Atalhos', 'iniciar.log');

// ─── Saída: tela e registro ─────────────────────────────────────────────────

let registrando = false;

/**
 * Começa o registro do zero, com o que se precisa saber para entender o resto.
 *
 * Pasta sem permissão de escrita não é motivo para não subir o sistema: sem registro,
 * a tela continua mostrando tudo.
 */
function comecarRegistro() {
  try {
    writeFileSync(
      REGISTRO,
      [
        `Registro da inicialização — ${new Date().toLocaleString('pt-BR')}`,
        `Node ${process.versions.node} · ${process.platform} ${process.arch}`,
        `Pasta: ${RAIZ}`,
        '',
      ].join('\n'),
    );
    registrando = true;
  } catch {
    registrando = false;
  }
}

function registrar(texto) {
  if (!registrando) return;
  try {
    appendFileSync(REGISTRO, `${texto}\n`);
  } catch {
    registrando = false;
  }
}

function escrever(texto = '') {
  console.log(texto);
  registrar(texto);
}

function escreverErro(texto = '') {
  console.error(texto);
  registrar(texto);
}

function passo(numero, texto) {
  escrever('');
  escrever(`[${String(numero)}/${String(PASSOS)}] ${texto}`);
}

function aviso(texto) {
  escrever(`      ${texto}`);
}

/**
 * Para com uma frase que diz o que fazer, e não com pilha de erro.
 *
 * Sai por `encerrar`, e não por `process.exit` direto: a última falha possível — o
 * servidor que não responde em dois minutos — acontece com servidor e fila já de pé, e
 * sair sem derrubá-los deixaria a porta presa para o próximo clique.
 */
function falhar(...linhas) {
  escreverErro('');
  for (const linha of linhas) escreverErro(`  ${linha}`);
  escreverErro('');
  if (registrando) escreverErro(`  Tudo o que apareceu aqui está também em ${REGISTRO}.`);
  encerrar(1);
}

// ─── Processos ──────────────────────────────────────────────────────────────

/**
 * Repassa a saída de um processo linha a linha, com um prefixo na frente.
 *
 * Por aqui, e não herdando o terminal, porque é assim que a saída de cada programa
 * chamado entra no registro — e é justamente a mensagem do programa que falhou o que
 * explica a falha.
 */
function repassar(fluxo, prefixo, transformar = (linha) => linha) {
  let resto = '';
  fluxo.setEncoding('utf8');
  fluxo.on('data', (pedaco) => {
    const linhas = (resto + pedaco).split(/\r?\n/);
    resto = linhas.pop() ?? '';
    for (const linha of linhas) {
      if (linha.trim() !== '') escrever(`${prefixo}${transformar(linha)}`);
    }
  });
  fluxo.on('end', () => {
    if (resto.trim() !== '') escrever(`${prefixo}${transformar(resto)}`);
  });
}

/**
 * Roda um programa até o fim, mostrando a saída enquanto roda, e devolve o código.
 *
 * Assíncrono de propósito: `npm ci` e a montagem levam minutos, e um `spawnSync` só
 * mostraria a saída no fim — minutos de tela parada, que é como alguém conclui que
 * travou e fecha a janela.
 */
function rodar(comando, argumentos, { shell = false } = {}) {
  return new Promise((resolver) => {
    const filho = shell
      ? spawn([comando, ...argumentos].join(' '), {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(comando, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
    repassar(filho.stdout, '        ');
    repassar(filho.stderr, '        ');
    filho.on('error', (erro) => {
      escreverErro(`        não consegui rodar ${comando}: ${erro.message}`);
      resolver(1);
    });
    filho.on('close', (codigo) => resolver(codigo ?? 1));
  });
}

/**
 * Roda um comando do npm.
 *
 * No Windows o `npm` é um `.cmd`, e desde o Node 20 um `.cmd` só roda com `shell`. O
 * comando vai como **uma string só**, e não como lista de argumentos: lista com
 * `shell: true` é depreciada no Node 24 (DEP0190). Nenhum argumento aqui vem de fora,
 * então não há o que escapar.
 */
function npm(...argumentos) {
  return rodar('npm', argumentos, { shell: true });
}

/**
 * Os argumentos do Node para rodar TypeScript do projeto.
 *
 * Sem o `--env-file-if-exists=.env` que os scripts do `package.json` usam: os filhos
 * herdam o ambiente deste processo, que já leu o `.env` sem tropeçar no BOM (ver
 * `carregarEnv`). A flag só repetiria a leitura — e só existe a partir do Node 22.9,
 * então exigiria mais do que o 22 que o passo 1 confere.
 */
function comTypeScript(caminho) {
  return ['--import', 'tsx', caminho];
}

/** Roda um script TypeScript do projeto até o fim. */
function scriptDoProjeto(caminho) {
  return rodar(process.execPath, comTypeScript(caminho));
}

function commitAtual() {
  const resultado = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (resultado.error !== undefined || resultado.status !== 0) return null;
  return resultado.stdout.trim();
}

function abrirNavegador(endereco) {
  // `explorer.exe` com URL abre o navegador padrão, e evita o `start` do `cmd` — cujo
  // primeiro argumento entre aspas é o título da janela, não o endereço.
  const [comando, argumentos] = EH_WINDOWS
    ? ['explorer.exe', [endereco]]
    : process.platform === 'darwin'
      ? ['open', [endereco]]
      : ['xdg-open', [endereco]];

  const filho = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });
  // Sem navegador disponível (servidor sem tela, por exemplo) o endereço já está
  // escrito na janela; não é motivo para derrubar o sistema.
  filho.on('error', () => undefined);
  filho.unref();
}

// ─── Configuração ───────────────────────────────────────────────────────────

/**
 * Carrega o `.env` para este processo e para os filhos.
 *
 * Não é `process.loadEnvFile`, por causa de uma armadilha medida: **o Node não remove
 * o BOM** do começo do arquivo. Um `.env` salvo pelo Bloco de Notas como "UTF-8 com
 * BOM" faz a primeira variável ganhar um caractere invisível no nome — se ela for a
 * `DATABASE_URL`, o sistema diz que ela não existe, com ela escrita ali na frente.
 *
 * Variável que já existe no ambiente vence a do arquivo, que é a regra do
 * `--env-file` e do Next: os filhos herdam este ambiente, e o que vale aqui vale lá.
 */
function carregarEnv() {
  let texto = readFileSync('.env', 'utf8');
  if (texto.charCodeAt(0) === 0xfeff) {
    texto = texto.slice(1);
    aviso('O .env foi salvo com BOM (marca invisível no começo do arquivo). Tratei aqui;');
    aviso('se for editar de novo, salve como "UTF-8" sem BOM.');
  }
  for (const [chave, valor] of Object.entries(util.parseEnv(texto))) {
    if (process.env[chave] === undefined) process.env[chave] = valor;
  }
}

/**
 * A porta preferida: `PORT` do `.env` (ou do ambiente), e 3000 sem ela. Ocupada, o
 * sistema usa a próxima livre — ver `varrerPortas`.
 *
 * Lida **depois** do `.env`, e isso já foi defeito: a primeira versão lia a porta ao
 * carregar o script, antes do `.env` existir para ele — e a mensagem de porta ocupada
 * mandava trocar `PORT` no `.env`, onde ela era ignorada.
 */
function lerPorta() {
  const bruta = process.env['PORT'];
  if (bruta === undefined || bruta.trim() === '') return 3000;
  const porta = Number(bruta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    falhar(
      `A variável PORT do .env vale "${bruta}", e isso não é uma porta.`,
      'Use um número como 3001, ou apague a linha para usar a 3000.',
    );
  }
  return porta;
}

// ─── Rede ───────────────────────────────────────────────────────────────────

/** A porta aceita conexão? Não diz se é Postgres, só se há alguém ali. */
function portaAberta(host, porta, milissegundos = 2500) {
  return new Promise((resolver) => {
    const conexao = createConnection({ host, port: porta });
    const terminar = (aberta) => {
      conexao.destroy();
      resolver(aberta);
    };
    conexao.setTimeout(milissegundos, () => terminar(false));
    conexao.once('connect', () => terminar(true));
    conexao.once('error', () => terminar(false));
  });
}

/**
 * Quem está respondendo no endereço do sistema: este sistema, outro programa, ou
 * ninguém.
 *
 * O layout escreve `<meta name="application-name" content="…">` com o nome do sistema
 * vindo do `.env` — é por ele que se sabe que a porta é nossa, sem precisar de rota
 * própria para isso.
 *
 * Pergunta em `127.0.0.1`, o endereço exato em que o servidor escuta, e não em
 * `localhost`: no Windows `localhost` resolve primeiro para o IPv6 (`::1`), onde o
 * servidor não está. A resposta chegaria pela segunda tentativa, mas não precisa
 * depender disso.
 */
async function quemResponde(porta, nomeDoSistema) {
  let resposta;
  try {
    resposta = await fetch(`http://${INTERFACE}:${String(porta)}`, {
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    return 'ninguem';
  }
  const html = await resposta.text().catch(() => '');
  const achado = /<meta name="application-name" content="([^"]*)"/.exec(html);
  if (achado === null) return 'outro';
  return nomeDoSistema === undefined || achado[1] === nomeDoSistema ? 'nosso' : 'outro';
}

function enderecoDa(porta) {
  return `http://localhost:${String(porta)}`;
}

/**
 * Dá para escutar nesta porta? Pergunta abrindo e fechando um servidor nela.
 *
 * É a única resposta definitiva: porta reservada pelo Windows (Hyper-V e WSL reservam
 * faixas inteiras) não tem ninguém atendendo, e mesmo assim não aceita servidor.
 */
function consigoEscutar(porta) {
  return new Promise((resolver) => {
    const servidor = createServer();
    servidor.once('error', () => resolver(false));
    servidor.listen(porta, INTERFACE, () => servidor.close(() => resolver(true)));
  });
}

/**
 * O que há numa porta: `nosso` (este sistema), `outro` (qualquer outro programa) ou
 * `livre`. Três perguntas, cada uma pegando o que a anterior deixa passar:
 *
 * 1. Alguém atende em `127.0.0.1`? Então é nosso ou de outro, pelo `<head>` — e quem
 *    atende sem falar HTTP é de outro.
 * 2. Alguém atende em `::1`? O navegador abre `localhost`, que no Windows tenta o IPv6
 *    primeiro, e servidor de desenvolvimento que escuta em `localhost` costuma ficar só
 *    ali. Subir nessa porta levaria o navegador ao outro projeto, e não a este.
 * 3. Dá para escutar nela? Ver `consigoEscutar`.
 */
async function estadoDaPorta(porta, nomeDoSistema) {
  if (await portaAberta(INTERFACE, porta, 1500)) {
    return (await quemResponde(porta, nomeDoSistema)) === 'nosso' ? 'nosso' : 'outro';
  }
  if (await portaAberta('::1', porta, 1500)) return 'outro';
  return (await consigoEscutar(porta)) ? 'livre' : 'outro';
}

/**
 * A porta preferida e as seguintes, cada uma com o seu estado, em ordem.
 *
 * Todas de uma vez: porta livre responde em milissegundos (conexão recusada), e só
 * programa que aceita conexão e fica mudo gasta o tempo-limite — uma vez, e não uma por
 * porta.
 */
async function varrerPortas(preferida, nomeDoSistema) {
  const portas = [];
  for (let porta = preferida; porta < preferida + PORTAS_A_TENTAR && porta <= 65535; porta += 1) {
    portas.push(porta);
  }
  const estados = await Promise.all(portas.map((porta) => estadoDaPorta(porta, nomeDoSistema)));
  return portas.map((porta, indice) => ({ porta, estado: estados[indice] }));
}

function abrirOQueJaRoda(porta) {
  const endereco = enderecoDa(porta);
  escrever('');
  escrever(`  O sistema já está rodando em outra janela. Abrindo ${endereco} no navegador.`);
  abrirNavegador(endereco);
}

// ─── Banco ──────────────────────────────────────────────────────────────────

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Onde o banco está, **sem** a senha.
 *
 * A URL do banco carrega usuário e senha, e esta janela e o registro guardam tudo que
 * é escrito. Nada aqui imprime a URL inteira — só host e porta.
 */
function lerBanco(url) {
  let analisada;
  try {
    analisada = new URL(url);
  } catch {
    falhar(
      'A DATABASE_URL do .env não é um endereço válido.',
      'Abra o .env e confira a linha DATABASE_URL.',
    );
  }
  const host = analisada.hostname.replace(/^\[|\]$/g, '');
  const porta = Number.parseInt(analisada.port === '' ? '5432' : analisada.port, 10);
  return { host, porta, local: HOSTS_LOCAIS.has(host) };
}

/** `ausente`, `parado` ou `ok` — o Docker está instalado, e o motor dele está de pé? */
function estadoDoDocker() {
  const resultado = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  if (resultado.error !== undefined) return 'ausente';
  return resultado.status === 0 ? 'ok' : 'parado';
}

/**
 * Abre o Docker Desktop, onde isso é possível sem pedir senha.
 *
 * No Windows e no macOS o Docker Desktop é um aplicativo comum; no Linux o motor é um
 * serviço do sistema, e subir serviço pede `sudo` — que um lançador de clique não deve
 * pedir. Lá a mensagem diz o comando.
 */
function abrirDockerDesktop() {
  if (EH_WINDOWS) {
    const programas = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const executavel = join(programas, 'Docker', 'Docker', 'Docker Desktop.exe');
    if (!existsSync(executavel)) return false;
    spawn(executavel, [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

async function esperar(milissegundos) {
  await new Promise((resolver) => setTimeout(resolver, milissegundos));
}

async function garantirBanco() {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    falhar('O .env não tem DATABASE_URL.', 'Abra o .env e preencha a linha DATABASE_URL.');
  }

  const banco = lerBanco(url);
  const onde = `${banco.host}:${String(banco.porta)}`;

  if (await portaAberta(banco.host, banco.porta)) {
    aviso(`Banco respondendo em ${onde}.`);
    return;
  }

  if (!banco.local) {
    falhar(
      `Não consegui falar com o banco em ${onde}.`,
      'O banco está na nuvem: confira se a internet está funcionando e tente de novo.',
    );
  }

  // Banco local que não responde: é o do Docker, e ele está desligado.
  aviso(`O banco local (${onde}) não responde. Subindo o banco do Docker...`);

  let docker = estadoDoDocker();
  if (docker === 'ausente') {
    falhar(
      'O Docker não está instalado, e o .env aponta para um banco local.',
      'Duas saídas: instale o Docker Desktop (https://www.docker.com/products/docker-desktop/),',
      'ou troque a DATABASE_URL do .env pela do seu banco na nuvem (Neon).',
    );
  }

  if (docker === 'parado') {
    if (!abrirDockerDesktop()) {
      falhar(
        'O Docker está instalado, mas desligado.',
        EH_WINDOWS || process.platform === 'darwin'
          ? 'Abra o Docker Desktop, espere ele dizer que está rodando, e clique de novo.'
          : 'Ligue com: sudo systemctl start docker — e clique de novo.',
      );
    }
    aviso('Abrindo o Docker Desktop. Na primeira vez do dia isso leva um ou dois minutos...');
    for (let segundos = 0; segundos < 180 && docker !== 'ok'; segundos += 5) {
      await esperar(5000);
      docker = estadoDoDocker();
    }
    if (docker !== 'ok') {
      falhar(
        'O Docker Desktop não ficou pronto em três minutos.',
        'Abra ele pela mão, espere dizer que está rodando, e clique de novo.',
      );
    }
  }

  // `--wait` espera o healthcheck do `compose.yaml` passar: sem ele, a migração logo
  // em seguida falha com "connection refused", porque o contêiner existe alguns
  // segundos antes de o Postgres aceitar conexão.
  if ((await rodar('docker', ['compose', 'up', '-d', '--wait'])) !== 0) {
    falhar('O banco do Docker não subiu. A mensagem do Docker está logo acima.');
  }

  if (!(await portaAberta(banco.host, banco.porta))) {
    // A armadilha mais provável: o `compose.yaml` publica a 5432, e o `.env` aponta
    // para outra porta (a 5433 é a sugestão para quem já tem Postgres na 5432).
    falhar(
      `O banco do Docker subiu, mas nada responde em ${onde}.`,
      'O compose.yaml publica o banco na porta 5432. Confira se a porta da DATABASE_URL',
      'no .env é a mesma — ou troque a porta no compose.yaml.',
    );
  }
  aviso(`Banco do Docker respondendo em ${onde}.`);
}

// ─── Passos que decidem sozinhos se precisam rodar ──────────────────────────

function hashDoLockfile() {
  return createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
}

/**
 * Por que instalar as dependências agora, ou `null` se não precisa.
 *
 * Compara o **conteúdo** do lockfile com o da última instalação, e não o horário. A
 * primeira versão comparava horário de arquivo e reinstalava sem precisar: o git dá
 * ao arquivo o horário do checkout, e checkout sem mudança de dependência também conta.
 */
function motivoParaInstalar() {
  if (!existsSync('node_modules')) return 'as dependências ainda não foram instaladas';
  if (!existsSync(MARCA_DA_INSTALACAO)) return 'não há registro de qual lista foi instalada';
  const instalado = readFileSync(MARCA_DA_INSTALACAO, 'utf8').trim();
  return instalado === hashDoLockfile() ? null : 'a lista de dependências mudou';
}

/** Por que montar a versão de uso agora, ou `null` se a que existe serve. */
function motivoParaMontar() {
  if (!existsSync(join('.next', 'BUILD_ID'))) return 'ainda não há versão de uso montada';
  const commit = commitAtual();
  // Sem git — projeto baixado como ZIP — não há como saber se o código mudou; a
  // versão que existe é usada, e apagar a pasta `.next` força montar de novo.
  if (commit === null) return null;
  const anterior = existsSync(MARCA_DO_BUILD) ? readFileSync(MARCA_DO_BUILD, 'utf8').trim() : '';
  return anterior === commit ? null : 'o código mudou desde a última montagem';
}

// ─── Servidor e fila ────────────────────────────────────────────────────────

/**
 * Linha de log da fila em forma de gente.
 *
 * A fila escreve log em JSON, uma linha por evento — ótimo para máquina, ilegível para
 * quem está olhando a janela. Linha de JSON com `evento` vira `hora evento motivo`; o
 * resto passa como veio.
 */
function legivel(linha) {
  if (!linha.startsWith('{')) return linha;
  try {
    const registro = JSON.parse(linha);
    if (typeof registro.evento !== 'string') return linha;
    const hora =
      typeof registro.t === 'string' ? new Date(registro.t).toLocaleTimeString('pt-BR') : '';
    const motivo = typeof registro.motivo === 'string' ? ` — ${registro.motivo}` : '';
    return `${hora} ${registro.evento}${motivo}`.trim();
  } catch {
    return linha;
  }
}

const filhos = [];
let encerrando = false;

function encerrar(codigo) {
  encerrando = true;
  for (const filho of filhos) {
    if (filho.exitCode === null) filho.kill();
  }
  process.exit(codigo);
}

function iniciarFilho(rotulo, argumentos) {
  const filho = spawn(process.execPath, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
  repassar(filho.stdout, `${rotulo} `, legivel);
  repassar(filho.stderr, `${rotulo} `, legivel);
  filho.on('exit', (codigo) => {
    if (encerrando) return;
    // Um dos dois caiu: o sistema pela metade é pior que parado, porque parece
    // funcionar. Derruba o outro e diz qual caiu.
    escreverErro('');
    escreverErro(`  ${rotulo} parou (código ${String(codigo)}). Desligando o resto.`);
    escreverErro('  A mensagem que explica está logo acima, e também em ' + REGISTRO + '.');
    encerrar(1);
  });
  filhos.push(filho);
  return filho;
}

// ─── O roteiro ──────────────────────────────────────────────────────────────

async function principal() {
  comecarRegistro();

  passo(1, 'Conferindo o Node...');
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major < NODE_MINIMO) {
    falhar(
      `Este sistema precisa do Node ${String(NODE_MINIMO)} ou mais novo, e o instalado é o ${process.versions.node}.`,
      'Baixe a versão LTS em https://nodejs.org, instale, e clique de novo.',
    );
  }
  aviso(`Node ${process.versions.node}.`);

  passo(2, 'Conferindo a configuração (.env)...');
  if (!existsSync('.env')) {
    aviso('Não há .env ainda. Criando a partir do .env.example, com a chave mestra gerada...');
    if ((await rodar(process.execPath, [join('scripts', 'preparar-env.mjs')])) !== 0) {
      falhar('Não consegui criar o .env. A mensagem está logo acima.');
    }
    aviso('O .env novo aponta para o banco local do Docker. Se o seu banco é o da nuvem,');
    aviso('troque a linha DATABASE_URL do .env e clique de novo.');
  }
  carregarEnv();
  aviso('Lida.');

  const preferida = lerPorta();
  const nomeDoSistema = process.env['BANCADA_NOME_SISTEMA'];
  if (nomeDoSistema !== undefined) process.title = nomeDoSistema;

  // Antes de qualquer passo pesado: se já está rodando — na preferida ou numa das
  // seguintes —, só abre o navegador.
  const jaRodando = (await varrerPortas(preferida, nomeDoSistema)).find(
    (item) => item.estado === 'nosso',
  );
  if (jaRodando !== undefined) {
    abrirOQueJaRoda(jaRodando.porta);
    return;
  }

  passo(3, 'Conferindo o banco de dados...');
  await garantirBanco();

  passo(4, 'Conferindo as dependências...');
  const instalar = motivoParaInstalar();
  if (instalar === null) {
    aviso('Instaladas e em dia.');
  } else {
    aviso(`Instalando: ${instalar}. Na primeira vez leva alguns minutos...`);
    // Sem auditoria, sem pedido de patrocínio e só com erro: os avisos de pacote
    // depreciado são sobre dependência de dependência, ninguém aqui age sobre eles, e
    // oito linhas amarelas na primeira execução parecem que algo deu errado.
    if ((await npm('ci', '--no-audit', '--no-fund', '--loglevel=error')) !== 0) {
      falhar('A instalação das dependências falhou. A mensagem está logo acima.');
    }
    writeFileSync(MARCA_DA_INSTALACAO, `${hashDoLockfile()}\n`);
  }

  passo(5, 'Atualizando o banco (migrações e perfil inicial)...');
  if ((await scriptDoProjeto(join('src', 'infra', 'banco', 'migrar.ts'))) !== 0) {
    falhar('As migrações falharam. A mensagem está logo acima.');
  }
  if ((await scriptDoProjeto(join('src', 'infra', 'banco', 'semear.ts'))) !== 0) {
    falhar('A criação do perfil inicial falhou. A mensagem está logo acima.');
  }

  passo(6, 'Conferindo a versão de uso...');
  const montar = motivoParaMontar();
  if (montar === null) {
    aviso('Montada e em dia com o código.');
  } else {
    aviso(`Montando: ${montar}. Leva um ou dois minutos...`);
    if ((await npm('run', 'build')) !== 0) {
      falhar('A montagem falhou. A mensagem está logo acima.');
    }
    const commit = commitAtual();
    if (commit !== null) writeFileSync(MARCA_DO_BUILD, `${commit}\n`);
  }

  passo(7, 'Subindo o servidor e a fila...');
  // A porta é escolhida aqui, e não no passo 2: entre um e outro podem passar minutos
  // de instalação e montagem, tempo de sobra para outro programa ocupar a porta.
  const varredura = await varrerPortas(preferida, nomeDoSistema);
  const subiuEmOutraJanela = varredura.find((item) => item.estado === 'nosso');
  if (subiuEmOutraJanela !== undefined) {
    abrirOQueJaRoda(subiuEmOutraJanela.porta);
    return;
  }
  const livre = varredura.find((item) => item.estado === 'livre');
  if (livre === undefined) {
    const ultima = preferida + varredura.length - 1;
    falhar(
      `As portas de ${String(preferida)} a ${String(ultima)} estão todas ocupadas por outros programas.`,
      'Feche algum deles, ou comece de outra porta com a variável PORT no .env (por exemplo, PORT=4000).',
    );
  }
  const porta = livre.porta;
  if (porta === preferida + 1) {
    aviso(
      `A porta ${String(preferida)} está ocupada por outro programa. Usando a ${String(porta)}.`,
    );
  } else if (porta > preferida) {
    aviso(
      `As portas de ${String(preferida)} a ${String(porta - 1)} estão ocupadas por outros programas. Usando a ${String(porta)}.`,
    );
  }
  const endereco = enderecoDa(porta);
  if (nomeDoSistema !== undefined) process.title = `${nomeDoSistema} — ${endereco}`;

  const servidor = iniciarFilho('[servidor]', [
    join('node_modules', 'next', 'dist', 'bin', 'next'),
    'start',
    '-p',
    String(porta),
    '-H',
    INTERFACE,
  ]);
  iniciarFilho('[fila]', comTypeScript(join('scripts', 'poller.ts')));

  process.on('SIGINT', () => {
    escrever('');
    escrever('  Desligando...');
    encerrar(0);
  });
  process.on('SIGTERM', () => encerrar(0));
  // No Windows, fechar a janela chega ao Node como SIGHUP.
  process.on('SIGHUP', () => encerrar(0));

  for (let segundos = 0; segundos < 120; segundos += 1) {
    if (servidor.exitCode !== null) return;
    if ((await quemResponde(porta, nomeDoSistema)) === 'nosso') {
      escrever('');
      escrever('  ─────────────────────────────────────────────────────────');
      escrever(`   Pronto: ${endereco}`);
      escrever('   Primeira vez? Clique em "Criar conta": a primeira conta não pede');
      escrever('   código (se o .env tiver CADASTRO_CODIGO, a tela pede esse código).');
      escrever('   Para desligar, feche esta janela.');
      escrever('  ─────────────────────────────────────────────────────────');
      escrever('');
      abrirNavegador(endereco);
      return;
    }
    await esperar(1000);
  }
  falhar(
    `O servidor não respondeu em dois minutos em ${endereco}.`,
    'A saída do [servidor] logo acima diz por quê.',
  );
}

// Erro que ninguém previu também sai na tela e no registro, com a pilha — é a
// informação que falta quando alguém diz "a janela fechou e não aconteceu nada".
try {
  await principal();
} catch (erro) {
  escreverErro('');
  escreverErro('  Erro inesperado no lançador:');
  escreverErro(`  ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`);
  escreverErro('');
  if (registrando) escreverErro(`  Mande o arquivo ${REGISTRO} para quem mantém o sistema.`);
  encerrar(1);
}
