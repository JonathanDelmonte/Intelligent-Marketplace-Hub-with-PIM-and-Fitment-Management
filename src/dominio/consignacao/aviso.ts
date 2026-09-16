/**
 * Mensagens ao parceiro de consignação (M11 — 8.10).
 *
 * Duas, e as duas existem para resolver o mesmo risco por lados opostos:
 *
 * - **Vendeu:** "separe esta peça, o prazo é este". Sem isso a peça continua no
 *   balcão até alguém lembrar, e o prazo de postagem corre do mesmo jeito.
 * - **Conferência:** "quantas destas você ainda tem?". É o que impede de vender o
 *   que a loja já vendeu no balcão.
 *
 * Função pura que devolve texto, como o primeiro contato a fornecedor. Nome de quem
 * fala vem por parâmetro, de configuração — nenhuma marca literal aqui (ADR 0003).
 *
 * ## O prazo entra como data e hora, escrito por extenso
 *
 * "Prazo: 16/09" manda a peça chegar no fim do dia 16, e o prazo era 10h. A
 * mensagem diz dia **e** hora, no fuso do vendedor, porque é o parceiro que vai
 * ler — e ele não sabe o que é UTC nem tem por que saber.
 */
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import { centavos, formatarBRL, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';

export interface ItemConsignado {
  /** Como a peça é chamada na conversa. */
  readonly descricao: string;
  readonly qtd: number;
  /** Código do fabricante, quando houver. É o que tira ambiguidade no balcão. */
  readonly codigo?: string | null;
}

export interface ParametrosDoAvisoDeVenda {
  /** Nome de quem está falando. De configuração, nunca literal. */
  readonly vendedor: string;
  readonly parceiro?: string | null;
  readonly item: ItemConsignado;
  /** Prazo de postagem do pedido. `null` quando a plataforma não informou. */
  readonly prazoPostagemAte: Date | null;
  readonly fuso?: string;
}

/** Data e hora em português, no fuso do vendedor: `16/09/2026 às 10:00`. */
export function dataEHoraNoFuso(data: Date, fuso: string = FUSO_PADRAO): string {
  const formatada = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
  // `pt-BR` devolve "16/09/2026, 10:00". O "às" é o que faz a frase ser lida como
  // frase, e não como registro de sistema.
  return formatada.replace(', ', ' às ');
}

function linhaDoItem(item: ItemConsignado): string {
  const codigo =
    item.codigo !== null && item.codigo !== undefined && item.codigo.trim() !== ''
      ? ` (código ${item.codigo})`
      : '';
  return `${item.qtd} × ${item.descricao}${codigo}`;
}

/**
 * Aviso de venda.
 *
 * A ordem é a de quem precisa agir: o que separar, até quando, e quem está
 * pedindo. Pedir confirmação é o que transforma a mensagem em combinado — sem ela
 * não há como saber se a peça foi separada, e a descoberta viria pelo comprador
 * reclamando.
 */
export function avisoDeVenda(params: ParametrosDoAvisoDeVenda): string {
  const saudacao =
    params.parceiro !== null && params.parceiro !== undefined && params.parceiro.trim() !== ''
      ? `Olá, ${params.parceiro.trim()}!`
      : 'Olá!';

  const prazo =
    params.prazoPostagemAte === null
      ? 'Preciso postar assim que possível — a plataforma não informou o prazo, e sem prazo eu trabalho com o mais curto.'
      : `Preciso postar até ${dataEHoraNoFuso(params.prazoPostagemAte, params.fuso ?? FUSO_PADRAO)}.`;

  return [
    saudacao,
    '',
    `Vendi um item que está em consignação com você: ${linhaDoItem(params.item)}.`,
    '',
    `Pode separar para eu retirar? ${prazo}`,
    '',
    'Me confirma que separou, por favor — assim eu sei que posso contar com a peça.',
    '',
    params.vendedor,
  ].join('\n');
}

export interface ItemParaConferir {
  readonly descricao: string;
  /** O que o sistema acha que ainda tem lá. É o número a ser confirmado. */
  readonly qtdNoSistema: number;
  readonly codigo?: string | null;
}

export interface ParametrosDoPedidoDeConferencia {
  readonly vendedor: string;
  readonly parceiro?: string | null;
  readonly itens: readonly ItemParaConferir[];
  /** Dias desde a última conferência. `null` quando nunca houve. */
  readonly diasDesdeAUltima: number | null;
}

/**
 * Pedido de conferência.
 *
 * Manda a contagem do sistema junto, de propósito: perguntar "quantos você tem?" em
 * aberto recebe "acho que uns cinco". Perguntar "eu tenho cinco anotados, confere?"
 * recebe sim ou o número certo, e é uma resposta que dá para usar.
 */
export function pedidoDeConferencia(params: ParametrosDoPedidoDeConferencia): string {
  const saudacao =
    params.parceiro !== null && params.parceiro !== undefined && params.parceiro.trim() !== ''
      ? `Olá, ${params.parceiro.trim()}!`
      : 'Olá!';

  const desdeQuando =
    params.diasDesdeAUltima === null
      ? 'Ainda não conferimos esse estoque nenhuma vez.'
      : params.diasDesdeAUltima === 0
        ? 'A última conferência foi hoje.'
        : `A última conferência foi há ${contagem(params.diasDesdeAUltima, 'dia', 'dias')}.`;

  const lista = params.itens.map(
    (i) =>
      `- ${i.descricao}${i.codigo !== null && i.codigo !== undefined && i.codigo.trim() !== '' ? ` (código ${i.codigo})` : ''}: tenho ${contagem(i.qtdNoSistema, 'anotado', 'anotados')}`,
  );

  return [
    saudacao,
    '',
    `${desdeQuando} Como eu mantenho esses itens anunciados, preciso confirmar o que ainda está com você — se vender aqui o que já saiu no balcão, eu tenho de cancelar, e cancelamento pesa na minha conta.`,
    '',
    ...lista,
    '',
    'Pode confirmar os números, ou me dizer os certos?',
    '',
    params.vendedor,
  ].join('\n');
}

/** Uma linha de fechamento em texto, para mandar ao parceiro junto do pagamento. */
export function linhaDeFechamento(
  descricao: string,
  unidades: number,
  repassePorUnidade: Centavos,
): string {
  return `${descricao}: ${unidades} × ${formatarBRL(repassePorUnidade)} = ${formatarBRL(centavos(unidades * repassePorUnidade))}`;
}
