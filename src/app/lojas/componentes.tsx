/**
 * Peças da área da loja. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O que decide texto, número e ordem está em `apresentacao.ts`, com teste. Aqui só há
 * onde cada coisa fica. As abas são links, e não botões com estado: a aba vira `?aba=`
 * na URL, recarregar não perde, e "o repasse da Shopee" é um endereço que se guarda.
 */
import Link from 'next/link';
import type { EstadoDaLoja } from '@/dominio/lojas/estado';
import type { PontoDaSerie } from '@/dominio/lojas/painel';
import type { MaisVendido } from '@/dominio/lojas/repositorio';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { formatarBRL } from '@/lib/dinheiro';
import { ROTULO_DA_PLATAFORMA, aLoja, daLoja } from '../ui/rotulos';
import {
  ROTULO_DA_ABA,
  ROTULO_DA_SITUACAO,
  diaCurto,
  margemEmTexto,
  resumoDaSerie,
  type CapacidadeNaTela,
  type NumeroNaTela,
  type PendenciaDaLoja,
  type Situacao,
} from './apresentacao';
import { ABAS_DA_LOJA, caminhoDaAba, type AbaDaLoja } from './caminhos';
import { IDENTIDADE_DA_LOJA } from './identidade';
import { Selo } from './selo';
import estilo from './lojas.module.css';

const CLASSE_DO_PONTO: Readonly<Record<EstadoDaLoja['tipo'], string>> = {
  conectada: `${estilo.ponto} ${estilo.pontoConectada}`,
  planilha: `${estilo.ponto} ${estilo.pontoPlanilha}`,
  sem_dados: `${estilo.ponto} ${estilo.pontoSemDados}`,
};

const CLASSE_DO_ESTADO: Readonly<Record<EstadoDaLoja['tipo'], string>> = {
  conectada: `${estilo.estadoNome} ${estilo.estadoConectada}`,
  planilha: `${estilo.estadoNome} ${estilo.estadoPlanilha}`,
  sem_dados: estilo.estadoNome,
};

const ROTULO_DO_ESTADO: Readonly<Record<EstadoDaLoja['tipo'], string>> = {
  conectada: 'Conectada',
  planilha: 'Por planilha',
  sem_dados: 'Sem dados',
};

/** O cabeçalho: selo, nome, em que pé a loja está, e as duas ações da área. */
export function CabecalhoDaLoja({
  plataforma,
  estado,
}: {
  readonly plataforma: Plataforma;
  readonly estado: EstadoDaLoja;
}) {
  return (
    <header className={estilo.cabecalho}>
      <div className={estilo.identidade}>
        <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={46} />
        <div>
          <h1 className={estilo.titulo}>{ROTULO_DA_PLATAFORMA[plataforma]}</h1>
          <p className={estilo.estado}>
            <span aria-hidden="true" className={CLASSE_DO_PONTO[estado.tipo]} />
            <span className={CLASSE_DO_ESTADO[estado.tipo]}>{ROTULO_DO_ESTADO[estado.tipo]}</span>
            <span>· {estado.frase}</span>
          </p>
        </div>
      </div>
      <div className={estilo.acoes}>
        <Link className={estilo.botaoSecundario} href={`/assistente?loja=${plataforma}`}>
          Perguntar sobre esta loja
        </Link>
        <Link className={estilo.botao} href={`/importar?loja=${plataforma}`}>
          Importar planilha
        </Link>
      </div>
    </header>
  );
}

const CLASSE_DA_NOTA: Readonly<Record<NumeroNaTela['tom'], string>> = {
  alta: `${estilo.numeroNota} ${estilo.notaAlta}`,
  baixa: `${estilo.numeroNota} ${estilo.notaBaixa}`,
  neutro: estilo.numeroNota,
};

/** A faixa dos quatro números da janela. */
export function Numeros({
  numeros,
  titulo,
}: {
  readonly numeros: readonly NumeroNaTela[];
  readonly titulo: string;
}) {
  return (
    <section aria-label={titulo} className={estilo.numeros}>
      {numeros.map((n) => (
        <div className={estilo.numero} key={n.rotulo}>
          <span className={estilo.numeroRotulo}>{n.rotulo}</span>
          <span className={estilo.numeroValor}>{n.valor}</span>
          <span className={CLASSE_DA_NOTA[n.tom]}>{n.nota}</span>
        </div>
      ))}
    </section>
  );
}

/** As abas, com a contagem do que espera em cada uma. */
export function Abas({
  plataforma,
  atual,
  contagens,
}: {
  readonly plataforma: Plataforma;
  readonly atual: AbaDaLoja;
  readonly contagens: Readonly<Partial<Record<AbaDaLoja, number>>>;
}) {
  return (
    <nav aria-label={`Áreas ${daLoja(plataforma)}`} className={estilo.abas}>
      {ABAS_DA_LOJA.map((aba) => {
        const conta = contagens[aba] ?? 0;
        return (
          <Link
            aria-current={aba === atual ? 'page' : undefined}
            className={aba === atual ? `${estilo.aba} ${estilo.abaAtual}` : estilo.aba}
            href={caminhoDaAba(plataforma, aba)}
            key={aba}
          >
            {ROTULO_DA_ABA[aba]}
            {conta > 0 && <span className={estilo.abaContagem}>{conta}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Faturamento por dia, uma barra por dia.
 *
 * O dia sem venda aparece como traço no chão, e a frase embaixo diz o pico em número:
 * é a leitura do gráfico para quem não enxerga barra.
 */
export function GraficoPorDia({ serie }: { readonly serie: readonly PontoDaSerie[] }) {
  const maior = Math.max(1, ...serie.map((p) => p.faturamento));
  const primeiro = serie[0];
  const ultimo = serie.at(-1);

  return (
    <figure className={estilo.figura}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>Faturamento por dia</h2>
        <span className={estilo.blocoNota}>últimos {serie.length} dias</span>
      </div>
      <div aria-hidden="true" className={estilo.grafico}>
        {serie.map((p) => (
          <span
            className={p.pedidos === 0 ? `${estilo.barra} ${estilo.barraVazia}` : estilo.barra}
            key={p.dia}
            style={{
              height: p.pedidos === 0 ? undefined : `${String((p.faturamento / maior) * 100)}%`,
            }}
            title={`${diaCurto(p.dia)}: ${formatarBRL(p.faturamento)}`}
          />
        ))}
      </div>
      {primeiro !== undefined && ultimo !== undefined && (
        <div aria-hidden="true" className={estilo.eixo}>
          <span>{diaCurto(primeiro.dia)}</span>
          <span>{diaCurto(ultimo.dia)}</span>
        </div>
      )}
      <figcaption className={estilo.legenda}>{resumoDaSerie(serie)}</figcaption>
    </figure>
  );
}

/** Os produtos que mais faturaram nesta loja, com a margem de cada um. */
export function MaisVendidos({
  itens,
  plataforma,
}: {
  readonly itens: readonly MaisVendido[];
  readonly plataforma: Plataforma;
}) {
  return (
    <section className={estilo.bloco}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>Mais vendidos nesta loja</h2>
      </div>
      {itens.length === 0 ? (
        <p className={estilo.vazio}>Nenhuma venda nesta janela.</p>
      ) : (
        <table className={estilo.tabela}>
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th className={estilo.numeroDaTabela} scope="col">
                Pedidos
              </th>
              <th className={estilo.numeroDaTabela} scope="col">
                Faturamento
              </th>
              <th className={estilo.numeroDaTabela} scope="col">
                Margem
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.skuId ?? 'sem-produto'}>
                <td>
                  {item.skuId === null ? (
                    'Sem produto do catálogo'
                  ) : (
                    <Link href={`/catalogo/${item.skuId}?plataforma=${plataforma}`}>
                      {item.titulo ?? 'Produto'}
                    </Link>
                  )}
                </td>
                <td className={estilo.numeroDaTabela}>{item.pedidos}</td>
                <td className={estilo.numeroDaTabela}>{formatarBRL(item.faturamento)}</td>
                <td
                  className={
                    item.margemBp !== null && item.margemBp < 0
                      ? `${estilo.numeroDaTabela} ${estilo.margemNegativa}`
                      : estilo.numeroDaTabela
                  }
                >
                  {margemEmTexto(item.margemBp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** O que esta loja pede de você. Vazia, diz que não há nada — e isso é informação. */
export function Pendencias({ itens }: { readonly itens: readonly PendenciaDaLoja[] }) {
  return (
    <section className={estilo.bloco}>
      <div className={estilo.blocoCabecalho}>
        <h2 className={estilo.blocoTitulo}>Precisa de você nesta loja</h2>
      </div>
      {itens.length === 0 ? (
        <p className={estilo.vazio}>Nada esperando você nesta loja.</p>
      ) : (
        <ul className={estilo.pendencias}>
          {itens.map((item) => (
            <li className={estilo.pendencia} key={item.chave}>
              <span
                aria-hidden="true"
                className={`${estilo.ponto} ${item.tom === 'agora' ? estilo.pontoAgora : estilo.pontoAtencao}`}
              />
              <span className={estilo.pendenciaTexto}>{item.texto}</span>
              <Link className={estilo.pendenciaAcao} href={item.href}>
                {item.acao}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CLASSE_DA_SITUACAO: Readonly<Record<Situacao, string>> = {
  funciona: `${estilo.situacao} ${estilo.situacaoFunciona}`,
  previsto: `${estilo.situacao} ${estilo.situacaoPrevisto}`,
  sem_conexao: `${estilo.situacao} ${estilo.situacaoSemConexao}`,
  nao_oferece: `${estilo.situacao} ${estilo.situacaoNaoOferece}`,
  bloqueado: `${estilo.situacao} ${estilo.situacaoBloqueado}`,
};

/** O que a loja libera, capacidade por capacidade, com a situação escrita. */
export function Capacidades({ itens }: { readonly itens: readonly CapacidadeNaTela[] }) {
  return (
    <table className={estilo.tabela}>
      <thead>
        <tr>
          <th scope="col">O quê</th>
          <th scope="col">Como</th>
          <th scope="col">Situação</th>
        </tr>
      </thead>
      <tbody>
        {itens.map((c) => (
          <tr key={c.capacidade}>
            <td>{c.rotulo}</td>
            <td>{c.como}</td>
            <td>
              <span className={CLASSE_DA_SITUACAO[c.situacao]}>
                {ROTULO_DA_SITUACAO[c.situacao]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A loja sem dado nenhum: os dois caminhos, e o que já funciona sem eles.
 *
 * Nenhuma tela depende de loja conectada (ADR 0002): a planilha funciona hoje, e a
 * integração é a segunda opção, com a frase do adaptador dizendo o que ela exige.
 */
export function SemDados({
  plataforma,
  comoConectar,
}: {
  readonly plataforma: Plataforma;
  readonly comoConectar: string;
}) {
  return (
    <section className={estilo.bloco}>
      <h2 className={estilo.blocoTitulo}>A área da loja aparece com o primeiro dado</h2>
      <p className={estilo.dica}>
        Nada aqui depende de conectar. Use um dos caminhos, ou os dois: a planilha funciona hoje.
      </p>
      <div className={estilo.caminhos}>
        <div className={estilo.caminho}>
          <span className={`${estilo.caminhoEtiqueta} ${estilo.etiquetaHoje}`}>Funciona hoje</span>
          <h3 className={estilo.caminhoTitulo}>Importar a planilha de pedidos</h3>
          <p className={estilo.caminhoTexto}>
            Exporte os pedidos no painel {daLoja(plataforma)} e suba o arquivo. Os números vão até a
            data do pedido mais recente, e a tela diz qual é.
          </p>
          <Link className={estilo.botao} href={`/importar?loja=${plataforma}`}>
            Importar planilha
          </Link>
        </div>
        <div className={estilo.caminho}>
          <span className={`${estilo.caminhoEtiqueta} ${estilo.etiquetaDepende}`}>
            Depende {daLoja(plataforma)}
          </span>
          <h3 className={estilo.caminhoTitulo}>Conectar pela integração oficial</h3>
          <p className={estilo.caminhoTexto}>{comoConectar}</p>
          <Link className={estilo.botaoSecundario} href={caminhoDaAba(plataforma, 'conexao')}>
            Ver o que {aLoja(plataforma)} libera
          </Link>
        </div>
      </div>
      <p className={estilo.legenda}>
        Já funciona sem dados: o catálogo calcula o preço para {aLoja(plataforma)} com a tabela de
        taxas do sistema, e Publicar anúncio gera o arquivo de importação da loja.{' '}
        <Link href="/catalogo">Abrir o catálogo</Link>
      </p>
    </section>
  );
}
