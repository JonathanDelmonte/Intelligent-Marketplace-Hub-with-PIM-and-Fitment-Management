/**
 * Link de afiliado e fila de publicação espaçada (M13 — 11.6).
 *
 * A especificação diz o limite e a razão dele na mesma frase: "fila de publicação para
 * o grupo, com limite por dia e espaçamento (**grupo que posta 40 ofertas por dia é
 * silenciado pelos membros**)".
 *
 * É o raro caso em que o limite não é técnico: o gargalo é a paciência de quem lê. Um
 * grupo silenciado não dá erro, não aparece em log, e continua recebendo publicação
 * para ninguém — o que faz o teto ser a entrega, e não uma precaução.
 *
 * ## O que este módulo decide, e o que ele não decide
 *
 * Decide **quando** publicar e **em que ordem**. Não decide se a oferta é boa: isso é
 * do detector de queda real, que já roda antes e devolve `valePublicar`.
 *
 * ## A tag do afiliado vem de configuração
 *
 * Nenhuma tag literal no código. É credencial de programa de afiliados, e mora onde
 * moram as credenciais (ADR 0007) — aqui ela entra por parâmetro.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import { pontosBase, type PontosBase } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';

/**
 * Quantas ofertas por dia, no máximo.
 *
 * Oito. A especificação diz que 40 silencia o grupo e não diz onde fica o limite bom;
 * oito é uma por hora e meia num dia de doze horas úteis, que passa como curadoria e
 * não como enxurrada. Número escolhido, não medido — fica nomeado para ser ajustado
 * com taxa de saída do grupo na mão, que é a medida que importa.
 */
export const OFERTAS_POR_DIA = 8;

/**
 * Espaçamento mínimo entre duas publicações, em minutos.
 *
 * Quarenta e cinco. Duas ofertas em cinco minutos são lidas como spam mesmo que as
 * duas sejam boas — o intervalo é o que separa curadoria de despejo.
 */
export const ESPACAMENTO_MINIMO_MINUTOS = 45;

/** Onde a tag de afiliado entra na URL, por plataforma. Levantamento, não fato. */
const PARAMETRO_DA_TAG: Readonly<Record<Plataforma, string>> = {
  ml: 'matt_word',
  shopee: 'af_siteid',
  amazon: 'tag',
};

export class LinkDeAfiliadoInvalido extends Error {
  override readonly name = 'LinkDeAfiliadoInvalido';
}

/**
 * Monta o link de afiliado.
 *
 * Preserva a query que já existe na URL e **sobrescreve** apenas o parâmetro da tag:
 * link de produto costuma carregar parâmetro de busca e de posição, e jogar isso fora
 * às vezes muda a página que abre.
 *
 * Lança para URL inválida, porque publicar link quebrado no grupo é pior que não
 * publicar — e é erro de programação, não estado previsto.
 */
export function linkDeAfiliado(url: string, plataforma: Plataforma, tag: string): string {
  const limpa = tag.trim();
  if (limpa === '') throw new LinkDeAfiliadoInvalido('tag de afiliado vazia');

  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    throw new LinkDeAfiliadoInvalido(`URL inválida: ${url}`);
  }

  if (alvo.protocol !== 'https:' && alvo.protocol !== 'http:') {
    throw new LinkDeAfiliadoInvalido(`esquema não suportado: ${alvo.protocol}`);
  }

  alvo.searchParams.set(PARAMETRO_DA_TAG[plataforma], limpa);
  return alvo.toString();
}

/** Uma oferta esperando a vez na fila. */
export interface OfertaNaFila {
  readonly id: string;
  readonly plataforma: Plataforma;
  /** Desconto real contra a mediana, em pontos-base. Ordena a fila. */
  readonly scoreDescontoBp: PontosBase;
  /** Quando foi publicada no grupo. `null` significa que ainda não foi. */
  readonly publicadoEmGrupo: Date | null;
}

export type DecisaoDePublicacao =
  | { readonly tipo: 'publicar'; readonly oferta: OfertaNaFila }
  | { readonly tipo: 'esperar'; readonly motivo: string; readonly minutosRestantes: number }
  | { readonly tipo: 'nada_na_fila' };

export interface OpcoesDaFila {
  readonly agora?: Date;
  readonly fuso?: string;
  readonly porDia?: number;
  readonly espacamentoMinutos?: number;
}

/**
 * A próxima oferta a publicar, ou o motivo de esperar.
 *
 * A ordem é por desconto real decrescente: a melhor oferta do dia sai primeiro, porque
 * o teto diário existe e a última da fila pode não sair.
 *
 * Função pura sobre a fila inteira — inclusive o que já foi publicado, porque é disso
 * que sai a contagem do dia e o intervalo desde a última.
 */
export function proximaPublicacao(
  fila: readonly OfertaNaFila[],
  opcoes: OpcoesDaFila = {},
): DecisaoDePublicacao {
  const agora = opcoes.agora ?? new Date();
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const porDia = opcoes.porDia ?? OFERTAS_POR_DIA;
  const espacamento = opcoes.espacamentoMinutos ?? ESPACAMENTO_MINIMO_MINUTOS;

  const hoje = diaNoFuso(agora, fuso);
  const publicadas = fila.filter((o) => o.publicadoEmGrupo !== null);

  const publicadasHoje = publicadas.filter(
    (o) => o.publicadoEmGrupo !== null && diaNoFuso(o.publicadoEmGrupo, fuso) === hoje,
  );

  const pendentes = fila.filter((o) => o.publicadoEmGrupo === null);
  if (pendentes.length === 0) return { tipo: 'nada_na_fila' };

  if (publicadasHoje.length >= porDia) {
    return {
      tipo: 'esperar',
      motivo: `${contagem(publicadasHoje.length, 'oferta já saiu', 'ofertas já saíram')} hoje, que é o teto. Grupo que posta demais é silenciado pelos membros, e grupo silenciado não avisa ninguém.`,
      minutosRestantes: minutosAteAmanha(agora, fuso),
    };
  }

  const ultima = publicadas
    .map((o) => o.publicadoEmGrupo)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (ultima !== undefined) {
    const decorridos = Math.floor((agora.getTime() - ultima.getTime()) / 60_000);
    if (decorridos < espacamento) {
      return {
        tipo: 'esperar',
        motivo: `${decorridos === 0 ? 'A última saiu agora mesmo' : `A última saiu há ${contagem(decorridos, 'minuto', 'minutos')}`}. Duas ofertas seguidas são lidas como spam mesmo quando as duas são boas.`,
        minutosRestantes: espacamento - decorridos,
      };
    }
  }

  // Melhor desconto primeiro; empate pelo id, para a fila ser reproduzível.
  const escolhida = [...pendentes].sort(
    (a, b) => b.scoreDescontoBp - a.scoreDescontoBp || a.id.localeCompare(b.id),
  )[0];

  return escolhida === undefined
    ? { tipo: 'nada_na_fila' }
    : { tipo: 'publicar', oferta: escolhida };
}

/**
 * Minutos até a virada do dia, no fuso do vendedor.
 *
 * Calculado a partir da **hora local** com `Intl`, e não somando 24 horas a uma data:
 * somar 24 horas erra no dia de mudança de horário de verão, e o teto diário é
 * justamente a coisa que não deve liberar uma hora antes.
 */
function minutosAteAmanha(agora: Date, fuso: string): number {
  const [hora, minuto] = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(agora)
    .split(':');

  const decorridos = Number(hora ?? '0') * 60 + Number(minuto ?? '0');
  // Piso de um minuto: dizer "faltam 0" seria dizer "já pode", que é o oposto.
  return Math.max(1, 24 * 60 - decorridos);
}

export interface Desempenho {
  readonly publicadas: number;
  readonly cliques: number;
  readonly conversoes: number;
  /** Conversão por clique, em pontos-base. `null` sem clique — não é zero. */
  readonly conversaoBp: PontosBase | null;
  readonly mensagem: string;
}

export interface OfertaMedida {
  readonly cliques: number;
  readonly conversoes: number;
  readonly publicadoEmGrupo: Date | null;
}

/**
 * O desempenho do que foi publicado.
 *
 * A especificação pede rastreio "para saber o que o grupo realmente converte". Sem
 * clique, a conversão é `null` e não zero: zero afirmaria que o grupo não converte,
 * quando o que houve foi ninguém clicar — e as duas leituras levam a ações opostas
 * (mexer na oferta, ou mexer no texto do post).
 */
export function medirDesempenho(ofertas: readonly OfertaMedida[]): Desempenho {
  const publicadas = ofertas.filter((o) => o.publicadoEmGrupo !== null);
  const cliques = publicadas.reduce((soma, o) => soma + o.cliques, 0);
  const conversoes = publicadas.reduce((soma, o) => soma + o.conversoes, 0);

  if (publicadas.length === 0) {
    return {
      publicadas: 0,
      cliques: 0,
      conversoes: 0,
      conversaoBp: null,
      mensagem: 'Nenhuma oferta publicada ainda.',
    };
  }

  if (cliques === 0) {
    return {
      publicadas: publicadas.length,
      cliques: 0,
      conversoes,
      conversaoBp: null,
      mensagem: `${contagem(publicadas.length, 'oferta publicada', 'ofertas publicadas')} e nenhum clique. Isso é sobre o texto do post e o horário, não sobre o preço da oferta.`,
    };
  }

  const conversaoBp = pontosBase(Math.trunc((conversoes * 10_000) / cliques));

  return {
    publicadas: publicadas.length,
    cliques,
    conversoes,
    conversaoBp,
    mensagem: `${contagem(cliques, 'clique', 'cliques')} e ${contagem(conversoes, 'venda', 'vendas')} em ${contagem(publicadas.length, 'oferta', 'ofertas')}. Clique sem venda é oferta que parece boa e não é — provavelmente o preço na página não é o do post.`,
  };
}
