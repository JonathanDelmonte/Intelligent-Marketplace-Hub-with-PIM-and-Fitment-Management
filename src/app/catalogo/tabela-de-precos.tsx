'use client';

/**
 * A tabela de preços: cada produto numa linha, cada loja numa coluna, e em cada casa o
 * preço que deixa com você a parte que você pediu.
 *
 * É a planilha de formação de preço que todo pequeno comerciante já viu (a do Sebrae é a
 * mais conhecida), com duas diferenças que só a tela dá: o número de cima refaz a tabela
 * inteira na hora, e a casa mostra ao lado o que você cobra de verdade, tirado das vendas
 * dos últimos 30 dias. Quando o que você cobra é menos do que a tabela pede, ele aparece em
 * laranja.
 *
 * Produto sem custo não tem preço: a casa mostra "?", e a linha pergunta o custo ali
 * mesmo, sem abrir outra tela. É a pergunta no lugar do formulário, e é o que a linha
 * precisa para deixar de ser um buraco na tabela.
 */
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  PLATAFORMAS,
  type ContextoDoVendedor,
  type Plataforma,
} from '@/dominio/precificacao/tipos';
import { centavos, centavosParaDigitar, formatarBRL } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { naLoja, ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { salvarCusto } from './acoes';
import { SeletorDeAlvo } from './alvo';
import { alvoEmPercentual, caminhoDoProduto, PERGUNTA_DO_CUSTO_VELHO } from './apresentacao';
import estilo from './catalogo.module.css';
import { MARGEM_ALVO_PADRAO_BP } from './constantes';
import {
  celulasDoProduto,
  fraseDoAlvo,
  type CelulaDaTabela,
  type FichaDaConta,
  type VendaNaLoja,
} from './conta';

/** Uma linha da tabela, como o servidor manda. */
export interface LinhaDaTabela {
  readonly id: string;
  readonly nome: string;
  /** Marca e código de barras, já juntos. */
  readonly detalhe: string | null;
  readonly ficha: FichaDaConta;
  /** "informado há 10 dias". `null` sem custo. */
  readonly custoTexto: string | null;
  readonly custoVelho: boolean;
  readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
}

/**
 * O alvo vai para a URL, sem recarregar: o link da tela guarda o número escolhido, e
 * voltar do produto para a tabela não o perde. O aviso da última ação sai junto, para
 * não reaparecer num recarregamento.
 */
function gravarAlvoNaUrl(alvoBp: number): void {
  const url = new URL(window.location.href);
  if (alvoBp === MARGEM_ALVO_PADRAO_BP) url.searchParams.delete('alvo');
  else url.searchParams.set('alvo', alvoEmPercentual(alvoBp));
  url.searchParams.delete('r');
  window.history.replaceState(window.history.state, '', url);
}

export function TabelaDePrecos({
  linhas,
  vendedor,
  alvoInicialBp,
}: {
  readonly linhas: readonly LinhaDaTabela[];
  readonly vendedor: ContextoDoVendedor;
  readonly alvoInicialBp: number;
}) {
  const [alvoBp, setAlvoBp] = useState(alvoInicialBp);
  // A conta de duzentos produtos em três lojas leva um instante. Adiada, ela não trava o
  // campo: o número muda na hora, e a tabela logo depois.
  const alvoDaConta = useDeferredValue(alvoBp);

  const calculadas = useMemo(
    () =>
      linhas.map((linha) => ({
        linha,
        celulas: celulasDoProduto({
          ficha: linha.ficha,
          vendas: linha.vendas,
          alvoBp: alvoDaConta,
          vendedor,
          tipoAnuncioML: 'classico',
          modoFrete: 'comprador_paga',
        }),
      })),
    [linhas, alvoDaConta, vendedor],
  );

  const algumaAbaixo = calculadas.some(({ celulas }) => celulas.some((c) => c.abaixo));

  return (
    <section aria-label="Tabela de preços" className={estilo.tabelaDePrecos}>
      <SeletorDeAlvo
        alvoBp={alvoBp}
        aoMudar={(novo) => {
          setAlvoBp(novo);
          gravarAlvoNaUrl(novo);
        }}
      />

      <div className={estilo.folha}>
        <table className={estilo.tabela}>
          <thead>
            <tr>
              <th className={estilo.cabecaProduto} scope="col">
                Produto
              </th>
              <th className={estilo.cabecaCusto} scope="col">
                Você paga
              </th>
              {PLATAFORMAS.map((plataforma) => (
                <th className={estilo.cabecaLoja} key={plataforma} scope="col">
                  <span className={estilo.cabecaLojaNome}>
                    <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={18} />
                    {ROTULO_DA_PLATAFORMA[plataforma]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calculadas.map(({ linha, celulas }) => (
              <LinhaDoProduto alvoBp={alvoBp} celulas={celulas} key={linha.id} linha={linha} />
            ))}
          </tbody>
        </table>
      </div>

      {algumaAbaixo ? (
        <p className={estilo.legenda}>
          <span aria-hidden="true" className={estilo.legendaAmostra} />
          Em laranja, o que você cobra hoje está abaixo do preço da tabela.
        </p>
      ) : null}
    </section>
  );
}

function LinhaDoProduto({
  linha,
  celulas,
  alvoBp,
}: {
  readonly linha: LinhaDaTabela;
  readonly celulas: readonly CelulaDaTabela[];
  readonly alvoBp: number;
}) {
  const semCusto = linha.ficha.custo === null;
  return (
    <tr className={semCusto ? estilo.linhaPendente : estilo.linha} id={`p-${linha.id}`}>
      <th className={estilo.celulaProduto} scope="row">
        <Link className={estilo.nome} href={caminhoDoProduto(linha.id, { alvoBp })}>
          {linha.nome}
        </Link>
        {linha.detalhe === null ? null : <span className={estilo.detalhe}>{linha.detalhe}</span>}
      </th>
      <td className={estilo.celulaCusto} data-rotulo="Você paga">
        <CustoNaTabela alvoBp={alvoBp} linha={linha} />
      </td>
      {celulas.map((celula) => (
        <td
          className={estilo.celulaLoja}
          data-rotulo={ROTULO_DA_PLATAFORMA[celula.plataforma]}
          key={celula.plataforma}
        >
          <PrecoNaTabela alvoBp={alvoBp} celula={celula} skuId={linha.id} />
        </td>
      ))}
    </tr>
  );
}

/**
 * O custo da linha: a pergunta, quando falta, e o valor clicável, quando existe.
 *
 * O formulário é a ação do servidor de sempre, com `volta=lista`: salvar devolve para a
 * tabela, na mesma linha, com o alvo que estava escolhido.
 */
function CustoNaTabela({
  linha,
  alvoBp,
}: {
  readonly linha: LinhaDaTabela;
  readonly alvoBp: number;
}) {
  const [editando, setEditando] = useState(false);
  const custo = linha.ficha.custo;

  if (custo === null || editando) {
    return (
      <form action={salvarCusto} className={estilo.formCusto}>
        <input name="id" type="hidden" value={linha.id} />
        <input name="volta" type="hidden" value="lista" />
        <input name="alvo" type="hidden" value={alvoEmPercentual(alvoBp)} />
        <label className={estilo.campoCusto}>
          <span className="sr-only">Quanto você paga por {linha.nome}</span>
          <span aria-hidden="true" className={estilo.moeda}>
            R$
          </span>
          <input
            autoFocus={editando}
            className={estilo.entradaCusto}
            defaultValue={custo === null ? '' : centavosParaDigitar(centavos(custo))}
            inputMode="decimal"
            name="custo"
            placeholder="0,00"
            required
            type="text"
          />
        </label>
        <button className={estilo.salvarCusto} type="submit">
          Salvar
        </button>
        {editando ? (
          <button className={estilo.cancelar} onClick={() => setEditando(false)} type="button">
            Cancelar
          </button>
        ) : null}
      </form>
    );
  }

  return (
    <span className={estilo.custo}>
      <button
        className={estilo.custoValor}
        onClick={() => setEditando(true)}
        title="Mudar o custo"
        type="button"
      >
        {formatarBRL(centavos(custo))}
      </button>
      {linha.custoTexto === null ? null : (
        <span className={linha.custoVelho ? estilo.custoVelho : estilo.custoQuando}>
          {linha.custoTexto}
        </span>
      )}
      {linha.custoVelho ? (
        <span className={estilo.custoVelho}>{PERGUNTA_DO_CUSTO_VELHO}</span>
      ) : null}
    </span>
  );
}

function PrecoNaTabela({
  celula,
  skuId,
  alvoBp,
}: {
  readonly celula: CelulaDaTabela;
  readonly skuId: string;
  readonly alvoBp: number;
}) {
  const conta = caminhoDoProduto(skuId, {
    plataforma: celula.plataforma,
    alvoBp,
    ancora: 'preco-titulo',
  });

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
      ) : celula.cobre.tipo === 'sem_custo' ? (
        <span className={estilo.precoVazio} title="Diga quanto você paga, e o preço aparece">
          ?
        </span>
      ) : (
        <span
          className={estilo.precoImpossivel}
          title={`${naLoja(celula.plataforma)}, nenhum preço até R$ 10.000 deixa ${fraseDoAlvo(alvoBp)}`}
        >
          não dá
        </span>
      )}
      {celula.voceCobra === null ? null : (
        <span
          className={celula.abaixo ? estilo.voceCobraAbaixo : estilo.voceCobra}
          title={`Média de ${contagem(celula.unidades, 'unidade vendida', 'unidades vendidas')} nos últimos 30 dias`}
        >
          você cobra {formatarBRL(celula.voceCobra)}
          {celula.abaixo ? <span className="sr-only">, abaixo do preço da tabela</span> : null}
        </span>
      )}
    </span>
  );
}
