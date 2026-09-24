/**
 * Componentes da tela de perguntas. Servidor, sem estado, sem JavaScript no cliente.
 *
 * A ordem do cartão de dúvida é a entrega: **o que acrescentar ao anúncio** vem antes
 * dos exemplos. A contagem é o gatilho, não a informação — saber que doze pessoas
 * perguntaram a voltagem não conserta nada; saber que a voltagem tem de estar no
 * título conserta.
 */
import { REPETICOES_QUE_ACUSAM, type DuvidaRecorrente } from '@/dominio/posvenda/recorrente';
import type { PerguntaRecebida } from '@/dominio/posvenda/recorrente';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { formatarRelativo } from '../ui/tempo';
import { guardarPerguntas } from './acoes';
import { ROTULO_DO_TEMA, type Aviso } from './apresentacao';
import { EXEMPLOS_NA_TELA } from './constantes';
import estilo from './perguntas.module.css';

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
 * O formulário de colar.
 *
 * Um anúncio por vez, e uma pergunta por linha. É o formato que sai do painel quando
 * se abre as perguntas de um anúncio e se copia a coluna — e formato que a pessoa tem
 * de montar é formato que ela não usa.
 *
 * Dentro da área de uma loja, a loja já está dita e o formulário volta para lá. Na tela
 * geral, a loja é uma escolha — com "não sei dizer", porque pergunta na loja errada é
 * pior que pergunta sem loja.
 */
export function FormularioDeColar({
  loja,
  voltar,
}: {
  readonly loja?: Plataforma | undefined;
  readonly voltar?: string | undefined;
} = {}) {
  return (
    <form action={guardarPerguntas} className={estilo.formulario}>
      {voltar !== undefined && <input name="voltar" type="hidden" value={voltar} />}
      {loja === undefined ? (
        <label className={estilo.campo}>
          De qual loja
          <select className={estilo.entrada} defaultValue="" name="plataforma">
            <option value="">Não sei dizer</option>
            {PLATAFORMAS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_DA_PLATAFORMA[p]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="plataforma" type="hidden" value={loja} />
      )}
      <label className={estilo.campo}>
        De qual anúncio
        <input
          className={estilo.entrada}
          name="anuncio"
          placeholder="MLB-1234567890"
          required
          type="text"
        />
        <span className={estilo.ajuda}>
          O identificador do anúncio na plataforma, como aparece no painel.
        </span>
      </label>

      <label className={estilo.campoLargo}>
        As perguntas, uma por linha
        <textarea
          className={estilo.entrada}
          name="texto"
          placeholder={'Serve na PA26G?\nÉ 110 ou 220?\nQuantos vêm na caixa?'}
          required
          rows={6}
        />
      </label>

      <button className={estilo.botao} type="submit">
        Guardar
      </button>
    </form>
  );
}

function Duvida({ duvida }: { readonly duvida: DuvidaRecorrente }) {
  return (
    <li className={estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>
            {ROTULO_DO_TEMA[duvida.tema]}
            {duvida.codigo === null ? '' : ` · ${duvida.codigo}`}
          </h3>
          <p className={estilo.itemSub}>
            {duvida.anuncios.length === 1
              ? `no anúncio ${duvida.anuncios[0] ?? ''}`
              : `em ${String(duvida.anuncios.length)} anúncios`}
          </p>
        </div>
        <span className={`${estilo.etiqueta} ${estilo.etiquetaAtencao}`}>{duvida.vezes} vezes</span>
      </div>

      {/* A entrega, antes dos exemplos. */}
      <p className={estilo.acrescentar}>{duvida.oQueAcrescentar}</p>

      <details className={estilo.exemplos}>
        <summary className={estilo.exemplosResumo}>ver como as pessoas perguntaram</summary>
        <ul className={estilo.listaDeExemplos}>
          {duvida.exemplos.slice(0, EXEMPLOS_NA_TELA).map((exemplo) => (
            <li key={exemplo}>{exemplo}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function Duvidas({ duvidas }: { readonly duvidas: readonly DuvidaRecorrente[] }) {
  if (duvidas.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhuma dúvida repetiu {REPETICOES_QUE_ACUSAM} vezes na janela. Não é sinal de anúncio
        perfeito: pode ser que ainda falte histórico. Uma pergunta respondida no privado ensina uma
        pessoa; a mesma dúvida repetida é o anúncio pedindo conserto.
      </p>
    );
  }

  return (
    <ul className={estilo.lista}>
      {duvidas.map((duvida) => (
        <Duvida duvida={duvida} key={duvida.chave} />
      ))}
    </ul>
  );
}

/**
 * As perguntas cruas, atrás de um clique.
 *
 * Ficam porque é o que permite conferir a classificação — tema errado é conserto de
 * gramática, e sem ver o texto ninguém descobre. Não ficam abertas porque não é o
 * trabalho da tela.
 */
export function PerguntasCruas({
  perguntas,
  agora,
}: {
  readonly perguntas: readonly PerguntaRecebida[];
  readonly agora: Date;
}) {
  if (perguntas.length === 0) return null;

  return (
    <details className={estilo.cruas}>
      <summary className={estilo.exemplosResumo}>
        ver as {perguntas.length} perguntas guardadas
      </summary>
      <ul className={estilo.listaDeCruas}>
        {perguntas.map((pergunta) => (
          <li className={estilo.crua} key={pergunta.id}>
            <span>{pergunta.texto}</span>
            <span className={estilo.itemSub}>
              {pergunta.anuncioId} · {formatarRelativo(pergunta.em, agora)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
