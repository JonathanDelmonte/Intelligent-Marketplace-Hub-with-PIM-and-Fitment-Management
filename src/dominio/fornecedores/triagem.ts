/**
 * Triagem de fornecedor — as cinco perguntas que eliminam 90% dos candidatos.
 *
 * Função pura com teste, no lugar de um formulário com regras espalhadas pela
 * tela, porque isto é regra de negócio: decide se vale gastar tempo com um
 * fornecedor, e a decisão precisa ser a mesma vindo da tela, do importador de
 * planilha ou do prospector.
 *
 * ## A pergunta que descarta sozinha
 *
 * `vende_direto_marketplace = true` é descarte automático. Fornecedor que vende na
 * mesma vitrine tem preço de fábrica e você tem o preço dele — não há margem a
 * disputar, só prejuízo a descobrir depois. **Foi exatamente contra isso que a
 * primeira tentativa do dono no Mercado Livre falhou**, e a especificação pede que
 * o sistema lembre disso por ele. É a única das cinco que descarta sozinha; as
 * outras quatro pesam.
 *
 * ## `null` não é `false`
 *
 * "Ainda não perguntei" e "perguntei e a resposta é não" são estados diferentes, e
 * confundi-los produz os dois erros caros: descartar um fornecedor bom por falta de
 * dado, ou aprovar um ruim por otimismo. `null` vira **pergunta pendente**, que é
 * tarefa; `false` vira ressalva ou descarte, que é decisão.
 */
import type { Centavos } from '@/lib/dinheiro';

/** As cinco respostas, cada uma podendo estar em branco. */
export interface RespostasDoFornecedor {
  /** Posta com a etiqueta do marketplace? Sem isso, o frete é problema seu. */
  readonly postaComEtiqueta: boolean | null;
  readonly emiteNf: boolean | null;
  readonly prazoPostagemDias: number | null;
  readonly pedidoMinimoReais: Centavos | null;
  readonly pedidoMinimoUn: number | null;
  readonly vendeDiretoMarketplace: boolean | null;
}

export const VEREDITOS_DE_TRIAGEM = ['descartar', 'perguntar', 'ressalva', 'aprovado'] as const;
export type VereditoDeTriagem = (typeof VEREDITOS_DE_TRIAGEM)[number];

export const PERGUNTAS = [
  'posta_com_etiqueta',
  'emite_nf',
  'prazo_postagem',
  'pedido_minimo',
  'vende_direto_marketplace',
] as const;
export type Pergunta = (typeof PERGUNTAS)[number];

/** O texto de cada pergunta, do jeito que se manda para o fornecedor. */
export const TEXTO_DA_PERGUNTA: Readonly<Record<Pergunta, string>> = {
  posta_com_etiqueta:
    'Vocês postam com a etiqueta do marketplace (Mercado Envios, Shopee Xpress), no nome do vendedor?',
  emite_nf: 'Vocês emitem nota fiscal de venda para revenda?',
  prazo_postagem: 'Em quantos dias úteis o pedido é postado depois do pagamento?',
  pedido_minimo: 'Existe pedido mínimo? Em valor ou em quantidade?',
  vende_direto_marketplace:
    'Vocês também vendem direto no Mercado Livre, Shopee ou Amazon, com loja própria?',
};

export interface CriterioDeTriagem {
  /**
   * Prazo de postagem acima do qual vira ressalva, em dias úteis.
   *
   * Três é **escolha deste projeto**, não número de plataforma: nenhuma das três
   * publica um limite único e verificável, e o que existe são penalidades de
   * reputação por atraso. Configurável de propósito, e o padrão é conservador
   * porque atraso em conta nova é o que mais custa.
   */
  readonly prazoMaximoDias: number;
  /** Pedido mínimo em centavos acima do qual vira ressalva. `null` = sem limite. */
  readonly pedidoMinimoToleradoCentavos: Centavos | null;
}

export const CRITERIO_PADRAO: CriterioDeTriagem = {
  prazoMaximoDias: 3,
  pedidoMinimoToleradoCentavos: null,
};

export interface Triagem {
  readonly veredito: VereditoDeTriagem;
  /** Por que este veredito, em frases que vão para a tela sem tradução. */
  readonly motivos: readonly string[];
  /** O que ainda não se sabe. Cada uma é uma tarefa, não um defeito. */
  readonly pendentes: readonly Pergunta[];
  /** `true` quando o descarte é o automático da especificação. */
  readonly descarteAutomatico: boolean;
}

/**
 * Tria um fornecedor pelas cinco respostas.
 *
 * A ordem das regras é a ordem do custo de errar:
 *
 * 1. **Vende direto na vitrine** descarta, e nada depois disso importa — não há o
 *    que negociar com quem já é seu concorrente com preço de fábrica.
 * 2. **Pergunta sem resposta** trava em "perguntar". Aprovar sem saber é o erro que
 *    aparece três semanas depois, no primeiro pedido.
 * 3. **Resposta ruim** vira ressalva com o motivo escrito, não descarte: "não posta
 *    com etiqueta" é caro e às vezes aceitável, e essa decisão é do dono.
 */
export function triarFornecedor(
  respostas: RespostasDoFornecedor,
  criterio: CriterioDeTriagem = CRITERIO_PADRAO,
): Triagem {
  if (respostas.vendeDiretoMarketplace === true) {
    return {
      veredito: 'descartar',
      motivos: [
        'Vende direto na mesma vitrine: tem preço de fábrica e você tem o preço dele. Não há margem a disputar.',
      ],
      pendentes: [],
      descarteAutomatico: true,
    };
  }

  const pendentes: Pergunta[] = [];
  const motivos: string[] = [];

  if (respostas.vendeDiretoMarketplace === null) pendentes.push('vende_direto_marketplace');

  if (respostas.postaComEtiqueta === null) pendentes.push('posta_com_etiqueta');
  else if (!respostas.postaComEtiqueta) {
    motivos.push(
      'Não posta com a etiqueta do marketplace: o frete e o prazo passam a ser seu problema, e o atraso conta contra a sua reputação.',
    );
  }

  if (respostas.emiteNf === null) pendentes.push('emite_nf');
  else if (!respostas.emiteNf) {
    motivos.push(
      'Não emite nota: sem comprovação de custo não há apuração correta, e revenda sem nota de entrada é risco fiscal seu, não dele.',
    );
  }

  if (respostas.prazoPostagemDias === null) pendentes.push('prazo_postagem');
  else if (respostas.prazoPostagemDias > criterio.prazoMaximoDias) {
    motivos.push(
      `Posta em ${String(respostas.prazoPostagemDias)} dias úteis, acima do limite de ${String(criterio.prazoMaximoDias)} que este perfil aceita.`,
    );
  }

  // Pedido mínimo é a única das cinco em que "não sei" e "não tem" se parecem: um
  // fornecedor sem pedido mínimo responde "não tem", e isso é resposta. Por isso a
  // pendência só existe quando **nenhum** dos dois campos foi preenchido.
  if (respostas.pedidoMinimoReais === null && respostas.pedidoMinimoUn === null) {
    pendentes.push('pedido_minimo');
  } else if (
    criterio.pedidoMinimoToleradoCentavos !== null &&
    respostas.pedidoMinimoReais !== null &&
    respostas.pedidoMinimoReais > criterio.pedidoMinimoToleradoCentavos
  ) {
    motivos.push(
      'Pedido mínimo acima do que este perfil aceita: é capital parado em estoque antes da primeira venda.',
    );
  }

  if (pendentes.length > 0) {
    return {
      veredito: 'perguntar',
      motivos: [...motivos, `Faltam ${String(pendentes.length)} resposta(s) das cinco perguntas.`],
      pendentes,
      descarteAutomatico: false,
    };
  }

  if (motivos.length > 0) {
    return { veredito: 'ressalva', motivos, pendentes: [], descarteAutomatico: false };
  }

  return {
    veredito: 'aprovado',
    motivos: ['Passa nas cinco perguntas.'],
    pendentes: [],
    descarteAutomatico: false,
  };
}

/** Etiqueta curta do veredito, para a tela não ter texto de estado espalhado. */
export const ETIQUETA_DO_VEREDITO: Readonly<Record<VereditoDeTriagem, string>> = {
  descartar: 'descartar',
  perguntar: 'falta perguntar',
  ressalva: 'serve com ressalva',
  aprovado: 'aprovado',
};
