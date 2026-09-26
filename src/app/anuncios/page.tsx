/**
 * Tela de anúncio (M9 — 8.11): montar, revisar os avisos, baixar o arquivo.
 *
 * É a tela que faltava para o gerador de anúncio existir fora do código. O caminho
 * padrão de publicação é **arquivo de importação, não chamada de API** (ADR 0002), e
 * esta tela é a ponta desse caminho.
 *
 * ## A montagem mora na URL
 *
 * Formulário GET, não ação de servidor. A escolha vira query string, e daí saem três
 * coisas de graça: o link é compartilhável, o botão de voltar do navegador funciona,
 * e a rota que devolve o arquivo monta **o mesmo anúncio** que a tela mostrou, porque
 * recebe os mesmos parâmetros. Com estado de sessão, "o arquivo saiu diferente da
 * tela" seria um bug possível; assim não é.
 *
 * ## A tela não decide preço
 *
 * O preço é campo, e vem de fora. Misturar montagem de anúncio com cálculo de preço
 * faria um gerador capaz de publicar com margem negativa — a decisão de preço é do
 * M8, com a tabela de taxas e o regime fiscal, e não cabe num campo de formulário.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { montarAnuncio } from '@/dominio/anuncios/anuncio';
import { avaliarCatalogoML } from '@/dominio/anuncios/catalogo';
import { RepositorioDeAnuncios } from '@/dominio/anuncios/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { ehPlataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { registroPadrao } from '@/plataformas/registro';
import { PublicarEm } from './publicar-em';
import { avisoDeCamposInvalidos, descreverAviso, outrasLojas } from './apresentacao';
import {
  AvisoDaAcao,
  Catalogo,
  Checklist,
  ConsertarCategoria,
  Ficha,
  Formulario,
  Resultado,
  VALORES_PADRAO,
  linkDoArquivo,
  type ValoresDoFormulario,
} from './componentes';
import { CAMINHO, LIMITE_DE_CANDIDATOS } from './constantes';
import { comoQueryString, lerParametros } from './parametros';
import estilo from './anuncios.module.css';

export const metadata: Metadata = { title: 'Anúncio' };

function primeiroParametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** Sempre dinâmica: monta a partir do banco e da query string. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeAnuncios({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDeAnuncios(db);

  const candidatos = await repo.candidatos(perfil.id, LIMITE_DE_CANDIDATOS);
  const leitura = lerParametros(parametros);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  let aviso = descreverAviso(codigo);
  // Produto e loja sem preço é o link da área da loja (ADR 0009): o formulário abre
  // preenchido, e o preço fica para a pessoa — não é erro, é o passo que falta.
  const precoNaoVeio = primeiroParametro(parametros['preco']) === undefined;
  const soFaltaOPreco =
    leitura.tipo === 'invalido' && precoNaoVeio && leitura.campos.every((c) => c === 'preco');
  if (leitura.tipo === 'invalido' && !soFaltaOPreco) {
    aviso = avisoDeCamposInvalidos(leitura.campos);
  }

  const dados =
    leitura.tipo === 'ok' ? await repo.dadosDoSku(perfil.id, leitura.parametros.skuId) : null;

  if (leitura.tipo === 'ok' && dados === null) {
    aviso = descreverAviso('sku_inexistente');
  }

  const montado =
    leitura.tipo === 'ok' && dados !== null
      ? montarAnuncio(
          {
            // O que a pessoa digitou vence o que foi extraído: ela está vendo a tela e
            // o extrator não.
            tipoProduto: leitura.parametros.tipoProduto ?? dados.tipoProduto,
            marca: dados.marca,
            modeloPeca: dados.modeloPeca,
            quantidadeEmbalagem: dados.quantidadeEmbalagem,
            ean: dados.ean,
            categoria: dados.categoria,
            pesoGramas: dados.pesoGramas,
            dimensoesMm: dados.dimensoesMm,
            voltagem: dados.voltagem,
            medida: dados.medida,
            ficha: dados.ficha,
            // O alerta de categoria regulada (M12 — 9.6) depende destes dois, e antes
            // nenhum chegava aqui: ele decidia sempre sobre `null`.
            tituloInterno: dados.tituloInterno,
            categoriaRegulada: dados.categoriaRegulada,
          },
          {
            plataforma: leitura.parametros.plataforma,
            preco: leitura.parametros.preco,
            quantidade: leitura.parametros.quantidade,
          },
        )
      : null;

  const catalogo = dados === null ? null : avaliarCatalogoML(dados.ocorrencias);

  // A instrução de onde subir vem do adaptador, e só existe junto do arquivo. Gerar
  // um CSV de uma linha para ler a instrução é barato, e tem um efeito colateral bom:
  // se a exportação quebrasse, quebraria aqui, na tela, e não na mão de quem clicou.
  const instrucao =
    montado !== null && montado.conferencia.podeExportar && leitura.tipo === 'ok'
      ? (
          await registroPadrao({ plataformasComCredencial: [] })
            .de(leitura.parametros.plataforma)
            .exportarParaImportacao([montado.anuncio])
        ).instrucao
      : null;

  const skuPedido = primeiroParametro(parametros['sku']);
  const plataformaPedida = primeiroParametro(parametros['plataforma']);
  const valores: ValoresDoFormulario =
    leitura.tipo === 'ok'
      ? {
          skuId: leitura.parametros.skuId,
          plataforma: leitura.parametros.plataforma,
          preco: leitura.parametros.precoComoTexto,
          quantidade: leitura.parametros.quantidade,
          tipoProduto: leitura.parametros.tipoProduto ?? dados?.tipoProduto ?? '',
        }
      : {
          ...VALORES_PADRAO,
          // Só pré-seleciona produto que está na lista de escolha: id que não está nela
          // viria de URL digitada, e selecionaria nada com cara de algo.
          ...(candidatos.some((c) => c.id === skuPedido) ? { skuId: skuPedido ?? null } : {}),
          ...(ehPlataforma(plataformaPedida) ? { plataforma: plataformaPedida } : {}),
        };

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Montar anúncio</h1>
        <p className={estilo.subtitulo}>
          Título com os códigos de modelo que o comprador busca, descrição com a tabela de onde
          serve, e o arquivo de importação da plataforma. O preço vem de fora: quem decide preço é a
          precificação, não o gerador de anúncio.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <Formulario candidatos={candidatos} valores={valores} />

      {montado !== null && leitura.tipo === 'ok' && (
        <>
          <section aria-labelledby="anuncio-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="anuncio-titulo">
              O anúncio
            </h2>
            <Resultado
              instrucao={instrucao}
              linkDoArquivo={linkDoArquivo(comoQueryString(leitura.parametros))}
              montado={montado}
              preco={leitura.parametros.preco}
            />
          </section>

          <section aria-labelledby="outras-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="outras-titulo">
              Montar também para
            </h2>
            <PublicarEm lojas={outrasLojas(leitura.parametros)} />
          </section>

          <section aria-labelledby="checklist-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="checklist-titulo">
              Checklist de atributos
            </h2>
            <Checklist conferencia={montado.conferencia} />
            {montado.conferencia.bloqueiam.some((i) => i.atributo === 'categoria') && (
              <ConsertarCategoria
                skuId={leitura.parametros.skuId}
                voltarPara={`${CAMINHO}?${comoQueryString(leitura.parametros)}`}
              />
            )}
          </section>

          <section aria-labelledby="onde-serve-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="onde-serve-titulo">
              Onde serve
            </h2>
            {dados !== null && <Ficha ficha={dados.ficha} />}
          </section>

          <section aria-labelledby="catalogo-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="catalogo-titulo">
              Catálogo do Mercado Livre
            </h2>
            {catalogo !== null && <Catalogo avaliacao={catalogo} />}
          </section>
        </>
      )}
    </main>
  );
}
