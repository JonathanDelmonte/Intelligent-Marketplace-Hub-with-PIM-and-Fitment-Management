/**
 * O que a tela Catálogo e preço diz, e para onde ela leva. Funções puras, com teste.
 *
 * A conta de dinheiro mora em `conta.ts`, que roda no navegador. Aqui ficam os textos e
 * os caminhos: a idade do custo, o resumo do alto, os avisos depois de cada ação, os
 * parâmetros que viajam na URL e os caminhos que outras telas usam para chegar aqui.
 *
 * Texto de tela, nesta tela, segue três regras do desenho novo: frase curta, sem
 * travessão, e dinheiro dito em reais antes de percentual.
 */
import { custoDefasado } from '@/dominio/catalogo/custo';
import {
  ehPlataforma,
  MODOS_FRETE,
  PLATAFORMAS,
  TIPOS_ANUNCIO_ML,
  type ModoFrete,
  type Plataforma,
  type TipoAnuncioML,
} from '@/dominio/precificacao/tipos';
import { lerReaisDigitados, pontosBase, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { formatarRelativo } from '../ui/tempo';
import { CAMINHO, CAMINHO_DO_NOVO, MARGEM_ALVO_PADRAO_BP } from './constantes';

// ─── O alto da tela ──────────────────────────────────────────────────────────

/**
 * A frase debaixo do título, quando há produto.
 *
 * Lidera pelo custo que falta, porque é a única falta que deixa a tabela em branco. Custo
 * velho vem depois: a tabela sai, mas pode estar mentindo devagar.
 */
export function resumoDaTabela(params: {
  readonly total: number;
  readonly semCusto: number;
  readonly velhos: number;
}): string {
  const base = contagem(params.total, 'produto', 'produtos');
  if (params.semCusto === 0 && params.velhos === 0) {
    return params.total === 1 ? `${base}, com custo.` : `${base}, todos com custo.`;
  }
  const partes = [`${base}.`];
  if (params.semCusto > 0) partes.push(`Falta o custo de ${String(params.semCusto)}.`);
  if (params.velhos > 0) {
    partes.push(
      params.velhos === 1
        ? 'Um custo tem mais de 30 dias.'
        : `${String(params.velhos)} custos têm mais de 30 dias.`,
    );
  }
  return partes.join(' ');
}

/** O que a ordem da tabela precisa saber de cada produto. */
export interface ChaveDeOrdem {
  readonly nome: string;
  readonly semCusto: boolean;
  /** Unidades vendidas nos últimos 30 dias, somando as lojas. */
  readonly unidades: number;
}

/**
 * A ordem da tabela: primeiro o que espera o custo, depois o que mais vende, e o resto
 * pelo nome.
 *
 * Sem custo no alto porque é a linha que pede alguma coisa, e é a primeira que se lê.
 * Depois, o que mais vende, porque um centavo errado nele custa mais. Quando o custo é
 * salvo, a linha desce para o lugar dela, e a volta da ação rola a tela até lá.
 */
export function ordemDaTabela(a: ChaveDeOrdem, b: ChaveDeOrdem): number {
  if (a.semCusto !== b.semCusto) return a.semCusto ? -1 : 1;
  if (a.unidades !== b.unidades) return b.unidades - a.unidades;
  return a.nome.localeCompare(b.nome, 'pt-BR');
}

/** Marca e código de barras, na linha de baixo do nome. `null` quando não há nenhum. */
export function detalheDoProduto(marca: string | null, ean: string | null): string | null {
  const partes = [marca, ean].filter((p): p is string => p !== null && p.trim() !== '');
  return partes.length === 0 ? null : partes.join(' · ');
}

/**
 * Quando o custo foi informado, e se ainda vale.
 *
 * Custo de mais de 30 dias vira pergunta ("ainda é esse?", que a tela põe numa linha
 * própria), e não alarme: quem sabe se o fornecedor reajustou é a pessoa, e a tela só
 * lembra de perguntar.
 */
export function textoDoCusto(
  custoAtualizadoEm: Date | null,
  agora: Date,
): { readonly texto: string; readonly velho: boolean } | null {
  if (custoAtualizadoEm === null) return null;
  return {
    texto: `informado ${formatarRelativo(custoAtualizadoEm, agora)}`,
    velho: custoDefasado(custoAtualizadoEm, agora),
  };
}

/** A pergunta que acompanha o custo velho. */
export const PERGUNTA_DO_CUSTO_VELHO = 'Ainda é esse?';

// ─── Parâmetros que viajam na URL ────────────────────────────────────────────

export interface ParametrosDoSimulador {
  readonly plataforma: Plataforma;
  readonly tipoAnuncioML: TipoAnuncioML;
  readonly modoFrete: ModoFrete;
  /** Preço a conferir. `null` quando a pessoa não escolheu um. */
  readonly preco: Centavos | null;
  readonly margemAlvoBp: number;
}

/** O alvo como vai na URL: `2000` pontos-base vira `"20"`, os reais de cada R$ 100. */
export function alvoEmPercentual(margemAlvoBp: number): string {
  return String(Math.round(margemAlvoBp / 100));
}

/** O alvo da URL de volta em pontos-base, ou `null`. */
export function lerAlvo(bruto: string): number | null {
  const n = Number.parseFloat(bruto.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n >= 100) return null;
  return pontosBase(Math.round(n * 100));
}

/**
 * Lê os parâmetros da conta na URL.
 *
 * Na URL e não só em estado de cliente: recarregar não perde o que se estava olhando, e
 * o link de uma conta é compartilhável. Valor fora da lista cai no padrão em vez de
 * derrubar a página, porque URL é texto que qualquer um digita.
 */
export function lerParametros(
  bruto: Readonly<Record<string, string | string[] | undefined>>,
): ParametrosDoSimulador {
  const um = (chave: string): string | undefined => {
    const valor = bruto[chave];
    return Array.isArray(valor) ? valor[0] : valor;
  };

  return {
    plataforma: PLATAFORMAS.find((p) => p === um('plataforma')) ?? 'ml',
    tipoAnuncioML: TIPOS_ANUNCIO_ML.find((t) => t === um('tipo')) ?? 'classico',
    modoFrete: MODOS_FRETE.find((f) => f === um('frete')) ?? 'comprador_paga',
    preco: lerReaisDigitados(um('preco') ?? ''),
    // O campo e a URL falam em reais de cada R$ 100 ("20"), e o domínio em pontos-base
    // (2000). Ida e volta pela mesma função: a primeira versão lia um e mandava o outro,
    // e pedir 25 virava 0,25.
    margemAlvoBp: lerAlvo(um('alvo') ?? '') ?? MARGEM_ALVO_PADRAO_BP,
  };
}

/** O produto, com a loja e o alvo quando dados, e a âncora de onde abrir. */
export function caminhoDoProduto(
  skuId: string,
  opcoes: {
    readonly plataforma?: Plataforma;
    readonly alvoBp?: number;
    readonly ancora?: string;
  } = {},
): string {
  const busca = new URLSearchParams();
  if (opcoes.plataforma !== undefined) busca.set('plataforma', opcoes.plataforma);
  if (opcoes.alvoBp !== undefined && opcoes.alvoBp !== MARGEM_ALVO_PADRAO_BP) {
    busca.set('alvo', alvoEmPercentual(opcoes.alvoBp));
  }
  const consulta = busca.toString();
  return `${CAMINHO}/${skuId}${consulta === '' ? '' : `?${consulta}`}${
    opcoes.ancora === undefined ? '' : `#${opcoes.ancora}`
  }`;
}

/** A conta do produto numa loja: o passo antes de montar o anúncio. */
export function caminhoDoSimulador(skuId: string, plataforma: Plataforma): string {
  return caminhoDoProduto(skuId, { plataforma, ancora: 'preco-titulo' });
}

// ─── Avisos depois de uma ação ───────────────────────────────────────────────

export const CODIGOS_DE_AVISO = [
  'criado',
  'custo',
  'ficha',
  'nada',
  'produto_invalido',
  'custo_invalido',
  'ficha_invalida',
  'desativado',
  'reativado',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  /** Uma frase, ou nada. O título sozinho basta quando a tela já mostra o resto. */
  readonly corpo: string | null;
}

export function descreverAviso(codigo: string | undefined): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'criado':
      return {
        tom: 'ok',
        titulo: 'Produto cadastrado.',
        corpo: 'Agora diga quanto você paga por ele.',
      };
    case 'custo':
      return { tom: 'ok', titulo: 'Custo salvo.', corpo: 'Os preços já usam o valor novo.' };
    case 'ficha':
      return { tom: 'ok', titulo: 'Ficha salva.', corpo: null };
    case 'nada':
      return { tom: 'atencao', titulo: 'Nada mudou.', corpo: null };
    case 'produto_invalido':
      return {
        tom: 'erro',
        titulo: 'O produto não entrou.',
        corpo:
          'O nome precisa de pelo menos 3 letras. Se você escreveu o código de barras, ele não confere: veja se digitou certo.',
      };
    case 'custo_invalido':
      return {
        tom: 'erro',
        titulo: 'Não deu para ler esse valor.',
        corpo: 'Escreva assim: 18,40.',
      };
    case 'ficha_invalida':
      return {
        tom: 'erro',
        titulo: 'A ficha não foi salva.',
        corpo:
          'Peso em gramas e medidas em milímetros são números maiores que zero, peças na embalagem é número inteiro, e devolução vai de 0 a 100.',
      };
    case 'desativado':
      return {
        tom: 'ok',
        titulo: 'Produto desativado.',
        corpo: 'Se foi engano, reative logo abaixo.',
      };
    case 'reativado':
      return {
        tom: 'ok',
        titulo: 'Produto de volta.',
        corpo: 'Voltou com custo, ficha e dados fiscais.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu certo.',
        corpo: 'Nada foi salvo. Tente de novo em instantes.',
      };
  }
}

// ─── Produto novo pedido por outra tela ─────────────────────────────────────

/** Um produto a cadastrar, pedido por outra tela: o "Publicar em" do garimpo. */
export interface ProdutoNovoPedido {
  readonly titulo: string;
  /** A loja em que a pessoa quer publicar. Vai junto até a conta do produto criado. */
  readonly plataforma: Plataforma | undefined;
}

/**
 * O cadastro de produto novo, aberto com o nome preenchido.
 *
 * Abre o formulário, e não cadastra direto: o nome do produto não se edita depois, e o
 * alvo de uma investigação nem sempre é o nome que se quer ver no catálogo para sempre.
 */
export function caminhoDoProdutoNovo(titulo: string, plataforma: Plataforma | undefined): string {
  const busca = new URLSearchParams({ novo: titulo });
  if (plataforma !== undefined) busca.set('plataforma', plataforma);
  return `${CAMINHO_DO_NOVO}?${busca.toString()}`;
}

/** O pedido de produto novo, lido da URL. Nome curto ou longo demais não é pedido. */
export function lerProdutoNovo(
  busca: Readonly<Record<string, string | string[] | undefined>>,
): ProdutoNovoPedido | null {
  const um = (valor: string | string[] | undefined): string | undefined =>
    Array.isArray(valor) ? valor[0] : valor;
  const titulo = (um(busca['novo']) ?? '').trim().replace(/\s+/g, ' ');
  if (titulo.length < 3 || titulo.length > 200) return null;
  const plataforma = um(busca['plataforma']);
  return { titulo, plataforma: ehPlataforma(plataforma) ? plataforma : undefined };
}

/**
 * Para onde vai o produto recém-criado: a conta dele, na loja pedida quando o pedido
 * veio com uma, aberta no botão de montar o anúncio.
 */
export function caminhoDoProdutoCriado(
  skuId: string,
  plataforma: Plataforma | undefined,
  codigo: CodigoDeAviso,
): string {
  if (plataforma === undefined) {
    return `${CAMINHO}/${skuId}?${new URLSearchParams({ r: codigo }).toString()}`;
  }
  return `${CAMINHO}/${skuId}?${new URLSearchParams({ plataforma, r: codigo }).toString()}#publicar-titulo`;
}
