/**
 * Ações da tela de jobs.
 *
 * Três, e nenhuma faz trabalho de domínio: cada uma traduz um formulário HTML numa
 * chamada ao orquestrador ou à fila, e volta. A regra que a especificação impõe
 * (nada é descartado) é do orquestrador, não daqui — o que esta camada pode fazer
 * de errado é perder a entrada antes de entregá-la, e é só isso que ela cuida.
 *
 * ## `redirect` lança, e isso muda como o `try` é escrito
 *
 * `redirect()` do Next sinaliza por exceção (`NEXT_REDIRECT`). Um
 * `try { ...; redirect() } catch { }` engoliria o redirecionamento e a tela
 * ficaria parada sem explicação. Por isso **nenhum `redirect` deste arquivo está
 * dentro de `try`**: o trabalho acontece, o resultado vira código, e o
 * redirecionamento é a última linha, fora de qualquer captura.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { entradaDeTextoLivre } from '@/dominio/ingestao/classificador';
import type { Entrada } from '@/dominio/ingestao/classificador';
import { MAX_UPLOAD_BYTES } from '@/config/limites';
import { FilaError } from '@/infra/fila/fila';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { montarNucleo } from '@/infra/montagem';
import type { CodigoDeAviso } from './apresentacao';
// Arquivo com `'use server'` só pode exportar função assíncrona, então constante
// compartilhada mora em `constantes.ts`. Ver o cabeçalho daquele arquivo.
import { CAMINHO, LIMITE_DE_PROCESSAMENTO_MANUAL } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_jobs' },
});

function paraOnde(codigo: CodigoDeAviso, quantidade?: number): string {
  const parametros = new URLSearchParams({ r: codigo });
  if (quantidade !== undefined) parametros.set('n', String(quantidade));
  return `${CAMINHO}?${parametros.toString()}`;
}

/**
 * O campo único: aceita arquivo, link, lista de links ou texto.
 *
 * O arquivo tem precedência sobre o texto porque é o mais específico: quem
 * escolheu um arquivo e deixou texto na caixa quis subir o arquivo.
 */
export async function enviarEntrada(dados: FormData): Promise<void> {
  const nucleo = montarNucleo();

  const arquivo = dados.get('arquivo');
  // Lido uma vez e estreitado: `FormData.get` devolve `string | File`, e chamar
  // duas vezes impediria o compilador de saber que o segundo valor é o testado.
  const campoDeTexto = dados.get('texto');
  const texto = typeof campoDeTexto === 'string' ? campoDeTexto.trim() : '';

  let entrada: Entrada;
  let conteudo: Uint8Array | undefined;

  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > MAX_UPLOAD_BYTES) {
      log.aviso('entrada.arquivo_grande', { nome: arquivo.name, bytes: arquivo.size });
      redirect(paraOnde('grande'));
    }

    conteudo = new Uint8Array(await arquivo.arrayBuffer());
    entrada = {
      tipo: 'arquivo',
      nome: arquivo.name,
      // `exactOptionalPropertyTypes`: campo opcional não recebe `undefined`
      // explícito, e `File.type` vem vazio quando o navegador não sabe o MIME.
      ...(arquivo.type === '' ? {} : { tipoMime: arquivo.type }),
      tamanhoBytes: arquivo.size,
    };
  } else if (texto !== '') {
    entrada = entradaDeTextoLivre(texto);
  } else {
    redirect(paraOnde('sem_entrada'));
  }

  const resultado = await nucleo.orquestrador.receber({
    entrada,
    ...(conteudo === undefined ? {} : { conteudo }),
  });

  log.info('entrada.recebida', {
    resultado: resultado.tipo,
    jobId: resultado.job.id,
    tipoDeEntrada: resultado.classificacao.tipoDeEntrada,
    confiancaBp: resultado.classificacao.confiancaBp,
  });

  revalidatePath(CAMINHO);

  const codigo: CodigoDeAviso =
    resultado.tipo === 'precisa_revisao'
      ? 'revisao'
      : resultado.jaExistia
        ? 'ja_existia'
        : 'enfileirado';

  redirect(paraOnde(codigo));
}

/** Devolve um job à fila, zerando tentativas. Para o que falhou e para o revisado. */
export async function reenfileirar(dados: FormData): Promise<void> {
  const campoDeId = dados.get('id');
  const id = typeof campoDeId === 'string' ? campoDeId : '';
  if (id === '') redirect(paraOnde('job_inexistente'));

  const { fila } = montarNucleo();
  let codigo: CodigoDeAviso = 'reenfileirado';

  try {
    await fila.reenfileirar(id);
    log.info('job.reenfileirado', { jobId: id });
  } catch (erro) {
    // `FilaError` é o "não" previsto da fila: job que não existe, ou que está
    // rodando. Vira aviso na tela. Qualquer outra exceção é defeito, e sobe.
    if (!(erro instanceof FilaError)) throw erro;
    codigo = erro.message.includes('rodando') ? 'job_rodando' : 'job_inexistente';
    log.aviso('job.reenfileirar_recusado', { jobId: id, erro });
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(codigo));
}

/**
 * Roda alguns jobs na hora, sem esperar o poller.
 *
 * Existe por honestidade operacional: a tela não tem como saber se há poller
 * rodando, e sem este botão a única saída seria abrir um terminal. O limite de
 * jobs por clique está em `constantes.ts`, com o motivo.
 */
export async function processarAgora(): Promise<void> {
  const { executor } = montarNucleo();

  const resultados = await executor.processarTodos(LIMITE_DE_PROCESSAMENTO_MANUAL);
  log.info('fila.processada_manualmente', { quantidade: resultados.length });

  revalidatePath(CAMINHO);
  redirect(
    resultados.length === 0
      ? paraOnde('nada_para_processar')
      : paraOnde('processado', resultados.length),
  );
}
