/**
 * Componentes da tela de catálogo. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O simulador de preço é um formulário `GET`: os parâmetros viajam na URL, a página
 * renderiza no servidor, e o resultado é compartilhável e sobrevive a recarregar. Sem
 * JavaScript de cliente para uma tela que só precisa recalcular quando alguém pede.
 */
import Link from 'next/link';
import type { SkuGravado } from '@/dominio/catalogo/sku';
import type { SimulacaoDeFaixa } from '@/dominio/precificacao/simulador';
import {
  MODOS_FRETE,
  PLATAFORMAS,
  TIPOS_ANUNCIO_ML,
  type Aviso as AvisoDeMargem,
  type ResultadoDeMargem,
} from '@/dominio/precificacao/tipos';
import { centavos, centavosParaReais, formatarBRL } from '@/lib/dinheiro';
import {
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_MODO_FRETE,
  ROTULO_DO_TIPO_ANUNCIO_ML,
} from '../ui/rotulos';
import { formatarRelativo } from '../ui/tempo';
import { criarProduto, salvarCusto, salvarFicha } from './acoes';
import {
  alvoEmPercentual,
  estadoDoProduto,
  etiquetaDoProduto,
  linhasDaDecomposicao,
  margemLegivel,
  ordenarAvisos,
  TOM_DA_SEVERIDADE,
  type Aviso,
  type ParametrosDoSimulador,
} from './apresentacao';
import { CAMINHO } from './constantes';
import estilo from './catalogo.module.css';

export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? estilo.avisoErro
      : aviso.tom === 'atencao'
        ? estilo.avisoAtencao
        : estilo.aviso;
  return (
    <div className={classe} role="status">
      <strong className={estilo.avisoTitulo}>{aviso.titulo}</strong>
      <span className={estilo.avisoCorpo}>{aviso.corpo}</span>
    </div>
  );
}

/**
 * Um número em reais do jeito que se digita de volta no campo: sem "R$".
 *
 * Recebe número cru porque é o que a linha do banco devolve, e a marca `Centavos` é
 * posta na borda — aqui, com `centavos()`, e não com `as`.
 */
function reaisNoCampo(valor: number | null): string {
  return valor === null ? '' : centavosParaReais(centavos(valor)).toFixed(2).replace('.', ',');
}

export function Produtos({
  produtos,
  agora,
}: {
  readonly produtos: readonly SkuGravado[];
  readonly agora: Date;
}) {
  if (produtos.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhum produto ainda. O catálogo é o que liga o que você compra ao que você anuncia — sem
        ele, a margem não tem de onde sair.
      </p>
    );
  }

  return (
    <ul className={estilo.lista}>
      {produtos.map((produto) => {
        const etiqueta = etiquetaDoProduto(estadoDoProduto(produto, agora));
        const classe =
          etiqueta.tom === 'ok'
            ? estilo.etiquetaOk
            : etiqueta.tom === 'alerta'
              ? estilo.etiquetaAlerta
              : estilo.etiquetaAtencao;

        return (
          <li className={estilo.item} key={produto.id}>
            <div className={estilo.itemCabecalho}>
              <div>
                <h3 className={estilo.itemTitulo}>
                  <Link className={estilo.link} href={`${CAMINHO}/${produto.id}`}>
                    {produto.tituloInterno}
                  </Link>
                </h3>
                <p className={estilo.itemSub}>
                  {produto.marca ?? 'sem marca'}
                  {produto.ean === null ? '' : ` · ${produto.ean}`}
                  {' · '}
                  {produto.custoAtual === null
                    ? 'custo não informado'
                    : `custo ${formatarBRL(centavos(produto.custoAtual))}`}
                  {produto.custoAtualizadoEm === null
                    ? ''
                    : ` (${formatarRelativo(produto.custoAtualizadoEm, agora)})`}
                </p>
              </div>
              <span className={classe}>{etiqueta.texto}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FormularioDeProduto() {
  return (
    <form action={criarProduto} className={estilo.formulario}>
      <label className={estilo.campoLargo}>
        O que é
        <input
          className={estilo.entrada}
          maxLength={200}
          name="titulo"
          placeholder="Refil de purificador de água PA21G"
          required
          type="text"
        />
        <span className={estilo.ajuda}>
          O nome que <strong>você</strong> usa para reconhecer a peça. O título do anúncio é outro,
          e a tela de montar anúncio gera aquele.
        </span>
      </label>

      <label className={estilo.campo}>
        Código de barras
        <input
          className={estilo.entrada}
          inputMode="numeric"
          name="ean"
          placeholder="7898123456789"
          type="text"
        />
        <span className={estilo.ajuda}>
          Opcional, e conferido pelo dígito verificador. É o que o leitor da loja procura.
        </span>
      </label>

      <label className={estilo.campo}>
        Marca
        <input className={estilo.entrada} maxLength={80} name="marca" type="text" />
      </label>

      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Acrescentar
        </button>
      </div>
    </form>
  );
}

/**
 * O custo, com a idade dele.
 *
 * Formulário próprio porque a data do custo é gravada junto, e é ela que responde se o
 * número ainda vale. Salvar peso não pode reescrever essa data.
 */
export function FormularioDeCusto({
  sku,
  agora,
}: {
  readonly sku: SkuGravado;
  readonly agora: Date;
}) {
  return (
    <form action={salvarCusto} className={estilo.formulario}>
      <input name="id" type="hidden" value={sku.id} />
      <label className={estilo.campo}>
        Custo de compra
        <input
          className={estilo.entrada}
          defaultValue={reaisNoCampo(sku.custoAtual)}
          inputMode="decimal"
          name="custo"
          placeholder="18,40"
          required
          type="text"
        />
        <span className={estilo.ajuda}>
          {sku.custoAtualizadoEm === null
            ? 'Nunca informado. Sem custo, a margem que a tela mostra é o teto.'
            : `Informado ${formatarRelativo(sku.custoAtualizadoEm, agora)}.`}
        </span>
      </label>

      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Salvar custo
        </button>
      </div>
    </form>
  );
}

/**
 * O resto da ficha.
 *
 * Os três campos que a margem usa além do custo — peso, dimensão e devolução — mais a
 * marca, que é a que aparece na lista. Cada um em branco entra presumido no cálculo, e
 * o simulador diz quais.
 *
 * Todo campo numérico é `type="text"` com `inputMode`, e não `type="number"`:
 * `type="number"` **não aceita vírgula**, então quem digita "2,5" na devolução perde o
 * que digitou sem aviso — e 2,5% é como se escreve em português. O `inputMode` dá o
 * teclado numérico no celular do mesmo jeito, e a leitura do lado do servidor já troca
 * vírgula por ponto. Apareceu exercitando o formulário no navegador.
 */
export function FormularioDaFicha({ sku }: { readonly sku: SkuGravado }) {
  return (
    <form action={salvarFicha} className={estilo.formulario}>
      <input name="id" type="hidden" value={sku.id} />

      <label className={estilo.campo}>
        Peso, em gramas
        <input
          className={estilo.entrada}
          defaultValue={sku.pesoG ?? ''}
          inputMode="numeric"
          name="pesoG"
          placeholder="420"
          type="text"
        />
        <span className={estilo.ajuda}>
          Na balança, com embalagem. É o que decide a faixa de frete.
        </span>
      </label>

      <label className={estilo.campo}>
        Devolução esperada, em %
        <input
          className={estilo.entrada}
          defaultValue={
            sku.taxaDevolucaoEsperadaBp === null
              ? ''
              : String(sku.taxaDevolucaoEsperadaBp / 100).replace('.', ',')
          }
          inputMode="decimal"
          name="devolucao"
          placeholder="2,5"
          type="text"
        />
      </label>

      <label className={estilo.campo}>
        Marca
        <input
          className={estilo.entrada}
          defaultValue={sku.marca ?? ''}
          maxLength={80}
          name="marca"
          type="text"
        />
      </label>

      <fieldset className={estilo.medidas}>
        <legend className={estilo.legenda}>Medida da caixa, em milímetros</legend>
        {(
          [
            ['comprimento', 'Comprimento'],
            ['largura', 'Largura'],
            ['altura', 'Altura'],
          ] as const
        ).map(([nome, rotulo]) => (
          <label className={estilo.campoMiudo} key={nome}>
            {rotulo}
            <input
              className={estilo.entradaMiuda}
              defaultValue={sku.dimMm?.[nome] ?? ''}
              inputMode="decimal"
              name={nome}
              type="text"
            />
          </label>
        ))}
        <span className={estilo.ajuda}>
          Os três juntos ou nenhum: dois lados medidos e um em branco não é medida, é medida pela
          metade.
        </span>
      </fieldset>

      <fieldset className={estilo.medidas}>
        <legend className={estilo.legenda}>O que o comprador confere antes de comprar</legend>

        <label className={estilo.campo}>
          Voltagem
          <input
            className={estilo.entrada}
            defaultValue={sku.voltagem ?? ''}
            maxLength={60}
            name="voltagem"
            placeholder="Bivolt"
            type="text"
          />
        </label>

        <label className={estilo.campoLargo}>
          Medida que decide se encaixa
          <input
            className={estilo.entrada}
            defaultValue={sku.medida ?? ''}
            maxLength={120}
            name="medida"
            placeholder="Rosca 1/2 polegada"
            type="text"
          />
          <span className={estilo.ajuda}>
            A medida da peça, com a unidade — não a da caixa, que é o quadro acima.
          </span>
        </label>

        <label className={estilo.campo}>
          Peças na embalagem
          <input
            className={estilo.entrada}
            defaultValue={sku.quantidadeEmbalagem ?? ''}
            inputMode="numeric"
            name="quantidade"
            placeholder="2"
            type="text"
          />
        </label>

        <span className={estilo.ajudaDoQuadro}>
          Voltagem trocada, medida que não encaixa e quantidade diferente da esperada voltam — o
          checklist do anúncio cobra os três no nível de um anúncio que não sai.
        </span>
      </fieldset>

      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Salvar ficha
        </button>
      </div>
    </form>
  );
}

/**
 * Os parâmetros do simulador, num formulário `GET`.
 *
 * O tipo de anúncio aparece sempre, e não só no Mercado Livre: esconder e mostrar campo
 * exigiria JavaScript, e o M8 já ignora o campo nas outras plataformas. O rótulo diz
 * que ele é do ML.
 */
export function FormularioDoSimulador({
  parametros,
}: {
  readonly parametros: ParametrosDoSimulador;
}) {
  return (
    <form className={estilo.formulario} method="get">
      <label className={estilo.campo}>
        Onde vender
        <select className={estilo.entrada} defaultValue={parametros.plataforma} name="plataforma">
          {PLATAFORMAS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_DA_PLATAFORMA[p]}
            </option>
          ))}
        </select>
      </label>

      <label className={estilo.campo}>
        Tipo de anúncio (ML)
        <select className={estilo.entrada} defaultValue={parametros.tipoAnuncioML} name="tipo">
          {TIPOS_ANUNCIO_ML.map((t) => (
            <option key={t} value={t}>
              {ROTULO_DO_TIPO_ANUNCIO_ML[t]}
            </option>
          ))}
        </select>
      </label>

      <label className={estilo.campo}>
        Frete
        <select className={estilo.entrada} defaultValue={parametros.modoFrete} name="frete">
          {MODOS_FRETE.map((f) => (
            <option key={f} value={f}>
              {ROTULO_DO_MODO_FRETE[f]}
            </option>
          ))}
        </select>
      </label>

      <label className={estilo.campo}>
        Margem que eu quero, em %
        <input
          className={estilo.entrada}
          defaultValue={alvoEmPercentual(parametros.margemAlvoBp)}
          inputMode="decimal"
          min={1}
          name="alvo"
          type="text"
        />
      </label>

      <label className={estilo.campo}>
        Preço a conferir
        <input
          className={estilo.entrada}
          defaultValue={parametros.preco === null ? '' : reaisNoCampo(parametros.preco)}
          inputMode="decimal"
          name="preco"
          placeholder="79,90"
          type="text"
        />
        <span className={estilo.ajuda}>
          Opcional. Com preço, a tela abre a conta linha por linha.
        </span>
      </label>

      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Calcular
        </button>
      </div>
    </form>
  );
}

export function Presuncoes({ textos }: { readonly textos: readonly string[] }) {
  if (textos.length === 0) return null;

  return (
    <div className={estilo.presuncoes}>
      <strong className={estilo.presuncoesTitulo}>O cálculo presumiu:</strong>
      <ul className={estilo.listaDePresuncoes}>
        {textos.map((texto) => (
          <li key={texto}>{texto}</li>
        ))}
      </ul>
    </div>
  );
}

export function AvisosDaMargem({ avisos }: { readonly avisos: readonly AvisoDeMargem[] }) {
  if (avisos.length === 0) return null;

  return (
    <ul className={estilo.listaDeAvisos}>
      {ordenarAvisos(avisos).map((aviso) => {
        const tom = TOM_DA_SEVERIDADE[aviso.severidade];
        const classe =
          tom === 'erro'
            ? estilo.avisoDeMargemErro
            : tom === 'atencao'
              ? estilo.avisoDeMargemAtencao
              : estilo.avisoDeMargem;
        return (
          <li className={classe} key={aviso.codigo}>
            {aviso.mensagem}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A conta, linha por linha, do preço até a sobra.
 *
 * Na ordem em que o dinheiro sai. É a ordem que responde "para onde foi", e é o que
 * transforma "margem de 12%" em algo conferível.
 */
export function Decomposicao({ resultado }: { readonly resultado: ResultadoDeMargem }) {
  const negativa = resultado.margemReais < 0;

  return (
    <>
      <div className={negativa ? estilo.veredictoRuim : estilo.veredicto}>
        <strong className={estilo.veredictoNumero}>
          {formatarBRL(resultado.margemReais)} · {margemLegivel(resultado.margemPontosBase)}
        </strong>
        <span className={estilo.veredictoNota}>
          {negativa
            ? 'Prejuízo por unidade a este preço.'
            : `Sobra por unidade, depois de tudo. Repasse líquido: ${formatarBRL(resultado.repasseLiquido)}.`}
          {resultado.markupSobreCusto === null
            ? ''
            : ` Markup de ${resultado.markupSobreCusto.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× sobre o custo.`}
        </span>
      </div>

      <div className={estilo.envelopeDaTabela}>
        <table className={estilo.tabela}>
          <caption className={estilo.legendaDaTabela}>
            Tabela usada: {resultado.tabelaUsada}
          </caption>
          <tbody>
            {linhasDaDecomposicao(resultado).map((linha) => (
              <tr key={linha.rotulo}>
                <th className={estilo.rotuloDaLinha} scope="row">
                  {linha.rotulo}
                </th>
                <td className={estilo.numero}>
                  {linha.subtrai ? '−' : ''}
                  {formatarBRL(linha.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AvisosDaMargem avisos={resultado.avisos} />
    </>
  );
}

/**
 * A faixa de preço que funciona, com os degraus.
 *
 * Degrau é onde a comissão ou o frete mudam de faixa: um centavo a mais e a margem cai.
 * A fase 1 calcula isso desde o começo e nunca teve onde aparecer.
 */
export function Faixas({ simulacao }: { readonly simulacao: SimulacaoDeFaixa }) {
  return (
    <>
      {simulacao.faixasRecomendadas.length === 0 ? (
        <p className={estilo.vazio}>
          Nenhuma faixa recomendada nesta varredura. Com o custo e a comissão de hoje, não há trecho
          de preço que valha a pena — e saber disso antes de anunciar é o ponto.
        </p>
      ) : (
        <ul className={estilo.lista}>
          {simulacao.faixasRecomendadas.map((faixa) => (
            <li className={estilo.item} key={`${String(faixa.de)}-${String(faixa.ate)}`}>
              <h3 className={estilo.itemTitulo}>
                {formatarBRL(faixa.de)} a {formatarBRL(faixa.ate)}
              </h3>
              <p className={estilo.itemCorpo}>{faixa.motivo}</p>
            </li>
          ))}
        </ul>
      )}

      {simulacao.degraus.length > 0 && (
        <details className={estilo.bloco}>
          <summary className={estilo.resumoDoBloco}>
            ver os {simulacao.degraus.length} degraus de preço desta plataforma
          </summary>
          <ul className={estilo.listaMiuda}>
            {simulacao.degraus.map((degrau) => (
              <li className={estilo.degrau} key={`${degrau.rotulo}-${String(degrau.preco)}`}>
                <span>{formatarBRL(degrau.preco)}</span>
                <span className={estilo.itemSub}>{degrau.rotulo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function Ocorrencias({
  ocorrencias,
}: {
  readonly ocorrencias: readonly {
    readonly id: string;
    readonly tituloBruto: string;
    readonly preco: number | null;
    readonly plataformaOuSite: string | null;
    readonly url: string | null;
  }[];
}) {
  if (ocorrencias.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhuma ocorrência ligada. Ocorrência é anúncio ou linha de planilha que fala deste mesmo
        produto — elas entram pela importação e são ligadas na tela de juntar iguais.
      </p>
    );
  }

  return (
    <ul className={estilo.listaMiuda}>
      {ocorrencias.map((ocorrencia) => (
        <li className={estilo.ocorrencia} key={ocorrencia.id}>
          <span>
            {ocorrencia.url === null ? (
              ocorrencia.tituloBruto
            ) : (
              <a
                className={estilo.link}
                href={ocorrencia.url}
                rel="noreferrer nofollow"
                target="_blank"
              >
                {ocorrencia.tituloBruto}
              </a>
            )}
          </span>
          <span className={estilo.itemSub}>
            {ocorrencia.plataformaOuSite ?? 'origem não informada'}
            {ocorrencia.preco === null ? '' : ` · ${formatarBRL(centavos(ocorrencia.preco))}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
