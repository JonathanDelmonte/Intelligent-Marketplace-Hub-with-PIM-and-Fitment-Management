/**
 * Detector de pergunta recorrente (M16 — 11.4).
 *
 * A especificação em uma frase, e a conclusão dela é o que importa: "se a mesma dúvida
 * aparece cinco vezes, **o anúncio está incompleto**. Sugerir o que acrescentar."
 *
 * Não é um relatório de perguntas. É um detector de **defeito no anúncio** que usa as
 * perguntas como sintoma — e por isso a saída é o que escrever na descrição, não uma
 * contagem.
 *
 * ## O agrupamento é por assunto, não por texto
 *
 * "serve no PA26G?", "essa vela cabe no meu purificador 26G" e "compatível com
 * PA26G???" são a mesma dúvida escrita de três formas. Agrupar por texto contaria uma
 * cada e nunca chegaria a cinco — o detector nunca dispararia, e ninguém saberia por
 * quê.
 *
 * Então o assunto é derivado: o **código de modelo** quando a pergunta tem um (que é o
 * caso dominante em reposição), e um tema por palavra-chave quando não tem.
 *
 * ## Por que isto não precisa de LLM
 *
 * Extrair código de modelo já é determinístico desde a fase 5 (`codigosDeModelo`, de
 * `identidade/canonico` — o mesmo reconhecedor que a resposta a comprador usa), e os
 * temas restantes são meia dúzia de assuntos com vocabulário estável em reposição:
 * medida, voltagem, quantidade, prazo, garantia, originalidade. Um LLM aqui gastaria
 * por chamada para reencontrar a mesma lista.
 */
import { codigosDeModelo } from '@/dominio/identidade/canonico';

/**
 * Quantas vezes a mesma dúvida precisa aparecer.
 *
 * Cinco, que é o número da especificação. Abaixo disso é comprador distraído; a partir
 * daí é o anúncio que não respondeu.
 */
export const REPETICOES_QUE_ACUSAM = 5;

export const TEMAS = [
  'compatibilidade',
  'medida',
  'voltagem',
  'quantidade',
  'prazo',
  'garantia',
  'originalidade',
  'outro',
] as const;
export type Tema = (typeof TEMAS)[number];

/**
 * Palavras que denunciam o tema.
 *
 * Tabela e não `switch`, pelo mesmo motivo das famílias de hipótese: acrescentar tema é
 * uma linha. A ordem importa — o primeiro tema que casa vence —, e `compatibilidade`
 * fica fora porque é detectada por código de modelo, que é sinal mais forte que palavra.
 *
 * **Casamento por palavra inteira, não por substring**, e isso custou um teste:
 * `par` (de "vem em par?") casava dentro de "**par**alelo", e "é original ou paralelo?"
 * era classificada como pergunta de quantidade. Substring é a forma errada de procurar
 * palavra curta em português — "par" mora dentro de parafuso, aparelho e separado.
 */
const PALAVRAS_DO_TEMA: readonly (readonly [
  Exclude<Tema, 'compatibilidade' | 'outro'>,
  readonly string[],
])[] = [
  ['voltagem', ['110', '220', 'volt', 'bivolt', 'tensao']],
  [
    'medida',
    ['medida', 'tamanho', 'diametro', 'comprimento', 'altura', 'largura', 'cm', 'mm', 'polegada'],
  ],
  [
    'quantidade',
    ['quantas', 'quantos', 'vem quantos', 'unidade', 'par', 'kit', 'embalagem', 'embalagens'],
  ],
  ['prazo', ['prazo', 'quando chega', 'demora', 'entrega', 'frete', 'chega em']],
  ['garantia', ['garantia', 'troca', 'devolucao', 'defeito']],
  ['originalidade', ['original', 'generico', 'paralelo', 'similar', 'nota fiscal']],
];

/** Uma pergunta recebida, do jeito que a plataforma a entrega. */
export interface PerguntaRecebida {
  readonly id: string;
  readonly texto: string;
  readonly em: Date;
  /** Anúncio em que ela foi feita. Agrupar entre anúncios esconderia qual é o furado. */
  readonly anuncioId: string;
}

export interface AssuntoDaPergunta {
  readonly tema: Tema;
  /** O código de modelo, quando o tema é compatibilidade. É a chave do agrupamento. */
  readonly codigo: string | null;
  /** A chave de agrupamento: tema mais código. */
  readonly chave: string;
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * O termo aparece no texto como **palavra**, e não como pedaço de outra?
 *
 * Termo de uma palavra é comparado por fronteira; termo com espaço ("vem quantos") é
 * comparado como trecho, porque a fronteira do primeiro e do último já basta.
 *
 * O `s?` no fim é o plural do português, e ele custou um caso real: a lista tinha
 * `unidade` e a pergunta era "vem 1 ou **2 unidades**?", que não casava com fronteira
 * estrita e caía em "outro". Plural irregular continua entrando na lista à mão —
 * `embalagem` e `embalagens` não se resolvem com um `s`.
 */
function contemTermo(texto: string, termo: string): boolean {
  if (termo.includes(' ')) return texto.includes(termo);
  // Fronteira escrita à mão em vez de `\b`: `\b` trata dígito como palavra, e aqui há
  // termos numéricos ("110", "220") que precisam da mesma regra das alfabéticas.
  return new RegExp(`(^|[^a-z0-9])${termo}s?([^a-z0-9]|$)`).test(texto);
}

/**
 * De que a pergunta trata.
 *
 * Código de modelo vence palavra-chave: "serve no PA26G 220v?" é pergunta de
 * compatibilidade com um detalhe de voltagem, não o contrário — e é a lista de
 * compatibilidade que resolve as duas.
 */
export function assuntoDaPergunta(texto: string): AssuntoDaPergunta {
  const codigos = codigosDeModelo(texto);
  const primeiro = codigos[0];
  if (primeiro !== undefined) {
    return { tema: 'compatibilidade', codigo: primeiro, chave: `compatibilidade:${primeiro}` };
  }

  const normalizado = normalizar(texto);
  for (const [tema, palavras] of PALAVRAS_DO_TEMA) {
    if (palavras.some((p) => contemTermo(normalizado, normalizar(p)))) {
      return { tema, codigo: null, chave: tema };
    }
  }

  return { tema: 'outro', codigo: null, chave: 'outro' };
}

export interface DuvidaRecorrente {
  readonly chave: string;
  readonly tema: Tema;
  readonly codigo: string | null;
  readonly vezes: number;
  readonly anuncios: readonly string[];
  readonly exemplos: readonly string[];
  /** O que acrescentar ao anúncio. É a entrega, não a contagem. */
  readonly oQueAcrescentar: string;
}

/**
 * As dúvidas que se repetiram o bastante para acusar o anúncio.
 *
 * Ordenadas por quantidade: a dúvida mais repetida é o pior buraco da descrição.
 */
export function duvidasRecorrentes(
  perguntas: readonly PerguntaRecebida[],
  minimo = REPETICOES_QUE_ACUSAM,
): readonly DuvidaRecorrente[] {
  const porChave = new Map<string, { assunto: AssuntoDaPergunta; perguntas: PerguntaRecebida[] }>();

  for (const pergunta of perguntas) {
    const assunto = assuntoDaPergunta(pergunta.texto);
    const atual = porChave.get(assunto.chave);
    if (atual === undefined) porChave.set(assunto.chave, { assunto, perguntas: [pergunta] });
    else atual.perguntas.push(pergunta);
  }

  return [...porChave.values()]
    .filter((g) => g.perguntas.length >= minimo)
    .map((g): DuvidaRecorrente => ({
      chave: g.assunto.chave,
      tema: g.assunto.tema,
      codigo: g.assunto.codigo,
      vezes: g.perguntas.length,
      anuncios: [...new Set(g.perguntas.map((p) => p.anuncioId))],
      // Três exemplos: o suficiente para reconhecer a dúvida, pouco para ler.
      exemplos: g.perguntas.slice(0, 3).map((p) => p.texto),
      oQueAcrescentar: oQueAcrescentar(g.assunto),
    }))
    .sort((a, b) => b.vezes - a.vezes || a.chave.localeCompare(b.chave));
}

/**
 * O que escrever no anúncio para a dúvida parar de chegar.
 *
 * Cada tema tem a sua frase, e todas dizem **onde** escrever — "acrescente à
 * descrição" é acionável; "o anúncio está incompleto" não é.
 */
export function oQueAcrescentar(assunto: AssuntoDaPergunta): string {
  switch (assunto.tema) {
    case 'compatibilidade':
      return `Cinco pessoas ou mais perguntaram por ${assunto.codigo ?? 'um modelo'}. Se ele serve, ponha o código no título e na tabela de compatibilidade da descrição; se não serve, diga isso na descrição — "não serve em X" evita devolução e evita a pergunta.`;
    case 'medida':
      return 'A medida não está na descrição, e é o que decide se a peça encaixa. Acrescente as medidas em milímetros, com o que cada uma significa.';
    case 'voltagem':
      return 'A voltagem não está clara. Diga na descrição se é 110 V, 220 V ou bivolt — e se for um só, diga no título também: voltagem errada é devolução.';
    case 'quantidade':
      return 'Quantas peças vêm na embalagem não está explícito. Ponha no título ("kit com 2") e na descrição.';
    case 'prazo':
      return 'O prazo de entrega está sendo perguntado, e isso costuma ser prazo de manuseio alto ou frete não configurado — confira a configuração antes de mexer na descrição.';
    case 'garantia':
      return 'A garantia e a política de troca não estão na descrição. Escreva o prazo e o que cobre, em uma linha.';
    case 'originalidade':
      return 'As pessoas querem saber se é original ou paralelo. Diga na descrição qual é, com a marca e o código do fabricante — omitir isso gera devolução por expectativa errada.';
    case 'outro':
      return 'A mesma dúvida se repetiu e não caiu em nenhum tema conhecido. Vale ler os exemplos e acrescentar a resposta à descrição.';
  }
}
