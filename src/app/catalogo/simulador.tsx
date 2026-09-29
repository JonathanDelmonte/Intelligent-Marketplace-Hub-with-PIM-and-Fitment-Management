'use client';

/**
 * O produto: quanto você paga, quanto cobrar em cada loja, e a conta de uma venda.
 *
 * No alto, os quatro números do produto, na ordem em que a conta anda: o custo, o preço
 * que alcança a meta, o que sobra por venda (no cartão escuro, que é a resposta) e o que
 * já se vendeu. Embaixo, o simulador: a loja, a meta, o preço, a curva de quanto se ganha
 * em cada preço e para onde vai cada real. Ao lado, as lojas comparadas e a ficha.
 *
 * Tudo roda no navegador, com o mesmo motor de margem do servidor: trocar de loja, mexer
 * na meta, digitar um preço ou arrastar a curva refaz a conta inteira na hora. A escolha
 * vai para a URL, para o link guardar a conta que se estava olhando.
 */
import Link from 'next/link';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import {
  MODOS_FRETE,
  PLATAFORMAS,
  TIPOS_ANUNCIO_ML,
  type ContextoDoVendedor,
  type ModoFrete,
  type Plataforma,
  type ResultadoDeMargem,
  type TipoAnuncioML,
} from '@/dominio/precificacao/tipos';
import type { CampoPresumido } from '@/dominio/precificacao/entrada';
import { degrausDe } from '@/dominio/precificacao/simulador';
import {
  centavos,
  centavosParaDigitar,
  formatarBRL,
  lerReaisDigitados,
  type Centavos,
} from '@/lib/dinheiro';
import { caminhoParaMontar } from '../anuncios/parametros';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import {
  naLoja,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_MODO_FRETE,
  ROTULO_DO_TIPO_ANUNCIO_ML,
} from '../ui/rotulos';
import { metaNaUrl } from './apresentacao';
import { ReguaDaMeta, TopoDoCartao, VendasPorLoja } from './cartoes';
import estilo from './catalogo.module.css';
import {
  avisosDaConta,
  contaDaVenda,
  curvaDeLucro,
  divisaoDoDinheiro,
  faixaDoGrafico,
  montarConta,
  notaDoEstimado,
  percentual,
  precoParaMeta,
  precoSemPrejuizo,
  reaisCurtos,
  textoDaMeta,
  type CenarioDaConta,
  type ChaveDaParte,
  type FichaDaConta,
  type Meta,
  type VendaNaLoja,
} from './conta';
import { CampoDeCusto } from './custo';
import { GraficoDeLucro } from './grafico';
import { ControleDaMeta } from './meta';
import {
  SinalAlerta,
  SinalAvancar,
  SinalCaixa,
  SinalCerto,
  SinalEtiqueta,
  SinalMoedas,
  SinalSacola,
} from '../ui/sinais';
import { gravarNaUrl } from './url';

/** O produto, como o servidor manda. */
export interface ProdutoDoSimulador {
  readonly id: string;
  readonly nome: string;
  readonly ativo: boolean;
  readonly ficha: FichaDaConta;
  /** "informado há 10 dias". `null` sem custo. */
  readonly custoTexto: string | null;
  readonly custoVelho: boolean;
  readonly vendas: Readonly<Partial<Record<Plataforma, VendaNaLoja>>>;
}

/** Com o que a tela abre: o que veio na URL. */
export interface InicioDoSimulador {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly meta: Meta;
  /** Preço que veio na URL, em centavos. `null` usa o preço da meta. */
  readonly preco: number | null;
}

interface Escolhas {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly meta: Meta;
  /** O preço como a pessoa digitou. `null` é "o preço da meta". */
  readonly precoTexto: string | null;
}

function gravarEscolhas(escolhas: Escolhas): void {
  gravarNaUrl((busca) => {
    busca.set('plataforma', escolhas.plataforma);
    const opcional = (chave: string, valor: string | null) => {
      if (valor === null) busca.delete(chave);
      else busca.set(chave, valor);
    };
    busca.delete('alvo');
    busca.delete('lucro');
    const meta = metaNaUrl(escolhas.meta);
    if (meta !== null) busca.set(meta[0], meta[1]);
    opcional('tipo', escolhas.tipoAnuncioML === 'classico' ? null : escolhas.tipoAnuncioML);
    opcional('frete', escolhas.modoFrete === 'comprador_paga' ? null : escolhas.modoFrete);
    opcional('preco', escolhas.precoTexto);
  });
}

export function PainelDoProduto({
  produto,
  vendedor,
  inicio,
  lateral,
}: {
  readonly produto: ProdutoDoSimulador;
  readonly vendedor: ContextoDoVendedor;
  readonly inicio: InicioDoSimulador;
  /** A ficha, a nota fiscal e o resto que é do servidor, embaixo das lojas comparadas. */
  readonly lateral: ReactNode;
}) {
  const [escolhas, setEscolhas] = useState<Escolhas>({
    plataforma: inicio.plataforma,
    tipoAnuncioML: inicio.tipoAnuncioML,
    modoFrete: inicio.modoFrete,
    meta: inicio.meta,
    precoTexto: inicio.preco === null ? null : centavosParaDigitar(centavos(inicio.preco)),
  });
  const { plataforma, tipoAnuncioML, modoFrete, meta, precoTexto } = escolhas;

  const mudar = (mudanca: Partial<Escolhas>) => {
    const proximas: Escolhas = { ...escolhas, ...mudanca };
    setEscolhas(proximas);
    gravarEscolhas(proximas);
  };

  const { ficha } = produto;
  const cenario: CenarioDaConta = useMemo(
    () => ({ plataforma, tipoAnuncioML, modoFrete, vendedor }),
    [plataforma, tipoAnuncioML, modoFrete, vendedor],
  );
  const presumidos = useMemo(() => montarConta(ficha, cenario).presumidos, [ficha, cenario]);
  const precoDaMeta = useMemo(() => precoParaMeta(ficha, cenario, meta), [ficha, cenario, meta]);
  const empate = useMemo(() => precoSemPrejuizo(ficha, cenario), [ficha, cenario]);
  const precoDaConta = precoTexto === null ? precoDaMeta : lerReaisDigitados(precoTexto);
  const resultado = useMemo(
    () => (precoDaConta === null ? null : contaDaVenda(ficha, cenario, precoDaConta)),
    [ficha, cenario, precoDaConta],
  );

  // O trecho do gráfico sai da meta e do empate, e só muda por causa do preço quando ele
  // sai do trecho: arrastar dentro do gráfico não pode mexer na escala debaixo do dedo.
  const degraus = useMemo(() => degrausDe(plataforma).map((d) => d.preco), [plataforma]);
  const faixaBase = useMemo(
    () =>
      ficha.custo === null ? null : faixaDoGrafico([precoDaMeta, empate], ficha.custo, degraus),
    [ficha.custo, precoDaMeta, empate, degraus],
  );
  const foraDaFaixa =
    faixaBase !== null &&
    precoDaConta !== null &&
    (precoDaConta < faixaBase.de || precoDaConta > faixaBase.ate);
  const faixa = useMemo(
    () =>
      faixaBase === null || !foraDaFaixa || ficha.custo === null
        ? faixaBase
        : faixaDoGrafico([precoDaMeta, empate, precoDaConta], ficha.custo, degraus),
    [faixaBase, foraDaFaixa, ficha.custo, precoDaMeta, empate, precoDaConta, degraus],
  );
  const curva = useMemo(
    () => (faixa === null ? [] : curvaDeLucro({ ficha, cenario, faixa })),
    [ficha, cenario, faixa],
  );
  const contaEm = useCallback(
    (preco: Centavos) => {
      const conta = contaDaVenda(ficha, cenario, preco);
      return conta === null
        ? null
        : { margemReais: conta.margemReais, margemPontosBase: conta.margemPontosBase };
    },
    [ficha, cenario],
  );
  const porLoja = useMemo(
    () =>
      PLATAFORMAS.map((p) => ({
        plataforma: p,
        preco: precoParaMeta(ficha, { ...cenario, plataforma: p }, meta),
      })),
    [ficha, cenario, meta],
  );

  const semCusto = ficha.custo === null;
  const unidadesPorLoja: Record<Plataforma, number> = { ml: 0, shopee: 0, amazon: 0 };
  for (const p of PLATAFORMAS) unidadesPorLoja[p] = produto.vendas[p]?.unidades ?? 0;
  const unidades = PLATAFORMAS.reduce((t, p) => t + unidadesPorLoja[p], 0);
  const faturamento = PLATAFORMAS.reduce((t, p) => t + (produto.vendas[p]?.faturamento ?? 0), 0);
  const vendaNaLoja = produto.vendas[plataforma];
  const mediaNaLoja =
    vendaNaLoja === undefined || vendaNaLoja.unidades <= 0
      ? null
      : centavos(Math.round(vendaNaLoja.faturamento / vendaNaLoja.unidades));

  return (
    <>
      <div className={estilo.numeros}>
        <section className={estilo.cartaoNumero}>
          <TopoDoCartao icone={<SinalCaixa />} rotulo="Você paga" />
          <CampoDeCusto
            custo={ficha.custo}
            focar={semCusto}
            meta={meta}
            nome={produto.nome}
            plataforma={plataforma}
            skuId={produto.id}
            volta="produto"
          />
          <p className={estilo.numeroNota}>
            {semCusto
              ? 'Por uma unidade, com o frete do fornecedor, se você paga.'
              : 'Por unidade. Clique no valor para mudar.'}
          </p>
          {produto.custoTexto === null ? null : (
            <p className={produto.custoVelho ? estilo.baseDoCartaoAtencao : estilo.baseDoCartao}>
              {produto.custoVelho ? <SinalAlerta tamanho={14} /> : <SinalCerto tamanho={14} />}
              <span>
                {produto.custoVelho
                  ? `Valor ${produto.custoTexto}. Ainda é esse?`
                  : `Valor ${produto.custoTexto}.`}
              </span>
            </p>
          )}
        </section>

        <section className={estilo.cartaoNumero}>
          <TopoDoCartao icone={<SinalEtiqueta />} rotulo="Preço para a meta" />
          <p className={precoDaMeta === null ? estilo.numeroVazio : estilo.numero}>
            {precoDaMeta === null
              ? semCusto
                ? 'Falta o custo'
                : 'Não alcança'
              : formatarBRL(precoDaMeta)}
          </p>
          <p className={estilo.numeroNota}>
            {precoDaMeta === null && !semCusto
              ? `Nenhum preço até R$ 10.000 chega lá ${naLoja(plataforma)}. Tente uma meta menor.`
              : `${primeiraMaiuscula(naLoja(plataforma))}, para ganhar ${textoDaMeta(meta)}.`}
          </p>
          <HojeVoceCobra media={mediaNaLoja} plataforma={plataforma} precoDaMeta={precoDaMeta} />
        </section>

        <CartaoDoGanho meta={meta} resultado={resultado} semCusto={semCusto} />

        <section className={estilo.cartaoNumero}>
          <TopoDoCartao icone={<SinalSacola />} rotulo="Vendidos em 30 dias" />
          <p className={estilo.numero}>
            {unidades}
            <span className={estilo.numeroResto}>{unidades === 1 ? ' unidade' : ' unidades'}</span>
          </p>
          <p className={estilo.numeroNota}>
            {faturamento > 0
              ? `${reaisCurtos(centavos(faturamento))} em vendas`
              : 'Nenhuma venda nas três lojas.'}
          </p>
          <VendasPorLoja destaque={plataforma} unidades={unidadesPorLoja} />
        </section>
      </div>

      <div className={estilo.corpoDoProduto}>
        <section aria-labelledby="preco-titulo" className={estilo.cartaoDoSimulador}>
          <header className={estilo.topoDoSimulador}>
            <div className={estilo.topoTextos}>
              <h2 className={estilo.tituloDoCartao} id="preco-titulo">
                Simular preço
              </h2>
              <p className={estilo.textoDoCartao}>
                {semCusto
                  ? 'A conta aparece quando você disser quanto paga.'
                  : 'Arraste no gráfico ou digite um preço.'}
              </p>
            </div>
            <div aria-label="Em qual loja" className={estilo.abasDeLoja} role="radiogroup">
              {PLATAFORMAS.map((p) => (
                <button
                  aria-checked={p === plataforma}
                  className={p === plataforma ? estilo.abaDeLojaAtual : estilo.abaDeLoja}
                  key={p}
                  onClick={() => mudar({ plataforma: p })}
                  role="radio"
                  type="button"
                >
                  <Selo identidade={IDENTIDADE_DA_LOJA[p]} tamanho={18} />
                  {ROTULO_DA_PLATAFORMA[p]}
                </button>
              ))}
            </div>
          </header>

          {semCusto ? (
            <EsperandoCusto />
          ) : (
            <>
              <div className={estilo.controlesDoSimulador}>
                <ControleDaMeta aoMudar={(nova) => mudar({ meta: nova })} meta={meta} />
                <CampoDoPreco
                  aoDigitar={(texto) => mudar({ precoTexto: texto })}
                  aoUsarMeta={() => mudar({ precoTexto: null })}
                  precoDaMeta={precoDaMeta}
                  precoTexto={precoTexto}
                />
                <div className={estilo.opcoesDoAnuncio}>
                  {plataforma === 'ml' ? (
                    <label className={estilo.opcaoDoAnuncio}>
                      <span className={estilo.rotuloDoCampo}>Tipo de anúncio</span>
                      <select
                        className={estilo.seletor}
                        onChange={(evento) => {
                          const tipo = TIPOS_ANUNCIO_ML.find((t) => t === evento.target.value);
                          if (tipo !== undefined) mudar({ tipoAnuncioML: tipo });
                        }}
                        value={tipoAnuncioML}
                      >
                        {TIPOS_ANUNCIO_ML.map((t) => (
                          <option key={t} value={t}>
                            {ROTULO_DO_TIPO_ANUNCIO_ML[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className={estilo.opcaoDoAnuncio}>
                    <span className={estilo.rotuloDoCampo}>Frete</span>
                    <select
                      className={estilo.seletor}
                      onChange={(evento) => {
                        const frete = MODOS_FRETE.find((f) => f === evento.target.value);
                        if (frete !== undefined) mudar({ modoFrete: frete });
                      }}
                      value={modoFrete}
                    >
                      {MODOS_FRETE.map((f) => (
                        <option key={f} value={f}>
                          {ROTULO_DO_MODO_FRETE[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {faixa === null || curva.length === 0 ? null : (
                <section aria-labelledby="curva-titulo" className={estilo.secaoDoSimulador}>
                  <header className={estilo.topoDaSecao}>
                    <h3 className={estilo.subtituloDoCartao} id="curva-titulo">
                      Quanto você ganha em cada preço
                    </h3>
                    <p aria-hidden="true" className={estilo.legendaDoGrafico}>
                      <span className={estilo.legendaItem}>
                        <span className={estilo.amostraGanha} />
                        ganha
                      </span>
                      <span className={estilo.legendaItem}>
                        <span className={estilo.amostraPerde} />
                        perde
                      </span>
                      <span className={estilo.legendaItem}>
                        <span className={estilo.amostraMeta} />
                        preço da meta
                      </span>
                    </p>
                  </header>
                  <GraficoDeLucro
                    aoEscolher={(preco) => mudar({ precoTexto: centavosParaDigitar(preco) })}
                    contaEm={contaEm}
                    empate={empate}
                    faixa={faixa}
                    pontos={curva}
                    preco={precoDaConta}
                    precoDaMeta={precoDaMeta}
                  />
                </section>
              )}

              {resultado === null ? (
                <p className={estilo.semConta}>Escreva um preço, como 49,90.</p>
              ) : (
                <>
                  <ParaOndeVai
                    plataforma={plataforma}
                    presumidos={presumidos}
                    resultado={resultado}
                  />
                  <Alertas resultado={resultado} />
                </>
              )}

              {produto.ativo ? (
                <footer className={estilo.rodapeDoSimulador} id="publicar-titulo">
                  <Link
                    className={estilo.botao}
                    href={caminhoParaMontar({
                      skuId: produto.id,
                      plataforma,
                      preco: precoDaConta,
                    })}
                  >
                    Montar anúncio {naLoja(plataforma)}
                    <SinalAvancar tamanho={14} />
                  </Link>
                  <span className={estilo.notaDoCartao}>
                    {precoDaConta === null
                      ? 'O preço você escolhe na tela do anúncio.'
                      : `O anúncio já sai com o preço de ${formatarBRL(precoDaConta)}.`}
                  </span>
                </footer>
              ) : null}
            </>
          )}
        </section>

        <aside aria-label="Lojas e ficha do produto" className={estilo.lateralDoProduto}>
          <CompararLojas
            aoEscolher={(p) => mudar({ plataforma: p })}
            meta={meta}
            plataforma={plataforma}
            porLoja={porLoja}
            semCusto={semCusto}
          />
          {lateral}
        </aside>
      </div>
    </>
  );
}

// ─── Os pedaços ──────────────────────────────────────────────────────────────

/** O cartão escuro do produto: quanto sobra por venda ao preço escolhido. */
function CartaoDoGanho({
  resultado,
  meta,
  semCusto,
}: {
  readonly resultado: ResultadoDeMargem | null;
  readonly meta: Meta;
  readonly semCusto: boolean;
}) {
  const perde = resultado !== null && resultado.margemReais < 0;
  const valor =
    resultado === null
      ? null
      : meta.tipo === 'percentual'
        ? resultado.margemPontosBase
        : resultado.margemReais;
  return (
    <section className={estilo.cartaoEscuro}>
      <TopoDoCartao
        escuro
        icone={<SinalMoedas />}
        rotulo={perde ? 'Você perde por venda' : 'Você ganha por venda'}
      />
      {resultado === null ? (
        <p className={estilo.numeroEscuroVazio}>Sem conta</p>
      ) : (
        <p className={perde ? estilo.numeroEscuroPerda : estilo.numeroEscuro}>
          {formatarBRL(centavos(Math.abs(resultado.margemReais)))}
        </p>
      )}
      <p className={estilo.notaEscura}>
        {resultado === null
          ? semCusto
            ? 'Precisa do custo para sair a conta.'
            : 'Escreva um preço para ver a conta.'
          : `${percentual(Math.abs(resultado.margemPontosBase))} do preço de ${formatarBRL(resultado.preco)}.`}
      </p>
      <ReguaDaMeta meta={meta} valor={valor} />
    </section>
  );
}

/**
 * O pé do cartão do preço: o que a pessoa cobra hoje nesta loja, perto do preço da meta.
 *
 * É a pergunta que ela faz logo depois de ver o preço da meta ("e eu, cobro quanto?"), e a
 * resposta vem com a diferença, na cor dela: âmbar quando falta, verde quando sobra.
 */
function HojeVoceCobra({
  media,
  precoDaMeta,
  plataforma,
}: {
  readonly media: Centavos | null;
  readonly precoDaMeta: Centavos | null;
  readonly plataforma: Plataforma;
}) {
  if (media === null) {
    return (
      <p className={estilo.baseDoCartao}>Nenhuma venda {naLoja(plataforma)} nos últimos 30 dias.</p>
    );
  }
  const diferenca = precoDaMeta === null ? null : media - precoDaMeta;
  return (
    <p className={estilo.baseEmPe}>
      <span>
        Hoje você cobra <strong className={estilo.baseForte}>{formatarBRL(media)}</strong>
      </span>
      {diferenca === null || diferenca === 0 ? null : (
        <span className={diferenca < 0 ? estilo.diferencaFalta : estilo.diferencaSobra}>
          {formatarBRL(centavos(Math.abs(diferenca)))}{' '}
          {diferenca < 0 ? 'abaixo da meta' : 'acima da meta'}
        </span>
      )}
    </p>
  );
}

function CampoDoPreco({
  precoTexto,
  precoDaMeta,
  aoDigitar,
  aoUsarMeta,
}: {
  readonly precoTexto: string | null;
  readonly precoDaMeta: Centavos | null;
  readonly aoDigitar: (texto: string) => void;
  readonly aoUsarMeta: () => void;
}) {
  const id = useId();
  return (
    <div className={estilo.campoDoPreco}>
      <label className={estilo.rotuloDoCampo} htmlFor={id}>
        Preço de venda
      </label>
      <span className={estilo.campoDinheiro}>
        <span aria-hidden="true" className={estilo.moeda}>
          R$
        </span>
        <input
          className={estilo.entradaDinheiro}
          id={id}
          inputMode="decimal"
          onChange={(evento) => aoDigitar(evento.target.value)}
          value={precoTexto ?? (precoDaMeta === null ? '' : centavosParaDigitar(precoDaMeta))}
        />
      </span>
      {precoTexto !== null && precoDaMeta !== null ? (
        <button className={estilo.botaoTexto} onClick={aoUsarMeta} type="button">
          Voltar ao preço da meta
        </button>
      ) : (
        <span className={estilo.notaDoCampo}>
          {precoDaMeta === null ? 'Digite o preço que quer testar.' : 'É o preço da meta.'}
        </span>
      )}
    </div>
  );
}

/** Sem custo, o simulador mostra o desenho da conta que vai aparecer, apagado. */
function EsperandoCusto() {
  return (
    <div className={estilo.esperandoCusto}>
      <svg aria-hidden="true" className={estilo.esperandoDesenho} viewBox="0 0 640 180">
        <line className={estilo.esperandoGrade} x1="0" x2="640" y1="40" y2="40" />
        <line className={estilo.esperandoGrade} x1="0" x2="640" y1="90" y2="90" />
        <line className={estilo.esperandoZero} x1="0" x2="640" y1="130" y2="130" />
        <path
          className={estilo.esperandoCurva}
          d="M0 168 C 90 150, 150 132, 210 118 S 330 80, 380 70 L 380 96 C 430 86, 520 60, 640 44"
        />
      </svg>
      <p className={estilo.esperandoTexto}>
        <strong>Diga quanto você paga por uma unidade</strong>
        no primeiro quadro, lá em cima. Aqui aparece quanto você ganha em cada preço, em cada loja.
      </p>
    </div>
  );
}

const CLASSE_DA_PARTE: Readonly<Record<ChaveDaParte, string>> = {
  fica: estilo.parteFica,
  produto: estilo.parteProduto,
  loja: estilo.parteLoja,
  frete: estilo.parteFrete,
  resto: estilo.parteResto,
};

/** Para onde vai cada real do preço: a barra, e a lista com o valor de cada parte. */
function ParaOndeVai({
  resultado,
  plataforma,
  presumidos,
}: {
  readonly resultado: ResultadoDeMargem;
  readonly plataforma: Plataforma;
  readonly presumidos: readonly CampoPresumido[];
}) {
  const divisao = divisaoDoDinheiro(resultado, plataforma, presumidos);
  const estimado = notaDoEstimado(resultado, presumidos);
  return (
    <section aria-labelledby="divisao-titulo" className={estilo.secaoDoSimulador}>
      <header className={estilo.topoDaSecao}>
        <h3 className={estilo.subtituloDoCartao} id="divisao-titulo">
          Para onde vão os {formatarBRL(resultado.preco)}
        </h3>
      </header>
      <div aria-hidden="true" className={estilo.barraDaDivisao}>
        {divisao.partes.map((parte) => (
          <span
            className={CLASSE_DA_PARTE[parte.chave]}
            key={parte.chave}
            style={{ flexGrow: parte.fracao }}
          />
        ))}
        {divisao.perde > 0 ? (
          <span
            className={estilo.excessoDaDivisao}
            style={{ left: `${String(divisao.fimDoPreco * 100)}%` }}
          />
        ) : null}
      </div>
      <dl className={estilo.partes}>
        {divisao.partes.map((parte) => (
          <div className={estilo.parte} key={parte.chave}>
            <dt className={estilo.parteRotulo}>
              <span aria-hidden="true" className={CLASSE_DA_PARTE[parte.chave]} />
              {parte.rotulo}
            </dt>
            <dd className={parte.chave === 'fica' ? estilo.parteValorFica : estilo.parteValor}>
              {formatarBRL(parte.valor)}
            </dd>
            <dd className={estilo.parteNota}>
              {percentual(Math.round((parte.valor * 10_000) / resultado.preco))} do preço
              {parte.presumido === null ? '' : ', estimado'}
            </dd>
          </div>
        ))}
      </dl>
      {divisao.perde > 0 ? (
        <p className={estilo.perdaDaDivisao}>
          O preço não paga tudo: faltam {formatarBRL(divisao.perde)} em cada venda, e esse dinheiro
          sai do seu bolso.
        </p>
      ) : null}
      <p className={estilo.notaDoCartao}>
        {estimado === null ? '' : `${estimado} `}Taxas da tabela {resultado.tabelaUsada}.
      </p>
    </section>
  );
}

/** Os avisos da conta, em português de balcão. */
function Alertas({ resultado }: { readonly resultado: ResultadoDeMargem }) {
  const avisos = avisosDaConta(resultado);
  if (avisos.length === 0) return null;
  return (
    <ul className={estilo.alertas}>
      {avisos.map((aviso) => (
        <li
          className={
            aviso.tom === 'erro'
              ? estilo.alertaErro
              : aviso.tom === 'atencao'
                ? estilo.alertaAtencao
                : estilo.alertaNota
          }
          key={aviso.codigo}
        >
          <SinalAlerta />
          <span>{aviso.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * As três lojas lado a lado: o preço que cada uma pede para a mesma meta.
 *
 * A barra começa do zero, de propósito: preços parecidos ficam com barras parecidas, e é
 * a verdade. Clicar numa loja troca a loja do simulador.
 */
function CompararLojas({
  porLoja,
  plataforma,
  meta,
  semCusto,
  aoEscolher,
}: {
  readonly porLoja: readonly { readonly plataforma: Plataforma; readonly preco: Centavos | null }[];
  readonly plataforma: Plataforma;
  readonly meta: Meta;
  readonly semCusto: boolean;
  readonly aoEscolher: (plataforma: Plataforma) => void;
}) {
  const conhecidos = porLoja.flatMap((l) => (l.preco === null ? [] : [l.preco]));
  const maior = Math.max(1, ...conhecidos);
  const menor = conhecidos.length > 1 ? Math.min(...conhecidos) : null;
  return (
    <section aria-labelledby="comparar-titulo" className={estilo.cartao}>
      <h2 className={estilo.tituloDoCartao} id="comparar-titulo">
        Comparar lojas
      </h2>
      <p className={estilo.textoDoCartao}>
        {semCusto
          ? 'O preço de cada loja aparece com o custo.'
          : `O preço para ganhar ${textoDaMeta(meta)} em cada uma.`}
      </p>
      <ul className={estilo.comparacao}>
        {porLoja.map((loja) => {
          const identidade = IDENTIDADE_DA_LOJA[loja.plataforma];
          const atual = loja.plataforma === plataforma;
          return (
            <li key={loja.plataforma}>
              <button
                aria-pressed={atual}
                className={atual ? estilo.lojaComparadaAtual : estilo.lojaComparada}
                onClick={() => aoEscolher(loja.plataforma)}
                type="button"
              >
                <span className={estilo.lojaComparadaTopo}>
                  <Selo identidade={identidade} tamanho={20} />
                  <span className={estilo.lojaComparadaNome}>
                    {ROTULO_DA_PLATAFORMA[loja.plataforma]}
                  </span>
                  <span
                    className={
                      loja.preco === null ? estilo.lojaComparadaSem : estilo.lojaComparadaPreco
                    }
                  >
                    {loja.preco === null
                      ? semCusto
                        ? 'Falta o custo'
                        : 'Não alcança'
                      : formatarBRL(loja.preco)}
                  </span>
                </span>
                <span aria-hidden="true" className={estilo.trilhoDaLoja}>
                  <span
                    className={estilo.barraDaLoja}
                    style={{
                      background: identidade.fundo,
                      width: `${String(loja.preco === null ? 0 : (loja.preco / maior) * 100)}%`,
                    }}
                  />
                </span>
                {menor !== null && loja.preco === menor ? (
                  <span className={estilo.menorPreco}>O menor preço das três</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {semCusto ? null : (
        <p className={estilo.notaDoCartao}>Clique numa loja para ver a conta dela.</p>
      )}
    </section>
  );
}

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
