#!/usr/bin/env node
/**
 * Sobe o sistema no localhost com um clique: banco, dependências, migrações, versão
 * de uso, servidor e fila — e abre o navegador quando o servidor responde.
 *
 * É o que `Atalhos/Iniciar.bat` chama. A lógica mora aqui, em Node, e não no `.bat`,
 * por três motivos:
 *
 * 1. Batch de Windows quebra por detalhe invisível: quebra de linha LF em vez de CRLF
 *    faz `goto` errar o rótulo, e acento sem `chcp` vira lixo. Node não tem nenhum
 *    dos dois problemas, e o `.bat` fica com dez linhas.
 * 2. O mesmo script roda em macOS e Linux sem mudança — `node scripts/iniciar.mjs`. O
 *    `.bat` é só a porta do Windows.
 * 3. **Sem dependência nenhuma além do Node**, ele roda antes do `npm install`, que é
 *    justamente uma das coisas que ele faz. Por isso é `.mjs` e não `.ts`: `tsx` é
 *    dependência de desenvolvimento e ainda não existe no primeiro clique.
 *
 * ## Uma janela só, e fechar a janela desliga tudo
 *
 * Servidor e fila são filhos deste processo, com a saída de cada um prefixada.
 * Fechar a janela (ou Ctrl+C) encerra os três: não sobra processo órfão segurando a
 * porta, que é o que faz o segundo clique falhar num lançador comum. A fila pode ser
 * interrompida no meio de um job sem perda — todo job é idempotente e retomável
 * (CLAUDE.md, seção 4), e o próximo arranque o reivindica de novo.
 *
 * ## Clicar de novo com tudo rodando só abre o navegador
 *
 * Antes de qualquer passo pesado, o script pergunta à porta se o sistema já está ali —
 * e confere que é **este** sistema, pelo `application-name` que o layout escreve no
 * `<head>`. Porta ocupada por outro programa é erro com nome, não navegador aberto na
 * coisa errada.
 *
 * ## O que ele faz sozinho, e por isso ninguém mais precisa lembrar
 *
 * - `npm ci` quando falta `node_modules` ou quando a lista de dependências mudou.
 * - `db:migrate` e `db:seed` **a cada arranque**: os dois são idempotentes, rodam em
 *   segundos, e é o que acaba com o "depois do `git pull`, rode `db:migrate`" — que é a
 *   instrução mais esquecida deste projeto.
 * - `npm run build` só quando o código mudou desde a última montagem (commit do git), e
 *   não a cada clique: a montagem leva um ou dois minutos.
 * - Sobe o banco do Docker quando o `.env` aponta para o banco local e ele não
 *   responde — e abre o Docker Desktop, no Windows, se ele estiver fechado.
 *
 * Versão de uso (`next start`), e não de desenvolvimento (`next dev`): o modo de
 * desenvolvimento compila cada tela na primeira visita, e medimos 34 segundos na
 * primeira abertura de um produto. Para quem só quer usar o sistema, isso é defeito.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(RAIZ);

const EH_WINDOWS = process.platform === 'win32';
const PORTA = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const ENDERECO = `http://localhost:${String(PORTA)}`;
const PASSOS = 7;
const NODE_MINIMO = 22;

/** Marca, dentro de `.next`, de qual commit gerou a versão de uso que está lá. */
const MARCA_DO_BUILD = join('.next', 'commit-do-build.txt');

/** Marca, dentro de `node_modules`, de qual lockfile gerou a instalação que está lá. */
const MARCA_DA_INSTALACAO = join('node_modules', 'lockfile-instalado.txt');

// ─── Saída ──────────────────────────────────────────────────────────────────

function passo(numero, texto) {
  console.log('');
  console.log(`[${String(numero)}/${String(PASSOS)}] ${texto}`);
}

function aviso(texto) {
  console.log(`      ${texto}`);
}

/** Para com uma frase que diz o que fazer, e não com pilha de erro. */
function falhar(...linhas) {
  console.error('');
  for (const linha of linhas) console.error(`  ${linha}`);
  console.error('');
  process.exit(1);
}

// ─── Processos ──────────────────────────────────────────────────────────────

/**
 * Roda um comando do npm e devolve o código de saída.
 *
 * No Windows o `npm` é um `.cmd`, e desde o Node 20 um `.cmd` só roda com `shell`. O
 * comando vai como **uma string só**, e não como lista de argumentos: lista com
 * `shell: true` é depreciada no Node 24 (DEP0190). Nenhum argumento aqui vem de fora,
 * então não há o que escapar.
 */
function npm(...argumentos) {
  const comando = ['npm', ...argumentos].join(' ');
  const resultado = spawnSync(comando, { shell: true, stdio: 'inherit' });
  return resultado.status ?? 1;
}

/** Roda um script TypeScript do projeto com o `.env` carregado, como os do `package.json`. */
function scriptDoProjeto(caminho) {
  const resultado = spawnSync(
    process.execPath,
    ['--env-file-if-exists=.env', '--import', 'tsx', caminho],
    { stdio: 'inherit' },
  );
  return resultado.status ?? 1;
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
 */
async function quemResponde(nomeDoSistema) {
  let resposta;
  try {
    resposta = await fetch(ENDERECO, { signal: AbortSignal.timeout(2500) });
  } catch {
    return 'ninguem';
  }
  const html = await resposta.text().catch(() => '');
  const achado = /<meta name="application-name" content="([^"]*)"/.exec(html);
  if (achado === null) return 'outro';
  return nomeDoSistema === undefined || achado[1] === nomeDoSistema ? 'nosso' : 'outro';
}

// ─── Banco ──────────────────────────────────────────────────────────────────

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Onde o banco está, **sem** a senha.
 *
 * A URL do banco carrega usuário e senha, e esta janela mostra tudo que escreve. Nada
 * aqui imprime a URL inteira — só host e porta.
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
  const subiu = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit' });
  if (subiu.status !== 0) {
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
 * ao arquivo o horário do checkout, e checkout sem mudança de dependência também conta
 * — trinta segundos de `npm ci` a troco de nada, logo no teste de primeiro arranque.
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
 * Repassa a saída de um filho para esta janela, com um rótulo na frente.
 *
 * A fila escreve log em JSON, uma linha por evento — ótimo para máquina, ilegível para
 * quem está olhando a janela. Linha de JSON com `evento` vira `hora evento motivo`; o
 * resto passa como veio.
 */
function repassar(fluxo, rotulo) {
  let resto = '';
  fluxo.setEncoding('utf8');
  fluxo.on('data', (pedaco) => {
    const linhas = (resto + pedaco).split(/\r?\n/);
    resto = linhas.pop() ?? '';
    for (const linha of linhas) {
      if (linha.trim() === '') continue;
      console.log(`${rotulo} ${legivel(linha)}`);
    }
  });
}

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
  repassar(filho.stdout, rotulo);
  repassar(filho.stderr, rotulo);
  filho.on('exit', (codigo) => {
    if (encerrando) return;
    // Um dos dois caiu: o sistema pela metade é pior que parado, porque parece
    // funcionar. Derruba o outro e diz qual caiu.
    console.error('');
    console.error(`  ${rotulo} parou (código ${String(codigo)}). Desligando o resto.`);
    console.error(
      '  A mensagem que explica está logo acima. Clique de novo para tentar outra vez.',
    );
    encerrar(1);
  });
  filhos.push(filho);
  return filho;
}

// ─── O roteiro ──────────────────────────────────────────────────────────────

async function principal() {
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
    const criou = spawnSync(process.execPath, [join('scripts', 'preparar-env.mjs')], {
      stdio: 'inherit',
    });
    if (criou.status !== 0) falhar('Não consegui criar o .env. A mensagem está logo acima.');
    aviso('O .env novo aponta para o banco local do Docker. Se o seu banco é o da nuvem,');
    aviso('troque a linha DATABASE_URL do .env e clique de novo.');
  }
  process.loadEnvFile('.env');

  const nomeDoSistema = process.env['BANCADA_NOME_SISTEMA'];
  if (nomeDoSistema !== undefined) process.title = `${nomeDoSistema} — ${ENDERECO}`;

  // Antes de qualquer passo pesado: se já está rodando, só abre o navegador.
  const quem = await quemResponde(nomeDoSistema);
  if (quem === 'nosso') {
    console.log('');
    console.log(`  O sistema já está rodando. Abrindo ${ENDERECO} no navegador.`);
    abrirNavegador(ENDERECO);
    return;
  }
  if (quem === 'outro') {
    falhar(
      `A porta ${String(PORTA)} está ocupada por outro programa.`,
      'Feche o programa que está usando essa porta, ou escolha outra com a variável PORT no .env.',
    );
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
    if (npm('ci', '--no-audit', '--no-fund', '--loglevel=error') !== 0) {
      falhar('A instalação das dependências falhou. A mensagem está logo acima.');
    }
    writeFileSync(MARCA_DA_INSTALACAO, `${hashDoLockfile()}\n`);
  }

  passo(5, 'Atualizando o banco (migrações e perfil inicial)...');
  if (scriptDoProjeto(join('src', 'infra', 'banco', 'migrar.ts')) !== 0) {
    falhar('As migrações falharam. A mensagem está logo acima.');
  }
  if (scriptDoProjeto(join('src', 'infra', 'banco', 'semear.ts')) !== 0) {
    falhar('A criação do perfil inicial falhou. A mensagem está logo acima.');
  }

  passo(6, 'Conferindo a versão de uso...');
  const montar = motivoParaMontar();
  if (montar === null) {
    aviso('Montada e em dia com o código.');
  } else {
    aviso(`Montando: ${montar}. Leva um ou dois minutos...`);
    if (npm('run', 'build') !== 0) falhar('A montagem falhou. A mensagem está logo acima.');
    const commit = commitAtual();
    if (commit !== null) writeFileSync(MARCA_DO_BUILD, `${commit}\n`);
  }

  passo(7, 'Subindo o servidor e a fila...');
  const servidor = iniciarFilho('[servidor]', [
    join('node_modules', 'next', 'dist', 'bin', 'next'),
    'start',
    '-p',
    String(PORTA),
  ]);
  iniciarFilho('[fila]', [
    '--env-file-if-exists=.env',
    '--import',
    'tsx',
    join('scripts', 'poller.ts'),
  ]);

  process.on('SIGINT', () => {
    console.log('');
    console.log('  Desligando...');
    encerrar(0);
  });
  process.on('SIGTERM', () => encerrar(0));

  for (let segundos = 0; segundos < 120; segundos += 1) {
    if (servidor.exitCode !== null) return;
    if ((await quemResponde(nomeDoSistema)) === 'nosso') {
      console.log('');
      console.log('  ─────────────────────────────────────────────────────────');
      console.log(`   Pronto: ${ENDERECO}`);
      console.log('   Para desligar, feche esta janela.');
      console.log('  ─────────────────────────────────────────────────────────');
      console.log('');
      abrirNavegador(ENDERECO);
      return;
    }
    await esperar(1000);
  }
  falhar(
    `O servidor não respondeu em dois minutos em ${ENDERECO}.`,
    'A saída do [servidor] logo acima diz por quê.',
  );
}

await principal();
