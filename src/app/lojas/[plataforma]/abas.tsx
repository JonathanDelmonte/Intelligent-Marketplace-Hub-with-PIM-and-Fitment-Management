/**
 * O conteúdo das abas da área da loja que leem algo só delas.
 *
 * Componentes de servidor assíncronos: cada um busca o que a aba mostra, e a página só
 * renderiza a aba aberta — abrir o repasse não consulta o gráfico. O que as abas usam
 * em comum (fila, divergências, perguntas) a página já leu para as contagens das abas,
 * e passa adiante.
 */
import Link from 'next/link';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { RepositorioDeAnuncios } from '@/dominio/anuncios/repositorio';
import { completarSerie, type Janela } from '@/dominio/lojas/painel';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { registroPadrao } from '@/plataformas/registro';
import { LIMITE_DE_CANDIDATOS } from '../../anuncios/constantes';
import { caminhoParaMontar } from '../../anuncios/parametros';
import { caminhoDoSimulador } from '../../catalogo/apresentacao';
import { Divergencias, type DivergenciaParaTela } from '../../postagem/componentes';
import { LIMITE_DE_CONFERIDAS } from '../../postagem/constantes';
import { aLoja, naLoja } from '../../ui/rotulos';
import { capacidadesNaTela, faltasDoProduto, type PendenciaDaLoja } from '../apresentacao';
import { caminhoDaAba } from '../caminhos';
import { Capacidades, GraficoPorDia, MaisVendidos, Pendencias } from '../componentes';
import estilo from '../lojas.module.css';

export async function AbaResumo({
  perfil,
  plataforma,
  janela,
  pendencias,
}: {
  readonly perfil: PerfilId;
  readonly plataforma: Plataforma;
  readonly janela: Janela;
  readonly pendencias: readonly PendenciaDaLoja[];
}) {
  const lojas = new RepositorioDeLojas(banco());
  const [serie, maisVendidos] = await Promise.all([
    lojas.serieDiaria(perfil, janela, plataforma),
    lojas.maisVendidos(perfil, janela, plataforma),
  ]);

  return (
    <div className={estilo.grade}>
      <div className={estilo.coluna}>
        <GraficoPorDia serie={completarSerie(serie, janela.dias)} />
        <MaisVendidos itens={maisVendidos} plataforma={plataforma} />
      </div>
      <Pendencias itens={pendencias} />
    </div>
  );
}

/**
 * O catálogo visto desta loja.
 *
 * Não são os anúncios publicados nela: nada no sistema lê anúncio publicado ainda — nem
 * planilha de anúncios, nem integração. A aba diz isso, e mostra o que dá para mostrar
 * com verdade: o que falta a cada produto para ser anunciado aqui.
 */
export async function AbaAnuncios({
  perfil,
  plataforma,
}: {
  readonly perfil: PerfilId;
  readonly plataforma: Plataforma;
}) {
  const candidatos = await new RepositorioDeAnuncios(banco()).candidatos(
    perfil,
    LIMITE_DE_CANDIDATOS,
  );

  return (
    <section className={estilo.bloco}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>O seu catálogo para {aLoja(plataforma)}</h2>
        <span className={estilo.blocoNota}>
          {candidatos.length === 1 ? '1 produto' : `${String(candidatos.length)} produtos`}
        </span>
      </div>
      <p className={estilo.dica}>
        O sistema ainda não lê os anúncios já publicados {naLoja(plataforma)}. Aqui está o seu
        catálogo, com o que falta a cada produto para anunciar nesta loja — o preço sai com as taxas
        dela.
      </p>
      {candidatos.length === 0 ? (
        <p className={estilo.vazio}>
          Nenhum produto no catálogo ainda. <Link href="/catalogo">Cadastrar o primeiro</Link>
        </p>
      ) : (
        <table className={estilo.tabela}>
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th scope="col">Falta</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => {
              const faltas = faltasDoProduto(c);
              return (
                <tr key={c.id}>
                  <td>{c.titulo}</td>
                  <td>{faltas.length === 0 ? 'pronto para anunciar' : faltas.join(', ')}</td>
                  <td className={estilo.numeroDaTabela}>
                    <Link href={caminhoDoSimulador(c.id, plataforma)}>Preço nesta loja</Link>
                    {' · '}
                    <Link href={caminhoParaMontar({ skuId: c.id, plataforma })}>
                      Montar anúncio
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export async function AbaRepasse({
  perfil,
  plataforma,
  divergencias,
}: {
  readonly perfil: PerfilId;
  readonly plataforma: Plataforma;
  readonly divergencias: readonly DivergenciaParaTela[];
}) {
  const conferidas = await new RepositorioDePedidos(banco()).repassesConferidos(
    perfil,
    LIMITE_DE_CONFERIDAS,
    plataforma,
  );
  return (
    <section className={estilo.bloco}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>O que {aLoja(plataforma)} pagou</h2>
        <span className={estilo.blocoNota}>repasse informado contra as taxas de cada pedido</span>
      </div>
      <Divergencias
        conferidas={conferidas}
        divergencias={divergencias}
        voltar={caminhoDaAba(plataforma, 'repasse')}
      />
    </section>
  );
}

/**
 * O que a loja libera, e como conectar.
 *
 * Tudo vem do adaptador: o estado de cada capacidade e a frase de como se obtém a
 * integração. A tela não sabe qual loja é — e é por isso que a mesma tela serve às três.
 */
export async function AbaConexao({
  plataforma,
  conectada,
}: {
  readonly plataforma: Plataforma;
  readonly conectada: boolean;
}) {
  const adaptador = registroPadrao({
    plataformasComCredencial: conectada ? [plataforma] : [],
  }).de(plataforma);
  const capacidades = capacidadesNaTela(await adaptador.capacidades());

  return (
    <section className={estilo.bloco}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>O que {aLoja(plataforma)} libera</h2>
        <span className={estilo.blocoNota}>
          {conectada ? 'com a sua conta conectada' : 'sem conexão'}
        </span>
      </div>
      <p className={estilo.dica}>
        “Previsto” é o que a loja oferece em tese e o sistema ainda não conferiu. A conferência roda
        quando a loja é conectada, e o que ela não liberar continua pela planilha ou pelo link.
      </p>
      <Capacidades itens={capacidades} />
      <div className={estilo.caixa}>
        <p className={estilo.caixaTexto}>
          <strong>Conectar:</strong> {adaptador.comoConectar} A conexão por aqui ainda não existe no
          sistema (etapa 2.6b); até ela entrar, o caminho é a planilha.
        </p>
        <Link className={estilo.botao} href={`/importar?loja=${plataforma}`}>
          Importar planilha
        </Link>
      </div>
    </section>
  );
}
