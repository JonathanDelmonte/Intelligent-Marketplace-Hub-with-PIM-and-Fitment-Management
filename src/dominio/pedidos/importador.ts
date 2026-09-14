/**
 * Conversão de linha de planilha em pedido (M10 — 8.6).
 *
 * Reusa inteiro o trabalho difícil da fase 3 — detecção de separador, busca de
 * cabeçalho entre linhas de título, mapeamento de coluna por sinônimo, leitura de
 * preço em vírgula ou ponto. Este módulo recebe a linha **já mapeada** e só decide
 * o que ela significa como venda.
 *
 * ## O que recusa a linha, e o que só vira aviso
 *
 * Recusa: sem identificador da venda, sem data legível, sem preço. Sem esses três
 * não há pedido — não se sabe qual venda é, quando foi, nem de quanto.
 *
 * Aviso: taxa faltando, comprador faltando, rastreio faltando. Uma venda sem a
 * comissão informada ainda é uma venda, e a margem sai com o aviso de que está
 * otimista. Recusar a linha inteira por isso perderia a venda toda por causa de
 * uma coluna.
 */
import { interpretarPreco } from '@/dominio/ingestao/planilha/importador';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import { reaisParaCentavos, type Centavos } from '@/lib/dinheiro';
import { interpretarData } from './planilha';
import type { PedidoCapturado } from './repositorio';

export type LinhaDePedido =
  | { readonly ok: true; readonly captura: PedidoCapturado; readonly avisos: readonly string[] }
  | { readonly ok: false; readonly motivo: string; readonly problemas: readonly string[] };

/** Lê uma célula de dinheiro: valor, ausente ou ilegível. */
function dinheiroDaCelula(bruto: string | undefined): {
  readonly valor: Centavos | null;
  readonly ilegivel: boolean;
} {
  const lido = interpretarPreco(bruto);
  if (lido.tipo === 'valor' && lido.valor !== null) {
    try {
      return { valor: reaisParaCentavos(lido.valor), ilegivel: false };
    } catch {
      return { valor: null, ilegivel: true };
    }
  }
  return { valor: null, ilegivel: lido.tipo === 'ilegivel' };
}

function inteiroDaCelula(bruto: string | undefined, padrao: number): number {
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const n = Number.parseInt(bruto.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

export interface ParametrosDaConversao {
  readonly plataforma: Plataforma;
  readonly fonte: Fonte;
  /** Fuso do vendedor, para a data sem hora cair no dia certo. */
  readonly fuso?: string;
}

/**
 * Converte uma linha mapeada em pedido capturado.
 *
 * A quantidade cai para 1 quando não vem: planilha de venda de marketplace
 * frequentemente omite quantidade em venda unitária, e recusar a linha por isso
 * perderia a maioria das vendas.
 */
export function converterLinhaEmPedido(
  bruto: Readonly<Record<string, string>>,
  params: ParametrosDaConversao,
): LinhaDePedido {
  const problemas: string[] = [];
  const avisos: string[] = [];

  const idExterno = (bruto['id_externo'] ?? '').trim();
  if (idExterno === '') problemas.push('id_externo: a venda não tem identificador');

  const data = interpretarData(bruto['data'], params.fuso);
  if (data === null) {
    problemas.push(
      `data: ${bruto['data'] === undefined ? 'coluna ausente' : `não entendi "${bruto['data']}"`}`,
    );
  }

  const preco = dinheiroDaCelula(bruto['preco']);
  if (preco.valor === null) {
    problemas.push(
      preco.ilegivel ? `preco: valor ilegível "${bruto['preco'] ?? ''}"` : 'preco: ausente',
    );
  }

  if (problemas.length > 0) {
    return {
      ok: false,
      motivo: 'linha de venda sem identificador, data ou preço',
      problemas,
    };
  }

  const comissao = dinheiroDaCelula(bruto['comissao']);
  const fixa = dinheiroDaCelula(bruto['taxa_fixa']);
  const frete = dinheiroDaCelula(bruto['frete']);
  const repasse = dinheiroDaCelula(bruto['repasse_liquido']);

  for (const [nome, lido] of [
    ['comissão', comissao],
    ['taxa fixa', fixa],
    ['frete', frete],
    ['repasse', repasse],
  ] as const) {
    if (lido.ilegivel) avisos.push(`${nome} ilegível: entrou como desconhecida.`);
  }

  const ean = (bruto['ean'] ?? '').trim();
  if (ean === '') {
    avisos.push('Sem EAN na linha: o pedido não casa com SKU e fica sem margem até alguém ligar.');
  }

  return {
    ok: true,
    captura: {
      plataforma: params.plataforma,
      idExterno,
      // Os três já foram validados acima; o `??` existe para o compilador, e o
      // caminho de `null` é inalcançável aqui.
      data: data ?? new Date(0),
      qtd: inteiroDaCelula(bruto['quantidade'], 1),
      precoBruto: preco.valor ?? reaisParaCentavos(0),
      taxaComissao: comissao.valor,
      taxaFixa: fixa.valor,
      fretePago: frete.valor,
      repasseLiquido: repasse.valor,
      ean: ean === '' ? null : ean,
      statusEnvio: (bruto['status'] ?? '').trim() === '' ? null : (bruto['status'] ?? '').trim(),
      rastreio: (bruto['rastreio'] ?? '').trim() === '' ? null : (bruto['rastreio'] ?? '').trim(),
      fonte: params.fonte,
    },
    avisos,
  };
}
