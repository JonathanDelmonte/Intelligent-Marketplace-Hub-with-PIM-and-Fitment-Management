/**
 * A confiabilidade do fornecedor, medida pelo atraso real dos pedidos (M5, etapa 7.5).
 *
 * A especificação: "score de confiabilidade alimentado por atraso real dos pedidos". O
 * roadmap deixou isto bloqueado até haver pedido com data prometida e data real, porque
 * um score sobre impressão daria ao palpite a aparência de medição. Os dois dados agora
 * existem: o pedido importado tem a data da venda, e o "postado" da tela de postagem grava
 * quando o fornecedor postou.
 *
 * ## O que conta como no prazo
 *
 * Até o prazo de postagem da plataforma, quando o pedido tem. A planilha de vendas quase
 * nunca traz esse prazo, e aí a referência é o prazo que **o próprio fornecedor prometeu**
 * — a terceira das cinco perguntas —, contado em dias úteis a partir do dia da venda.
 * Sem nenhum dos dois, o pedido não mede nada, e não entra na conta.
 *
 * ## Quem responde por qual pedido
 *
 * Só conta pedido de produto que **um** fornecedor atende. Produto com dois fornecedores
 * não diz qual dos dois postou, e dividir o atraso entre eles seria inventar. Pedido sem
 * postagem confirmada também fica de fora: não se sabe se atrasou ou se só ninguém marcou.
 *
 * ## A nota
 *
 * De 0 a 5, pela fração postada no prazo, com pelo menos cinco pedidos medidos — com
 * menos, a nota diria mais sobre a sorte do que sobre o fornecedor. Os cortes são escolha
 * deste projeto, como o prazo máximo da triagem: marketplace pune atraso cedo, então 5 é
 * quase nunca atrasar, e não "atrasa pouco".
 *
 * É calculada na leitura, por perfil, e não gravada: pedido é do perfil, fornecedor é base
 * compartilhada (CLAUDE.md, 3.4), e uma nota gravada no fornecedor misturaria os perfis.
 */
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/** Quanto tempo para trás a medida olha. Fornecedor muda; o atraso de um ano atrás é outro. */
export const JANELA_DA_CONFIABILIDADE_DIAS = 180;

/** Com menos pedidos medidos que isso, não há nota. */
export const MINIMO_DE_PEDIDOS_MEDIDOS = 5;

/**
 * A nota por fração no prazo, em percentual inteiro: a maior nota cujo corte a fração
 * alcança. Abaixo do último corte, 1; nenhum no prazo, 0. Escolha do projeto — ver o
 * cabeçalho.
 */
export const CORTES_DA_NOTA: readonly { readonly nota: number; readonly minimoPct: number }[] = [
  { nota: 5, minimoPct: 95 },
  { nota: 4, minimoPct: 85 },
  { nota: 3, minimoPct: 70 },
  { nota: 2, minimoPct: 50 },
];

export interface PedidoParaMedir {
  readonly data: Date;
  readonly prazoPostagemAte: Date | null;
  readonly postagemConfirmadaEm: Date;
}

export type Confiabilidade =
  | { readonly tipo: 'sem_pedidos' }
  | { readonly tipo: 'poucos'; readonly medidos: number }
  | {
      readonly tipo: 'medida';
      readonly nota: number;
      readonly medidos: number;
      readonly noPrazo: number;
    };

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** `2026-09-24` → o meio-dia UTC desse dia, que não muda de dia com fuso nenhum. */
function meioDia(dia: string): number {
  const [ano, mes, d] = dia.split('-').map(Number);
  return Date.UTC(ano ?? 1970, (mes ?? 1) - 1, d ?? 1, 12);
}

/**
 * Dias úteis depois de `de`, até `ate` inclusive: venda na sexta e postagem na segunda é
 * um dia útil. Fim de semana não conta; feriado conta como dia útil — não há calendário
 * de feriados no sistema, e o erro é a favor do fornecedor.
 */
export function diasUteisEntre(de: string, ate: string): number {
  const inicio = meioDia(de);
  const fim = meioDia(ate);
  let uteis = 0;
  for (let dia = inicio + MS_POR_DIA; dia <= fim; dia += MS_POR_DIA) {
    const semana = new Date(dia).getUTCDay();
    if (semana !== 0 && semana !== 6) uteis += 1;
  }
  return uteis;
}

/**
 * O pedido foi postado no prazo? `null` quando não há prazo contra o qual medir.
 *
 * O prazo da plataforma é instante, e compara direto. O prometido é em dias úteis, e
 * compara por dia civil no fuso do vendedor: postar no fim do último dia prometido ainda é
 * cumprir a promessa.
 */
export function postadoNoPrazo(
  pedido: PedidoParaMedir,
  prometidoDias: number | null,
  fuso: string = FUSO_PADRAO,
): boolean | null {
  if (pedido.prazoPostagemAte !== null) {
    return pedido.postagemConfirmadaEm.getTime() <= pedido.prazoPostagemAte.getTime();
  }
  if (prometidoDias === null) return null;
  const levou = diasUteisEntre(
    diaNoFuso(pedido.data, fuso),
    diaNoFuso(pedido.postagemConfirmadaEm, fuso),
  );
  return levou <= prometidoDias;
}

/** A nota de uma fração, pelos cortes. Inteiro contra inteiro: sem ponto flutuante. */
export function notaDaFracao(noPrazo: number, medidos: number): number {
  if (medidos <= 0 || noPrazo <= 0) return 0;
  return CORTES_DA_NOTA.find((c) => noPrazo * 100 >= c.minimoPct * medidos)?.nota ?? 1;
}

/** A confiabilidade de um fornecedor, sobre os pedidos que só ele atende. */
export function medirConfiabilidade(
  pedidos: readonly PedidoParaMedir[],
  prometidoDias: number | null,
  fuso: string = FUSO_PADRAO,
): Confiabilidade {
  let medidos = 0;
  let noPrazo = 0;
  for (const pedido of pedidos) {
    const resultado = postadoNoPrazo(pedido, prometidoDias, fuso);
    if (resultado === null) continue;
    medidos += 1;
    if (resultado) noPrazo += 1;
  }
  if (medidos === 0) return { tipo: 'sem_pedidos' };
  if (medidos < MINIMO_DE_PEDIDOS_MEDIDOS) return { tipo: 'poucos', medidos };
  return { tipo: 'medida', nota: notaDaFracao(noPrazo, medidos), medidos, noPrazo };
}
