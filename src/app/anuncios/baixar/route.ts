/**
 * A rota que devolve o arquivo de importação (M9 — 8.11).
 *
 * Primeira rota de API do projeto, e a convenção que ela abre: **rota só existe
 * quando a resposta não é HTML.** Tudo o mais é página ou ação de servidor. Aqui a
 * resposta é um arquivo, com nome e tipo próprios, então não há página que sirva.
 *
 * ## Monta o mesmo anúncio que a tela mostrou
 *
 * Recebe os mesmos parâmetros da página, e chama a mesma função de montagem com o
 * mesmo `lerParametros`. Não há caminho por onde o arquivo sair diferente do que a
 * tela exibiu — que seria o defeito mais caro possível nesta tela, porque ninguém
 * confere um CSV de vinte colunas antes de subir.
 *
 * ## Recusa o que a plataforma recusaria
 *
 * Anúncio com atributo de nível `bloqueia` faltando não gera arquivo: devolve 409 e
 * diz o que falta. Gerar assim seria entregar um arquivo que a importação rejeita —
 * o sistema gastaria a confiança de quem subiu para descobrir sozinho o que ele já
 * sabia. A tela, pelo mesmo motivo, só mostra o link quando o arquivo sai.
 */
import { lerAmbiente } from '@/config/ambiente';
import { montarAnuncio } from '@/dominio/anuncios/anuncio';
import { RepositorioDeAnuncios } from '@/dominio/anuncios/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { registroPadrao } from '@/plataformas/registro';
import { lerParametros } from '../parametros';
import { rotuloDoAtributo } from '../apresentacao';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'rota_de_arquivo_de_anuncio' },
});

/** Texto puro, porque quem lê isto é uma pessoa que clicou num link. */
function recusa(mensagem: string, status: number): Response {
  return new Response(`${mensagem}\n`, {
    status,
    headers: { 'content-type': 'text/plain;charset=utf-8' },
  });
}

export async function GET(pedido: Request): Promise<Response> {
  const busca = new URL(pedido.url).searchParams;
  const leitura = lerParametros(Object.fromEntries(busca.entries()));

  if (leitura.tipo === 'ausente') {
    return recusa('Falta escolher o produto, a plataforma e o preço.', 400);
  }
  if (leitura.tipo === 'invalido') {
    return recusa(`Parâmetros que não dá para usar: ${leitura.campos.join(', ')}.`, 400);
  }

  const parametros = leitura.parametros;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const dados = await new RepositorioDeAnuncios(db).dadosDoSku(perfil.id, parametros.skuId);

  if (dados === null) return recusa('Esse produto não está neste perfil.', 404);

  const montado = montarAnuncio(
    {
      tipoProduto: parametros.tipoProduto ?? dados.tipoProduto,
      marca: dados.marca,
      modeloPeca: dados.modeloPeca,
      quantidadeEmbalagem: dados.quantidadeEmbalagem,
      ean: dados.ean,
      categoria: dados.categoria,
      pesoGramas: dados.pesoGramas,
      dimensoesMm: dados.dimensoesMm,
      ficha: dados.ficha,
    },
    {
      plataforma: parametros.plataforma,
      preco: parametros.preco,
      quantidade: parametros.quantidade,
    },
  );

  if (!montado.conferencia.podeExportar) {
    const faltando = montado.conferencia.bloqueiam.map((i) => rotuloDoAtributo(i.atributo));
    return recusa(
      `A importação recusaria este anúncio: falta ${faltando.join(', ')}. ` +
        'Preencha no catálogo e monte de novo.',
      409,
    );
  }

  // `exportarParaImportacao` é a única capacidade suportada por contrato em todo
  // adaptador (ADR 0002), então não há `NaoSuportado` a tratar aqui. Sem credencial
  // nenhuma: gerar arquivo não depende de plataforma conectada, e é o ponto.
  const adaptador = registroPadrao({ plataformasComCredencial: [] }).de(parametros.plataforma);
  const arquivo = await adaptador.exportarParaImportacao([montado.anuncio]);

  log.info('anuncio.arquivo_gerado', {
    skuId: parametros.skuId,
    plataforma: parametros.plataforma,
    bytes: arquivo.conteudo.byteLength,
  });

  return new Response(new Uint8Array(arquivo.conteudo), {
    headers: {
      'content-type': arquivo.tipoMime,
      // `attachment` com nome: sem isto o navegador abre o CSV como texto, e a
      // pessoa perde o arquivo que ela precisa subir na plataforma.
      'content-disposition': `attachment; filename="${arquivo.nome}"`,
      // A instrução de onde subir viaja junto, em cabeçalho, para não poluir o CSV
      // com uma linha que a importação não entenderia. A tela também a mostra.
      'x-instrucao': encodeURIComponent(arquivo.instrucao),
      'cache-control': 'no-store',
    },
  });
}
