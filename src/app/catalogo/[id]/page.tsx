/**
 * Um produto: quanto você paga, quanto cobrar, e a conta de uma venda.
 *
 * Duas colunas. À esquerda, o dinheiro, na ordem de quem decide preço: primeiro o custo,
 * porque sem ele não há conta; depois a resposta ("cobre R$ 39,90") e o cupom que a
 * explica. À direita, o que se consulta: a ficha, a nota fiscal e onde o produto
 * apareceu. No telefone as duas viram uma, com o dinheiro em cima.
 *
 * Loja, alvo, tipo de anúncio, frete e preço viajam na URL: o link guarda a conta que se
 * estava olhando, e as outras telas abrem o produto direto numa loja
 * (`?plataforma=shopee#preco-titulo`).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { descreverAviso, detalheDoProduto, lerParametros } from '../apresentacao';
import estilo from '../catalogo.module.css';
import {
  AvisoDaAcao,
  FichaDoProduto,
  NotaFiscal,
  PararDeVender,
  PerguntaDoCusto,
  ProdutoDesativado,
  Voltar,
  VistoEm,
} from '../componentes';
import { OCORRENCIAS_NA_TELA } from '../constantes';
import { limitarAlvo } from '../conta';
import { ContaDaVenda } from '../conta-da-venda';

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
  const alvoBp = limitarAlvo(parametros.margemAlvoBp);

  const codigo = Array.isArray(busca['r']) ? busca['r'][0] : busca['r'];
  const aviso = descreverAviso(codigo);
  const detalhe = detalheDoProduto(sku.marca, sku.ean);

  return (
    <main className={estilo.pagina}>
      <Voltar />
      <header className={estilo.cabecalhoDoProduto}>
        <h1 className={estilo.titulo}>{sku.tituloInterno}</h1>
        {detalhe === null ? null : <p className={estilo.subtitulo}>{detalhe}</p>}
      </header>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}
      {sku.ativo ? null : <ProdutoDesativado id={sku.id} />}

      <div className={estilo.produto}>
        <div className={estilo.principal}>
          <PerguntaDoCusto
            agora={agora}
            alvoBp={alvoBp}
            plataforma={parametros.plataforma}
            sku={sku}
          />
          <ContaDaVenda
            ativo={sku.ativo}
            ficha={{
              custo: sku.custoAtual,
              pesoG: sku.pesoG,
              devolucaoBp: sku.taxaDevolucaoEsperadaBp,
              categoriaMl: sku.categoriaMl,
            }}
            inicial={{
              plataforma: parametros.plataforma,
              tipoAnuncioML: parametros.tipoAnuncioML,
              modoFrete: parametros.modoFrete,
              alvoBp,
              preco: parametros.preco,
            }}
            skuId={sku.id}
            vendedor={perfil.contextoDoVendedor}
          />
        </div>

        <aside aria-label="Ficha do produto" className={estilo.lateral}>
          <FichaDoProduto abrirFormulario={codigo === 'ficha_invalida'} sku={sku} />
          <NotaFiscal sku={sku} />
          <VistoEm ocorrencias={ocorrencias.slice(0, OCORRENCIAS_NA_TELA)} />
          {sku.ativo ? <PararDeVender id={sku.id} /> : null}
        </aside>
      </div>
    </main>
  );
}
