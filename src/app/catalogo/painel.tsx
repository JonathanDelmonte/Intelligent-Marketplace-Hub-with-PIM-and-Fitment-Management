'use client';

/**
 * A lista do catálogo: quatro números no alto e a tabela de preços embaixo.
 *
 * Os quatro números respondem, nesta ordem, o que quem vende pergunta ao abrir a tela:
 * os meus preços estão bons, quanto eu vendi, quanto eu ganhei, e o que eu preciso fazer.
 * Cada um vem com o próprio desenho, porque número sozinho pede conta de cabeça e barra
 * se lê de relance: a de cores é a situação dos preços, a de lojas é onde se vendeu, a do
 * cartão escuro é o lucro perto da meta.
 *
 * A meta mora aqui, e não em cada tela: mexer nela refaz a tabela e os números juntos, na
 * hora, e o que mudou de cor é a resposta. Tudo roda no navegador com o mesmo motor de
 * margem do servidor.
 */
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  PLATAFORMAS,
  type ContextoDoVendedor,
  type Plataforma,
} from '@/dominio/precificacao/tipos';
import { centavos, formatarBRL } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { naLoja, ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { caminhoDoProduto, metaNaUrl } from './apresentacao';
import estilo from './catalogo.module.css';
import {
  celulasDoProduto,
  numerosDoCatalogo,
  percentual,
  reaisCurtos,
  ROTULO_DA_SITUACAO,
  situacaoDoProduto,
  textoDaMeta,
  type CelulaDaTabela,
  type FichaDaConta,
  type Meta,
  type NumerosDoCatalogo,
  type SituacaoDoProduto,
  type VendaNaLoja,
} from './conta';
import { ReguaDaMeta, TopoDoCartao, VendasPorLoja } from './cartoes';
import { CampoDeCusto } from './custo';
import { ControleDaMeta } from './meta';
import {
  SinalAlerta,
  SinalAvancar,
  SinalBusca,
  SinalCaixa,
  SinalCerto,
  SinalEtiqueta,
  SinalMoedas,
  SinalSacola,
  SinalSino,
  SinalVoltar,
} from './sinais';
import { gravarNaUrl } from './url';

/** Uma linha da tabela, como o servidor manda. */
export interface LinhaDaTabela {
  readonly id: string;
  readonly nome: string;
  /** Marca e código de barras, já juntos. */
  readonly detalhe: string | null;
  readonly ficha: FichaDaConta;
  /** Quando o custo foi informado: "há 10 dias". `null` sem custo. */
  readonly custoQuando: string | null;
  readonly custoVelho: boolean;
  readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
}

interface LinhaCalculada {
  readonly linha: LinhaDaTabela;
  readonly celulas: readonly CelulaDaTabela[];
  readonly situacao: SituacaoDoProduto;
}

// ─── Filtro ──────────────────────────────────────────────────────────────────

type Filtro = 'todos' | SituacaoDoProduto | 'custo_velho';

/** Os filtros, na ordem de urgência. Só aparece o que tem produto, e o que está escolhido. */
const FILTROS: readonly { readonly chave: Filtro; readonly rotulo: string }[] = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'sem_custo', rotulo: 'Falta o custo' },
  { chave: 'prejuizo', rotulo: 'Dando prejuízo' },
  { chave: 'abaixo', rotulo: 'Abaixo da meta' },
  { chave: 'custo_velho', rotulo: 'Custo antigo' },
  { chave: 'na_meta', rotulo: 'Na meta' },
  { chave: 'sem_vendas', rotulo: 'Sem vendas' },
];

function passaNoFiltro(item: LinhaCalculada, filtro: Filtro): boolean {
  if (filtro === 'todos') return true;
  if (filtro === 'custo_velho') return item.linha.custoVelho;
  return item.situacao === filtro;
}

/** Sem acento e sem caixa: "refil ibbl" acha "Refil IBBL C+3". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** A meta vai para a URL: recarregar não a perde, e o link guarda o número escolhido. */
function gravarMetaNaUrl(meta: Meta): void {
  gravarNaUrl((busca) => {
    busca.delete('alvo');
    busca.delete('lucro');
    const naUrl = metaNaUrl(meta);
    if (naUrl !== null) busca.set(naUrl[0], naUrl[1]);
  });
}

// ─── O painel ────────────────────────────────────────────────────────────────

export function PainelDoCatalogo({
  linhas,
  vendedor,
  metaInicial,
}: {
  readonly linhas: readonly LinhaDaTabela[];
  readonly vendedor: ContextoDoVendedor;
  readonly metaInicial: Meta;
}) {
  const [meta, setMeta] = useState(metaInicial);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  // A conta de duzentos produtos em três lojas leva um instante. Adiada, ela não trava o
  // campo da meta: o número muda na hora, e a tabela logo depois.
  const metaDaConta = useDeferredValue(meta);

  const calculadas: readonly LinhaCalculada[] = useMemo(
    () =>
      linhas.map((linha) => {
        const celulas = celulasDoProduto({
          ficha: linha.ficha,
          vendas: linha.vendas,
          meta: metaDaConta,
          vendedor,
          tipoAnuncioML: 'classico',
          modoFrete: 'comprador_paga',
        });
        return { linha, celulas, situacao: situacaoDoProduto(linha.ficha.custo, celulas) };
      }),
    [linhas, metaDaConta, vendedor],
  );

  const numeros = useMemo(
    () =>
      numerosDoCatalogo(
        calculadas.map((c) => ({
          custo: c.linha.ficha.custo,
          custoVelho: c.linha.custoVelho,
          vendas: c.linha.vendas,
          situacao: c.situacao,
        })),
      ),
    [calculadas],
  );

  const contagens = useMemo(() => {
    const total = new Map<Filtro, number>();
    for (const { chave } of FILTROS) {
      total.set(chave, calculadas.filter((c) => passaNoFiltro(c, chave)).length);
    }
    return total;
  }, [calculadas]);

  const termo = normalizar(busca.trim());
  const visiveis = calculadas.filter(
    (c) =>
      passaNoFiltro(c, filtro) &&
      (termo === '' || normalizar(`${c.linha.nome} ${c.linha.detalhe ?? ''}`).includes(termo)),
  );

  const mudarMeta = (nova: Meta) => {
    setMeta(nova);
    gravarMetaNaUrl(nova);
  };

  const filtrar = (novo: Filtro) => {
    setFiltro(novo);
    document.getElementById('tabela-titulo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <div className={estilo.numeros}>
        <CartaoDosPrecos calculadas={calculadas} />
        <CartaoDasVendas numeros={numeros} />
        <CartaoDoLucro meta={metaDaConta} numeros={numeros} />
        <CartaoDaAtencao aoFiltrar={filtrar} contagens={contagens} />
      </div>

      <section aria-labelledby="tabela-titulo" className={estilo.cartaoDaTabela}>
        <header className={estilo.topoDaTabela}>
          <div className={estilo.topoTextos}>
            <h2 className={estilo.tituloDoCartao} id="tabela-titulo">
              Tabela de preços
            </h2>
            <p className={estilo.textoDoCartao}>
              Quanto cobrar em cada loja para ganhar{' '}
              {meta.tipo === 'percentual'
                ? `${textoDaMeta(meta)} em cada venda`
                : textoDaMeta(meta)}
              .
            </p>
          </div>
          <ControleDaMeta aoMudar={mudarMeta} meta={meta} />
        </header>

        <div className={estilo.barraDaTabela}>
          <div aria-label="Mostrar" className={estilo.filtros} role="group">
            {FILTROS.filter(
              ({ chave }) =>
                chave === 'todos' || chave === filtro || (contagens.get(chave) ?? 0) > 0,
            ).map(({ chave, rotulo }) => (
              <button
                aria-pressed={chave === filtro}
                className={chave === filtro ? estilo.filtroAtual : estilo.filtro}
                key={chave}
                onClick={() => setFiltro(chave)}
                type="button"
              >
                {rotulo}
                <span className={estilo.filtroConta}>{contagens.get(chave) ?? 0}</span>
              </button>
            ))}
          </div>
          <label className={estilo.busca}>
            <SinalBusca />
            <span className="sr-only">Buscar produto</span>
            <input
              className={estilo.buscaEntrada}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar produto"
              type="search"
              value={busca}
            />
          </label>
        </div>

        <table className={estilo.tabela}>
          <thead>
            <tr>
              <th className={estilo.cabecaProduto} scope="col">
                Produto
              </th>
              <th className={estilo.cabecaNumero} scope="col">
                Você paga
              </th>
              {PLATAFORMAS.map((plataforma) => (
                <th className={estilo.cabecaNumero} key={plataforma} scope="col">
                  <span className={estilo.cabecaLoja}>
                    <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={16} />
                    {ROTULO_DA_PLATAFORMA[plataforma]}
                  </span>
                </th>
              ))}
              <th className={estilo.cabecaSituacao} scope="col">
                Situação
              </th>
              <th className={estilo.cabecaSeta} scope="col">
                <span className="sr-only">Abrir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td className={estilo.semResultado} colSpan={PLATAFORMAS.length + 4}>
                  {termo === ''
                    ? 'Nenhum produto neste grupo com a meta de agora.'
                    : 'Nenhum produto com esse nome.'}
                </td>
              </tr>
            ) : (
              visiveis.map((item) => <LinhaDoProduto item={item} key={item.linha.id} meta={meta} />)
            )}
          </tbody>
        </table>

        <footer className={estilo.rodapeDaTabela}>
          <p className={estilo.legenda}>
            Em cada loja, em cima, quanto cobrar para a sua meta. Embaixo, quanto você cobra hoje (a
            média dos últimos 30 dias), na cor da situação:
          </p>
          <p className={estilo.legendaCores}>
            <span className={estilo.legendaItem}>
              <span aria-hidden="true" className={estilo.pontoNaMeta} />
              na meta
            </span>
            <span className={estilo.legendaItem}>
              <span aria-hidden="true" className={estilo.pontoAbaixo} />
              abaixo da meta
            </span>
            <span className={estilo.legendaItem}>
              <span aria-hidden="true" className={estilo.pontoPrejuizo} />
              dando prejuízo
            </span>
          </p>
        </footer>
      </section>
    </>
  );
}

// ─── Os quatro números ───────────────────────────────────────────────────────

/** A ordem da barra de situação: do que está bem ao que ainda não se sabe. */
const ORDEM_DA_SITUACAO: readonly SituacaoDoProduto[] = [
  'na_meta',
  'abaixo',
  'prejuizo',
  'sem_vendas',
  'sem_custo',
];

const CLASSE_DA_SITUACAO: Readonly<Record<SituacaoDoProduto, string>> = {
  na_meta: estilo.pontoNaMeta,
  abaixo: estilo.pontoAbaixo,
  prejuizo: estilo.pontoPrejuizo,
  sem_vendas: estilo.pontoSemVendas,
  sem_custo: estilo.pontoSemCusto,
};

const CLASSE_DO_TRECHO: Readonly<Record<SituacaoDoProduto, string>> = {
  na_meta: estilo.trechoNaMeta,
  abaixo: estilo.trechoAbaixo,
  prejuizo: estilo.trechoPrejuizo,
  sem_vendas: estilo.trechoSemVendas,
  sem_custo: estilo.trechoSemCusto,
};

const LEGENDA_CURTA: Readonly<Record<SituacaoDoProduto, string>> = {
  na_meta: 'na meta',
  abaixo: 'abaixo',
  prejuizo: 'prejuízo',
  sem_vendas: 'sem vendas',
  sem_custo: 'sem custo',
};

/** Seus preços: quantos estão na meta, e a barra de cores com todos. */
function CartaoDosPrecos({ calculadas }: { readonly calculadas: readonly LinhaCalculada[] }) {
  const total = calculadas.length;
  const porSituacao = ORDEM_DA_SITUACAO.map((situacao) => ({
    situacao,
    quantos: calculadas.filter((c) => c.situacao === situacao).length,
  })).filter((s) => s.quantos > 0);
  const naMeta = calculadas.filter((c) => c.situacao === 'na_meta').length;

  return (
    <section className={estilo.cartaoNumero}>
      <TopoDoCartao icone={<SinalEtiqueta />} rotulo="Seus preços" />
      <p className={estilo.numero}>
        {naMeta}
        <span className={estilo.numeroResto}> de {total} na meta</span>
      </p>
      <div aria-hidden="true" className={estilo.barraDeSituacao}>
        {porSituacao.map(({ situacao, quantos }) => (
          <span
            className={CLASSE_DO_TRECHO[situacao]}
            key={situacao}
            style={{ flexGrow: quantos }}
          />
        ))}
      </div>
      <ul className={estilo.legendaDoNumero}>
        {porSituacao.map(({ situacao, quantos }) => (
          <li className={estilo.legendaItem} key={situacao}>
            <span aria-hidden="true" className={CLASSE_DA_SITUACAO[situacao]} />
            <span className={estilo.legendaQuantos}>{quantos}</span> {LEGENDA_CURTA[situacao]}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Vendidos em 30 dias: as unidades, e quanto cada loja vendeu. */
function CartaoDasVendas({ numeros }: { readonly numeros: NumerosDoCatalogo }) {
  return (
    <section className={estilo.cartaoNumero}>
      <TopoDoCartao icone={<SinalSacola />} rotulo="Vendidos em 30 dias" />
      <p className={estilo.numero}>
        {numeros.unidades}
        <span className={estilo.numeroResto}>
          {numeros.unidades === 1 ? ' unidade' : ' unidades'}
        </span>
      </p>
      <p className={estilo.numeroNota}>
        {numeros.faturamento > 0
          ? `${reaisCurtos(numeros.faturamento)} em vendas`
          : 'Nenhuma venda de produto do catálogo.'}
      </p>
      <VendasPorLoja unidades={numeros.unidadesPorLoja} />
    </section>
  );
}

/**
 * Lucro em 30 dias, no cartão escuro: o número que mais importa da tela, e o único que
 * ganha a cor da lateral. Embaixo, a régua do lucro de verdade até a meta.
 */
function CartaoDoLucro({
  numeros,
  meta,
}: {
  readonly numeros: NumerosDoCatalogo;
  readonly meta: Meta;
}) {
  const real = meta.tipo === 'percentual' ? numeros.margemRealBp : numeros.lucroPorUnidade;
  const textoDoReal =
    real === null
      ? null
      : meta.tipo === 'percentual'
        ? `${percentual(real)} do que você vendeu`
        : `${formatarBRL(centavos(real))} por unidade vendida`;

  return (
    <section className={estilo.cartaoEscuro}>
      <TopoDoCartao escuro icone={<SinalMoedas />} rotulo="Lucro em 30 dias" />
      <p className={numeros.lucro < 0 ? estilo.numeroEscuroPerda : estilo.numeroEscuro}>
        {formatarBRL(numeros.lucro)}
      </p>
      <p className={estilo.notaEscura}>
        {textoDoReal ??
          (numeros.unidades === 0
            ? 'Nenhuma venda nos últimos 30 dias.'
            : 'Os pedidos chegaram sem custo, e o lucro não saiu.')}
      </p>
      <ReguaDaMeta meta={meta} valor={real} />
    </section>
  );
}

const ATENCOES: readonly {
  readonly chave: Filtro;
  readonly ponto: string;
  readonly singular: string;
  readonly plural: string;
}[] = [
  {
    chave: 'sem_custo',
    ponto: estilo.pontoSemCusto,
    singular: 'sem custo',
    plural: 'sem custo',
  },
  {
    chave: 'prejuizo',
    ponto: estilo.pontoPrejuizo,
    singular: 'dando prejuízo',
    plural: 'dando prejuízo',
  },
  {
    chave: 'abaixo',
    ponto: estilo.pontoAbaixo,
    singular: 'abaixo da meta',
    plural: 'abaixo da meta',
  },
  {
    chave: 'custo_velho',
    ponto: estilo.pontoCustoVelho,
    singular: 'custo antigo',
    plural: 'custos antigos',
  },
];

/** O que pede a pessoa: cada linha filtra a tabela. Vazio, diz que está tudo em dia. */
function CartaoDaAtencao({
  contagens,
  aoFiltrar,
}: {
  readonly contagens: ReadonlyMap<Filtro, number>;
  readonly aoFiltrar: (filtro: Filtro) => void;
}) {
  const pendentes = ATENCOES.filter((a) => (contagens.get(a.chave) ?? 0) > 0);
  return (
    <section className={estilo.cartaoNumero}>
      <TopoDoCartao icone={<SinalSino />} rotulo="Pedem sua atenção" />
      {pendentes.length === 0 ? (
        <p className={estilo.tudoEmDia}>
          <span className={estilo.tudoEmDiaSinal}>
            <SinalCerto tamanho={14} />
          </span>
          Tudo em dia. Nenhum produto pede nada agora.
        </p>
      ) : (
        <ul className={estilo.atencoes}>
          {pendentes.map((a) => {
            const quantos = contagens.get(a.chave) ?? 0;
            return (
              <li key={a.chave}>
                <button className={estilo.atencao} onClick={() => aoFiltrar(a.chave)} type="button">
                  <span aria-hidden="true" className={a.ponto} />
                  <span className={estilo.atencaoQuantos}>{quantos}</span>
                  <span className={estilo.atencaoTexto}>
                    {quantos === 1 ? a.singular : a.plural}
                  </span>
                  <SinalAvancar tamanho={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── A tabela ────────────────────────────────────────────────────────────────

const CLASSE_DO_QUANTO_COBRA: Readonly<Record<NonNullable<CelulaDaTabela['situacao']>, string>> = {
  na_meta: estilo.cobraNaMeta,
  abaixo: estilo.cobraAbaixo,
  prejuizo: estilo.cobraPrejuizo,
};

function LinhaDoProduto({ item, meta }: { readonly item: LinhaCalculada; readonly meta: Meta }) {
  const { linha, celulas, situacao } = item;
  const semCusto = linha.ficha.custo === null;
  const formulario = `custo-${linha.id}`;
  return (
    <tr className={estilo.linha} id={`p-${linha.id}`}>
      <th className={estilo.celulaProduto} scope="row">
        <span className={estilo.produto}>
          <span aria-hidden="true" className={estilo.miniatura}>
            <SinalCaixa tamanho={18} />
          </span>
          <span className={estilo.produtoTextos}>
            <Link
              className={estilo.produtoNome}
              href={caminhoDoProduto(linha.id, { meta })}
              title={linha.nome}
            >
              {linha.nome}
            </Link>
            <span className={estilo.produtoDetalhe}>{linha.detalhe ?? 'Sem marca'}</span>
          </span>
        </span>
      </th>
      <td className={estilo.celulaCusto}>
        <CampoDeCusto
          custo={linha.ficha.custo}
          meta={meta}
          nome={linha.nome}
          skuId={linha.id}
          volta="lista"
          {...(semCusto ? { formulario } : {})}
        />
        {linha.custoQuando === null ? null : linha.custoVelho ? (
          // Custo antigo: a idade em âmbar, com o sinal de atenção. A pergunta inteira fica
          // na dica e no leitor de tela; escrita na casa, ela quebrava em duas linhas.
          <span className={estilo.custoVelho} title="Custo com mais de 30 dias. Ainda é esse?">
            <SinalAlerta tamanho={12} />
            {linha.custoQuando}
            <span className="sr-only">. Custo antigo: ainda é esse?</span>
          </span>
        ) : (
          <span className={estilo.custoQuando}>{linha.custoQuando}</span>
        )}
      </td>
      {semCusto ? (
        <td className={estilo.celulaEspera} colSpan={PLATAFORMAS.length}>
          <span className={estilo.espera}>
            <button className={estilo.botaoPequeno} form={formulario} type="submit">
              Salvar
            </button>
            <span className={estilo.esperaTexto}>
              <SinalVoltar />
              Diga quanto paga, e os preços aparecem aqui.
            </span>
          </span>
        </td>
      ) : (
        celulas.map((celula) => (
          <td className={estilo.celulaLoja} key={celula.plataforma}>
            <PrecoNaLoja celula={celula} meta={meta} skuId={linha.id} />
          </td>
        ))
      )}
      <td className={estilo.celulaSituacao}>
        <span className={estilo.situacao}>
          <span aria-hidden="true" className={CLASSE_DA_SITUACAO[situacao]} />
          {ROTULO_DA_SITUACAO[situacao]}
        </span>
      </td>
      <td className={estilo.celulaSeta}>
        <Link
          aria-label={`Abrir ${linha.nome}`}
          className={estilo.seta}
          href={caminhoDoProduto(linha.id, { meta })}
        >
          <SinalAvancar />
        </Link>
      </td>
    </tr>
  );
}

function PrecoNaLoja({
  celula,
  skuId,
  meta,
}: {
  readonly celula: CelulaDaTabela;
  readonly skuId: string;
  readonly meta: Meta;
}) {
  const conta = caminhoDoProduto(skuId, {
    plataforma: celula.plataforma,
    meta,
    ancora: 'preco-titulo',
  });
  const ganha =
    celula.margemHoje === null || celula.margemHojeBp === null
      ? ''
      : celula.margemHoje < 0
        ? `, e perde ${formatarBRL(centavos(Math.abs(celula.margemHoje)))} por venda`
        : `, e ganha ${formatarBRL(celula.margemHoje)} (${percentual(celula.margemHojeBp)}) por venda`;

  return (
    <span className={estilo.precoNaLoja}>
      {celula.cobre.tipo === 'preco' ? (
        <Link
          className={estilo.preco}
          href={conta}
          title={`Abrir a conta ${naLoja(celula.plataforma)}`}
        >
          {formatarBRL(celula.cobre.valor)}
        </Link>
      ) : (
        <span
          className={estilo.precoImpossivel}
          title={`${naLoja(celula.plataforma)}, nenhum preço até R$ 10.000 alcança esta meta`}
        >
          Não alcança
        </span>
      )}
      {celula.voceCobra === null || celula.situacao === null ? null : (
        <span
          className={CLASSE_DO_QUANTO_COBRA[celula.situacao]}
          title={`Você cobrou em média ${formatarBRL(celula.voceCobra)} em ${contagem(celula.unidades, 'unidade', 'unidades')}${ganha}.`}
        >
          <span className="sr-only">você cobra </span>
          hoje {formatarBRL(celula.voceCobra)}
          <span className="sr-only">, {ROTULO_DA_SITUACAO[celula.situacao].toLowerCase()}</span>
        </span>
      )}
    </span>
  );
}
