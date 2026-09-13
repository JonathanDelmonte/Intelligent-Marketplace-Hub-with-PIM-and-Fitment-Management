/**
 * Gerador do primeiro contato com fornecedor.
 *
 * A especificação pede "um gerador do primeiro contato com as cinco perguntas já
 * preenchidas com o produto específico", e o detalhe que faz a diferença é o
 * **específico**: mensagem genérica de "gostaria de saber sobre seus produtos"
 * recebe resposta genérica ou nenhuma. Perguntar por um item nomeado, com
 * quantidade, faz a resposta vir com preço.
 *
 * Função pura que devolve texto. Nenhum nome de marca entra aqui — o nome de quem
 * está falando vem por parâmetro, de configuração (ADR 0003).
 *
 * Só pergunta o que ainda não se sabe. Refazer as cinco perguntas a quem já
 * respondeu três é o jeito mais rápido de parecer que ninguém leu a resposta.
 */
import { TEXTO_DA_PERGUNTA, type Pergunta } from './triagem';

export interface ProdutoDoContato {
  /** Como o produto é chamado na conversa: "refil de purificador de água". */
  readonly descricao: string;
  /** Modelos de aparelho em que serve, quando se sabe. Ajuda o fornecedor a achar. */
  readonly modelos?: readonly string[];
  /** Código do fabricante, quando se sabe. É o que elimina ambiguidade. */
  readonly codigo?: string | null;
}

export interface ParametrosDoContato {
  /** Nome de quem está falando. Vem de configuração, nunca literal. */
  readonly vendedor: string;
  /** Nome do fornecedor, para a saudação. */
  readonly fornecedor?: string | null;
  readonly produto: ProdutoDoContato;
  /** Quantidade da primeira compra. Pedir preço sem quantidade não recebe preço. */
  readonly quantidadeInicial?: number | null;
  /** As perguntas que faltam. Vazio = nenhuma pergunta, só a cotação. */
  readonly pendentes?: readonly Pergunta[];
}

/** Descreve o produto em uma linha, com o que houver de identificação. */
export function linhaDoProduto(produto: ProdutoDoContato): string {
  const partes = [produto.descricao];
  if (produto.codigo !== null && produto.codigo !== undefined && produto.codigo !== '') {
    partes.push(`código ${produto.codigo}`);
  }
  const modelos = produto.modelos ?? [];
  if (modelos.length > 0) {
    partes.push(`serve em ${modelos.join(', ')}`);
  }
  return partes.join(' — ');
}

/**
 * Monta a mensagem de primeiro contato.
 *
 * A ordem é a de uma conversa que dá certo: quem fala, o que quer, quanto quer, e
 * só então as perguntas. Pergunta antes de dizer o que se quer comprar parece
 * pesquisa de mercado, e fornecedor não responde pesquisa de mercado.
 */
export function mensagemDePrimeiroContato(params: ParametrosDoContato): string {
  const saudacao =
    params.fornecedor === null || params.fornecedor === undefined || params.fornecedor === ''
      ? 'Olá!'
      : `Olá, ${params.fornecedor}!`;

  const quantidade =
    params.quantidadeInicial === null ||
    params.quantidadeInicial === undefined ||
    params.quantidadeInicial <= 0
      ? null
      : params.quantidadeInicial;

  const linhas = [
    saudacao,
    '',
    `Sou ${params.vendedor} e vendo em marketplace. Estou procurando fornecedor para ${linhaDoProduto(params.produto)}.`,
    '',
    quantidade === null
      ? 'Gostaria de saber o preço de revenda e as condições.'
      : `Para começar, pensei em ${String(quantidade)} unidades. Gostaria de saber o preço de revenda nessa quantidade.`,
  ];

  const pendentes = params.pendentes ?? [];
  if (pendentes.length > 0) {
    linhas.push('', 'E, para eu não te fazer perder tempo depois, quatro perguntas rápidas:', '');
    for (const [i, pergunta] of pendentes.entries()) {
      linhas.push(`${String(i + 1)}. ${TEXTO_DA_PERGUNTA[pergunta]}`);
    }
  }

  linhas.push('', 'Obrigado!');
  return linhas.join('\n');
}
