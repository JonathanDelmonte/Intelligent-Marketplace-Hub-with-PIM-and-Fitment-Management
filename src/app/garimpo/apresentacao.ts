/**
 * O que a tela de garimpo diz. Funções puras, com teste.
 *
 * A pergunta que a tela responde é "em que o agente gastou, e o que ele achou" — e a
 * parte difícil do texto é não mentir sobre o estado. Um dossiê com plano escrito e
 * zero passo gasto não está "em andamento": está esperando ferramenta. As duas leituras
 * levam a ações diferentes, e por isso a situação é função com teste, e não um ternário
 * no JSX.
 */
import type { EstadoDaFerramenta } from '@/dominio/prospector/ferramentas';
import type { MotivoDeParada } from '@/dominio/prospector/fronteira';
import type { FamiliaDeHipotese, Ferramenta } from '@/dominio/prospector/hipoteses';
import { formatarBRL, lerReaisDigitados, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';

export const ROTULO_DA_FAMILIA: Readonly<Record<FamiliaDeHipotese, string>> = {
  onde_e_mais_barato: 'onde é mais barato',
  quem_distribui: 'quem distribui',
  quem_fabrica: 'quem fabrica',
  que_outras_pecas: 'que outras peças',
  em_que_mais_serve: 'em que mais serve',
  demanda_publica: 'demanda pública',
  quem_ja_vende: 'quem já vende',
};

export const ROTULO_DA_FERRAMENTA: Readonly<Record<Ferramenta, string>> = {
  busca_web: 'busca na web',
  ler_pagina: 'leitura de página',
  visao: 'visão (print e foto)',
  cnpj: 'consulta de CNPJ',
  pncp: 'compra pública',
  base_local: 'base local',
};

export interface TextoDoEstado {
  readonly rotulo: string;
  readonly detalhe: string | null;
  readonly tom: 'ok' | 'atencao' | 'neutro';
}

/**
 * O estado de uma ferramenta, em texto.
 *
 * O detalhe é o que transforma o rótulo em ação: "não existe ainda" sozinho manda a
 * pessoa procurar, e "nenhum buscador implementado, e rede de saída para ele" diz o que
 * falta escrever. Quem produz esse texto é o domínio.
 */
export function textoDoEstadoDaFerramenta(estado: EstadoDaFerramenta): TextoDoEstado {
  return estado.tipo === 'disponivel'
    ? { tom: 'ok', rotulo: 'dá para usar', detalhe: null }
    : { tom: 'neutro', rotulo: 'não existe ainda', detalhe: estado.oQueFalta };
}

export const ROTULO_DO_MOTIVO: Readonly<Record<MotivoDeParada, string>> = {
  saturacao: 'terminou',
  orcamento_passos: 'parou no teto de passos',
  orcamento_reais: 'parou no teto de reais',
  fronteira_vazia: 'sem ferramenta para seguir',
  concluido: 'concluído',
};

export interface SituacaoDoDossie {
  readonly rotulo: string;
  readonly explicacao: string;
  readonly tom: 'ok' | 'atencao' | 'neutro';
  /** Se aumentar o teto muda algo. É o que separa "continuar" de "não insista". */
  readonly valeContinuar: boolean;
}

/**
 * Em que pé está um dossiê.
 *
 * O caso que importa é o primeiro: `motivoParada` nulo significa "em andamento" no
 * domínio, mas um dossiê recém-aberto também tem motivo nulo — e chamar isso de "em
 * andamento" afirmaria que algo está rodando. Nada está rodando: o executor não existe.
 */
export function situacaoDoDossie(dossie: {
  readonly motivoParada: MotivoDeParada | null;
  readonly passosGastos: number;
  readonly hipotesesAbertas: number;
}): SituacaoDoDossie {
  if (dossie.motivoParada === null) {
    return dossie.passosGastos === 0
      ? {
          tom: 'neutro',
          rotulo: 'esperando a fila',
          explicacao:
            'O plano está escrito e nenhum passo foi gasto. A investigação entra pela fila — quem a tira de lá é o processador, que dá para rodar na tela de importação.',
          valeContinuar: false,
        }
      : {
          tom: 'ok',
          rotulo: 'em andamento',
          explicacao: 'Passos gastos e nenhum motivo de parada: a investigação não terminou.',
          valeContinuar: false,
        };
  }

  switch (dossie.motivoParada) {
    case 'saturacao':
      return {
        tom: 'ok',
        rotulo: ROTULO_DO_MOTIVO.saturacao,
        explicacao:
          'Três investigações seguidas sem achado novo. Parar aqui é ter terminado, e aumentar o teto não traria mais nada neste alvo.',
        valeContinuar: false,
      };
    case 'orcamento_passos':
    case 'orcamento_reais':
      return {
        tom: 'atencao',
        rotulo: ROTULO_DO_MOTIVO[dossie.motivoParada],
        explicacao:
          dossie.hipotesesAbertas > 0
            ? 'Esbarrou no teto com hipótese em aberto. Continuar não recomeça: o dossiê está salvo como está.'
            : 'Esbarrou no teto, e não sobrou hipótese em aberto para perseguir.',
        valeContinuar: dossie.hipotesesAbertas > 0,
      };
    case 'fronteira_vazia':
      return {
        tom: 'atencao',
        rotulo: ROTULO_DO_MOTIVO.fronteira_vazia,
        explicacao: 'Aumentar o teto não resolve aqui; ligar uma ferramenta resolve.',
        valeContinuar: false,
      };
    case 'concluido':
      return {
        tom: 'ok',
        rotulo: ROTULO_DO_MOTIVO.concluido,
        explicacao: 'A investigação fechou o alvo.',
        valeContinuar: false,
      };
  }
}

/**
 * A explicação da situação acrescenta algo ao resumo do domínio?
 *
 * `resumirDossie` já explica saturação ("aumentar o teto não traria nada") e teto
 * ("continuar não recomeça"). O que ele não explica é o dossiê sem nenhum passo gasto e
 * o que parou por falta de ferramenta — e repetir a mesma frase em dois lugares do
 * mesmo cartão é como as duas versões dela começam a divergir.
 */
export function explicacaoAcrescenta(motivoParada: MotivoDeParada | null): boolean {
  return motivoParada === null || motivoParada === 'fronteira_vazia';
}

export interface LinhaDaFronteira {
  readonly principal: string;
  readonly secundario: string | null;
}

/**
 * Uma linha da fronteira.
 *
 * Na abertura, os sete itens têm o **mesmo** alvo do dossiê, e listar o alvo sete vezes
 * com a família à direita é sete linhas iguais: a informação é a família. Depois que a
 * investigação ramifica, o alvo do item passa a ser outro — uma URL, um CNPJ, um termo
 * — e aí é ele que interessa.
 */
export function linhaDaFronteira(
  item: { readonly alvo: string; readonly familia: FamiliaDeHipotese },
  alvoDoDossie: string,
): LinhaDaFronteira {
  const rotulo = ROTULO_DA_FAMILIA[item.familia];
  return item.alvo.trim() === alvoDoDossie.trim()
    ? { principal: rotulo, secundario: null }
    : { principal: item.alvo, secundario: rotulo };
}

/**
 * O teto em reais, do jeito que se digita de volta no campo.
 *
 * `formatarBRL` devolve "R$ 5,00", e o campo de teto é o mesmo que a pessoa preenche —
 * então o prefixo sai. `lerReaisDigitados` aceitaria o "R$", mas campo pré-preenchido
 * com prefixo convida a apagar mais do que o número.
 */
export function reaisDoTeto(teto: Centavos): string {
  return formatarBRL(teto).replace('R$', '').trim();
}

/** O gasto contra o teto, nas duas moedas do orçamento. */
export function orcamentoLegivel(dossie: {
  readonly gastoCentavos: Centavos;
  readonly orcamentoCentavos: Centavos;
  readonly passosGastos: number;
  readonly orcamentoPassos: number;
}): string {
  return `${formatarBRL(dossie.gastoCentavos)} de ${formatarBRL(dossie.orcamentoCentavos)} · ${String(dossie.passosGastos)} de ${String(dossie.orcamentoPassos)} passos`;
}

/**
 * A frase do alto da tela.
 *
 * Diz o que dá para investigar **hoje** junto com o que já foi achado, porque sem isso
 * a leitura de "nenhum achado" fica errada: não achar nada com seis ferramentas
 * ausentes não é sinal sobre o alvo.
 */
export function resumoDoGarimpo(params: {
  readonly dossies: number;
  readonly achados: number;
  readonly valeContinuar: number;
  readonly familiasPossiveis: number;
  readonly familiasTotais: number;
}): string {
  const { dossies, achados, valeContinuar, familiasPossiveis, familiasTotais } = params;

  const alcance =
    familiasPossiveis === 0
      ? `Nenhuma das ${String(familiasTotais)} perguntas dá para investigar com as ferramentas de hoje.`
      : `${contagem(familiasPossiveis, 'pergunta', 'perguntas')} de ${String(familiasTotais)} ${familiasPossiveis === 1 ? 'dá' : 'dão'} para investigar com as ferramentas de hoje.`;

  if (dossies === 0) {
    return `Nenhum alvo aberto. Abrir um alvo escreve o plano e declara o teto antes de gastar o primeiro centavo. ${alcance}`;
  }

  const partes = [`${contagem(dossies, 'alvo aberto', 'alvos abertos')}`];
  partes.push(achados === 0 ? 'nenhum achado ainda' : contagem(achados, 'achado', 'achados'));

  const frase = `${partes.join(', ')}.`;
  const continuar =
    valeContinuar === 0
      ? ''
      : ` ${contagem(valeContinuar, 'dossiê', 'dossiês')} ${valeContinuar === 1 ? 'parou' : 'pararam'} no teto com hipótese em aberto.`;

  return `${frase}${continuar} ${alcance}`;
}

/** Teto em reais digitado, ou `null`. A mesma leitura das outras telas. */
export function lerTeto(bruto: string): Centavos | null {
  const valor = lerReaisDigitados(bruto);
  // Teto zero é "sem teto" na prática, e `OrcamentoDaBusca` recusa — a recusa aqui é
  // para a tela dizer o motivo em vez de estourar uma exceção de construtor.
  return valor === null || valor <= 0 ? null : valor;
}

export const CODIGOS_DE_AVISO = [
  'aberto',
  'na_fila',
  'nao_enfileirou',
  'alvo_invalido',
  'teto_invalido',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

export function descreverAviso(codigo: string | undefined): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'aberto':
      return {
        tom: 'ok',
        titulo: 'Alvo aberto, e investigação na fila.',
        corpo:
          'As sete hipóteses estão na fronteira, em ordem de valor por custo, e o teto está declarado. O que rodar depende de ferramenta disponível — o resto fica esperando.',
      };
    case 'na_fila':
      return {
        tom: 'ok',
        titulo: 'Investigação na fila.',
        corpo:
          'O plano que já existia não foi reescrito: investigar continua de onde parou, com o teto que você acabou de pedir. Reabrir apagaria os achados, e achado perdido é investigação paga duas vezes.',
      };
    case 'nao_enfileirou':
      return {
        tom: 'erro',
        titulo: 'Não entrou na fila.',
        corpo:
          'O plano está salvo, mas o job não foi criado. O erro está no log, e clicar de novo tenta outra vez.',
      };
    case 'alvo_invalido':
      return {
        tom: 'erro',
        titulo: 'Esse alvo não serve.',
        corpo:
          'Precisa de três caracteres ou mais. Alvo bom é específico: "refil de purificador PA21G" rende; "peças" não.',
      };
    case 'teto_invalido':
      return {
        tom: 'erro',
        titulo: 'Teto fora de forma.',
        corpo:
          'O teto em reais é obrigatório e maior que zero, como 5,00. Agente sem teto de gasto é curiosidade que vira fatura.',
      };
    case 'falha':
      return { tom: 'erro', titulo: 'Não deu.', corpo: 'Nada foi gravado. O erro está no log.' };
  }
}
