/**
 * Componentes da tela de garimpo. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O dossiê é longo por natureza — sete hipóteses, a fronteira, os achados com URL — e a
 * tela resolve isso com `<details>`: o cartão mostra o estado e o resumo, e quem vai
 * auditar abre. Esconder atrás de clique só vale para o que é conferência; o estado e o
 * motivo de parada ficam abertos, porque são a razão de olhar a tela.
 */
import type { DossieGravado } from '@/dominio/prospector/repositorio';
import { definicaoDaFamilia, FERRAMENTAS, type Ferramenta } from '@/dominio/prospector/hipoteses';
import { estadoDaFerramenta, O_QUE_A_FERRAMENTA_FAZ } from '@/dominio/prospector/ferramentas';
import { formatarAbsoluto, formatarRelativo } from '../ui/tempo';
import { abrirUmAlvo } from './acoes';
import {
  explicacaoAcrescenta,
  linhaDaFronteira,
  orcamentoLegivel,
  ROTULO_DA_FAMILIA,
  ROTULO_DA_FERRAMENTA,
  situacaoDoDossie,
  textoDoEstadoDaFerramenta,
  type Aviso,
} from './apresentacao';
import { ACHADOS_NA_TELA, TETO_PASSOS_PADRAO } from './constantes';
import estilo from './garimpo.module.css';

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
 * O que dá para investigar hoje.
 *
 * Fica antes dos dossiês de propósito: sem isto, "nenhum achado" se lê como sinal sobre
 * o alvo, quando o que houve foi não ter com que olhar.
 */
export function Ferramentas({ temChaveDeLlm }: { readonly temChaveDeLlm: boolean }) {
  return (
    <ul className={estilo.lista}>
      {FERRAMENTAS.map((ferramenta) => (
        <Ferramenta ferramenta={ferramenta} key={ferramenta} temChaveDeLlm={temChaveDeLlm} />
      ))}
    </ul>
  );
}

function Ferramenta({
  ferramenta,
  temChaveDeLlm,
}: {
  readonly ferramenta: Ferramenta;
  readonly temChaveDeLlm: boolean;
}) {
  const texto = textoDoEstadoDaFerramenta(estadoDaFerramenta(ferramenta, { temChaveDeLlm }));
  const classe =
    texto.tom === 'ok'
      ? estilo.etiquetaOk
      : texto.tom === 'atencao'
        ? estilo.etiquetaAtencao
        : estilo.etiqueta;

  return (
    <li className={estilo.ferramenta}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.ferramentaNome}>{ROTULO_DA_FERRAMENTA[ferramenta]}</h3>
          <p className={estilo.itemSub}>{O_QUE_A_FERRAMENTA_FAZ[ferramenta]}</p>
        </div>
        <span className={classe}>{texto.rotulo}</span>
      </div>
      {texto.detalhe !== null && <p className={estilo.itemFonte}>{texto.detalhe}</p>}
    </li>
  );
}

function Dossie({
  dossie,
  valeContinuar,
  agora,
}: {
  readonly dossie: DossieGravado;
  readonly valeContinuar: boolean;
  readonly agora: Date;
}) {
  const situacao = situacaoDoDossie({
    motivoParada: dossie.motivoParada,
    passosGastos: dossie.passosGastos,
    hipotesesAbertas: dossie.resumo.hipotesesAbertas,
  });

  const classeDaSituacao =
    situacao.tom === 'ok'
      ? estilo.etiquetaOk
      : situacao.tom === 'atencao'
        ? estilo.etiquetaAtencao
        : estilo.etiqueta;

  const restantes = dossie.achados.length - ACHADOS_NA_TELA;

  return (
    <li className={estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>{dossie.alvo}</h3>
          <p className={estilo.itemSub}>
            {orcamentoLegivel(dossie)}
            {' · '}
            <span title={formatarAbsoluto(dossie.atualizadoEm)}>
              {formatarRelativo(dossie.atualizadoEm, agora)}
            </span>
          </p>
        </div>
        <div className={estilo.etiquetas}>
          {valeContinuar && <span className={estilo.etiquetaViva}>vale continuar</span>}
          {!dossie.resumo.auditavel && (
            <span className={estilo.etiquetaAlerta}>achado sem fonte</span>
          )}
          <span className={classeDaSituacao}>{situacao.rotulo}</span>
        </div>
      </div>

      <p className={estilo.itemCorpo}>{dossie.resumo.mensagem}</p>
      {explicacaoAcrescenta(dossie.motivoParada) && (
        <p className={estilo.itemAcao}>{situacao.explicacao}</p>
      )}

      {dossie.recomendacao !== null && <p className={estilo.recomendacao}>{dossie.recomendacao}</p>}

      {dossie.achados.length > 0 && (
        <details className={estilo.bloco}>
          <summary className={estilo.resumoDoBloco}>
            ver os {dossie.achados.length} achados, com a origem de cada um
          </summary>
          <ul className={estilo.listaMiuda}>
            {dossie.achados.slice(0, ACHADOS_NA_TELA).map((achado) => (
              <li className={estilo.achado} key={achado.id}>
                <span>{achado.oQue}</span>
                {achado.origemUrl.trim() === '' ? (
                  <span className={estilo.semFonte}>sem URL de origem</span>
                ) : (
                  <a
                    className={estilo.origem}
                    href={achado.origemUrl}
                    rel="noreferrer nofollow"
                    target="_blank"
                  >
                    {achado.origemUrl}
                  </a>
                )}
              </li>
            ))}
          </ul>
          {restantes > 0 && <p className={estilo.itemFonte}>e mais {restantes}.</p>}
        </details>
      )}

      <details className={estilo.bloco}>
        <summary className={estilo.resumoDoBloco}>
          ver as {dossie.hipoteses.length} hipóteses
        </summary>
        <ul className={estilo.listaMiuda}>
          {dossie.hipoteses.map((hipotese) => (
            <li className={estilo.hipotese} key={hipotese.id}>
              <span>{hipotese.enunciado}</span>
              <span
                className={estilo.itemSub}
                title={definicaoDaFamilia(hipotese.familia).porQueImporta}
              >
                {ROTULO_DA_FAMILIA[hipotese.familia]} · {hipotese.estado}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {dossie.fronteira.length > 0 && (
        <details className={estilo.bloco}>
          <summary className={estilo.resumoDoBloco}>
            ver o que ficou na fronteira ({dossie.fronteira.length})
          </summary>
          <ul className={estilo.listaMiuda}>
            {dossie.fronteira.map((item, indice) => {
              const linha = linhaDaFronteira(item, dossie.alvo);
              return (
                <li className={estilo.hipotese} key={`${item.familia}-${String(indice)}`}>
                  <span>{linha.principal}</span>
                  {linha.secundario !== null && (
                    <span className={estilo.itemSub}>{linha.secundario}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </li>
  );
}

export function Dossies({
  dossies,
  idsQueValeContinuar,
  agora,
}: {
  readonly dossies: readonly DossieGravado[];
  readonly idsQueValeContinuar: readonly string[];
  readonly agora: Date;
}) {
  if (dossies.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhum alvo aberto. O prospector não varre: ele investiga, com alvo, teto e critério de
        parada — e o alvo é a parte que só você sabe escolher.
      </p>
    );
  }

  const vale = new Set(idsQueValeContinuar);

  return (
    <ul className={estilo.lista}>
      {dossies.map((dossie) => (
        <Dossie agora={agora} dossie={dossie} key={dossie.id} valeContinuar={vale.has(dossie.id)} />
      ))}
    </ul>
  );
}

/**
 * Abrir um alvo.
 *
 * Os dois tetos são campo, e não configuração escondida: o de reais é o que interessa
 * ao bolso, e o de passos é o que continua valendo quando uma ferramenta não informa
 * custo. Declarar os dois antes de começar é o que a especificação pede.
 */
export function FormularioDeAlvo({ tetoPadrao }: { readonly tetoPadrao: string }) {
  return (
    <form action={abrirUmAlvo} className={estilo.formulario}>
      <label className={estilo.campoLargo}>
        O alvo
        <input
          className={estilo.entrada}
          maxLength={120}
          name="alvo"
          placeholder="refil de purificador de água PA21G"
          required
          type="text"
        />
        <span className={estilo.ajuda}>
          Um produto, um aparelho, uma marca ou um nicho. Específico rende: &ldquo;refil
          PA21G&rdquo; tem fabricante, distribuidor e compatibilidade para achar;
          &ldquo;peças&rdquo; gasta o teto sem responder nada.
        </span>
      </label>

      <label className={estilo.campo}>
        Teto em reais
        <input
          className={estilo.entrada}
          defaultValue={tetoPadrao}
          inputMode="decimal"
          name="teto"
          required
          type="text"
        />
      </label>

      <label className={estilo.campo}>
        Teto em passos
        <input
          className={estilo.entrada}
          defaultValue={TETO_PASSOS_PADRAO}
          inputMode="numeric"
          max={500}
          min={1}
          name="passos"
          required
          type="number"
        />
      </label>

      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Abrir alvo
        </button>
      </div>
    </form>
  );
}
