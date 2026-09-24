/**
 * Componentes da tela de postagem.
 *
 * Todos de servidor e sem JavaScript no cliente: confirmar postagem é um `form`
 * com ação de servidor. Esta é a tela que se usa com o celular na mão e a caixa na
 * bancada, então tem de funcionar em rede ruim e com a aba recarregada.
 */
import Link from 'next/link';
import type { FilaDoDia, ItemDaFila } from '@/dominio/pedidos/fila-do-dia';
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';
import type { Centavos } from '@/lib/dinheiro';
import { formatarBRL } from '@/lib/dinheiro';
import { CAMINHO as CAMINHO_DE_CONSIGNACAO } from '@/app/consignacao/constantes';
import { contagem } from '@/lib/texto';
import { caminhoDaAba } from '../lojas/caminhos';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { IDIOMA } from '../ui/tempo';
import { confirmarPostagem, desfazerConferenciaDeRepasse, marcarRepasseConferido } from './acoes';
import {
  divergenciaEmTexto,
  repasseDaLojaEmTexto,
  rotuloDaUrgencia,
  tempoRestanteEmTexto,
  tomDaUrgencia,
  type Aviso,
} from './apresentacao';
import estilo from './postagem.module.css';

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

/**
 * Aviso de consignação, com link para a tela que resolve.
 *
 * Aviso que diz o problema e não diz onde resolver é aviso que a pessoa lê duas
 * vezes e ignora na terceira.
 */
export function AvisoDeConsignacao({ texto }: { readonly texto: string }) {
  return (
    <div className={`${estilo.aviso} ${estilo.avisoAtencao}`} role="status">
      <strong className={estilo.avisoTitulo}>Consignação sem conferir</strong>
      <span className={estilo.avisoCorpo}>
        {texto} <a href={CAMINHO_DE_CONSIGNACAO}>Abrir consignação</a>
      </span>
    </div>
  );
}

export function Painel({ fila }: { readonly fila: FilaDoDia }) {
  const cartoes = [
    { rotulo: 'Atrasados', valor: fila.porUrgencia.atrasado, nota: 'comece por estes' },
    { rotulo: 'Para hoje', valor: fila.porUrgencia.hoje, nota: 'ainda dá tempo' },
    { rotulo: 'Sem prazo', valor: fila.porUrgencia.sem_prazo, nota: 'não se sabe se atrasou' },
    { rotulo: 'Já postados', valor: fila.jaPostados, nota: 'saíram da fila' },
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

/**
 * O campo que devolve a ação para a tela de onde o formulário saiu.
 *
 * A área de cada loja usa estes mesmos formulários; sem a volta, confirmar uma postagem
 * na área da Shopee levaria para "Postar hoje". A ação lê o campo com `lerVolta`, que
 * só aceita a área de uma loja.
 */
function CampoDeVolta({ voltar }: { readonly voltar: string | undefined }) {
  return voltar === undefined ? null : <input name="voltar" type="hidden" value={voltar} />;
}

/** "Mercado Livre", e não "ml": o id da coluna é para o banco, o nome é para quem lê. */
function nomeDaLoja(plataforma: string): string {
  return ehPlataforma(plataforma) ? ROTULO_DA_PLATAFORMA[plataforma] : plataforma;
}

function CartaoDoPedido({
  item,
  voltar,
}: {
  readonly item: ItemDaFila;
  readonly voltar: string | undefined;
}) {
  const tom = tomDaUrgencia(item.urgencia);
  const classe =
    tom === 'alerta'
      ? `${estilo.etiqueta} ${estilo.etiquetaAlerta}`
      : tom === 'atencao'
        ? `${estilo.etiqueta} ${estilo.etiquetaAtencao}`
        : estilo.etiqueta;

  return (
    <li className={estilo.item}>
      <div className={estilo.itemCabecalho}>
        <div>
          <h3 className={estilo.itemTitulo}>
            {item.tituloDoProduto ?? 'produto não identificado'}
          </h3>
          <p className={estilo.itemSub}>
            {nomeDaLoja(item.plataforma)} · {item.idExterno}
            {item.qtd > 1 ? ` · ${String(item.qtd)} unidades` : ''}
          </p>
        </div>
        <span className={classe}>
          {rotuloDaUrgencia(item.urgencia)} · {tempoRestanteEmTexto(item.horasRestantes)}
        </span>
      </div>

      {item.tituloDoProduto === null && (
        <p className={estilo.dica}>
          Este pedido não casou com nenhum produto do catálogo, então não tem margem calculada.
          Cadastre o código de barras no produto e reimporte a planilha.
        </p>
      )}

      <form action={confirmarPostagem} className={estilo.formulario}>
        <input name="pedidoId" type="hidden" value={item.id} />
        <CampoDeVolta voltar={voltar} />
        <label className={estilo.campo}>
          <span>Rastreio (opcional)</span>
          <input
            className={estilo.entrada}
            defaultValue={item.rastreio ?? ''}
            name="rastreio"
            placeholder="BR123456789BR"
            type="text"
          />
        </label>
        <button className={estilo.botaoSim} type="submit">
          Postei este
        </button>
      </form>
    </li>
  );
}

export function Fila({
  fila,
  voltar,
}: {
  readonly fila: FilaDoDia;
  readonly voltar?: string | undefined;
}) {
  if (fila.itens.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nada na fila. Se você acabou de vender, importe a planilha de vendas em Importar.
      </p>
    );
  }
  return (
    <ul className={estilo.fila}>
      {fila.itens.map((item) => (
        <CartaoDoPedido item={item} key={item.id} voltar={voltar} />
      ))}
    </ul>
  );
}

export interface DivergenciaParaTela {
  readonly id: string;
  readonly idExterno: string;
  readonly data: Date;
  readonly divergencia: Centavos;
  readonly repasseInformado: Centavos;
}

export interface ConferidaParaTela {
  readonly id: string;
  readonly idExterno: string;
  readonly conferidoEm: Date;
  readonly repasseInformado: Centavos;
}

/**
 * O que já foi conferido, recolhido e com volta.
 *
 * Recolhido porque o que alguém já olhou não disputa atenção com o que não foi; com
 * volta porque a marca esconde um número de dinheiro, e botão de mão única sobre
 * dinheiro é o tipo de coisa que se descobre na hora errada.
 */
export function Conferidas({
  conferidas,
  voltar,
}: {
  readonly conferidas: readonly ConferidaParaTela[];
  readonly voltar?: string | undefined;
}) {
  if (conferidas.length === 0) return null;

  return (
    <details className={estilo.conferidas}>
      <summary>
        {contagem(conferidas.length, 'diferença já conferida', 'diferenças já conferidas')}
      </summary>
      <ul className={estilo.divergencias}>
        {conferidas.map((c) => (
          <li className={estilo.divergencia} key={c.id}>
            <span>
              <strong>{c.idExterno}</strong> · conferida em{' '}
              {c.conferidoEm.toLocaleDateString(IDIOMA)} (informado{' '}
              {formatarBRL(c.repasseInformado)})
            </span>
            <form action={desfazerConferenciaDeRepasse}>
              <input name="pedidoId" type="hidden" value={c.id} />
              <CampoDeVolta voltar={voltar} />
              <button className={estilo.botaoConferido} type="submit">
                Voltar para a lista
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Divergencias({
  divergencias,
  conferidas,
  voltar,
}: {
  readonly divergencias: readonly DivergenciaParaTela[];
  readonly conferidas: readonly ConferidaParaTela[];
  readonly voltar?: string | undefined;
}) {
  if (divergencias.length === 0) {
    return (
      <>
        <p className={estilo.vazio}>
          Nenhuma diferença entre o que a plataforma informou e o que as taxas explicam.
        </p>
        <Conferidas conferidas={conferidas} voltar={voltar} />
      </>
    );
  }

  return (
    <>
      <p className={estilo.dica}>
        Aqui aparecem taxas que não estavam na conta. Vale conferir no extrato da plataforma antes
        de aceitar como custo.
      </p>
      <ul className={estilo.divergencias}>
        {divergencias.map((d) => (
          <li className={estilo.divergencia} key={d.id}>
            <span>
              <strong>{d.idExterno}</strong> · {d.data.toLocaleDateString(IDIOMA)} ·{' '}
              {divergenciaEmTexto(d.divergencia)} (informado {formatarBRL(d.repasseInformado)})
            </span>
            {/*
              Sem este botão a lista só cresce: a consulta esconde o que já foi
              conferido, e nada escrevia a data. Divergência investigada voltava
              para sempre, e lista que só cresce ninguém lê.
            */}
            <form action={marcarRepasseConferido}>
              <input name="pedidoId" type="hidden" value={d.id} />
              <CampoDeVolta voltar={voltar} />
              <button className={estilo.botaoConferido} type="submit">
                Conferi no extrato
              </button>
            </form>
          </li>
        ))}
      </ul>
      <Conferidas conferidas={conferidas} voltar={voltar} />
    </>
  );
}

/**
 * O repasse de cada loja, com o atalho para a aba dela.
 *
 * A conferência de repasse morava inteira aqui; com a área de cada loja (ADR 0009) ela
 * foi para a aba Repasse da loja, onde o extrato que se confere é o daquela loja. Aqui
 * fica o que pesa no dia: quanto espera conferência em cada uma.
 */
export function RepasseNasLojas({
  lojas,
}: {
  readonly lojas: readonly { readonly plataforma: Plataforma; readonly paraConferir: number }[];
}) {
  return (
    <ul className={estilo.repasses}>
      {lojas.map(({ plataforma, paraConferir }) => (
        <li className={estilo.repasse} key={plataforma}>
          <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={24} />
          <Link href={caminhoDaAba(plataforma, 'repasse')}>{ROTULO_DA_PLATAFORMA[plataforma]}</Link>
          <span className={paraConferir === 0 ? estilo.repasseCalmo : estilo.repasseAberto}>
            {repasseDaLojaEmTexto(paraConferir)}
          </span>
        </li>
      ))}
    </ul>
  );
}
