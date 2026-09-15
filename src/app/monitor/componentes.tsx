/**
 * Componentes da tela do monitor. Servidor, sem estado, sem JavaScript no cliente.
 *
 * A decisão de desenho que manda aqui: **a leitura do grupo vem antes dos eventos**.
 * O que a pessoa precisa saber é "preço caiu e estoque subiu na mesma semana, isso é
 * fornecedor novo"; os dois eventos que sustentam a frase vêm abaixo, para conferir.
 * Invertido, a tela seria uma lista de números com uma conclusão escondida no fim.
 */
import { O_QUE_SIGNIFICA, type GrupoDeEventos } from '@/dominio/monitor/eventos';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarAbsoluto, formatarRelativo } from '../ui/tempo';
import { marcarLido } from './acoes';
import {
  ROTULO_DA_SEVERIDADE,
  ROTULO_DO_VEREDITO,
  TOM_DA_SEVERIDADE,
  TOM_DO_VEREDITO,
  descontoLegivel,
  descreverEvento,
  type Aviso,
  type QuedaNaTela,
} from './apresentacao';
import estilo from './monitor.module.css';

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

const CLASSE_DA_ETIQUETA: Readonly<Record<'alerta' | 'atencao' | 'neutro', string>> = {
  alerta: `${estilo.etiqueta} ${estilo.etiquetaAlerta}`,
  atencao: `${estilo.etiqueta} ${estilo.etiquetaAtencao}`,
  neutro: estilo.etiqueta,
};

function Grupo({ grupo, agora }: { readonly grupo: GrupoDeEventos; readonly agora: Date }) {
  const tom = TOM_DA_SEVERIDADE[grupo.severidade];
  const classeDoItem =
    tom === 'alerta'
      ? `${estilo.item} ${estilo.itemAlerta}`
      : tom === 'atencao'
        ? `${estilo.item} ${estilo.itemAtencao}`
        : estilo.item;

  return (
    <li className={classeDoItem}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>{grupo.sobre}</h3>
          <p className={estilo.itemSub}>
            {grupo.eventos.length === 1
              ? '1 mudança'
              : `${String(grupo.eventos.length)} mudanças na mesma semana`}
          </p>
        </div>
        <span className={CLASSE_DA_ETIQUETA[tom]}>{ROTULO_DA_SEVERIDADE[grupo.severidade]}</span>
      </div>

      {/* A conclusão primeiro. É o que a especificação chama de agrupar antes de avisar. */}
      <p className={estilo.leitura}>{grupo.leitura}</p>

      <ul className={estilo.mudancas}>
        {grupo.eventos.map((evento) => {
          const descricao = descreverEvento(evento);
          return (
            <li className={estilo.mudanca} key={evento.id}>
              <span className={estilo.mudancaTitulo}>{descricao.titulo}</span>
              {descricao.detalhe !== null && (
                <span className={estilo.mudancaDetalhe}>{descricao.detalhe}</span>
              )}
              <span className={estilo.mudancaQuando} title={formatarAbsoluto(evento.detectadoEm)}>
                {formatarRelativo(evento.detectadoEm, agora)}
              </span>
              {/*
                O que o tipo significa só aparece quando o grupo tem mais de um evento.
                Com um evento só, `lerGrupo` devolve exatamente esta frase — e a tela
                mostrava a mesma explicação duas vezes, uma no destaque e outra embaixo.
              */}
              {grupo.eventos.length > 1 && (
                <span className={estilo.mudancaSignifica}>{O_QUE_SIGNIFICA[evento.tipo]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        Marca o grupo inteiro, e não evento por evento: o grupo é uma história, e
        marcar metade dela deixaria a outra metade voltando amanhã sem contexto.
      */}
      <form action={marcarLido}>
        {grupo.eventos.map((evento) => (
          <input key={evento.id} name="id" type="hidden" value={evento.id} />
        ))}
        <button className={estilo.botaoSecundario} type="submit">
          Já vi
        </button>
      </form>
    </li>
  );
}

export function Grupos({
  grupos,
  agora,
}: {
  readonly grupos: readonly GrupoDeEventos[];
  readonly agora: Date;
}) {
  if (grupos.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nada na fila. Uma mudança entra aqui quando a mesma oferta é capturada de novo com preço
        diferente — acima de 3%, que é o piso que impede o monitor de virar ruído.
      </p>
    );
  }

  return (
    <ul className={estilo.lista}>
      {grupos.map((grupo) => (
        <Grupo agora={agora} grupo={grupo} key={grupo.chave} />
      ))}
    </ul>
  );
}

function Queda({ queda }: { readonly queda: QuedaNaTela }) {
  const desconto = descontoLegivel(queda.avaliacao.descontoBp);
  const tom = TOM_DO_VEREDITO[queda.avaliacao.veredito];
  const classe =
    tom === 'alerta'
      ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
      : tom === 'ok'
        ? `${estilo.etiqueta} ${estilo.etiquetaOk}`
        : estilo.etiqueta;

  return (
    <li className={queda.avaliacao.valePublicar ? `${estilo.item} ${estilo.itemOk}` : estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>{queda.titulo}</h3>
          <p className={estilo.itemSub}>{queda.de}</p>
        </div>
        <span className={classe}>{ROTULO_DO_VEREDITO[queda.avaliacao.veredito]}</span>
      </div>

      <p className={estilo.itemCorpo}>{queda.avaliacao.mensagem}</p>

      <dl className={estilo.numeros}>
        <dt>preço agora</dt>
        <dd>{formatarBRL(queda.avaliacao.precoAtual)}</dd>
        <dt>mediana de 90 dias</dt>
        <dd>
          {queda.avaliacao.medianaJanela === null
            ? 'sem referência'
            : formatarBRL(queda.avaliacao.medianaJanela)}
        </dd>
        <dt>{desconto.rotulo}</dt>
        <dd>{desconto.valor}</dd>
        <dt>preços diferentes vistos</dt>
        <dd>{queda.avaliacao.observacoes}</dd>
      </dl>
    </li>
  );
}

export function Quedas({ quedas }: { readonly quedas: readonly QuedaNaTela[] }) {
  if (quedas.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhuma oferta tem série de preço suficiente ainda. São necessários três{' '}
        <strong>preços diferentes</strong> na janela de 90 dias — a série guarda um ponto por preço
        novo, não por captura, então importar a mesma planilha sem mudança não avança a conta. Sem
        mediana, &ldquo;está barato&rdquo; é chute.
      </p>
    );
  }

  return (
    <ul className={estilo.lista}>
      {quedas.map((queda) => (
        <Queda key={queda.produtoExternoId} queda={queda} />
      ))}
    </ul>
  );
}
