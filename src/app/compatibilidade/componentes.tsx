/**
 * Componentes da tela de compatibilidade.
 *
 * Todos de servidor, sem estado e sem JavaScript no cliente: cada decisão é um
 * `form` com `action` de servidor. A tela funciona com JavaScript desligado, que é
 * o que garante que ela funcione em telefone ruim e em rede ruim — e é onde a
 * conferência de compatibilidade acontece na prática, com o aparelho na mão.
 */
import type { Evidencia } from '@/dominio/compatibilidade/evidencia';
import type { Ficha, Resposta } from '@/dominio/compatibilidade/ficha';
import type { Decisao } from '@/dominio/compatibilidade/resolucao';
import { cadastrarAparelho, decidirLinha, procurarNosAnuncios } from './acoes';
import {
  emPorcento,
  explicarRetencao,
  explicarSituacao,
  resumoDasEvidencias,
  rotuloDaConfianca,
  rotuloDaDecisao,
  type Aviso,
} from './apresentacao';
import estilo from './compatibilidade.module.css';

export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  const classe =
    aviso.tom === 'erro'
      ? `${estilo.aviso} ${estilo.avisoErro}`
      : aviso.tom === 'atencao'
        ? `${estilo.aviso} ${estilo.avisoAtencao}`
        : estilo.aviso;
  return (
    <div className={classe} role="status">
      <strong className={estilo.avisoTitulo}>{aviso.titulo}</strong>
      <span className={estilo.avisoCorpo}>{aviso.corpo}</span>
    </div>
  );
}

export function Painel({
  numeros,
}: {
  readonly numeros: {
    readonly publicaveis: number;
    readonly emRevisao: number;
    readonly comConflito: number;
    readonly naoServe: number;
    readonly aparelhos: number;
  };
}) {
  const cartoes = [
    {
      rotulo: 'Prontas para o anúncio',
      valor: numeros.publicaveis,
      nota: 'provado o bastante para publicar',
    },
    {
      rotulo: 'Esperando você',
      valor: numeros.emRevisao,
      nota: 'um clique resolve cada uma',
    },
    {
      rotulo: 'Com fontes discordando',
      valor: numeros.comConflito,
      nota: 'olhe estas primeiro',
    },
    {
      rotulo: 'Marcadas como não serve',
      valor: numeros.naoServe,
      nota: 'evita sugerir o modelo errado',
    },
    {
      rotulo: 'Aparelhos cadastrados',
      valor: numeros.aparelhos,
      nota: 'é o que o sistema sabe procurar',
    },
  ];

  return (
    <div className={estilo.painel}>
      {cartoes.map((c) => (
        <div className={estilo.cartao} key={c.rotulo}>
          <span className={estilo.cartaoNumero}>{c.valor}</span>
          <span className={estilo.cartaoRotulo}>{c.rotulo}</span>
          <span className={estilo.cartaoNota}>{c.nota}</span>
        </div>
      ))}
    </div>
  );
}

export function BotaoProcurar() {
  return (
    <form action={procurarNosAnuncios}>
      <button className={estilo.botaoSecundario} type="submit">
        Procurar nos anúncios já capturados
      </button>
      <p className={estilo.dica}>
        Lê o título de cada anúncio que você já importou e anota em que aparelhos ele diz que a peça
        serve. Não chama nenhuma plataforma e não gasta nada.
      </p>
    </form>
  );
}

export interface LinhaDaFila {
  readonly skuId: string;
  readonly aparelhoId: string;
  readonly skuTitulo: string;
  readonly aparelhoRotulo: string;
  readonly aparelhoTipo: string;
  readonly decisao: Decisao;
  readonly confiancaBp: number;
  readonly conflito: string | null;
  readonly evidencias: readonly Evidencia[];
}

function Etiqueta({ decisao, bp }: { readonly decisao: Decisao; readonly bp: number }) {
  const classe =
    decisao === 'nao_serve'
      ? `${estilo.etiqueta} ${estilo.etiquetaNao}`
      : decisao === 'indefinido'
        ? `${estilo.etiqueta} ${estilo.etiquetaNeutra}`
        : estilo.etiqueta;
  return (
    <span className={classe}>
      {rotuloDaDecisao(decisao)} · {rotuloDaConfianca(bp)} {emPorcento(bp)}
    </span>
  );
}

function Decisoes({ linha }: { readonly linha: LinhaDaFila }) {
  return (
    <div className={estilo.acoes}>
      <form action={decidirLinha}>
        <input name="skuId" type="hidden" value={linha.skuId} />
        <input name="aparelhoId" type="hidden" value={linha.aparelhoId} />
        <input name="escolha" type="hidden" value="serve" />
        <button className={estilo.botaoSim} type="submit">
          Serve
        </button>
      </form>
      <form action={decidirLinha}>
        <input name="skuId" type="hidden" value={linha.skuId} />
        <input name="aparelhoId" type="hidden" value={linha.aparelhoId} />
        <input name="escolha" type="hidden" value="nao_serve" />
        <button className={estilo.botaoNao} type="submit">
          Não serve
        </button>
      </form>
    </div>
  );
}

export function Fila({ linhas }: { readonly linhas: readonly LinhaDaFila[] }) {
  if (linhas.length === 0) {
    return <p className={estilo.vazio}>Nada esperando conferência.</p>;
  }

  return (
    <ul className={estilo.fila}>
      {linhas.map((linha) => (
        <li className={estilo.item} key={`${linha.skuId}:${linha.aparelhoId}`}>
          <div className={estilo.itemCabecalho}>
            <div>
              <h3 className={estilo.itemTitulo}>{linha.aparelhoRotulo}</h3>
              <p className={estilo.itemSub}>
                {linha.aparelhoTipo} · peça: {linha.skuTitulo}
              </p>
            </div>
            <Etiqueta bp={linha.confiancaBp} decisao={linha.decisao} />
          </div>

          <p className={estilo.situacao}>{explicarSituacao(linha)}</p>

          {linha.evidencias.length > 0 && (
            <ul className={estilo.evidencias}>
              {resumoDasEvidencias(linha.evidencias).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <Decisoes linha={linha} />
        </li>
      ))}
    </ul>
  );
}

export function FichaPublicavel({ ficha }: { readonly ficha: Ficha }) {
  if (ficha.publicaveis.length === 0 && ficha.retidas.length === 0) {
    return <p className={estilo.vazio}>Nenhuma compatibilidade registrada ainda.</p>;
  }

  return (
    <>
      {ficha.publicaveis.length === 0 ? (
        <p className={estilo.vazio}>Nada provado o bastante para publicar ainda.</p>
      ) : (
        <div className={estilo.rolagem}>
          <table className={estilo.tabela}>
            <caption className={estilo.legenda}>
              É isto que vai para a ficha do anúncio, e o que dá para responder a comprador sem
              medo.
            </caption>
            <thead>
              <tr>
                <th scope="col">Aparelho</th>
                <th scope="col">Tipo</th>
                <th scope="col">Variação</th>
                <th scope="col">Provado</th>
              </tr>
            </thead>
            <tbody>
              {ficha.publicaveis.map((l) => (
                <tr key={`${l.marca}:${l.modelo}:${l.variante ?? ''}`}>
                  <td>
                    {l.marca} {l.modelo}
                  </td>
                  <td>{l.tipo}</td>
                  <td>{l.variante ?? '—'}</td>
                  <td>{emPorcento(l.confiancaBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ficha.retidas.length > 0 && (
        <details className={estilo.detalhe}>
          <summary>{ficha.retidas.length} fora da ficha — por que cada uma ficou de fora</summary>
          <ul className={estilo.retidas}>
            {ficha.retidas.map((l) => (
              <li key={`${l.marca}:${l.modelo}:${l.variante ?? ''}`}>
                <strong>
                  {l.marca} {l.modelo}
                </strong>{' '}
                — {explicarRetencao(l.motivo)}
                {l.conflito === null ? '' : `: ${l.conflito}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function FormularioDeAparelho() {
  return (
    <form action={cadastrarAparelho} className={estilo.formulario}>
      <div className={estilo.campos}>
        <label className={estilo.campo}>
          <span>Tipo de aparelho</span>
          <input
            className={estilo.entrada}
            defaultValue=""
            name="tipo"
            placeholder="purificador de água"
            required
            type="text"
          />
        </label>
        <label className={estilo.campo}>
          <span>Marca</span>
          <input
            className={estilo.entrada}
            name="marca"
            placeholder="Electrolux"
            required
            type="text"
          />
        </label>
        <label className={estilo.campo}>
          <span>Modelo</span>
          <input
            className={estilo.entrada}
            name="modelo"
            placeholder="PA26G"
            required
            type="text"
          />
        </label>
        <label className={estilo.campo}>
          <span>Variação (opcional)</span>
          <input className={estilo.entrada} name="variante" placeholder="220v" type="text" />
        </label>
      </div>
      <button className={estilo.botaoNeutro} type="submit">
        Cadastrar aparelho
      </button>
      <p className={estilo.dica}>
        Copie marca e modelo como estão na etiqueta do aparelho. O sistema reconhece que PA21G e
        PA21X são o mesmo aparelho em outra cor, e usa isso para sugerir — nunca para publicar sem
        você confirmar.
      </p>
    </form>
  );
}

export function ListaDeAparelhos({
  aparelhos,
}: {
  readonly aparelhos: readonly {
    readonly id: string;
    readonly rotulo: string;
    readonly tipo: string;
    readonly explicacao: string | null;
  }[];
}) {
  if (aparelhos.length === 0) {
    return <p className={estilo.vazio}>Nenhum aparelho cadastrado.</p>;
  }
  return (
    <ul className={estilo.aparelhos}>
      {aparelhos.map((a) => (
        <li key={a.id}>
          <strong>{a.rotulo}</strong> <span className={estilo.itemSub}>{a.tipo}</span>
          {a.explicacao !== null && <div className={estilo.leituraDoCodigo}>{a.explicacao}</div>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Responder pergunta de comprador, a partir da mesma base da ficha.
 *
 * "Serve no meu purificador PA26G?" é a pergunta que fecha a venda em peça de
 * reposição, e responder em minutos pesa no ranqueamento das plataformas. A
 * resposta sai daqui pronta para copiar — e **só afirma quando a base sustenta**.
 *
 * É um formulário `GET`, sem ação de servidor: a pergunta vai na URL, a página
 * calcula a resposta e desenha. Assim a resposta é compartilhável por link, o botão
 * "voltar" funciona, e nada é gravado — porque não há o que gravar.
 */
export function ResponderComprador({
  produto,
  pergunta,
  resposta,
}: {
  readonly produto: string;
  readonly pergunta: string;
  readonly resposta: Resposta | null;
}) {
  return (
    <form className={estilo.formulario} method="get">
      <label className={estilo.campo} htmlFor="pergunta">
        <span>Pergunta do comprador sobre “{produto}”</span>
        <input
          className={estilo.entrada}
          defaultValue={pergunta}
          id="pergunta"
          name="p"
          placeholder="serve no meu purificador PA26G?"
          type="text"
        />
      </label>
      <button className={estilo.botaoNeutro} type="submit">
        Ver o que responder
      </button>

      {resposta !== null && (
        <>
          <blockquote className={estilo.resposta}>{resposta.texto}</blockquote>
          <p className={estilo.dica}>
            {resposta.tipo === 'serve'
              ? `Pode enviar: ${resposta.fontes.join(', ')}.`
              : 'Confira antes de prometer — a base ainda não sustenta uma confirmação.'}
          </p>
        </>
      )}
    </form>
  );
}
