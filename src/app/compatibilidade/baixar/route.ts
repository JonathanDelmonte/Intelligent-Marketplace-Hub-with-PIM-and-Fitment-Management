/**
 * A rota que devolve a ficha de compatibilidade em planilha (M4 — 6.7).
 *
 * `fichaEmCsv` existia com teste desde a fase 6 e **não tinha botão**: a pendência
 * 3.5 registrava isso, e o que a destravava era a tela de catálogo — sem escolher
 * produto, não havia de qual ficha baixar. Agora há.
 *
 * Segue a convenção que a rota de anúncio abriu: **rota só existe quando a resposta
 * não é HTML**, e ela devolve o mesmo que a tela mostrou, chamando a mesma função de
 * montagem. Não há caminho por onde o arquivo saia diferente da ficha exibida — que
 * seria o defeito mais caro aqui, porque ninguém confere linha por linha um CSV antes
 * de subir, e compatibilidade errada volta como devolução.
 */
import { lerAmbiente } from '@/config/ambiente';
import { fichaEmCsv, montarFicha } from '@/dominio/compatibilidade/ficha';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { nomeDoArquivoDaFicha } from '../apresentacao';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'rota_de_ficha_de_compatibilidade' },
});

/** Texto puro, porque quem lê isto é uma pessoa que clicou num link. */
function recusa(mensagem: string, status: number): Response {
  return new Response(`${mensagem}\n`, {
    status,
    headers: { 'content-type': 'text/plain;charset=utf-8' },
  });
}

export async function GET(pedido: Request): Promise<Response> {
  const skuId = new URL(pedido.url).searchParams.get('sku');
  if (skuId === null || skuId.trim() === '') {
    return recusa('Falta dizer de qual produto é a ficha.', 400);
  }

  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDeCompatibilidade(db);

  // A mesma leitura da tela, com a mesma checagem de perfil: id de outro perfil não
  // baixa ficha, e a resposta não diz se o produto existe em outro lugar.
  const escolha = await repo.skuParaFicha(perfil.id, skuId);
  if (escolha.pedidoInvalido || escolha.escolhido === null) {
    return recusa('Esse produto não está neste perfil.', 404);
  }

  const ficha = montarFicha(await repo.doSku(escolha.escolhido.id));

  if (ficha.publicaveis.length === 0) {
    return recusa(
      'Não há nada publicável na ficha deste produto ainda: o arquivo sairia só com o ' +
        'cabeçalho. Confira as linhas que estão esperando conferência e volte.',
      409,
    );
  }

  const csv = fichaEmCsv(ficha);
  log.info('compatibilidade.ficha_gerada', {
    skuId: escolha.escolhido.id,
    linhas: ficha.publicaveis.length,
  });

  return new Response(csv, {
    headers: {
      // `charset=utf-8` declarado: a ficha tem acento em marca e em tipo de aparelho.
      'content-type': 'text/csv;charset=utf-8',
      // `attachment` com nome, senão o navegador abre o CSV como texto e a pessoa
      // perde o arquivo que ela precisa subir.
      'content-disposition': `attachment; filename="${nomeDoArquivoDaFicha(escolha.escolhido.titulo)}"`,
      'cache-control': 'no-store',
    },
  });
}
