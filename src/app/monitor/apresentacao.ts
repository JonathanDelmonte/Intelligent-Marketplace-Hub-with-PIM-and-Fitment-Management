/**
 * O que a tela do monitor diz. Funções puras, com teste.
 *
 * A regra de negócio do monitor já está no domínio — o piso de 3%, a assimetria entre
 * queda e alta, o agrupamento por semana, os quatro vereditos de queda. O que mora
 * aqui é a **ordem** e o **texto**: qual grupo aparece primeiro, como uma mudança de
 * preço se lê em uma linha, e o que dizer quando não há nada.
 *
 * Ordem é decisão de operação, não de layout: um grupo vermelho lido depois de três
 * informativos é um grupo que ninguém leu.
 */
import type { Severidade } from '@/dominio/precificacao/tipos';
import type { GrupoDeEventos, Evento } from '@/dominio/monitor/eventos';
import type { AvaliacaoDaQueda, VereditoDeQueda } from '@/dominio/monitor/queda';
import { centavos, formatarBRL } from '@/lib/dinheiro';
import { IDIOMA } from '../ui/tempo';

export const ROTULO_DA_SEVERIDADE: Readonly<Record<Severidade, string>> = {
  vermelho: 'não pode esperar',
  amarelo: 'olhe hoje',
  informativo: 'para saber',
};

/** Tom visual por severidade. Nome de classe, não cor — a cor é do tema. */
export const TOM_DA_SEVERIDADE: Readonly<Record<Severidade, 'alerta' | 'atencao' | 'neutro'>> = {
  vermelho: 'alerta',
  amarelo: 'atencao',
  informativo: 'neutro',
};

export const ROTULO_DO_VEREDITO: Readonly<Record<VereditoDeQueda, string>> = {
  queda_real: 'queda real',
  desconto_fraco: 'desconto fraco',
  preco_inflado: 'preço inflado',
  sem_referencia: 'sem referência',
};

/**
 * Tom de cada veredito.
 *
 * `preco_inflado` é o único que ganha alerta, e não é por ser ruim para você: é o
 * truque de subir para depois "baixar", e quem o ignora publica um desconto que não
 * existe. `desconto_fraco` e `sem_referencia` não são erro de ninguém.
 */
export const TOM_DO_VEREDITO: Readonly<
  Record<VereditoDeQueda, 'ok' | 'alerta' | 'atencao' | 'neutro'>
> = {
  queda_real: 'ok',
  desconto_fraco: 'neutro',
  preco_inflado: 'alerta',
  sem_referencia: 'neutro',
};

const PESO_DA_SEVERIDADE: Readonly<Record<Severidade, number>> = {
  vermelho: 0,
  amarelo: 1,
  informativo: 2,
};

/**
 * Percentual legível a partir de pontos-base. 1 500 bp é "15%".
 *
 * Uma casa decimal só abaixo de 10%, onde ela muda a decisão (3,2% é ruído, 9,8% é
 * quase o corte). O corte usa o **módulo**: com `pct < 10` direto, −17,3% ganhava
 * casa decimal e 17,3% não, e os dois apareciam na mesma tela.
 */
export function percentual(bp: number | null): string {
  if (bp === null) return '—';
  const pct = bp / 100;
  const casas = Math.abs(pct) < 10 ? 1 : 0;
  return `${pct.toLocaleString(IDIOMA, { maximumFractionDigits: casas })}%`;
}

/**
 * O desconto contra a mediana, com o rótulo certo para o sinal.
 *
 * `descontoBp` é negativo quando o preço está **acima** da mediana, e mostrar
 * "desconto real: −17,3%" obriga quem lê a interpretar um sinal para descobrir que o
 * preço subiu. O rótulo muda junto com o sinal, e o número sai sempre positivo.
 */
export function descontoLegivel(descontoBp: number | null): {
  readonly rotulo: string;
  readonly valor: string;
} {
  if (descontoBp === null) return { rotulo: 'desconto real', valor: '—' };
  if (descontoBp < 0) {
    return { rotulo: 'acima da mediana', valor: percentual(-descontoBp) };
  }
  return { rotulo: 'desconto real', valor: percentual(descontoBp) };
}

/**
 * Um evento em uma linha.
 *
 * O título diz **o quê** e quanto; o detalhe diz de onde para onde. Separados porque
 * a tela mostra o primeiro em peso normal e o segundo em cinza, e juntá-los numa
 * frase só obrigaria a ler tudo para achar o número.
 */
export function descreverEvento(evento: Evento): {
  readonly titulo: string;
  readonly detalhe: string | null;
} {
  const antes = Number(evento.valorAntes);
  const depois = Number(evento.valorDepois);
  const temPrecos = Number.isFinite(antes) && Number.isFinite(depois) && antes > 0;

  const quanto = evento.variacaoBp === null ? '' : ` ${percentual(evento.variacaoBp)}`;

  const titulo =
    evento.tipo === 'preco_concorrente_caiu'
      ? `Preço caiu${quanto}`
      : evento.tipo === 'preco_concorrente_subiu'
        ? `Preço subiu${quanto}`
        : evento.tipo === 'estoque_concorrente_subiu'
          ? 'Estoque subiu'
          : evento.tipo === 'custo_fornecedor_subiu'
            ? `Custo do fornecedor subiu${quanto}`
            : evento.tipo === 'concorrente_novo'
              ? 'Vendedor novo no nicho'
              : evento.tipo === 'produto_parou_de_vender'
                ? 'Produto parou de vender'
                : 'Taxa da plataforma mudou';

  return {
    titulo,
    detalhe: temPrecos
      ? `${formatarBRL(centavos(antes))} para ${formatarBRL(centavos(depois))}`
      : null,
  };
}

/**
 * Os grupos na ordem em que precisam ser lidos.
 *
 * `agruparEventos` já ordena por severidade; esta função existe para a tela não
 * depender disso — ordem de leitura é decisão da tela, e uma mudança na função de
 * agrupamento não pode reordenar silenciosamente o que a pessoa vê primeiro.
 */
export function ordenarGrupos(grupos: readonly GrupoDeEventos[]): readonly GrupoDeEventos[] {
  return [...grupos].sort(
    (a, b) =>
      PESO_DA_SEVERIDADE[a.severidade] - PESO_DA_SEVERIDADE[b.severidade] ||
      b.eventos.length - a.eventos.length ||
      a.chave.localeCompare(b.chave),
  );
}

/** Uma oferta avaliada, do jeito que a tela precisa. */
export interface QuedaNaTela {
  readonly produtoExternoId: string;
  readonly titulo: string;
  readonly de: string;
  readonly avaliacao: AvaliacaoDaQueda;
}

const PESO_DO_VEREDITO: Readonly<Record<VereditoDeQueda, number>> = {
  queda_real: 0,
  preco_inflado: 1,
  desconto_fraco: 2,
  sem_referencia: 3,
};

/**
 * As quedas na ordem de quem decide o que publicar.
 *
 * Primeiro o que vale publicar, com o maior desconto no topo. Depois o preço inflado,
 * que é o que **não** se deve publicar e por isso precisa ser visto. Por último o que
 * não dá conclusão.
 */
export function ordenarQuedas(quedas: readonly QuedaNaTela[]): readonly QuedaNaTela[] {
  return [...quedas].sort(
    (a, b) =>
      PESO_DO_VEREDITO[a.avaliacao.veredito] - PESO_DO_VEREDITO[b.avaliacao.veredito] ||
      (b.avaliacao.descontoBp ?? 0) - (a.avaliacao.descontoBp ?? 0) ||
      a.titulo.localeCompare(b.titulo, IDIOMA),
  );
}

/**
 * A frase do alto da tela.
 *
 * Distingue três estados que parecem o mesmo e pedem ações opostas: nada aconteceu,
 * nada foi observado ainda, e há coisa urgente esperando.
 */
export function resumoDoMonitor(params: {
  readonly grupos: readonly GrupoDeEventos[];
  readonly ofertasComSerie: number;
}): string {
  const urgentes = params.grupos.filter((g) => g.severidade === 'vermelho').length;
  if (urgentes > 0) {
    return `${String(urgentes)} ${urgentes === 1 ? 'mudança não pode' : 'mudanças não podem'} esperar.`;
  }
  if (params.grupos.length > 0) {
    return `${String(params.grupos.length)} ${params.grupos.length === 1 ? 'mudança' : 'mudanças'} para olhar, nenhuma urgente.`;
  }
  if (params.ofertasComSerie === 0) {
    return 'Nada observado ainda. O monitor compara o preço de hoje com o da última captura, então ele começa a falar na segunda vez que a mesma oferta entrar.';
  }
  return 'Nenhuma mudança acima do piso desde a última leitura.';
}

export const CODIGOS_DE_AVISO = ['lido', 'nada_para_ler', 'falha'] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/** Texto do aviso que volta pela URL depois de uma ação. */
export function descreverAviso(
  codigo: string | undefined,
  quantidade: number | null = null,
): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  const n = quantidade === null || !Number.isInteger(quantidade) || quantidade < 0 ? 0 : quantidade;

  switch (codigo as CodigoDeAviso) {
    case 'lido':
      return {
        tom: 'ok',
        titulo: `${String(n)} ${n === 1 ? 'mudança marcada como lida' : 'mudanças marcadas como lidas'}`,
        corpo: 'Sai da fila e continua gravada. O histórico de preço não muda.',
      };
    case 'nada_para_ler':
      return {
        tom: 'atencao',
        titulo: 'Nada foi marcado.',
        corpo: 'O grupo já havia sido lido, ou a página estava velha.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu.',
        corpo: 'Nada foi marcado. O erro está no log.',
      };
  }
}

/** Inteiro não negativo de parâmetro de URL, ou `null`. Nunca lança. */
export function inteiroDaUrl(bruto: string | string[] | undefined): number | null {
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  if (valor === undefined) return null;
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
