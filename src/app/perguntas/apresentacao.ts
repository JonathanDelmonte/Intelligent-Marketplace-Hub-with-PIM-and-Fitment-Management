/**
 * O que a tela de perguntas diz. Funções puras, com teste.
 *
 * A leitura do que foi colado mora aqui, e não na ação, porque é a parte que erra: uma
 * caixa de texto colada do painel vem com linha em branco, com o nome de quem
 * perguntou, e com a mesma pergunta duas vezes. O que entra no banco é o que esta
 * função aceita.
 */
import type { Tema } from '@/dominio/posvenda/recorrente';
import { REPETICOES_QUE_ACUSAM, type DuvidaRecorrente } from '@/dominio/posvenda/recorrente';

export const ROTULO_DO_TEMA: Readonly<Record<Tema, string>> = {
  compatibilidade: 'serve no meu modelo?',
  medida: 'medida',
  voltagem: 'voltagem',
  quantidade: 'quantas peças vêm',
  prazo: 'prazo de entrega',
  garantia: 'garantia e troca',
  originalidade: 'original ou paralelo',
  outro: 'outro assunto',
};

/**
 * Comprimento mínimo de uma pergunta.
 *
 * Quatro caracteres: "ok", "?" e "obg" são o que sobra quando alguém cola a conversa
 * inteira em vez das perguntas, e eles não ensinam nada sobre o anúncio.
 */
export const MINIMO_DE_CARACTERES = 4;

/** Quantas linhas um lote aceita de uma vez. */
export const MAXIMO_POR_LOTE = 200;

export interface LeituraDoLote {
  readonly perguntas: readonly string[];
  /** Linhas descartadas por serem curtas demais para ser pergunta. */
  readonly curtas: number;
  /** Linhas iguais a outra do mesmo lote. */
  readonly repetidasNoLote: number;
  /** Linhas que não entraram porque passaram do teto do lote. */
  readonly sobraram: number;
}

/**
 * Lê o texto colado: uma pergunta por linha.
 *
 * Sem separador inventado e sem formato a decorar — copiar a coluna de perguntas do
 * painel produz exatamente isto. Duplicata dentro do mesmo lote é removida aqui para
 * a contagem da tela não mentir; duplicata contra o que já está no banco é resolvida
 * lá, pela chave única.
 */
export function lerPerguntas(bruto: string): LeituraDoLote {
  const linhas = bruto.split('\n').map((l) => l.trim());

  const aceitas: string[] = [];
  const vistas = new Set<string>();
  let curtas = 0;
  let repetidasNoLote = 0;
  let sobraram = 0;

  for (const linha of linhas) {
    if (linha === '') continue;
    if (linha.length < MINIMO_DE_CARACTERES) {
      curtas += 1;
      continue;
    }

    const chave = linha.toLowerCase().replace(/\s+/gu, ' ');
    if (vistas.has(chave)) {
      repetidasNoLote += 1;
      continue;
    }
    vistas.add(chave);

    if (aceitas.length >= MAXIMO_POR_LOTE) {
      sobraram += 1;
      continue;
    }
    aceitas.push(linha);
  }

  return { perguntas: aceitas, curtas, repetidasNoLote, sobraram };
}

/**
 * A frase do alto da tela.
 *
 * Três estados com ações diferentes: não há pergunta guardada, há pergunta e nenhuma
 * repetiu o bastante, e há dúvida acusando anúncio.
 */
export function resumoDasDuvidas(params: {
  readonly duvidas: readonly DuvidaRecorrente[];
  readonly perguntasNaJanela: number;
}): string {
  if (params.perguntasNaJanela === 0) {
    return 'Nenhuma pergunta guardada ainda. Cole as perguntas de um anúncio abaixo — a conta de repetição precisa de histórico, e é por isso que elas ficam guardadas.';
  }

  if (params.duvidas.length === 0) {
    return `${String(params.perguntasNaJanela)} ${params.perguntasNaJanela === 1 ? 'pergunta guardada' : 'perguntas guardadas'}, e nenhuma dúvida repetiu ${String(REPETICOES_QUE_ACUSAM)} vezes ainda.`;
  }

  const anuncios = new Set(params.duvidas.flatMap((d) => d.anuncios)).size;
  return `${String(params.duvidas.length)} ${params.duvidas.length === 1 ? 'dúvida está acusando' : 'dúvidas estão acusando'} ${String(anuncios)} ${anuncios === 1 ? 'anúncio' : 'anúncios'}.`;
}

export const CODIGOS_DE_AVISO = ['gravado', 'nada', 'so_repetidas', 'falha'] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/** Texto do aviso que volta pela URL depois de gravar um lote. */
export function descreverAviso(
  codigo: string | undefined,
  quantidade: number | null = null,
): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  const n = quantidade === null || !Number.isInteger(quantidade) || quantidade < 0 ? 0 : quantidade;

  switch (codigo as CodigoDeAviso) {
    case 'gravado':
      return {
        tom: 'ok',
        titulo: `${String(n)} ${n === 1 ? 'pergunta guardada' : 'perguntas guardadas'}`,
        corpo:
          'A conta de repetição considera os últimos 90 dias. Uma dúvida acusa o anúncio ao chegar na quinta vez.',
      };
    case 'nada':
      return {
        tom: 'atencao',
        titulo: 'Nada para guardar.',
        corpo: 'Cole uma pergunta por linha, e informe de qual anúncio elas são.',
      };
    case 'so_repetidas':
      return {
        tom: 'atencao',
        titulo: 'Todas já estavam guardadas.',
        corpo:
          'Nada foi duplicado. Colar a lista do painel de novo é o uso normal — o que já existia fica como está.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu.',
        corpo: 'Nada foi guardado. O erro está no log.',
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
