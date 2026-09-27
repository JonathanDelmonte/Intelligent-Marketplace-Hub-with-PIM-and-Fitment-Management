/**
 * Um produto: quanto você paga, quanto cobrar em cada loja, e a conta de uma venda.
 *
 * No alto, o caminho de volta e o nome. Embaixo, os quatro números do produto, o
 * simulador e, ao lado, as lojas comparadas, a ficha e a nota fiscal. O que muda enquanto
 * a pessoa mexe roda no navegador (`simulador.tsx`); a ficha e a nota fiscal são do
 * servidor e chegam prontas para a coluna do lado.
 *
 * Loja, meta, tipo de anúncio, frete e preço viajam na URL: o link guarda a conta que se
 * estava olhando, e as outras telas abrem o produto direto numa loja
 * (`?plataforma=shopee#preco-titulo`).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { janelasDoPainel } from '@/dominio/lojas/painel';
import { RepositorioDeLojas, type VendaDoProduto } from '@/dominio/lojas/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { descreverAviso, detalheDoProduto, lerParametros, textoDoCusto } from '../apresentacao';
import estilo from '../catalogo.module.css';
import {
  AvisoDaAcao,
  FichaDoProduto,
  Migalha,
  Miniatura,
  NotaFiscal,
  PararDeVender,
  ProdutoDesativado,
  VistoEm,
} from '../componentes';
import { OCORRENCIAS_NA_TELA } from '../constantes';
import { PainelDoProduto } from '../simulador';
import { vendasPorSku } from '../vendas';

export const metadata: Metadata = { title: 'Produto' };

export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_produto' },
});

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
  const [ocorrencias, vendas] = await Promise.all([
    repo.ocorrencias(perfil.id, sku.id),
    // As vendas são enfeite: se falharem, o produto abre sem elas.
    new RepositorioDeLojas(db)
      .vendasPorProduto(perfil.id, janelasDoPainel(agora).atual)
      .catch((erro: unknown) => {
        log.aviso('produto.vendas_nao_lidas', { erro });
        return [] as readonly VendaDoProduto[];
      }),
  ]);
  const parametros = lerParametros(busca);
  const custo = textoDoCusto(sku.custoAtualizadoEm, agora);

  const codigo = Array.isArray(busca['r']) ? busca['r'][0] : busca['r'];
  const aviso = descreverAviso(codigo);
  const detalhe = detalheDoProduto(sku.marca, sku.ean);

  return (
    <main className={estilo.pagina}>
      <Migalha atual={sku.tituloInterno} />
      <header className={estilo.cabecalhoDoProduto}>
        <Miniatura grande />
        <div className={estilo.cabecalhoTextos}>
          <h1 className={estilo.titulo}>{sku.tituloInterno}</h1>
          <p className={estilo.subtitulo}>
            {detalhe ?? 'Sem marca e sem código de barras'}
            {sku.ativo ? null : ' · desativado'}
          </p>
        </div>
      </header>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}
      {sku.ativo ? null : <ProdutoDesativado id={sku.id} />}

      <PainelDoProduto
        inicio={{
          plataforma: parametros.plataforma,
          tipoAnuncioML: parametros.tipoAnuncioML,
          modoFrete: parametros.modoFrete,
          meta: parametros.meta,
          preco: parametros.preco,
        }}
        lateral={
          <>
            <FichaDoProduto abrirFormulario={codigo === 'ficha_invalida'} sku={sku} />
            <NotaFiscal sku={sku} />
            <VistoEm ocorrencias={ocorrencias.slice(0, OCORRENCIAS_NA_TELA)} />
            {sku.ativo ? <PararDeVender id={sku.id} /> : null}
          </>
        }
        produto={{
          id: sku.id,
          nome: sku.tituloInterno,
          ativo: sku.ativo,
          ficha: {
            custo: sku.custoAtual,
            pesoG: sku.pesoG,
            devolucaoBp: sku.taxaDevolucaoEsperadaBp,
            categoriaMl: sku.categoriaMl,
          },
          custoTexto: sku.custoAtual === null ? null : (custo?.texto ?? null),
          custoVelho: sku.custoAtual !== null && custo?.velho === true,
          vendas: vendasPorSku(vendas).get(sku.id) ?? {},
        }}
        vendedor={perfil.contextoDoVendedor}
      />
    </main>
  );
}
