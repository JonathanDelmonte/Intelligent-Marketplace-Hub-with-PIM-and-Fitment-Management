/**
 * Componentes da tela de afiliados. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O cartão de oferta tem duas caras, e é de propósito: pendente mostra o botão de
 * "saiu no grupo", publicada mostra os dois campos do painel de afiliado. A mesma
 * oferta em dois momentos pede coisas diferentes, e um cartão que mostra os dois ao
 * mesmo tempo faz a pessoa escolher entre campos que não se aplicam.
 */
import type { Desempenho } from '@/dominio/afiliados/publicacao';
import type { OfertaGravada } from '@/dominio/afiliados/repositorio';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { formatarBRL, formatarPontosBase } from '@/lib/dinheiro';
import { formatarAbsoluto, formatarRelativo } from '../ui/tempo';
import { cadastrarOferta, informarDesempenho, marcarPublicada } from './acoes';
import {
  etiquetaDoDesconto,
  ROTULO_DA_PLATAFORMA,
  VARIAVEL_DA_TAG,
  type Aviso,
  type TextoDaDecisao,
} from './apresentacao';
import estilo from './afiliados.module.css';

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
 * A decisão de publicar, em destaque.
 *
 * É a única coisa da tela que responde "e agora?", então fica antes da fila. Esperar
 * tem o mesmo peso visual de publicar: das duas, esperar é a que precisa de explicação
 * para não parecer defeito.
 */
export function Decisao({ texto }: { readonly texto: TextoDaDecisao }) {
  const classe =
    texto.tom === 'ok'
      ? estilo.decisaoOk
      : texto.tom === 'atencao'
        ? estilo.decisaoAtencao
        : estilo.decisao;
  return (
    <div className={classe}>
      <strong className={estilo.decisaoTitulo}>{texto.titulo}</strong>
      <span className={estilo.decisaoCorpo}>{texto.corpo}</span>
    </div>
  );
}

/**
 * Os números do que foi publicado.
 *
 * A conversão aparece como travessão quando não houve clique, e não como 0%: zero
 * afirmaria que o grupo não compra, quando o que houve foi ninguém clicar — e as duas
 * leituras levam a ações opostas. A nota embaixo é a leitura, e fica junto do número
 * de propósito.
 */
export function PainelDeDesempenho({ desempenho }: { readonly desempenho: Desempenho }) {
  return (
    <>
      <ul className={estilo.painel}>
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>{desempenho.publicadas}</span>
          <span className={estilo.cartaoRotulo}>publicadas</span>
        </li>
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>{desempenho.cliques}</span>
          <span className={estilo.cartaoRotulo}>cliques</span>
        </li>
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>{desempenho.conversoes}</span>
          <span className={estilo.cartaoRotulo}>vendas</span>
        </li>
        <li className={estilo.cartao}>
          <span className={estilo.cartaoNumero}>
            {desempenho.conversaoBp === null ? '—' : formatarPontosBase(desempenho.conversaoBp, 1)}
          </span>
          <span className={estilo.cartaoRotulo}>venda por clique</span>
          <span className={estilo.cartaoNota}>
            {desempenho.conversaoBp === null ? 'sem clique, não há o que dividir' : 'do grupo'}
          </span>
        </li>
      </ul>
      <p className={estilo.dica}>{desempenho.mensagem}</p>
    </>
  );
}

function Oferta({
  oferta,
  destacada,
  agora,
}: {
  readonly oferta: OfertaGravada;
  readonly destacada: boolean;
  readonly agora: Date;
}) {
  const etiqueta = etiquetaDoDesconto(oferta);
  const classeDaEtiqueta =
    etiqueta.tom === 'ok'
      ? estilo.etiquetaOk
      : etiqueta.tom === 'atencao'
        ? estilo.etiquetaAtencao
        : estilo.etiqueta;

  return (
    <li className={destacada ? estilo.itemProximo : estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>
            {ROTULO_DA_PLATAFORMA[oferta.plataforma]} · {formatarBRL(oferta.preco)}
          </h3>
          <p className={estilo.itemSub}>
            {oferta.medianaNoventaDias === null
              ? 'sem mediana informada'
              : `mediana de 90 dias: ${formatarBRL(oferta.medianaNoventaDias)}`}
            {oferta.publicadoEmGrupo !== null && (
              <>
                {' · '}
                <span title={formatarAbsoluto(oferta.publicadoEmGrupo)}>
                  saiu {formatarRelativo(oferta.publicadoEmGrupo, agora)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className={estilo.etiquetas}>
          {destacada && <span className={estilo.etiquetaViva}>próxima</span>}
          <span className={classeDaEtiqueta}>{etiqueta.texto}</span>
        </div>
      </div>

      {/* O link inteiro, e não o domínio: é texto para copiar e colar no grupo. */}
      <a
        className={estilo.link}
        href={oferta.urlAfiliado}
        rel="noreferrer nofollow"
        target="_blank"
      >
        {oferta.urlAfiliado}
      </a>

      {oferta.publicadoEmGrupo === null ? (
        <form action={marcarPublicada}>
          <input name="id" type="hidden" value={oferta.id} />
          <button className={estilo.botaoMiudo} type="submit">
            Saiu no grupo
          </button>
        </form>
      ) : (
        <form action={informarDesempenho} className={estilo.numeros}>
          <input name="id" type="hidden" value={oferta.id} />
          <label className={estilo.campoMiudo}>
            Cliques
            <input
              className={estilo.entradaMiuda}
              defaultValue={oferta.cliques}
              inputMode="numeric"
              min={0}
              name="cliques"
              type="number"
            />
          </label>
          <label className={estilo.campoMiudo}>
            Vendas
            <input
              className={estilo.entradaMiuda}
              defaultValue={oferta.conversoes}
              inputMode="numeric"
              min={0}
              name="conversoes"
              type="number"
            />
          </label>
          <button className={estilo.botaoMiudo} type="submit">
            Anotar
          </button>
        </form>
      )}
    </li>
  );
}

export function Fila({
  ofertas,
  proximaId,
  agora,
}: {
  readonly ofertas: readonly OfertaGravada[];
  readonly proximaId: string | null;
  readonly agora: Date;
}) {
  if (ofertas.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nada na fila. O link de afiliado não é o trabalho: o trabalho é achar a queda real — e é o
        monitor de preço que diz qual oferta está abaixo da própria mediana.
      </p>
    );
  }

  return (
    <ul className={estilo.lista}>
      {ofertas.map((oferta) => (
        <Oferta agora={agora} destacada={oferta.id === proximaId} key={oferta.id} oferta={oferta} />
      ))}
    </ul>
  );
}

/**
 * O formulário de nova oferta.
 *
 * Só aparecem as plataformas com tag configurada. É a diferença entre um formulário
 * que recusa depois de preenchido e um que não oferece o que não funciona — e a lista
 * do que falta configurar fica abaixo, com o nome da variável.
 */
export function FormularioDeOferta({
  disponiveis,
}: {
  readonly disponiveis: readonly Plataforma[];
}) {
  if (disponiveis.length === 0) return null;

  return (
    <form action={cadastrarOferta} className={estilo.formulario}>
      <label className={estilo.campo}>
        Plataforma
        <select className={estilo.entrada} name="plataforma" required>
          {disponiveis.map((plataforma) => (
            <option key={plataforma} value={plataforma}>
              {ROTULO_DA_PLATAFORMA[plataforma]}
            </option>
          ))}
        </select>
      </label>

      <label className={estilo.campoLargo}>
        Link do anúncio
        <input
          className={estilo.entrada}
          name="url"
          placeholder="https://produto.mercadolivre.com.br/MLB-..."
          required
          type="url"
        />
        <span className={estilo.ajuda}>
          Cole o endereço da página. A sua tag é acrescentada aqui — o que já estava na URL não é
          jogado fora, porque às vezes é o que faz a página certa abrir.
        </span>
      </label>

      <label className={estilo.campo}>
        Preço agora
        <input
          className={estilo.entrada}
          inputMode="decimal"
          name="preco"
          placeholder="49,90"
          required
          type="text"
        />
      </label>

      <label className={estilo.campo}>
        Mediana de 90 dias
        <input
          className={estilo.entrada}
          inputMode="decimal"
          name="referencia"
          placeholder="79,90"
          type="text"
        />
      </label>

      {/* Linha própria: campo de altura diferente na mesma linha do botão desalinha as
          duas coisas, e o que fica torto é justamente o que se clica. */}
      <div className={estilo.acao}>
        <button className={estilo.botao} type="submit">
          Pôr na fila
        </button>
      </div>
    </form>
  );
}

/**
 * O que falta configurar.
 *
 * Nomeia a variável de ambiente. Dizer "configure a tag" manda a pessoa procurar em
 * documentação; dizer `AFILIADO_TAG_SHOPEE` manda ela editar uma linha.
 */
export function TagsQueFaltam({ faltando }: { readonly faltando: readonly Plataforma[] }) {
  if (faltando.length === 0) return null;

  return (
    <p className={estilo.dica}>
      {faltando.length === 3
        ? 'Nenhuma plataforma tem tag de afiliado configurada, então não há link para gerar. '
        : 'Sem tag, e por isso fora da lista: '}
      {faltando.map((plataforma, indice) => (
        <span key={plataforma}>
          {indice > 0 && ', '}
          {ROTULO_DA_PLATAFORMA[plataforma]} (<code>{VARIAVEL_DA_TAG[plataforma]}</code>)
        </span>
      ))}
      . Link de afiliado sem tag é link comum: leva ao produto e não paga comissão nenhuma.
    </p>
  );
}
