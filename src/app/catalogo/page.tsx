/**
 * Catálogo e preço (M2 e M8): o que você vende, e quanto cobrar em cada loja.
 *
 * Quatro números no alto e a tabela de preços embaixo: um produto por linha, uma loja por
 * coluna, e o preço que alcança a meta que a pessoa escolheu. O desenho, e o porquê de
 * cada escolha, estão no cabeçalho de `catalogo.module.css`.
 *
 * Catálogo vazio não mostra tabela vazia: mostra a primeira pergunta, com o campo, e o
 * desenho da tabela que ela vai virar.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { janelasDoPainel } from '@/dominio/lojas/painel';
import { RepositorioDeLojas, type VendaDoProduto } from '@/dominio/lojas/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import {
  caminhoDoProdutoNovo,
  descreverAviso,
  detalheDoProduto,
  lerMeta,
  lerProdutoNovo,
  ordemDaTabela,
  textoDoCusto,
} from './apresentacao';
import estilo from './catalogo.module.css';
import {
  AvisoDaAcao,
  BotaoDeCadastrar,
  CatalogoVazio,
  Desativados,
  ParesEsperando,
} from './componentes';
import { LIMITE_DO_CATALOGO } from './constantes';
import { PainelDoCatalogo, type LinhaDaTabela } from './painel';
import { vendasPorSku } from './vendas';

export const metadata: Metadata = { title: 'Catálogo e preço' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_catalogo' },
});

export default async function PaginaDoCatalogo({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;

  // O cadastro tem tela própria. Link antigo, do tempo em que ele morava aqui, vai para
  // lá com o nome e a loja que trazia.
  const pedido = lerProdutoNovo(parametros);
  if (pedido !== null) redirect(caminhoDoProdutoNovo(pedido.titulo, pedido.plataforma));

  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const agora = new Date();
  const repo = new RepositorioDeSku(db);

  const [produtos, desativados, pendentes, vendas] = await Promise.all([
    repo.listar(perfil.id, { limite: LIMITE_DO_CATALOGO }),
    repo.desativados(perfil.id),
    // As duas últimas são enfeite da tabela: se falharem, a tabela abre sem elas.
    new RepositorioDePares(db)
      .contarPorStatus()
      .then((c) => c.pendente)
      .catch(() => null),
    new RepositorioDeLojas(db)
      .vendasPorProduto(perfil.id, janelasDoPainel(agora).atual)
      .catch((erro: unknown) => {
        log.aviso('catalogo.vendas_nao_lidas', { erro });
        return [] as readonly VendaDoProduto[];
      }),
  ]);

  const doProduto = vendasPorSku(vendas);
  const linhas: readonly LinhaDaTabela[] = produtos
    .map((produto) => {
      const custo = textoDoCusto(produto.custoAtualizadoEm, agora);
      const vendasDoProduto = doProduto.get(produto.id) ?? {};
      const linha: LinhaDaTabela = {
        id: produto.id,
        nome: produto.tituloInterno,
        detalhe: detalheDoProduto(produto.marca, produto.ean),
        ficha: {
          custo: produto.custoAtual,
          pesoG: produto.pesoG,
          devolucaoBp: produto.taxaDevolucaoEsperadaBp,
          categoriaMl: produto.categoriaMl,
        },
        custoQuando: produto.custoAtual === null ? null : (custo?.quando ?? null),
        custoVelho: produto.custoAtual !== null && custo?.velho === true,
        vendas: vendasDoProduto,
      };
      const unidades = PLATAFORMAS.reduce((t, p) => t + (vendasDoProduto[p]?.unidades ?? 0), 0);
      return {
        linha,
        ordem: { nome: linha.nome, semCusto: produto.custoAtual === null, unidades },
      };
    })
    .sort((a, b) => ordemDaTabela(a.ordem, b.ordem))
    .map(({ linha }) => linha);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);
  const vazio = linhas.length === 0;

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <div className={estilo.cabecalhoTextos}>
          <h1 className={estilo.titulo}>Catálogo e preço</h1>
          <p className={estilo.subtitulo}>
            O que você vende, quanto paga e quanto cobrar em cada loja.
          </p>
        </div>
        {vazio ? null : <BotaoDeCadastrar />}
      </header>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}

      {vazio ? (
        <CatalogoVazio />
      ) : (
        <PainelDoCatalogo
          linhas={linhas}
          metaInicial={lerMeta(parametros)}
          vendedor={perfil.contextoDoVendedor}
        />
      )}

      <footer className={estilo.peDaLista}>
        <ParesEsperando pendentes={pendentes} />
        <Desativados produtos={desativados} />
      </footer>
    </main>
  );
}
