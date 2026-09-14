/**
 * Componentes da tela de postagem.
 *
 * Todos de servidor e sem JavaScript no cliente: confirmar postagem é um `form`
 * com ação de servidor. Esta é a tela que se usa com o celular na mão e a caixa na
 * bancada, então tem de funcionar em rede ruim e com a aba recarregada.
 */
import type { FilaDoDia, ItemDaFila } from '@/dominio/pedidos/fila-do-dia';
import type { Centavos } from '@/lib/dinheiro';
import { formatarBRL } from '@/lib/dinheiro';
import { CAMINHO as CAMINHO_DE_CONSIGNACAO } from '@/app/consignacao/constantes';
import { confirmarPostagem } from './acoes';
import {
  divergenciaEmTexto,
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

function CartaoDoPedido({ item }: { readonly item: ItemDaFila }) {
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
            {item.plataforma} · {item.idExterno}
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

export function Fila({ fila }: { readonly fila: FilaDoDia }) {
  if (fila.itens.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nada na fila. Se você acabou de vender, importe a planilha de vendas na tela de jobs.
      </p>
    );
  }
  return (
    <ul className={estilo.fila}>
      {fila.itens.map((item) => (
        <CartaoDoPedido item={item} key={item.id} />
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

export function Divergencias({
  divergencias,
}: {
  readonly divergencias: readonly DivergenciaParaTela[];
}) {
  if (divergencias.length === 0) {
    return (
      <p className={estilo.vazio}>
        Nenhuma diferença entre o que a plataforma informou e o que as taxas explicam.
      </p>
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
          <li key={d.id}>
            <strong>{d.idExterno}</strong> · {d.data.toLocaleDateString('pt-BR')} ·{' '}
            {divergenciaEmTexto(d.divergencia)} (informado {formatarBRL(d.repasseInformado)})
          </li>
        ))}
      </ul>
    </>
  );
}
