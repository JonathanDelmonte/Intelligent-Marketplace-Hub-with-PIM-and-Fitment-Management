/**
 * Tela de catálogo (M2).
 *
 * A pergunta que ela responde: **o que eu vendo, e quanto custa?**
 *
 * É a tela que faltava desde a fase 1. O motor de margem tem oito entregas prontas e
 * teste em cada degrau de comissão desde o começo do projeto, e usar ele exigia escrever
 * código — porque não havia onde informar o custo. A pendência 3.1 registrava isso com
 * a frase que resume o problema: "usar o M8 hoje exige escrever código".
 *
 * A lista lidera pelo que **falta**: sem custo primeiro, depois custo velho, depois peso
 * ausente. É a ordem do quanto cada falta distorce a margem — sem custo ela não existe,
 * com custo velho ela mente devagar, sem peso ela erra o frete.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { custoDefasado } from '@/dominio/catalogo/custo';
import { RepositorioDeSku } from '@/dominio/catalogo/sku';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { naLoja } from '../ui/rotulos';
import estilo from './catalogo.module.css';
import {
  caminhoDoSimulador,
  descreverAviso,
  lerProdutoNovo,
  resumoDoCatalogo,
} from './apresentacao';
import {
  AtalhoParaJuntar,
  AvisoDaAcao,
  Desativados,
  FormularioDeProduto,
  Produtos,
} from './componentes';
import { CAMINHO, LIMITE_DO_CATALOGO } from './constantes';

export const metadata: Metadata = { title: 'Catálogo' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeCatalogo({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const agora = new Date();

  const repo = new RepositorioDeSku(db);
  // O produto novo pedido por outra tela — o "Publicar em" do garimpo. Se o nome já está
  // no catálogo, a tela leva ao que existe em vez de deixar cadastrar de novo.
  const pedido = lerProdutoNovo(parametros);
  const [produtos, desativados, jaExiste, pendentes] = await Promise.all([
    repo.listar(perfil.id, { limite: LIMITE_DO_CATALOGO }),
    repo.desativados(perfil.id),
    pedido === null ? Promise.resolve(null) : repo.buscarPorTitulo(perfil.id, pedido.titulo),
    // A contagem é um enfeite do atalho: se falhar, o atalho aparece sem ela, e o
    // catálogo abre do mesmo jeito.
    new RepositorioDePares(db)
      .contarPorStatus()
      .then((c) => c.pendente)
      .catch(() => null),
  ]);

  const semCusto = produtos.filter((p) => p.custoAtual === null).length;
  const defasados = produtos.filter((p) => custoDefasado(p.custoAtualizadoEm, agora)).length;

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Catálogo</h1>
        <p className={estilo.subtitulo}>
          O que você vende, com o custo de cada peça. O custo é o número que decide toda venda — sem
          ele o sistema calcula margem, mas a margem que ele mostra é o teto, e não a real.
        </p>
        <p className={estilo.resumo}>
          {resumoDoCatalogo({ total: produtos.length, semCusto, defasados })}
        </p>
        <AtalhoParaJuntar pendentes={pendentes} />
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="produtos-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="produtos-titulo">
          Produtos
        </h2>
        <p className={estilo.dica}>
          Abra um produto para informar o custo e ver quanto cobrar. A etiqueta mostra a falta mais
          grave de cada um, e não todas: linha com quatro etiquetas é linha que ninguém lê.
        </p>
        <Produtos agora={agora} produtos={produtos} />
        <Desativados produtos={desativados} />
      </section>

      <section aria-labelledby="novo-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="novo-titulo">
          Acrescentar produto
        </h2>
        {pedido === null ? (
          <p className={estilo.dica}>
            Produto também entra pela tela de juntar iguais, quando duas ocorrências viram o mesmo
            item. Aqui é para o que você já conhece e quer cadastrar direto.
          </p>
        ) : (
          <p className={estilo.dica}>
            Veio do garimpo
            {pedido.plataforma === undefined ? '' : `, para publicar ${naLoja(pedido.plataforma)}`}.
            Confira o nome antes de acrescentar: é por ele que você vai reconhecer a peça, e ele não
            muda depois.
          </p>
        )}
        {jaExiste === null ? null : (
          <p className={estilo.dica} role="status">
            Já existe no catálogo um produto com esse nome:{' '}
            <Link
              className={estilo.link}
              href={
                pedido?.plataforma === undefined
                  ? `${CAMINHO}/${jaExiste.id}`
                  : caminhoDoSimulador(jaExiste.id, pedido.plataforma)
              }
            >
              {jaExiste.tituloInterno}
            </Link>
            . Abra ele para publicar, em vez de cadastrar de novo.
          </p>
        )}
        <FormularioDeProduto plataforma={pedido?.plataforma} tituloInicial={pedido?.titulo ?? ''} />
      </section>
    </main>
  );
}
