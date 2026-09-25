/**
 * Sobe o sistema inteiro num contêiner só: o Render gratuito (ADR 0013).
 *
 * No servidor próprio (`servidor/compose.yaml`), migração, site e fila são contêineres
 * separados, e a publicação os orquestra. No Render gratuito há um serviço só, então
 * este processo faz o papel da composição:
 *
 *   1. migra o banco — e, se a migração falha, a versão nova não sobe, e o Render
 *      mantém a anterior no ar;
 *   2. semeia o primeiro perfil (só faz algo na primeira vez);
 *   3. sobe o site e a fila, cada um no seu processo, com teto de memória: a máquina
 *      gratuita tem 512 MB para os dois;
 *   4. repassa o pedido de parar aos dois, e espera a fila terminar o item em curso.
 *
 * Se um dos dois cai sozinho, derruba o outro e sai com erro: o Render sobe tudo de
 * novo, e a fila retoma o que estava fazendo (todo job é retomável).
 *
 * É o comando padrão da imagem (`Dockerfile`), empacotado por `npm run montar:tarefas`.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { prepararAmbienteDoConteiner } from '@/infra/conteiner/ambiente';
import { criarRegistrador } from '@/infra/log';

const log = criarRegistrador();
const ambiente = prepararAmbienteDoConteiner(process.env, new Date());

/** A fila termina o item em curso antes de sair, como no servidor próprio. */
const ESPERA_AO_PARAR_MS = 60_000;

interface Processo {
  readonly filho: ChildProcess;
  /** O código de saída; morto por sinal conta como 1. */
  readonly fim: Promise<number>;
}

/**
 * O fim é escutado no instante em que o processo nasce. Escutar depois perde o
 * evento de quem já morreu — foi o que o ensaio pegou: o site derrubado à força, a
 * promessa que nunca resolvia, e o contêiner saindo com 0, como se tivesse parado
 * por pedido.
 */
function rodar(nome: string, argumentos: readonly string[]): Processo {
  const filho = spawn(process.execPath, argumentos, { env: ambiente, stdio: 'inherit' });
  const fim = new Promise<number>((pronto) => {
    filho.once('exit', (codigo) => pronto(codigo ?? 1));
    filho.once('error', () => pronto(1));
  });
  log.info('conteiner.subiu', { processo: nome, pid: filho.pid });
  return { filho, fim };
}

async function rodarAteOFim(nome: string, argumentos: readonly string[]): Promise<void> {
  const codigo = await rodar(nome, argumentos).fim;
  if (codigo !== 0) {
    log.erro('conteiner.falhou', { processo: nome, codigo });
    process.exit(1);
  }
}

async function principal(): Promise<void> {
  await rodarAteOFim('migracao', ['tarefas/migrar.mjs']);
  await rodarAteOFim('semente', ['tarefas/semear.mjs']);

  const site = rodar('site', ['--max-old-space-size=256', 'server.js']);
  const fila = rodar('fila', ['--max-old-space-size=192', 'tarefas/poller.mjs']);

  let parando = false;
  const parar = (sinal: NodeJS.Signals) => {
    if (parando) return;
    parando = true;
    site.filho.kill(sinal);
    fila.filho.kill(sinal);
    // Quem não parar a tempo é derrubado: o Render não espera para sempre.
    setTimeout(() => {
      site.filho.kill('SIGKILL');
      fila.filho.kill('SIGKILL');
    }, ESPERA_AO_PARAR_MS).unref();
  };
  process.on('SIGTERM', () => parar('SIGTERM'));
  process.on('SIGINT', () => parar('SIGINT'));

  const primeiro = await Promise.race([
    site.fim.then((codigo) => ({ processo: 'site', codigo })),
    fila.fim.then((codigo) => ({ processo: 'fila', codigo })),
  ]);
  const caiuSozinho = !parando;
  if (caiuSozinho) {
    log.erro('conteiner.caiu', primeiro);
    parar('SIGTERM');
  }
  await Promise.all([site.fim, fila.fim]);
  log.info('conteiner.terminou', { caiuSozinho });
  process.exit(caiuSozinho ? 1 : 0);
}

principal().catch((erro: unknown) => {
  log.erro('conteiner.falhou', { erro: erro instanceof Error ? erro.message : String(erro) });
  process.exit(1);
});
