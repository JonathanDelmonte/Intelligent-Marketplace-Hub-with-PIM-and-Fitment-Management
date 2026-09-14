/**
 * Componentes da tela de consignação.
 *
 * Todos de servidor e sem JavaScript no cliente: conferir é um `form` com ação de
 * servidor. A conferência de verdade acontece no balcão da loja, com o celular na
 * mão, então a tela precisa funcionar em rede ruim e com a aba recarregada.
 */
import type { ItemDaConferencia, QuadroDeConferencia } from '@/dominio/consignacao/conferencia';
import type { Fechamento } from '@/dominio/consignacao/fechamento';
import { formatarBRL } from '@/lib/dinheiro';
import { cadastrarConsignacao, registrarConferencia } from './acoes';
import {
  desdeAUltimaEmTexto,
  mesEmTexto,
  resumoDoFechamento,
  rotuloDoEstado,
  tomDoEstado,
  type Aviso,
} from './apresentacao';
import estilo from './consignacao.module.css';

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

export function Painel({ quadro }: { readonly quadro: QuadroDeConferencia }) {
  const cartoes = [
    {
      rotulo: 'Unidades em risco',
      valor: quadro.unidadesEmRisco,
      nota: 'anunciadas e não conferidas',
    },
    { rotulo: 'Nunca conferidos', valor: quadro.porEstado.nunca, nota: 'ninguém olhou ainda' },
    { rotulo: 'Atrasados', valor: quadro.porEstado.vencida, nota: 'passou do prazo' },
    { rotulo: 'Em dia', valor: quadro.porEstado.em_dia, nota: 'nada a fazer' },
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

function CartaoDoItem({ item }: { readonly item: ItemDaConferencia }) {
  const tom = tomDoEstado(item.estado);
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
            {item.tituloDoProduto ?? 'produto sem título no catálogo'}
          </h3>
          <p className={estilo.itemSub}>
            {item.parceiroNome} · {item.qtdDisponivel} unidade(s) no sistema ·{' '}
            {desdeAUltimaEmTexto(item.diasDesde)}
          </p>
        </div>
        <span className={classe}>{rotuloDoEstado(item.estado)}</span>
      </div>

      {/*
        A contagem é campo obrigatório, e não há botão "conferi" sem número: marcar a
        data sem corrigir o estoque apaga o alerta e deixa o erro, que é o pior
        resultado possível nesta tela.
      */}
      <form action={registrarConferencia} className={estilo.formulario}>
        <input name="consignacaoId" type="hidden" value={item.id} />
        <label className={estilo.campo}>
          Quantas o parceiro tem agora
          <input
            className={estilo.entrada}
            defaultValue={item.qtdDisponivel}
            min={0}
            name="qtdContada"
            required
            step={1}
            type="number"
          />
        </label>
        <button className={estilo.botaoSim} type="submit">
          Registrar conferência
        </button>
      </form>
    </li>
  );
}

export function Quadro({ quadro }: { readonly quadro: QuadroDeConferencia }) {
  if (quadro.itens.length === 0) {
    return <p className={estilo.vazio}>Nada em consignação ainda.</p>;
  }
  return (
    <ul className={estilo.fila}>
      {quadro.itens.map((i) => (
        <CartaoDoItem item={i} key={i.id} />
      ))}
    </ul>
  );
}

export function FechamentoDoMes({ fechamento }: { readonly fechamento: Fechamento }) {
  return (
    <>
      <p className={estilo.resumo}>
        {mesEmTexto(fechamento.de)}: {resumoDoFechamento(fechamento)}
      </p>

      {fechamento.porParceiro.length > 0 && (
        <ul className={estilo.lista}>
          {fechamento.porParceiro.map((p) => (
            <li key={p.parceiroNome}>
              <strong>{p.parceiroNome}</strong>: {formatarBRL(p.aRepassar)} · {p.unidades}{' '}
              unidade(s)
              {p.pendencias.length > 0 && (
                <ul className={estilo.pendencias}>
                  {p.pendencias.map((pend) => (
                    <li key={pend.pedidoId}>
                      {pend.tituloDoProduto ?? 'produto sem título'} ({pend.qtd} un.) — sem preço de
                      repasse combinado, então está fora do total.
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export interface OpcaoDeSku {
  readonly id: string;
  readonly titulo: string;
}

/**
 * Cadastro de item em consignação.
 *
 * O SKU vem de lista, não de campo livre: consignação sem SKU não tem custo, não
 * tem margem e não tem como casar com a venda — seria uma anotação, não um
 * controle.
 */
export function Cadastro({ skus }: { readonly skus: readonly OpcaoDeSku[] }) {
  if (skus.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhum produto no catálogo ainda. Consignação precisa de um SKU para poder casar a venda com
        a peça do parceiro — cadastre o produto primeiro.
      </p>
    );
  }

  return (
    <form action={cadastrarConsignacao} className={estilo.cadastro}>
      <label className={estilo.campo}>
        Parceiro
        <input className={estilo.entrada} name="parceiroNome" required type="text" />
      </label>
      <label className={estilo.campo}>
        Contato do parceiro (opcional)
        <input className={estilo.entrada} name="parceiroContato" type="text" />
      </label>
      <label className={estilo.campo}>
        Produto
        <select className={estilo.entrada} name="skuId" required>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.titulo}
            </option>
          ))}
        </select>
      </label>
      <label className={estilo.campo}>
        Quantidade que está lá
        <input
          className={estilo.entrada}
          defaultValue={1}
          min={0}
          name="qtdDisponivel"
          required
          step={1}
          type="number"
        />
      </label>
      <label className={estilo.campo}>
        Repasse por unidade, em reais (opcional)
        <input
          className={estilo.entrada}
          inputMode="decimal"
          name="precoAcordadoRepasse"
          type="text"
        />
      </label>
      <button className={estilo.botao} type="submit">
        Cadastrar
      </button>
    </form>
  );
}
