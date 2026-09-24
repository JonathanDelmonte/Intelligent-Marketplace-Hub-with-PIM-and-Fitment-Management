/**
 * Um produto: a ficha e quanto cobrar por ele.
 *
 * É aqui que o M8 finalmente aparece. A fase 1 entregou `calcularMargem`,
 * `simularFaixa`, `precoParaMargem`, os degraus de comissão por plataforma e o aviso de
 * zona morta do Mercado Livre — tudo puro, com teste em cada degrau, e nunca visto por
 * ninguém que não leia código.
 *
 * ## A ordem é a de quem está decidindo o preço
 *
 * Primeiro o custo, porque sem ele o resto é estimativa. Depois o resto da ficha, que é
 * o que tira presunção do cálculo. Depois **quanto cobrar**: o preço mínimo para a
 * margem que a pessoa quer, a faixa que funciona com os degraus marcados, e — quando ela
 * informa um preço — a conta linha por linha. Por último, de onde o produto veio.
 *
 * ## Os parâmetros viajam na URL
 *
 * Plataforma, tipo de anúncio, frete, margem alvo e preço são `searchParams`, e o
 * formulário é `GET`. Sem estado de cliente: recarregar não perde o que se estava
 * olhando, e a URL do cenário é compartilhável — que é o que se quer de uma tela usada
 * para decidir preço com outra pessoa do lado.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { carregarPerfil } from '@/dominio/perfil';
import { entradaParaMargem } from '@/dominio/precificacao/entrada';
import { calcularMargem } from '@/dominio/precificacao/margem';
import { precoParaMargem, simularFaixa } from '@/dominio/precificacao/simulador';
import { banco } from '@/infra/banco/cliente';
import { centavos, pontosBase, reaisParaCentavos } from '@/lib/dinheiro';
import estilo from '../catalogo.module.css';
import {
  descreverAviso,
  lerParametros,
  textoDasPresuncoes,
  textoDoPrecoMinimo,
} from '../apresentacao';
import {
  AvisoDaAcao,
  Decomposicao,
  DesativarProduto,
  Faixas,
  FormularioDaFicha,
  FormularioDeCusto,
  FormularioDoSimulador,
  Ocorrencias,
  Presuncoes,
  ProdutoDesativado,
  ResumoFiscal,
} from '../componentes';
import { CAMINHO, FAIXA_PADRAO, OCORRENCIAS_NA_TELA } from '../constantes';

export const metadata: Metadata = { title: 'Produto' };

export const dynamic = 'force-dynamic';

export default async function PaginaDoProduto({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const busca = await searchParams;

  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDeSku(db);

  const sku = await repo.buscarPorId(perfil.id, id);
  if (sku === null) notFound();

  const agora = new Date();
  const ocorrencias = await repo.ocorrencias(perfil.id, sku.id);
  const parametros = lerParametros(busca);

  const montada = entradaParaMargem({
    ficha: {
      custoAtual: sku.custoAtual === null ? null : centavos(sku.custoAtual),
      pesoG: sku.pesoG,
      taxaDevolucaoEsperadaBp:
        sku.taxaDevolucaoEsperadaBp === null ? null : pontosBase(sku.taxaDevolucaoEsperadaBp),
    },
    plataforma: parametros.plataforma,
    vendedor: perfil.contextoDoVendedor,
    modoFrete: parametros.modoFrete,
    tipoAnuncioML: parametros.tipoAnuncioML,
    ...(sku.categoriaMl === null ? {} : { categoria: sku.categoriaMl }),
    em: agora,
  });

  const de = reaisParaCentavos(FAIXA_PADRAO.deReais);
  const ate = reaisParaCentavos(FAIXA_PADRAO.ateReais);

  const minimo = precoParaMargem({
    base: montada.base,
    margemAlvo: { tipo: 'pontos_base', valor: pontosBase(parametros.margemAlvoBp) },
    de,
    ate,
  });

  const simulacao = simularFaixa({ base: montada.base, de, ate });

  const resultado =
    parametros.preco === null ? null : calcularMargem({ ...montada.base, preco: parametros.preco });

  const codigo = Array.isArray(busca['r']) ? busca['r'][0] : busca['r'];
  const aviso = descreverAviso(codigo);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <p className={estilo.voltar}>
          <Link className={estilo.link} href={CAMINHO}>
            ← Catálogo
          </Link>
        </p>
        <h1 className={estilo.titulo}>{sku.tituloInterno}</h1>
        <p className={estilo.subtitulo}>
          {sku.marca ?? 'sem marca'}
          {sku.ean === null ? '' : ` · ${sku.ean}`}
          {sku.ncm === null ? '' : ` · NCM ${sku.ncm}`}
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}
      {!sku.ativo && <ProdutoDesativado id={sku.id} />}

      <section aria-labelledby="custo-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="custo-titulo">
          Custo
        </h2>
        <p className={estilo.dica}>
          O que você paga por uma unidade, já com o que for rateado. A data fica gravada junto:
          custo de três meses atrás com o fornecedor reajustado é margem otimista sem aviso.
        </p>
        <FormularioDeCusto agora={agora} sku={sku} />
      </section>

      <section aria-labelledby="preco-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="preco-titulo">
          Quanto cobrar
        </h2>
        <FormularioDoSimulador parametros={parametros} />

        <p className={estilo.resposta}>
          {textoDoPrecoMinimo({
            preco: minimo,
            margemAlvoBp: parametros.margemAlvoBp,
            deReais: FAIXA_PADRAO.deReais,
            ateReais: FAIXA_PADRAO.ateReais,
          })}
        </p>

        <Presuncoes textos={textoDasPresuncoes(montada.presumidos)} />

        {resultado !== null && <Decomposicao resultado={resultado} />}

        <h3 className={estilo.subsecao}>A faixa que funciona</h3>
        <p className={estilo.dica}>
          Varredura de {FAIXA_PADRAO.deReais} a {FAIXA_PADRAO.ateReais} reais. Degrau é onde a
          comissão ou o frete mudam de faixa: um centavo a mais e a margem cai de degrau — e é por
          isso que a curva é varrida em vez de calculada num preço só.
        </p>
        <Faixas simulacao={simulacao} />
      </section>

      <section aria-labelledby="ficha-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="ficha-titulo">
          Ficha
        </h2>
        <p className={estilo.dica}>
          Cada campo em branco é uma presunção no cálculo acima. Preencher não muda o que o sistema
          faz — muda o quanto o número dele vale.
        </p>
        <FormularioDaFicha sku={sku} />
      </section>

      <section aria-labelledby="fiscal-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="fiscal-titulo">
          Fiscal
        </h2>
        <p className={estilo.dica}>
          O que a nota fiscal deste produto precisa. Os três códigos passam a ser obrigatórios na
          nota de 2027.
        </p>
        <ResumoFiscal sku={sku} />
      </section>

      <section aria-labelledby="ocorrencias-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="ocorrencias-titulo">
          De onde veio
        </h2>
        <p className={estilo.dica}>
          As ocorrências ligadas a este produto, com o preço que cada uma trazia. É o que os outros
          cobram — não é o seu preço, mas é a referência que existe.
        </p>
        <Ocorrencias ocorrencias={ocorrencias.slice(0, OCORRENCIAS_NA_TELA)} />
      </section>

      {sku.ativo && (
        <section aria-labelledby="desativar-titulo" className={estilo.secao}>
          <h2 className={estilo.secaoTitulo} id="desativar-titulo">
            Parar de vender
          </h2>
          <p className={estilo.dica}>
            Desativar tira o produto do catálogo e das listas de anúncio, compatibilidade,
            consignação e cadastro fiscal. Nada é apagado: pedidos antigos continuam ligados a ele,
            e ele volta com um clique.
          </p>
          <DesativarProduto id={sku.id} />
        </section>
      )}
    </main>
  );
}
