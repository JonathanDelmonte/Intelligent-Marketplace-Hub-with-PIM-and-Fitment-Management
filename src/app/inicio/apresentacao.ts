/**
 * O que a tela inicial diz, a partir do que foi lido do banco.
 *
 * Funções puras com teste, pelo motivo de sempre — e aqui com um motivo a mais: a
 * decisão de **o que é urgente** é regra de negócio disfarçada de layout. "Atrasado
 * aparece antes de tudo" e "consignação em risco é agora, não depois" são afirmações
 * sobre o que custa dinheiro, e regra desse tipo dentro de JSX não tem teste.
 *
 * A leitura de cada número pode falhar sozinha (`null`), e falhar é estado normal
 * nesta tela: se o banco não responde, a tela inicial diz isso em vez de mostrar zero
 * — zero é uma afirmação, e "não consegui ler" é outra. Mostrar zero quando não se
 * sabe é o jeito de alguém deixar de conferir o que precisava conferir.
 */
import { DIAS_QUE_JA_SAO_AGORA } from '@/dominio/fiscal/prazos';
import { contagem } from '@/lib/texto';

/** Ordem de atenção: `agora` é dinheiro parado ou vazando hoje. */
export const TONS = ['agora', 'atencao', 'calmo'] as const;
export type Tom = (typeof TONS)[number];

const PESO_DO_TOM: Readonly<Record<Tom, number>> = { agora: 0, atencao: 1, calmo: 2 };

/** Uma linha do painel: um número, o que ele significa, e para onde ir. */
export interface Pendencia {
  /** Identidade estável, para chave de lista e para teste. */
  readonly chave: string;
  readonly href: string;
  readonly titulo: string;
  /** `null` quando a leitura falhou. A linha então diz isso, e não zero. */
  readonly quantidade: number | null;
  /** O que o número é, em uma linha. */
  readonly oQueE: string;
  readonly tom: Tom;
}

/**
 * O que a tela inicial precisa saber do banco.
 *
 * Cada campo é `null` quando **aquela** leitura falhou. São consultas independentes:
 * o banco pode responder a contagem da fila e engasgar na de compatibilidade, e nesse
 * caso a tela mostra cinco números e uma linha honesta.
 */
export interface LeiturasDaCasa {
  readonly entradasEmRevisao: number | null;
  readonly paresEsperandoDecisao: number | null;
  readonly postagem: {
    readonly atrasados: number;
    readonly hoje: number;
    readonly semPrazo: number;
  } | null;
  readonly compatibilidadeEmRevisao: number | null;
  readonly consignacaoEmRisco: number | null;
  readonly produtosSemCodigoFiscal: number | null;
  readonly prazoFiscal: { readonly rotulo: string; readonly diasRestantes: number } | null;
}

/** Texto de "não deu para ler". Uma frase só, usada em toda linha que falhou. */
export const NAO_DEU_PARA_LER = 'não deu para ler agora — a tela continua abrindo';

/**
 * A linha da postagem, que é a única com três números.
 *
 * Pedido sem prazo entra junto com atrasado, e não depois: não saber se atrasou é o
 * mesmo problema prático de ter atrasado — é a regra que a tela de postagem já usa.
 */
function postagem(leitura: LeiturasDaCasa['postagem']): Pendencia {
  const base = { chave: 'postagem', href: '/postagem', titulo: 'Postar hoje' } as const;
  if (leitura === null) {
    return { ...base, quantidade: null, oQueE: NAO_DEU_PARA_LER, tom: 'atencao' };
  }

  const urgentes = leitura.atrasados + leitura.semPrazo;
  const total = urgentes + leitura.hoje;
  if (total === 0) {
    return { ...base, quantidade: 0, oQueE: 'nada para despachar hoje', tom: 'calmo' };
  }

  const partes: string[] = [];
  if (leitura.atrasados > 0) partes.push(contagem(leitura.atrasados, 'atrasado', 'atrasados'));
  if (leitura.semPrazo > 0) partes.push(`${String(leitura.semPrazo)} sem prazo conhecido`);
  if (leitura.hoje > 0) partes.push(`${String(leitura.hoje)} para hoje`);

  return {
    ...base,
    quantidade: total,
    oQueE: partes.join(', '),
    tom: urgentes > 0 ? 'agora' : 'atencao',
  };
}

/** A linha do fiscal, que junta cadastro faltando com prazo chegando. */
function fiscal(pendentes: number | null, prazo: LeiturasDaCasa['prazoFiscal']): Pendencia {
  const base = { chave: 'fiscal', href: '/fiscal', titulo: 'Fiscal' } as const;
  if (pendentes === null) {
    return { ...base, quantidade: null, oQueE: NAO_DEU_PARA_LER, tom: 'atencao' };
  }

  const chegando = prazo !== null && prazo.diasRestantes <= DIAS_QUE_JA_SAO_AGORA;
  const comPrazo =
    prazo === null ? '' : ` · ${prazo.rotulo} em ${contagem(prazo.diasRestantes, 'dia', 'dias')}`;

  if (pendentes === 0) {
    return {
      ...base,
      quantidade: 0,
      oQueE: `cadastro completo${comPrazo}`,
      tom: chegando ? 'atencao' : 'calmo',
    };
  }

  return {
    ...base,
    quantidade: pendentes,
    oQueE: `${contagem(pendentes, 'produto sem NCM, CST ou cClassTrib', 'produtos sem NCM, CST ou cClassTrib')}${comPrazo}`,
    // Cadastro faltando com prazo dentro de trinta dias é a única combinação que não
    // pode esperar o fim de semana: nota emitida errada em janeiro não se desfaz.
    tom: chegando ? 'agora' : 'atencao',
  };
}

/** Linha simples: um número, uma frase, e urgente só quando há o que fazer. */
function simples(
  chave: string,
  href: string,
  titulo: string,
  quantidade: number | null,
  textos: { readonly um: string; readonly muitos: string; readonly nenhum: string },
  tomQuandoHa: Tom = 'atencao',
): Pendencia {
  if (quantidade === null) {
    return { chave, href, titulo, quantidade: null, oQueE: NAO_DEU_PARA_LER, tom: 'atencao' };
  }
  return {
    chave,
    href,
    titulo,
    quantidade,
    oQueE: quantidade === 0 ? textos.nenhum : contagem(quantidade, textos.um, textos.muitos),
    tom: quantidade === 0 ? 'calmo' : tomQuandoHa,
  };
}

/**
 * As pendências, na ordem em que o trabalho importa.
 *
 * Ordena por tom e, dentro do tom, pela quantidade maior primeiro. A ordem de
 * construção entra como terceiro critério, para a lista não trocar de ordem sozinha
 * entre dois carregamentos com os mesmos números.
 */
export function montarPendencias(leituras: LeiturasDaCasa): readonly Pendencia[] {
  const itens: readonly Pendencia[] = [
    postagem(leituras.postagem),
    simples(
      'consignacao',
      '/consignacao',
      'Consignação',
      leituras.consignacaoEmRisco,
      {
        um: 'unidade de parceiro sem conferência',
        muitos: 'unidades de parceiro sem conferência',
        nenhum: 'tudo conferido',
      },
      // Vender o que já saiu no balcão do parceiro é cancelamento com reputação
      // perdida, e não estoque errado no papel. Por isso `agora`, e não `atencao`.
      'agora',
    ),
    simples('juntar-iguais', '/juntar-iguais', 'Juntar iguais', leituras.paresEsperandoDecisao, {
      um: 'par esperando sua decisão',
      muitos: 'pares esperando sua decisão',
      nenhum: 'nada esperando decisão',
    }),
    simples('importar', '/importar', 'Importar', leituras.entradasEmRevisao, {
      um: 'entrada esperando revisão',
      muitos: 'entradas esperando revisão',
      nenhum: 'nada esperando revisão',
    }),
    simples(
      'compatibilidade',
      '/compatibilidade',
      'Onde serve',
      leituras.compatibilidadeEmRevisao,
      {
        um: 'afirmação para conferir',
        muitos: 'afirmações para conferir',
        nenhum: 'nada para conferir',
      },
    ),
    fiscal(leituras.produtosSemCodigoFiscal, leituras.prazoFiscal),
  ];

  return [...itens].sort(
    (a, b) =>
      PESO_DO_TOM[a.tom] - PESO_DO_TOM[b.tom] ||
      (b.quantidade ?? 0) - (a.quantidade ?? 0) ||
      itens.indexOf(a) - itens.indexOf(b),
  );
}

/**
 * A frase do alto da tela.
 *
 * Três casos, e o terceiro é o que justifica a função: quando **nenhuma** leitura
 * voltou, dizer "nada esperando você" seria mentira tranquilizadora.
 */
export function resumoDaCasa(itens: readonly Pendencia[]): string {
  if (itens.length > 0 && itens.every((i) => i.quantidade === null)) {
    return 'Não deu para ler o estado do sistema agora. As telas continuam abrindo, e o que está gravado está gravado.';
  }

  const comTrabalho = itens.filter((i) => i.quantidade !== null && i.quantidade > 0);
  if (comTrabalho.length === 0) {
    return 'Nada esperando por você. O que entrar de novo aparece aqui.';
  }

  const agora = comTrabalho.filter((i) => i.tom === 'agora');
  if (agora.length > 0) {
    return `${contagem(agora.length, 'coisa não pode esperar', 'coisas não podem esperar')} — ${agora
      .map((i) => i.titulo.toLocaleLowerCase('pt-BR'))
      .join(', ')}.`;
  }

  return `${contagem(comTrabalho.length, 'tela tem trabalho', 'telas têm trabalho')} esperando, nenhuma urgente.`;
}

// ─── Momento de trabalho: as pílulas do alto ─────────────────────────────────

/**
 * Está calma? Nada esperando, e a leitura voltou.
 *
 * `tom === 'calmo'` só é atribuído quando a contagem é zero **e** a leitura deu certo —
 * leitura que falhou vira `atencao`, e por isso não cai aqui. A diferença importa: uma
 * linha calma pode ser recolhida, uma que não deu para ler não pode.
 */
export function estaCalma(item: Pendencia): boolean {
  return item.tom === 'calmo';
}

export interface Separacao {
  /** O que tem trabalho ou não deu para ler. Vira cartão. */
  readonly ativas: readonly Pendencia[];
  /** O que está zerado. Vira uma linha só, recolhida. */
  readonly calmas: readonly Pendencia[];
}

/**
 * Separa o que pede atenção do que está zerado.
 *
 * É a decisão de layout mais importante desta tela, e ela é regra e não gosto: o painel
 * de vendedor que serviu de referência mostra oito contadores do mesmo tamanho, e no dia
 * comum sete deles são zero. Oito zeros lado a lado treinam a pessoa a não ler nenhum.
 *
 * Aqui o zerado desce para uma faixa recolhida, e o que sobra em cima é o que custa
 * dinheiro hoje. É a mesma regra do piso de 3% do monitor, aplicada ao layout: avisar de
 * tudo é não avisar de nada.
 */
export function separarCalmas(itens: readonly Pendencia[]): Separacao {
  return {
    ativas: itens.filter((i) => !estaCalma(i)),
    calmas: itens.filter(estaCalma),
  };
}
