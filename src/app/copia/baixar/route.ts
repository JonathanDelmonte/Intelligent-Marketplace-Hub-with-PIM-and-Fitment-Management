/**
 * A cópia dos dados, para baixar (ADR 0016).
 *
 * Rota, e não página, pela convenção de `anuncios/baixar`: a resposta é um arquivo. Fica
 * atrás do porteiro como toda rota (ADR 0011): só quem entrou com conta baixa.
 *
 * Sai comprimida enquanto sai. O banco não é juntado na memória — no Render são 512 MB
 * para site e fila —, e cada pedaço que o banco entrega já vai para o navegador. Quem
 * cancela o download encerra a leitura, e a conexão volta ao pool (`gerarCopia`).
 */
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { gerarCopia } from '@/infra/banco/copia';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { nomeDoArquivoDaCopia } from '../apresentacao';

export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'copia_dos_dados' },
});

export function GET(): Response {
  const ambiente = lerAmbiente();
  const agora = new Date();
  const pedacos = gerarCopia(banco(), {
    nomeDoSistema: ambiente.BANCADA_NOME_SISTEMA,
    versao: ambiente.VERSAO ?? null,
    agora,
  })[Symbol.asyncIterator]();

  // Só contagem no log: o conteúdo é dado do negócio, e log não é lugar dele.
  let bytes = 0;
  const texto = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controle) {
      try {
        const lido = await pedacos.next();
        if (lido.done === true) {
          log.info('copia.baixada', { bytes });
          controle.close();
          return;
        }
        bytes += lido.value.byteLength;
        controle.enqueue(new Uint8Array(lido.value));
      } catch (erro) {
        log.erro('copia.falhou', { erro, bytes });
        controle.error(erro);
      }
    },
    async cancel() {
      log.aviso('copia.interrompida', { bytes });
      await pedacos.return(undefined);
    },
  });

  return new Response(texto.pipeThrough(new CompressionStream('gzip')), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${nomeDoArquivoDaCopia(agora)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
