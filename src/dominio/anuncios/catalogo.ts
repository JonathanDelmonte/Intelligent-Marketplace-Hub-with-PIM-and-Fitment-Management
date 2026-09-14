/**
 * Alerta de catálogo do Mercado Livre (M9, 8.5).
 *
 * A especificação: "se o produto existe em catálogo no ML, avisar que conta sem
 * reputação verde não ganha a posição destacada e fica em 'outras opções de
 * compra'".
 *
 * ## Isto não é o aviso que M8 já dá
 *
 * A precificação tem `catalogo_sem_reputacao`, e ele dispara quando **você
 * escolhe** anunciar em catálogo. É uma consequência da sua escolha, e você já
 * sabia.
 *
 * O que falta é o contrário, e é o que pega: o produto **já tem ficha de catálogo**,
 * e você nem escolheu nada. Anúncio comum de um produto que tem ficha é absorvido
 * pela ficha, e o comprador que chega nela vê um vendedor em destaque e o resto
 * escondido atrás de "outras opções de compra". Sem reputação verde o resto é você.
 * A hora de saber disso é **antes** de comprar estoque, não depois de anunciar.
 *
 * ## Como se sabe, sem API
 *
 * Dois sinais independentes, dos dados que a ingestão já traz. Nenhum é prova —
 * prova seria a API, que não há —, então o veredito é graduado e diz de qual sinal
 * veio:
 *
 * 1. **A URL.** Ficha de catálogo do ML vive em `/p/MLB…`, anúncio de vendedor em
 *    `/MLB-…`. É estrutural, e é o sinal forte: se uma ocorrência aponta para
 *    `/p/`, a ficha existe. O classificador de entrada já reconhece as duas formas.
 * 2. **Vários vendedores no mesmo GTIN.** Ficha de catálogo agrega vendedores por
 *    GTIN, então muitos vendedores de ML no mesmo código de barras é indício. É o
 *    sinal fraco: pode ser só concorrência sem ficha nenhuma.
 *
 * Sinal fraco sozinho nunca vira `confirmado`. É a mesma disciplina da fase 6:
 * evidência fraca informa, não decide.
 */
import type { Severidade } from '@/dominio/precificacao/tipos';

/**
 * Reputação da conta no ML.
 *
 * `nao_informada` é o padrão e **não** é o mesmo que amarela: o sistema não tem
 * como descobrir isso sem API, e chutar "ruim" para todo mundo faria o alerta
 * virar ruído que a pessoa aprende a ignorar. Sem a informação, o aviso é
 * condicional — e continua acionável, porque quem lê sabe a própria reputação.
 */
export const REPUTACOES = ['verde', 'abaixo_de_verde', 'nao_informada'] as const;
export type Reputacao = (typeof REPUTACOES)[number];

/** Presença de ficha de catálogo, graduada pela força do sinal. */
export const PRESENCAS = ['confirmada', 'provavel', 'sem_sinal'] as const;
export type Presenca = (typeof PRESENCAS)[number];

export const SINAIS = ['url_de_ficha', 'muitos_vendedores'] as const;
export type Sinal = (typeof SINAIS)[number];

/**
 * A partir de quantos vendedores de ML no mesmo GTIN o sinal fraco acende.
 *
 * Três, e não dois: dois vendedores no mesmo código de barras é o caso comum de
 * uma marca e um revendedor, sem ficha nenhuma. A partir de três a agregação
 * começa a explicar melhor o que se vê do que a coincidência.
 *
 * Número escolhido por raciocínio, não medido — não há conta conectada para
 * conferir. Fica nomeado aqui para o ajuste ser em um lugar.
 */
export const VENDEDORES_QUE_SUGEREM_FICHA = 3;

/** Uma ocorrência do produto no mundo, do jeito que a ingestão a guarda. */
export interface OcorrenciaParaCatalogo {
  readonly plataformaOuSite: string | null;
  readonly url: string | null;
  readonly vendedor: string | null;
  readonly ean: string | null;
}

export interface AvaliacaoDeCatalogo {
  readonly presenca: Presenca;
  /** Quais sinais acenderam, na ordem de `SINAIS`. */
  readonly sinais: readonly Sinal[];
  /** Vendedores distintos de ML vistos neste produto. Entra na mensagem. */
  readonly vendedoresNoMl: number;
  readonly severidade: Severidade;
  /** Nulo quando não há nada a dizer. Tela não mostra caixa vazia. */
  readonly mensagem: string | null;
}

/** Ficha de catálogo do ML: `/p/MLB…`. Anúncio de vendedor é `/MLB-…`. */
const URL_DE_FICHA = /mercadolivre\.[a-z.]+\/p\/MLB\d{6,}/i;

function ehDoMl(o: OcorrenciaParaCatalogo): boolean {
  if (
    o.plataformaOuSite !== null &&
    /^ml$|mercadolivre|mercado[\s_-]?livre/i.test(o.plataformaOuSite)
  ) {
    return true;
  }
  return o.url !== null && /mercadolivre\./i.test(o.url);
}

/**
 * Avalia se o produto tem ficha de catálogo no ML, e o que isso significa para
 * esta conta.
 *
 * Função pura sobre as ocorrências que a ingestão já gravou. Não chama rede: o
 * caminho de rede é M3, e este alerta precisa funcionar sem plataforma conectada
 * como toda tela do sistema (ADR 0002).
 */
export function avaliarCatalogoML(
  ocorrencias: readonly OcorrenciaParaCatalogo[],
  reputacao: Reputacao = 'nao_informada',
): AvaliacaoDeCatalogo {
  const doMl = ocorrencias.filter(ehDoMl);

  const temUrlDeFicha = doMl.some((o) => o.url !== null && URL_DE_FICHA.test(o.url));

  const vendedores = new Set(
    doMl
      .map((o) => o.vendedor?.trim().toLowerCase())
      .filter((v): v is string => v !== undefined && v !== ''),
  );
  const muitosVendedores = vendedores.size >= VENDEDORES_QUE_SUGEREM_FICHA;

  const sinais = SINAIS.filter((s) => (s === 'url_de_ficha' ? temUrlDeFicha : muitosVendedores));

  const presenca: Presenca = temUrlDeFicha
    ? 'confirmada'
    : muitosVendedores
      ? 'provavel'
      : 'sem_sinal';

  return {
    presenca,
    sinais,
    vendedoresNoMl: vendedores.size,
    severidade: severidadeDe(presenca, reputacao),
    mensagem: mensagemDe(presenca, reputacao, vendedores.size),
  };
}

/**
 * Gravidade do alerta.
 *
 * Reputação verde com ficha confirmada é **informativo**, não aviso: a ficha passa
 * a ser oportunidade — quem tem verde disputa o destaque e ganha a vitrine inteira
 * em vez de dividir. O mesmo fato muda de sinal conforme quem o lê.
 */
function severidadeDe(presenca: Presenca, reputacao: Reputacao): Severidade {
  if (presenca === 'sem_sinal') return 'informativo';
  if (reputacao === 'verde') return 'informativo';
  if (presenca === 'confirmada' && reputacao === 'abaixo_de_verde') return 'vermelho';
  return 'amarelo';
}

function mensagemDe(presenca: Presenca, reputacao: Reputacao, vendedores: number): string | null {
  if (presenca === 'sem_sinal') return null;

  const comoSabe =
    presenca === 'confirmada'
      ? 'Este produto tem ficha de catálogo no ML — uma das ocorrências aponta para a ficha.'
      : `Este produto provavelmente tem ficha de catálogo no ML: ${vendedores} vendedores diferentes no mesmo código de barras. Confirme abrindo o anúncio de um deles.`;

  const oQueFazer =
    reputacao === 'verde'
      ? 'Com reputação verde isso é a favor: dá para disputar a posição destacada e ficar com a vitrine inteira em vez de dividir.'
      : reputacao === 'abaixo_de_verde'
        ? 'Sem reputação verde você não ganha a posição destacada e fica em "outras opções de compra", que é quase invisível. Conte com volume baixo até a reputação subir.'
        : 'Se a sua conta não tem reputação verde, você não ganha a posição destacada e fica em "outras opções de compra", que é quase invisível — vale checar antes de comprar estoque.';

  return `${comoSabe} ${oQueFazer}`;
}
