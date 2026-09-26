/**
 * Catálogo e preço (M2 e M8): o que você vende, e quanto cobrar em cada loja.
 *
 * A tela é uma tabela de preços, o papel que o comerciante já conhece: um produto por
 * linha, uma loja por coluna, e o preço que deixa com você a parte que você pediu. O
 * desenho, e o porquê de cada escolha, estão no cabeçalho de `catalogo.module.css`.
 *
 * Catálogo vazio não mostra tabela vazia: mostra a primeira pergunta, com o campo.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { janelasDoPainel } from '@/dominio/lojas/painel';
import { RepositorioDeLojas, type VendaDoProduto } from '@/dominio/lojas/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import {
  caminhoDoProdutoNovo,
  descreverAviso,
  detalheDoProduto,
  lerParametros,
  lerProdutoNovo,
  ordemDaTabela,
  resumoDaTabela,
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
import { limitarAlvo, type VendaNaLoja } from './conta';
import { TabelaDePrecos, type LinhaDaTabela } from './tabela-de-precos';

export const metadata: Metadata = { title: 'Catálogo e preço' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_catalogo' },
});

/** As vendas de cada produto, por loja: a coluna "você cobra" da tabela. */
function vendasPorSku(
  vendas: readonly VendaDoProduto[],
): ReadonlyMap<string, Partial<Record<Plataforma, VendaNaLoja>>> {
  const mapa = new Map<string, Partial<Record<Plataforma, VendaNaLoja>>>();
  for (const venda of vendas) {
    const doProduto = mapa.get(venda.skuId) ?? {};
    doProduto[venda.plataforma] = { unidades: venda.unidades, faturamento: venda.faturamento };
    mapa.set(venda.skuId, doProduto);
  }
  return mapa;
}

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
        custoTexto: produto.custoAtual === null ? null : (custo?.texto ?? null),
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
            {vazio
              ? 'O que você vende e quanto cobrar em cada loja.'
              : resumoDaTabela({
                  total: linhas.length,
                  semCusto: linhas.filter((l) => l.ficha.custo === null).length,
                  velhos: linhas.filter((l) => l.custoVelho).length,
                })}
          </p>
        </div>
        {vazio ? null : <BotaoDeCadastrar />}
      </header>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}

      {vazio ? (
        <CatalogoVazio />
      ) : (
        <TabelaDePrecos
          alvoInicialBp={limitarAlvo(lerParametros(parametros).margemAlvoBp)}
          linhas={linhas}
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
