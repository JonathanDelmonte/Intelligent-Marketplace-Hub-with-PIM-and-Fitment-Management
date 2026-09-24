/**
 * Qual emissor de nota fiscal usar — decidido pelo sistema, com os dados do aplicativo.
 *
 * O dono pediu, em 24/09, que a decisão não dependa de ele informar estado e volume de
 * vendas pelo chat: o estado, o regime, o documento e o certificado vêm da tela "Meu
 * negócio", e as vendas por plataforma vêm dos pedidos importados. A emissão em si
 * continua pendente (pendência 1.5): isto diz **o que falta e para onde ir**, e se refaz
 * sozinho quando um dado muda.
 *
 * ## Gratuito primeiro
 *
 * A regra do dono (CLAUDE.md, 3.7) decide a ordem: o emissor integrado do Mercado Livre e
 * o emissor gratuito do Sebrae vêm antes de qualquer serviço pago. O hub pago (Bling e
 * parecidos) só aparece quando o volume fora do Mercado Livre torna a emissão à mão um
 * trabalho de verdade — e mesmo aí aparece como opção, com o caminho gratuito dito junto.
 *
 * Os fatos por trás de cada frase foram levantados em 24/09/2026 e estão na pendência 1.5.
 */
import type { Documento } from '@/dominio/documento';
import type { Plataforma, RegimeFiscal } from '@/dominio/precificacao/tipos';

/**
 * Notas por mês fora do Mercado Livre acima das quais emitir à mão deixa de caber.
 *
 * Trinta é uma nota por dia, perto de uma hora e meia por mês no emissor do Sebrae.
 * Número escolhido, não medido — e num lugar só para ser ajustado.
 */
export const NOTAS_A_MAO_POR_MES = 30;

/**
 * Estados em que o emissor do Mercado Livre exige credenciamento prévio na SEFAZ ou
 * inscrição estadual antes da primeira nota (levantamento de 24/09/2026).
 */
export const UFS_COM_CREDENCIAMENTO_NO_EMISSOR_ML: readonly string[] = [
  'AL',
  'ES',
  'MS',
  'PE',
  'PR',
  'RS',
  'SC',
];

export interface EntradaDoEmissor {
  readonly regime: RegimeFiscal;
  readonly documento: Documento | null;
  readonly inscricaoEstadual: string | null;
  readonly uf: string | null;
  readonly certificadoValidoAte: Date | null;
  /** Pedidos dos últimos 30 dias, por plataforma. */
  readonly vendasNoMes: Readonly<Record<Plataforma, number>>;
  readonly agora: Date;
}

export type OpcaoDeEmissor = 'nenhuma' | 'emissor_ml' | 'sebrae' | 'hub';

export interface RecomendacaoDeEmissor {
  /** `sem_cnpj`: nota não se aplica ainda. `falta_dado`: há o que providenciar. */
  readonly situacao: 'sem_cnpj' | 'falta_dado' | 'pronto';
  readonly opcao: OpcaoDeEmissor;
  readonly titulo: string;
  /** O que providenciar, em ordem. Vazio quando não falta nada. */
  readonly falta: readonly string[];
  /** Por que esta opção, e o que vale saber sobre ela. */
  readonly porque: readonly string[];
}

function dataCurta(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function oQueFalta(entrada: EntradaDoEmissor): string[] {
  const falta: string[] = [];
  if (entrada.uf === null) {
    falta.push('Informe o estado em "Meu negócio": a nota vai para a SEFAZ dele.');
  }
  if (entrada.inscricaoEstadual === null) {
    falta.push(
      'Inscrição estadual: nota de mercadoria exige o CNPJ habilitado na SEFAZ do estado.',
    );
  }
  if (entrada.certificadoValidoAte === null) {
    falta.push(
      'Certificado digital e-CNPJ A1, que assina a nota — de R$ 130 a R$ 235 por ano, válido por um ano.',
    );
  } else if (entrada.certificadoValidoAte.getTime() < entrada.agora.getTime()) {
    falta.push(
      `O certificado digital venceu em ${dataCurta(entrada.certificadoValidoAte)}: renove antes da próxima nota.`,
    );
  }
  return falta;
}

function opcaoPeloVolume(entrada: EntradaDoEmissor): {
  readonly opcao: OpcaoDeEmissor;
  readonly titulo: string;
  readonly porque: string[];
} {
  const { ml, shopee, amazon } = entrada.vendasNoMes;
  const fora = shopee + amazon;
  const total = ml + fora;

  if (total === 0) {
    return {
      opcao: 'sebrae',
      titulo: 'Para começar: o emissor gratuito do Sebrae',
      porque: [
        'Não há vendas importadas nos últimos 30 dias, então a recomendação parte do caminho gratuito que serve a qualquer plataforma.',
        'Se as vendas vierem pelo Mercado Livre, o emissor integrado dele é mais prático: emite na própria venda, também de graça.',
      ],
    };
  }

  const ressalvaDoEstado =
    entrada.uf !== null && UFS_COM_CREDENCIAMENTO_NO_EMISSOR_ML.includes(entrada.uf)
      ? [
          `Em ${entrada.uf}, o emissor do Mercado Livre exige credenciamento na SEFAZ ou inscrição estadual antes da primeira nota.`,
        ]
      : [];

  if (fora > NOTAS_A_MAO_POR_MES) {
    return {
      opcao: 'hub',
      titulo: 'Um hub que emite sozinho nas três plataformas',
      porque: [
        `São ${String(fora)} vendas por mês fora do Mercado Livre, e emitir cada uma à mão vira trabalho de todo dia.`,
        'Um hub com emissor (como o Bling) importa o pedido e emite a nota sozinho no Mercado Livre, na Shopee e na Amazon. É a primeira opção paga — os planos começam em R$ 55 por mês.',
        'Até lá, o caminho gratuito continua valendo: o emissor do Mercado Livre para as vendas de lá, e o do Sebrae para as outras.',
        ...ressalvaDoEstado,
      ],
    };
  }

  if (ml > 0) {
    return {
      opcao: 'emissor_ml',
      titulo: 'O emissor integrado do Mercado Livre, e o do Sebrae para o resto',
      porque: [
        `${String(ml)} das ${String(total)} vendas do mês foram no Mercado Livre, e o emissor dele é gratuito e emite na própria venda.`,
        fora === 0
          ? 'Não houve venda nas outras plataformas; quando houver, o emissor gratuito do Sebrae dá conta delas à mão.'
          : `As ${String(fora)} das outras plataformas cabem no emissor gratuito do Sebrae, à mão.`,
        ...ressalvaDoEstado,
      ],
    };
  }

  return {
    opcao: 'sebrae',
    titulo: 'O emissor gratuito do Sebrae',
    porque: [
      `São ${String(fora)} vendas por mês, todas fora do Mercado Livre — cabem no emissor gratuito do Sebrae, à mão.`,
      `Acima de ${String(NOTAS_A_MAO_POR_MES)} por mês, um hub que emite sozinho passa a valer o que custa.`,
    ],
  };
}

export function recomendarEmissor(entrada: EntradaDoEmissor): RecomendacaoDeEmissor {
  if (entrada.regime === 'cpf' || entrada.documento?.tipo !== 'cnpj') {
    return {
      situacao: 'sem_cnpj',
      opcao: 'nenhuma',
      titulo: 'Sem CNPJ, a nota fiscal ainda não se aplica',
      falta: [],
      porque: [
        'Pessoa física vende com declaração de conteúdo, sem nota fiscal eletrônica.',
        'O painel de prazos acima tem a data em que a pessoa física que vende com habitualidade passa a precisar de CNPJ. Abrir um MEI é o caminho mais simples.',
        'Quando houver CNPJ, informe em "Meu negócio": esta recomendação se refaz sozinha.',
      ],
    };
  }

  const falta = oQueFalta(entrada);
  const { opcao, titulo, porque } = opcaoPeloVolume(entrada);
  return { situacao: falta.length === 0 ? 'pronto' : 'falta_dado', opcao, titulo, falta, porque };
}
