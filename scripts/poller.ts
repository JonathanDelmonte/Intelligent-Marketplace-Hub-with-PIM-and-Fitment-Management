/**
 * Processo que consome a fila.
 *
 * É o que transforma o sistema de "chamável por teste" em "roda sozinho". Sem
 * ele, tudo o que a tela enfileira fica parado esperando alguém pedir.
 *
 * ```sh
 * npm run poller                      # laço contínuo, até Ctrl-C
 * npm run poller -- --uma-vez         # drena a fila e sai (cron, CI, comando)
 * npm run poller -- --limite=5        # cinco tiques e sai
 * npm run poller -- --ocioso=500      # espera 500 ms quando não há trabalho
 * npm run poller -- --nivel=debug     # mostra também os tiques ociosos
 * ```
 *
 * `--uma-vez` é o modo que importa para quem não quer um processo residente:
 * `* * * * * npm run poller -- --uma-vez` num cron faz a mesma coisa que o laço,
 * com um minuto de latência. A fila em tabela com `SKIP LOCKED` permite os dois
 * modos ao mesmo tempo, e mais de um processo de cada, sem job em duplicidade.
 */
// Primeiro de todos: o `.env` tem de estar em `process.env` antes de qualquer
// módulo ler ambiente. Ver o cabeçalho de `carregar-env.ts`.
import { carregarEnv } from '@/config/carregar-env';

import { lerAmbiente } from '@/config/ambiente';

import { encerrarBanco } from '@/infra/banco/cliente';
import { Poller, ligarSinaisDeEncerramento } from '@/infra/fila/poller';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { Registrador } from '@/infra/log';
import { montarNucleo, tarefaDoProcesso } from '@/infra/montagem';
import type { Nucleo } from '@/infra/montagem';

carregarEnv();

const AJUDA = `
Consome a fila de jobs.

  --uma-vez        drena a fila e sai no primeiro tique ocioso
  --limite=N       para depois de N tiques
  --ocioso=MS      espera entre tiques sem trabalho (padrão 2000)
  --ativo=MS       espera entre tiques que trabalharam (padrão 25)
  --nivel=NIVEL    debug | info | aviso | erro (padrão: LOG_NIVEL ou info)
  --ajuda          mostra isto
`.trim();

function texto(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

function presente(nome: string): boolean {
  return process.argv.includes(`--${nome}`);
}

/**
 * Inteiro de argumento, ou erro.
 *
 * Falha ruidosa de propósito: `--ocioso=abc` virando `NaN` daria
 * `setTimeout(NaN)`, que o Node trata como zero — e o poller martelaria o banco
 * num laço fechado, com aparência de estar funcionando.
 */
function inteiro(nome: string): number | undefined {
  const bruto = texto(nome);
  if (bruto === undefined) return undefined;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`--${nome} precisa ser um inteiro não negativo, recebeu "${bruto}"`);
  }
  return valor;
}

/**
 * Relata o estado da fila no arranque. **Nunca derruba o processo.**
 *
 * É diagnóstico, não pré-requisito. Na primeira versão a consulta rodava solta, e
 * um `ECONNREFUSED` no arranque matava o processo com código 1 — enquanto a mesma
 * falha, três linhas depois, dentro do laço, entraria em backoff e se recuperaria
 * sozinha. Duas políticas para a mesma falha, decididas por onde ela acontece.
 *
 * Aconteceu de verdade aqui: o Postgres estava fora, o poller morreu no arranque,
 * e o serviço ficaria dependendo de o supervisor reiniciar — enquanto o próprio
 * poller sabe esperar. Banco que volta em dez segundos não deve custar um
 * reinício.
 */
async function relatarEstadoInicial(nucleo: Nucleo, log: Registrador): Promise<void> {
  try {
    const prontos = await nucleo.fila.quantidadePronta();
    log.info('fila.estado_inicial', { prontos, ...(await nucleo.fila.contagemPorStatus()) });
  } catch (erro) {
    log.aviso('fila.estado_inicial_indisponivel', { erro });
  }
}

async function principal(): Promise<number> {
  if (presente('ajuda') || presente('help')) {
    console.log(AJUDA);
    return 0;
  }

  const log = criarRegistrador({
    nivelMinimo: nivelDoAmbiente(texto('nivel') ?? process.env['LOG_NIVEL']),
  });

  const ambiente = lerAmbiente();
  const nucleo = montarNucleo();
  // A composição das filas mora em `montagem.ts`, com a ordem de prioridade e o motivo.
  // Este script roda a mesma do botão da tela de jobs, mais a limpeza da nuvem no fim.
  const tarefa = tarefaDoProcesso(nucleo, log);

  const limite = inteiro('limite');
  const ocioso = inteiro('ocioso');
  const ativo = inteiro('ativo');

  const poller = new Poller(tarefa, {
    registrador: log,
    pararQuandoOcioso: presente('uma-vez'),
    ...(limite === undefined ? {} : { limiteDeTiques: limite }),
    ...(ocioso === undefined ? {} : { intervaloOciosoMs: ocioso }),
    ...(ativo === undefined ? {} : { intervaloAtivoMs: ativo }),
  });

  const desligarSinais = ligarSinaisDeEncerramento(poller, { registrador: log });

  log.info('processo.iniciou', {
    // O nome do sistema vem de configuração até no log (ADR 0003).
    sistema: ambiente.BANCADA_NOME_SISTEMA,
    armazenamento: nucleo.armazenamento.descricao,
    retencaoDoConteudoDias: nucleo.armazenamento.retencaoDias,
    pid: process.pid,
  });

  try {
    await relatarEstadoInicial(nucleo, log);

    const estatisticas = await poller.iniciar();

    log.info('processo.terminou', {
      tiques: estatisticas.tiques,
      comTrabalho: estatisticas.comTrabalho,
      ociosos: estatisticas.ociosos,
      errosTotais: estatisticas.errosTotais,
    });

    // Erro de infraestrutura não pode sair com código 0: num cron isso
    // silenciaria banco inacessível para sempre.
    return estatisticas.errosTotais > 0 ? 1 : 0;
  } finally {
    desligarSinais();
    await encerrarBanco();
  }
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    // Registrador novo: se a falha foi ao ler o ambiente, o de cima não existe.
    criarRegistrador({ nivelMinimo: 'erro' }).erro('processo.falhou', { erro });
    process.exitCode = 1;
  });
