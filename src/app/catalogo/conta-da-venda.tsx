'use client';

/**
 * Quanto cobrar por um produto, e a conta de uma venda: o cupom.
 *
 * O cupom é o papel que qualquer pessoa já leu: o preço em cima, cada saída numa linha, e
 * o total embaixo de um traço duplo, que é como a contabilidade fecha uma conta. Aqui o
 * total é o que fica com você.
 *
 * Tudo roda no navegador, com o mesmo motor de margem do servidor: trocar de loja, mexer
 * no quanto quer ficar ou digitar um preço refaz a conta na hora, sem recarregar. A
 * escolha vai para a URL, para o link guardar a conta que se estava olhando.
 */
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import {
  MODOS_FRETE,
  PLATAFORMAS,
  TIPOS_ANUNCIO_ML,
  type ContextoDoVendedor,
  type ModoFrete,
  type Plataforma,
  type TipoAnuncioML,
} from '@/dominio/precificacao/tipos';
import { centavos, centavosParaDigitar, formatarBRL, lerReaisDigitados } from '@/lib/dinheiro';
import { caminhoParaMontar } from '../anuncios/parametros';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import {
  naLoja,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DO_MODO_FRETE,
  ROTULO_DO_TIPO_ANUNCIO_ML,
} from '../ui/rotulos';
import { SeletorDeAlvo } from './alvo';
import { alvoEmPercentual } from './apresentacao';
import estilo from './catalogo.module.css';
import { MARGEM_ALVO_PADRAO_BP } from './constantes';
import {
  avisosDaConta,
  contaDaVenda,
  ficaDeCadaCem,
  fraseDoAlvo,
  linhasDoCupom,
  montarConta,
  notaDoEstimado,
  precoParaFicarCom,
  precoSemPrejuizo,
  reguaDaConta,
  type CenarioDaConta,
  type FichaDaConta,
} from './conta';
import { COR_DA_PARTE, ReguaDoDinheiro } from './regua';

export interface ContaInicial {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly alvoBp: number;
  /** Preço que veio na URL, em centavos. `null` usa o preço da tabela. */
  readonly preco: number | null;
}

/** Guarda a conta na URL sem recarregar. O aviso da última ação sai junto. */
function gravarNaUrl(conta: {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  readonly alvoBp: number;
  readonly precoTexto: string | null;
}): void {
  const url = new URL(window.location.href);
  const busca = url.searchParams;
  busca.set('plataforma', conta.plataforma);
  const opcional = (chave: string, valor: string | null) => {
    if (valor === null) busca.delete(chave);
    else busca.set(chave, valor);
  };
  opcional('alvo', conta.alvoBp === MARGEM_ALVO_PADRAO_BP ? null : alvoEmPercentual(conta.alvoBp));
  opcional('tipo', conta.tipoAnuncioML === 'classico' ? null : conta.tipoAnuncioML);
  opcional('frete', conta.modoFrete === 'comprador_paga' ? null : conta.modoFrete);
  opcional('preco', conta.precoTexto);
  busca.delete('r');
  window.history.replaceState(window.history.state, '', url);
}

export function ContaDaVenda({
  skuId,
  ficha,
  vendedor,
  inicial,
  ativo,
}: {
  readonly skuId: string;
  readonly ficha: FichaDaConta;
  readonly vendedor: ContextoDoVendedor;
  readonly inicial: ContaInicial;
  readonly ativo: boolean;
}) {
  const idDoPreco = useId();
  const [plataforma, setPlataforma] = useState(inicial.plataforma);
  const [tipoAnuncioML, setTipo] = useState(inicial.tipoAnuncioML);
  const [modoFrete, setFrete] = useState(inicial.modoFrete);
  const [alvoBp, setAlvoBp] = useState(inicial.alvoBp);
  // `null` é "o preço da tabela". Texto é o que a pessoa digitou, do jeito que digitou.
  const [precoTexto, setPrecoTexto] = useState<string | null>(
    inicial.preco === null ? null : centavosParaDigitar(centavos(inicial.preco)),
  );

  const mudar = (
    mudanca: Partial<{
      plataforma: Plataforma;
      tipoAnuncioML: TipoAnuncioML;
      modoFrete: ModoFrete;
      alvoBp: number;
      precoTexto: string | null;
    }>,
  ) => {
    const proxima = { plataforma, tipoAnuncioML, modoFrete, alvoBp, precoTexto, ...mudanca };
    setPlataforma(proxima.plataforma);
    setTipo(proxima.tipoAnuncioML);
    setFrete(proxima.modoFrete);
    setAlvoBp(proxima.alvoBp);
    setPrecoTexto(proxima.precoTexto);
    gravarNaUrl(proxima);
  };

  const cenario: CenarioDaConta = useMemo(
    () => ({ plataforma, tipoAnuncioML, modoFrete, vendedor }),
    [plataforma, tipoAnuncioML, modoFrete, vendedor],
  );
  const presumidos = useMemo(() => montarConta(ficha, cenario).presumidos, [ficha, cenario]);
  const sugerido = useMemo(
    () => precoParaFicarCom(ficha, cenario, alvoBp),
    [ficha, cenario, alvoBp],
  );
  const empate = useMemo(() => precoSemPrejuizo(ficha, cenario), [ficha, cenario]);

  const precoDaConta = precoTexto === null ? sugerido : lerReaisDigitados(precoTexto);
  const resultado = useMemo(
    () => (precoDaConta === null ? null : contaDaVenda(ficha, cenario, precoDaConta)),
    [ficha, cenario, precoDaConta],
  );
  const linhas = resultado === null ? [] : linhasDoCupom(resultado, plataforma, presumidos);
  const estimado = notaDoEstimado(linhas);

  return (
    <section aria-labelledby="preco-titulo" className={estilo.bloco}>
      <h2 className={estilo.blocoTitulo} id="preco-titulo">
        Quanto cobrar
      </h2>

      {ficha.custo === null ? (
        <p className={estilo.esperandoCusto}>
          Diga quanto você paga pelo produto, aqui em cima, e a conta aparece: quanto cobrar em cada
          loja, e quanto fica com você.
        </p>
      ) : (
        <>
          <div aria-label="Em qual loja" className={estilo.lojas} role="radiogroup">
            {PLATAFORMAS.map((p) => (
              <button
                aria-checked={p === plataforma}
                className={p === plataforma ? estilo.lojaAtual : estilo.loja}
                key={p}
                onClick={() => mudar({ plataforma: p })}
                role="radio"
                type="button"
              >
                <Selo identidade={IDENTIDADE_DA_LOJA[p]} tamanho={20} />
                {ROTULO_DA_PLATAFORMA[p]}
              </button>
            ))}
          </div>

          <SeletorDeAlvo alvoBp={alvoBp} aoMudar={(novo) => mudar({ alvoBp: novo })} />

          <div className={estilo.resposta}>
            {sugerido === null ? (
              <p className={estilo.respostaNota}>
                {primeiraMaiuscula(naLoja(plataforma))}, nenhum preço até R$&nbsp;10.000 deixa{' '}
                {fraseDoAlvo(alvoBp)}. Tente um número menor.
              </p>
            ) : (
              <>
                <p className={estilo.respostaLinha}>
                  <span className={estilo.respostaRotulo}>Cobre</span>
                  <strong className={estilo.respostaValor}>{formatarBRL(sugerido)}</strong>
                </p>
                <p className={estilo.respostaNota}>
                  {primeiraMaiuscula(naLoja(plataforma))}, para ficar com {fraseDoAlvo(alvoBp)}.
                </p>
              </>
            )}
            {empate === null ? null : (
              <p className={estilo.respostaEmpate}>
                Abaixo de {formatarBRL(empate)}, você perde dinheiro.
              </p>
            )}
          </div>

          <div className={estilo.cupom}>
            <div className={estilo.cupomTopo}>
              <label className={estilo.cupomPergunta} htmlFor={idDoPreco}>
                A conta de uma venda a
              </label>
              <span className={estilo.campoDinheiro}>
                <span aria-hidden="true" className={estilo.moeda}>
                  R$
                </span>
                <input
                  className={estilo.entradaDinheiro}
                  id={idDoPreco}
                  inputMode="decimal"
                  onChange={(evento) => mudar({ precoTexto: evento.target.value })}
                  value={precoTexto ?? (sugerido === null ? '' : centavosParaDigitar(sugerido))}
                />
              </span>
              {precoTexto !== null && sugerido !== null ? (
                <button
                  className={estilo.linkBotao}
                  onClick={() => mudar({ precoTexto: null })}
                  type="button"
                >
                  Voltar ao preço da tabela
                </button>
              ) : null}
            </div>

            {resultado === null ? (
              <p className={estilo.cupomVazio}>Escreva um preço, como 49,90.</p>
            ) : (
              <>
                <ReguaDoDinheiro regua={reguaDaConta(resultado)} />
                <dl className={estilo.cupomLinhas}>
                  <div className={estilo.cupomLinhaDoPreco}>
                    <dt className={estilo.cupomRotulo}>O cliente paga</dt>
                    <dd className={estilo.cupomValor}>{formatarBRL(resultado.preco)}</dd>
                  </div>
                  {linhas.map((linha) => (
                    <div className={estilo.cupomLinha} key={linha.rotulo}>
                      <dt className={estilo.cupomRotulo}>
                        <span
                          aria-hidden="true"
                          className={`${estilo.amostra} ${COR_DA_PARTE[linha.parte]}`}
                        />
                        {linha.rotulo}
                        {linha.presumido === null ? null : (
                          <span className={estilo.estimado}>estimado</span>
                        )}
                      </dt>
                      <dd className={estilo.cupomValor}>
                        {'−'}
                        {formatarBRL(linha.valor)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p
                  className={resultado.margemReais < 0 ? estilo.cupomTotalPerde : estilo.cupomTotal}
                >
                  <span className={estilo.cupomTotalRotulo}>
                    {resultado.margemReais >= 0 ? (
                      <span
                        aria-hidden="true"
                        className={`${estilo.amostra} ${COR_DA_PARTE.fica}`}
                      />
                    ) : null}
                    {resultado.margemReais < 0 ? 'Você perde' : 'Fica com você'}
                  </span>
                  <strong className={estilo.cupomTotalValor}>
                    {formatarBRL(centavos(Math.abs(resultado.margemReais)))}
                  </strong>
                  <span className={estilo.cupomTotalNota}>
                    {ficaDeCadaCem(resultado.margemPontosBase)}
                  </span>
                </p>
                <div className={estilo.cupomRodape}>
                  {estimado === null ? null : <p>{estimado}</p>}
                  <p>Taxas da tabela {resultado.tabelaUsada}.</p>
                </div>
              </>
            )}
          </div>

          {resultado === null ? null : <Avisos resultado={resultado} />}

          {ativo ? (
            <p className={estilo.montar} id="publicar-titulo">
              <Link
                className={estilo.botao}
                href={caminhoParaMontar({ skuId, plataforma, preco: precoDaConta })}
              >
                Montar o anúncio {naLoja(plataforma)}
              </Link>
            </p>
          ) : null}

          <details className={estilo.opcoes}>
            <summary className={estilo.opcoesResumo}>Tipo de anúncio e frete</summary>
            <div className={estilo.opcoesCorpo}>
              {plataforma === 'ml' ? (
                <fieldset className={estilo.opcoesGrupo}>
                  <legend className={estilo.opcoesLegenda}>Tipo de anúncio</legend>
                  {TIPOS_ANUNCIO_ML.map((t) => (
                    <label className={estilo.opcao} key={t}>
                      <input
                        checked={t === tipoAnuncioML}
                        name="tipo"
                        onChange={() => mudar({ tipoAnuncioML: t })}
                        type="radio"
                      />
                      {ROTULO_DO_TIPO_ANUNCIO_ML[t]}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <fieldset className={estilo.opcoesGrupo}>
                <legend className={estilo.opcoesLegenda}>Frete</legend>
                {MODOS_FRETE.map((f) => (
                  <label className={estilo.opcao} key={f}>
                    <input
                      checked={f === modoFrete}
                      name="frete"
                      onChange={() => mudar({ modoFrete: f })}
                      type="radio"
                    />
                    {ROTULO_DO_MODO_FRETE[f]}
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function Avisos({ resultado }: { readonly resultado: Parameters<typeof avisosDaConta>[0] }) {
  const avisos = avisosDaConta(resultado);
  if (avisos.length === 0) return null;
  return (
    <ul className={estilo.avisosDaConta}>
      {avisos.map((aviso) => (
        <li
          className={
            aviso.tom === 'erro'
              ? estilo.avisoDaContaErro
              : aviso.tom === 'atencao'
                ? estilo.avisoDaContaAtencao
                : estilo.avisoDaConta
          }
          key={aviso.codigo}
        >
          {aviso.texto}
        </li>
      ))}
    </ul>
  );
}

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
