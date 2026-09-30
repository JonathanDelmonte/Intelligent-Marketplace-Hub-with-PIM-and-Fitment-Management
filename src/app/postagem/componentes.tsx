/**
 * Componentes da tela de postagem.
 *
 * Todos de servidor e sem JavaScript no cliente: confirmar postagem é um `form`
 * com ação de servidor. Esta é a tela que se usa com o celular na mão e a caixa na
 * bancada, então tem de funcionar em rede ruim e com a aba recarregada.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FilaDoDia, ItemDaFila } from '@/dominio/pedidos/fila-do-dia';
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';
import type { Centavos } from '@/lib/dinheiro';
import { formatarBRL } from '@/lib/dinheiro';
import { CAMINHO as CAMINHO_DE_CONSIGNACAO } from '@/app/consignacao/constantes';
import { contagem } from '@/lib/texto';
import { caminhoDaAba } from '../lojas/caminhos';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { FaixaDeNumeros } from '../ui/numeros';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { SinalAlerta, SinalAvancar, SinalCaixa, SinalCerto, SinalRelogio } from '../ui/sinais';
import { IDIOMA } from '../ui/tempo';
import { confirmarPostagem, desfazerConferenciaDeRepasse, marcarRepasseConferido } from './acoes';
import {
  diferencaCurta,
  gruposDaFila,
  numerosDaFila,
  repasseDaLojaEmTexto,
  semProdutoEmTexto,
  tempoRestanteEmTexto,
  tomDaUrgencia,
  type Aviso,
  type NumeroDaFila,
  type TomDaUrgencia,
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

const ICONE_DO_NUMERO: Readonly<Record<NumeroDaFila['chave'], ReactNode>> = {
  atrasado: <SinalAlerta />,
  hoje: <SinalRelogio />,
  sem_prazo: <SinalCaixa />,
  postados: <SinalCerto />,
};

/**
 * Os quatro números do alto. O escuro é o do atraso, que é o número que muda o que se
 * faz primeiro; os que têm fila atrás levam ao grupo deles na tabela.
 */
export function Painel({ fila }: { readonly fila: FilaDoDia }) {
  return (
    <FaixaDeNumeros
      itens={numerosDaFila(fila).map((numero) => ({
        rotulo: numero.rotulo,
        valor: numero.valor.toLocaleString(IDIOMA),
        nota: numero.nota,
        tom: numero.tom,
        icone: ICONE_DO_NUMERO[numero.chave],
        escuro: numero.chave === 'atrasado',
        ...(numero.ancora === null ? {} : { href: numero.ancora }),
      }))}
      rotulo="A fila de postagem em números"
    />
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

/** O ponto do grupo e a etiqueta do prazo, na cor da urgência. */
const CLASSE_DO_PONTO: Readonly<Record<TomDaUrgencia, string>> = {
  alerta: estilo.pontoAlerta,
  atencao: estilo.pontoAtencao,
  neutro: estilo.pontoNeutro,
};

const CLASSE_DO_PRAZO: Readonly<Record<TomDaUrgencia, string>> = {
  alerta: estilo.etiquetaAlerta,
  atencao: estilo.etiquetaAtencao,
  neutro: estilo.etiqueta,
};

/**
 * Uma linha da fila: o que é, de onde, quanto tempo falta, e o botão.
 *
 * O campo do rastreio mora numa casa e o botão em outra, e os dois são do mesmo
 * formulário pelo atributo `form`, que é HTML comum: um `form` não pode abraçar uma linha
 * de tabela. Sem JavaScript no navegador, como antes.
 */
function LinhaDoPedido({
  item,
  voltar,
  mostrarLoja,
}: {
  readonly item: ItemDaFila;
  readonly voltar: string | undefined;
  readonly mostrarLoja: boolean;
}) {
  const formulario = `postar-${item.id}`;
  return (
    <tr className={estilo.linha}>
      <td>
        <span className={item.tituloDoProduto === null ? estilo.produtoSem : estilo.produto}>
          {item.tituloDoProduto ?? 'Produto não identificado'}
        </span>
        <span className={estilo.pedidoNumero}>Pedido {item.idExterno}</span>
      </td>
      {mostrarLoja ? (
        <td>
          <span className={estilo.loja}>
            {ehPlataforma(item.plataforma) ? (
              <Selo identidade={IDENTIDADE_DA_LOJA[item.plataforma]} tamanho={20} />
            ) : null}
            {nomeDaLoja(item.plataforma)}
          </span>
        </td>
      ) : null}
      <td>
        <span className={CLASSE_DO_PRAZO[tomDaUrgencia(item.urgencia)]}>
          {tempoRestanteEmTexto(item.horasRestantes)}
        </span>
      </td>
      <td className={item.qtd > 1 ? estilo.unidadesVarias : estilo.unidades}>
        {item.qtd.toLocaleString(IDIOMA)}
      </td>
      <td>
        <label className={estilo.campoDoRastreio}>
          <span className="sr-only">Rastreio do pedido {item.idExterno}, se tiver</span>
          <input
            className={estilo.entradaDoRastreio}
            defaultValue={item.rastreio ?? ''}
            form={formulario}
            name="rastreio"
            type="text"
          />
        </label>
      </td>
      <td className={estilo.celulaAcao}>
        <form action={confirmarPostagem} id={formulario}>
          <input name="pedidoId" type="hidden" value={item.id} />
          <CampoDeVolta voltar={voltar} />
          <button className={estilo.botaoPostei} type="submit">
            <SinalCerto tamanho={14} />
            Postei
            <span className="sr-only"> o pedido {item.idExterno}</span>
          </button>
        </form>
      </td>
    </tr>
  );
}

/**
 * A fila como tabela, em grupos de urgência.
 *
 * Eram cartões, um por pedido, com o campo e o botão embaixo: trinta pedidos davam seis
 * telas de rolagem. Na tabela cabem numa, e o grupo diz a urgência uma vez só, no alto
 * de cada bloco. Serve a "Postar hoje" e à aba Pedidos de cada loja, onde a coluna da
 * loja sai, porque ali todas são a mesma.
 */
export function Fila({
  fila,
  titulo,
  texto,
  voltar,
  mostrarLoja = true,
}: {
  readonly fila: FilaDoDia;
  readonly titulo: string;
  readonly texto: ReactNode;
  readonly voltar?: string | undefined;
  readonly mostrarLoja?: boolean;
}) {
  const grupos = gruposDaFila(fila);
  const semProduto = semProdutoEmTexto(
    fila.itens.filter((item) => item.tituloDoProduto === null).length,
  );
  const colunas = mostrarLoja ? 6 : 5;

  return (
    <section aria-labelledby="fila-titulo" className={estilo.cartaoDaFila}>
      <header className={estilo.topoDoCartao}>
        <div className={estilo.topoTextos}>
          <h2 className={estilo.tituloDoCartao} id="fila-titulo">
            {titulo}
          </h2>
          <p className={estilo.textoDoCartao}>{texto}</p>
        </div>
        {fila.itens.length === 0 ? null : (
          <span className={estilo.contaDaFila}>
            {contagem(fila.itens.length, 'pedido na fila', 'pedidos na fila')}
          </span>
        )}
      </header>

      {fila.itens.length === 0 ? (
        <p className={estilo.filaVazia}>
          <span className={estilo.filaVaziaSinal}>
            <SinalCerto tamanho={16} />
          </span>
          Nada na fila. Se você acabou de vender, importe a planilha de vendas em{' '}
          <Link href="/importar">Importar</Link>.
        </p>
      ) : (
        <div className={estilo.rolagem}>
          <table className={estilo.tabela}>
            <thead>
              <tr>
                <th className={estilo.cabecaPedido} scope="col">
                  Pedido
                </th>
                {mostrarLoja ? (
                  <th className={estilo.cabecaLoja} scope="col">
                    Loja
                  </th>
                ) : null}
                <th className={estilo.cabecaPrazo} scope="col">
                  Prazo
                </th>
                <th className={estilo.cabecaUnidades} scope="col">
                  Unidades
                </th>
                <th className={estilo.cabecaRastreio} scope="col">
                  Rastreio (se tiver)
                </th>
                <th className={estilo.cabecaAcao} scope="col">
                  <span className="sr-only">Confirmar a postagem</span>
                </th>
              </tr>
            </thead>
            {grupos.map((grupo) => (
              <tbody className={estilo.grupo} id={grupo.ancora} key={grupo.urgencia}>
                <tr className={estilo.linhaDoGrupo}>
                  <th colSpan={colunas} scope="rowgroup">
                    <span className={estilo.grupoCabeca}>
                      <span aria-hidden="true" className={CLASSE_DO_PONTO[grupo.tom]} />
                      <span className={estilo.grupoTitulo}>{grupo.titulo}</span>
                      <span className={estilo.grupoConta}>
                        {grupo.itens.length.toLocaleString(IDIOMA)}
                      </span>
                      <span className={estilo.grupoExplicacao}>{grupo.explicacao}</span>
                    </span>
                  </th>
                </tr>
                {grupo.itens.map((item) => (
                  <LinhaDoPedido
                    item={item}
                    key={item.id}
                    mostrarLoja={mostrarLoja}
                    voltar={voltar}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {semProduto === null ? null : (
        <footer className={estilo.rodapeDoCartao}>
          <p className={estilo.legenda}>{semProduto}</p>
        </footer>
      )}
    </section>
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
        Pedidos em que a loja pagou diferente do que as taxas explicam: uma taxa que não estava na
        conta, ou um desconto que não se sabia. Vale conferir no extrato antes de aceitar como
        custo.
      </p>
      <div className={estilo.rolagem}>
        <table className={estilo.tabelaDoRepasse}>
          <thead>
            <tr>
              <th scope="col">Pedido</th>
              <th className={estilo.cabecaData} scope="col">
                Data
              </th>
              <th className={estilo.cabecaValor} scope="col">
                Diferença
              </th>
              <th className={estilo.cabecaValor} scope="col">
                A loja informou
              </th>
              <th className={estilo.cabecaConferir} scope="col">
                <span className="sr-only">Conferir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {divergencias.map((d) => (
              <tr className={estilo.linha} key={d.id}>
                <td className={estilo.pedidoDoRepasse}>{d.idExterno}</td>
                <td className={estilo.dataDoRepasse}>{d.data.toLocaleDateString(IDIOMA)}</td>
                <td className={d.divergencia < 0 ? estilo.valorAMenos : estilo.valorAMais}>
                  {diferencaCurta(d.divergencia)}
                </td>
                <td className={estilo.valor}>{formatarBRL(d.repasseInformado)}</td>
                <td className={estilo.celulaAcao}>
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
                      <span className="sr-only"> o pedido {d.idExterno}</span>
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <section aria-labelledby="repasse-titulo" className={estilo.cartaoDoRepasse}>
      <header className={estilo.topoDoCartao}>
        <div className={estilo.topoTextos}>
          <h2 className={estilo.tituloDoCartao} id="repasse-titulo">
            Repasse de cada loja
          </h2>
          <p className={estilo.textoDoCartao}>
            O dinheiro que a loja pagou diferente do que as taxas explicam. A conferência mora na
            aba Repasse de cada loja, com o extrato daquela loja do lado.
          </p>
        </div>
      </header>
      <ul className={estilo.repasses}>
        {lojas.map(({ plataforma, paraConferir }) => (
          <li className={estilo.repasse} key={plataforma}>
            <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={28} />
            <span className={estilo.repasseLoja}>{ROTULO_DA_PLATAFORMA[plataforma]}</span>
            <span className={paraConferir === 0 ? estilo.etiquetaOk : estilo.etiquetaAtencao}>
              {repasseDaLojaEmTexto(paraConferir)}
            </span>
            <Link className={estilo.repasseAbrir} href={caminhoDaAba(plataforma, 'repasse')}>
              {paraConferir === 0 ? 'Abrir' : 'Conferir'}
              <span className="sr-only"> o repasse de {ROTULO_DA_PLATAFORMA[plataforma]}</span>
              <SinalAvancar tamanho={12} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
