/**
 * Monitor: detecção, severidade e agrupamento (M15 — 11.1, 11.2).
 *
 * A especificação abre com a diferença que o módulo existe para produzir:
 *
 * - **Automação:** "o preço do concorrente caiu 8%."
 * - **Inteligência:** "caiu 8% e aumentou o estoque anunciado ao mesmo tempo, três
 *   semanas depois de um fornecedor novo aparecer 20% mais barato. Provável troca de
 *   fornecedor, não queima de estoque — o piso do nicho baixou de forma permanente."
 *
 * ## O que é máquina aqui, e o que é julgamento
 *
 * A **leitura** — a hipótese e a recomendação — é LLM, e entra por fora: é julgamento
 * sobre evidência incompleta, que é o critério das convenções (3.5).
 *
 * O que mora aqui é o resto, e é mais do que parece: detectar que houve mudança
 * relevante, medir a severidade, e **agrupar eventos relacionados antes de avisar**.
 * O agrupamento é o que transforma dez alertas soltos em um evento explicado — e é
 * puramente determinístico, porque "mesmo concorrente, mesma semana" é regra, não
 * opinião.
 *
 * ## A mudança pequena não é evento
 *
 * Preço de marketplace oscila por centavo e por arredondamento de frete. Avisar de
 * 0,5% é treinar a pessoa a ignorar o painel — então há um piso, e ele é declarado.
 */
import {
  absoluto,
  centavos,
  proporcaoEmPontosBase,
  type Centavos,
  type PontosBase,
} from '@/lib/dinheiro';
import type { Severidade } from '@/dominio/precificacao/tipos';
import { diaNoFuso, FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/**
 * Mudança de preço mínima para virar evento, em pontos-base.
 *
 * 3%. Abaixo disso é oscilação de arredondamento e de frete embutido, e avisar dela é
 * o caminho mais curto para a pessoa parar de olhar o painel.
 */
export const MUDANCA_QUE_IMPORTA_BP = 300;

/** Mudança de preço que já é alerta vermelho, em pontos-base. 15%. */
export const MUDANCA_GRAVE_BP = 1_500;

/**
 * Janela de agrupamento, em dias.
 *
 * Sete. Eventos do mesmo concorrente na mesma semana são provavelmente a mesma
 * história — o exemplo da especificação é exatamente isso: queda de preço **e**
 * aumento de estoque ao mesmo tempo.
 */
export const JANELA_DE_AGRUPAMENTO_DIAS = 7;

export const TIPOS_DE_MUDANCA = [
  'preco_concorrente_caiu',
  'preco_concorrente_subiu',
  'estoque_concorrente_subiu',
  'custo_fornecedor_subiu',
  'concorrente_novo',
  'produto_parou_de_vender',
  'taxa_da_plataforma_mudou',
] as const;
export type TipoDeMudanca = (typeof TIPOS_DE_MUDANCA)[number];

/**
 * O que cada tipo significa para a operação.
 *
 * Existe porque severidade sozinha não diz o que fazer, e a leitura por LLM pode não
 * existir. Sem chave, a pessoa ainda lê uma frase que explica o evento.
 */
export const O_QUE_SIGNIFICA: Readonly<Record<TipoDeMudanca, string>> = {
  preco_concorrente_caiu:
    'Alguém baixou o preço. Se for queima de estoque, volta; se for fornecedor novo mais barato, o piso do nicho baixou e não volta.',
  preco_concorrente_subiu:
    'Alguém subiu o preço. Pode ser espaço para você subir também, ou pode ser que ele perdeu o fornecedor.',
  estoque_concorrente_subiu:
    'Alguém se abasteceu. Junto com queda de preço, é sinal de fornecedor novo, não de liquidação.',
  custo_fornecedor_subiu:
    'Seu custo subiu. Se o preço de venda ficar onde está, a margem foi embora sem ninguém avisar.',
  concorrente_novo:
    'Entrou vendedor novo no seu nicho. Se ele chegou com preço abaixo do seu custo, ele tem outro fornecedor.',
  produto_parou_de_vender:
    'Um produto seu parou. Pode ser posição de busca, pode ser preço, pode ser concorrente novo — e a diferença muda o conserto.',
  taxa_da_plataforma_mudou:
    'A plataforma mudou a taxa. Toda margem calculada com a taxa antiga está errada a partir de agora.',
};

/** Uma mudança detectada, antes de agrupar e antes de qualquer leitura por LLM. */
export interface Evento {
  readonly id: string;
  readonly tipo: TipoDeMudanca;
  /** Sobre quem: um concorrente, um fornecedor, um SKU. É a chave do agrupamento. */
  readonly sobre: string;
  readonly entidadeTipo: string;
  readonly entidadeId: string | null;
  readonly valorAntes: string | null;
  readonly valorDepois: string | null;
  readonly severidade: Severidade;
  readonly detectadoEm: Date;
  /** Diferença em pontos-base, quando a mudança é numérica. */
  readonly variacaoBp: PontosBase | null;
}

export interface MudancaDePreco {
  readonly antes: Centavos;
  readonly depois: Centavos;
}

/**
 * Severidade de uma mudança de preço.
 *
 * Queda de concorrente é mais grave que alta: alta é oportunidade e pode esperar; queda
 * come a sua venda hoje. A assimetria é deliberada.
 */
export function severidadeDaMudanca(variacaoBp: PontosBase, caiu: boolean): Severidade {
  const modulo = Math.abs(variacaoBp);
  if (modulo >= MUDANCA_GRAVE_BP) return caiu ? 'vermelho' : 'amarelo';
  if (modulo >= MUDANCA_QUE_IMPORTA_BP) return caiu ? 'amarelo' : 'informativo';
  return 'informativo';
}

export interface ParametrosDoEvento {
  readonly id: string;
  readonly sobre: string;
  readonly entidadeTipo: string;
  readonly entidadeId?: string | null;
  readonly detectadoEm: Date;
}

/**
 * Detecta evento de preço, ou `null` quando a mudança não importa.
 *
 * Devolver `null` é metade da entrega: um monitor que avisa de tudo é um monitor
 * desligado na segunda semana.
 */
export function eventoDePreco(
  mudanca: MudancaDePreco,
  params: ParametrosDoEvento,
  pisoBp = MUDANCA_QUE_IMPORTA_BP,
): Evento | null {
  if (mudanca.antes <= 0) return null;

  const diferenca = centavos(mudanca.depois - mudanca.antes);
  const variacaoBp = proporcaoEmPontosBase(absoluto(diferenca), mudanca.antes, 'baixo');
  if (variacaoBp < pisoBp) return null;

  const caiu = diferenca < 0;

  return {
    id: params.id,
    tipo: caiu ? 'preco_concorrente_caiu' : 'preco_concorrente_subiu',
    sobre: params.sobre,
    entidadeTipo: params.entidadeTipo,
    entidadeId: params.entidadeId ?? null,
    valorAntes: String(mudanca.antes),
    valorDepois: String(mudanca.depois),
    severidade: severidadeDaMudanca(variacaoBp, caiu),
    detectadoEm: params.detectadoEm,
    variacaoBp,
  };
}

export interface GrupoDeEventos {
  readonly chave: string;
  readonly sobre: string;
  readonly eventos: readonly Evento[];
  /** A pior severidade do grupo. Um grupo vale pelo pior evento dele. */
  readonly severidade: Severidade;
  /**
   * Por que estes eventos estão juntos, e o que a combinação sugere.
   *
   * É a parte determinística da "leitura": combinações conhecidas ganham frase
   * própria, e o resto ganha a explicação de cada tipo. A hipótese por LLM, quando
   * houver, entra **em cima** disto — não em vez disto.
   */
  readonly leitura: string;
}

const PESO_DA_SEVERIDADE: Readonly<Record<Severidade, number>> = {
  vermelho: 0,
  amarelo: 1,
  informativo: 2,
};

/**
 * Agrupa eventos relacionados.
 *
 * A chave é **sobre quem** mais a semana: dez alertas do mesmo concorrente na mesma
 * semana são uma história, não dez. É o que a especificação chama de "agrupar eventos
 * relacionados **antes** de te avisar".
 *
 * A semana é civil e no fuso do vendedor, pela mesma razão de sempre: um evento às 22h
 * de domingo em São Paulo é segunda em UTC, e cairia no grupo da semana seguinte.
 */
export function agruparEventos(
  eventos: readonly Evento[],
  opcoes: { readonly fuso?: string; readonly janelaDias?: number } = {},
): readonly GrupoDeEventos[] {
  const fuso = opcoes.fuso ?? FUSO_PADRAO;
  const janela = opcoes.janelaDias ?? JANELA_DE_AGRUPAMENTO_DIAS;

  const grupos = new Map<string, Evento[]>();

  for (const evento of eventos) {
    // O balde é o número da janela desde a época, então eventos a menos de `janela`
    // dias caem junto sem precisar de ordenação prévia.
    const dia = Date.parse(`${diaNoFuso(evento.detectadoEm, fuso)}T00:00:00Z`) / 86_400_000;
    const balde = Math.floor(dia / janela);
    const chave = `${evento.sobre.trim().toLowerCase()}|${String(balde)}`;

    const atual = grupos.get(chave);
    if (atual === undefined) grupos.set(chave, [evento]);
    else atual.push(evento);
  }

  return [...grupos.entries()]
    .map(([chave, doGrupo]): GrupoDeEventos => {
      const ordenados = [...doGrupo].sort(
        (a, b) =>
          PESO_DA_SEVERIDADE[a.severidade] - PESO_DA_SEVERIDADE[b.severidade] ||
          a.id.localeCompare(b.id),
      );
      const pior = ordenados[0]?.severidade ?? 'informativo';

      return {
        chave,
        sobre: doGrupo[0]?.sobre ?? '',
        eventos: ordenados,
        severidade: pior,
        leitura: lerGrupo(ordenados),
      };
    })
    .sort(
      (a, b) =>
        PESO_DA_SEVERIDADE[a.severidade] - PESO_DA_SEVERIDADE[b.severidade] ||
        a.chave.localeCompare(b.chave),
    );
}

/**
 * A leitura determinística de um grupo.
 *
 * Uma combinação conhecida ganha frase própria — e a primeira delas é justamente o
 * exemplo da especificação: preço caindo **e** estoque subindo ao mesmo tempo não é
 * queima de estoque, é fornecedor novo. Queima de estoque não vem com reposição.
 */
export function lerGrupo(eventos: readonly Evento[]): string {
  // Grupo vazio não existe pelo caminho de `agruparEventos`, mas a função é pública e
  // a queda natural produziria "0 mudanças na mesma semana" — frase sem sentido que o
  // teste pegou antes de chegar à tela.
  if (eventos.length === 0) return '';

  const tipos = new Set(eventos.map((e) => e.tipo));

  if (tipos.has('preco_concorrente_caiu') && tipos.has('estoque_concorrente_subiu')) {
    return 'Preço caiu e estoque subiu na mesma semana. Queima de estoque não vem com reposição — isto parece fornecedor novo, e nesse caso o piso de preço do nicho baixou de forma permanente.';
  }

  if (tipos.has('preco_concorrente_caiu') && tipos.has('concorrente_novo')) {
    return 'Vendedor novo entrou e o preço do nicho caiu na mesma semana. Se ele chegou abaixo do seu custo, ele tem outro fornecedor — e a briga não é de preço, é de compra.';
  }

  if (tipos.has('custo_fornecedor_subiu') && tipos.has('preco_concorrente_caiu')) {
    return 'Seu custo subiu enquanto o preço do concorrente caiu. É a pior combinação possível: a margem aperta dos dois lados ao mesmo tempo.';
  }

  if (eventos.length === 1) {
    const unico = eventos[0];
    return unico === undefined ? '' : O_QUE_SIGNIFICA[unico.tipo];
  }

  return `${String(eventos.length)} mudanças na mesma semana, sobre o mesmo alvo. ${[...tipos]
    .map((t) => O_QUE_SIGNIFICA[t])
    .join(' ')}`;
}
