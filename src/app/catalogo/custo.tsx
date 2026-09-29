'use client';

/**
 * Quanto a pessoa paga por uma unidade: o valor, e o campo para mudar.
 *
 * O mesmo campo na tabela e no produto. Sem custo, ele já aparece aberto, porque é a
 * pergunta que falta; com custo, aparece o valor, e um clique abre o campo no mesmo
 * lugar. Salvar é a ação de servidor de sempre, que funciona sem JavaScript no
 * navegador, e a loja e a meta da tela vão junto, para ela voltar do jeito que estava.
 */
import { useState } from 'react';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { centavos, centavosParaDigitar, formatarBRL } from '@/lib/dinheiro';
import { salvarCusto } from './acoes';
import { metaNaUrl } from './apresentacao';
import estilo from './catalogo.module.css';
import type { Meta } from './conta';
import { SinalCerto, SinalFechar, SinalLapis } from '../ui/sinais';

export function CampoDeCusto({
  skuId,
  nome,
  custo,
  meta,
  plataforma,
  volta,
  focar = false,
  formulario,
}: {
  readonly skuId: string;
  /** O nome do produto, para o leitor de tela saber de que custo se trata. */
  readonly nome: string;
  readonly custo: number | null;
  readonly meta: Meta;
  readonly plataforma?: Plataforma;
  /** Para onde salvar leva: a linha da tabela, ou o produto. */
  readonly volta: 'lista' | 'produto';
  /** Põe o cursor no campo quando ele abre sozinho. */
  readonly focar?: boolean;
  /**
   * O nome do formulário, quando o botão de salvar mora em outra casa da tabela.
   *
   * Na linha sem custo, o campo fica na coluna do custo e o botão fica logo ao lado, na
   * casa larga que espera o preço: juntos na mesma casa estreita, eles quebravam em duas
   * linhas. O botão acha o formulário pelo atributo `form`, que é HTML comum.
   */
  readonly formulario?: string;
}) {
  const [editando, setEditando] = useState(false);
  const naTabela = volta === 'lista';
  const metaNoFormulario = metaNaUrl(meta);

  if (custo !== null && !editando) {
    return (
      <button
        className={naTabela ? estilo.custoNaTabela : estilo.custoNoCartao}
        onClick={() => setEditando(true)}
        title="Mudar o custo"
        type="button"
      >
        <span className={naTabela ? estilo.custoValor : estilo.numeroDoCartao}>
          {formatarBRL(centavos(custo))}
        </span>
        <span className={estilo.custoLapis}>
          <SinalLapis />
          <span className="sr-only">Mudar o custo de {nome}</span>
        </span>
      </button>
    );
  }

  return (
    <form
      action={salvarCusto}
      className={naTabela ? estilo.formDoCusto : estilo.formDoCustoGrande}
      id={formulario}
    >
      <input name="id" type="hidden" value={skuId} />
      {naTabela ? <input name="volta" type="hidden" value="lista" /> : null}
      {plataforma === undefined ? null : (
        <input name="plataforma" type="hidden" value={plataforma} />
      )}
      {metaNoFormulario === null ? null : (
        <input name={metaNoFormulario[0]} type="hidden" value={metaNoFormulario[1]} />
      )}
      <label className={naTabela ? estilo.campoDoCusto : estilo.campoDoCustoGrande}>
        <span className="sr-only">Quanto você paga por uma unidade de {nome}</span>
        <span aria-hidden="true" className={estilo.moeda}>
          R$
        </span>
        <input
          autoFocus={editando || focar}
          className={estilo.entradaDoCusto}
          defaultValue={custo === null ? '' : centavosParaDigitar(centavos(custo))}
          inputMode="decimal"
          name="custo"
          placeholder="0,00"
          required
          type="text"
        />
      </label>
      {naTabela && editando ? (
        // Mudando um custo que já existe, a casa é estreita: dois botões de ícone.
        <>
          <button aria-label="Salvar o custo" className={estilo.botaoIcone} type="submit">
            <SinalCerto tamanho={14} />
          </button>
          <button
            aria-label="Cancelar"
            className={estilo.botaoIconeClaro}
            onClick={() => setEditando(false)}
            type="button"
          >
            <SinalFechar tamanho={14} />
          </button>
        </>
      ) : formulario === undefined ? (
        <>
          <button className={estilo.botao} type="submit">
            Salvar
          </button>
          {editando ? (
            <button className={estilo.botaoTexto} onClick={() => setEditando(false)} type="button">
              Cancelar
            </button>
          ) : null}
        </>
      ) : null}
    </form>
  );
}
