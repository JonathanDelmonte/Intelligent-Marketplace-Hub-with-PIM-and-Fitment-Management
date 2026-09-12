/**
 * Apresentação da tela de identidade — funções puras, com teste.
 *
 * Tudo que decide **texto** vive aqui e não no componente, pelo motivo de sempre:
 * regra dentro de JSX não tem teste, e a primeira coisa que quebra numa tela de
 * revisão é a frase que explica ao revisor o que ele está decidindo.
 */
import { formatarBRL, type Centavos } from '@/lib/dinheiro';
import { ETIQUETA_DA_FONTE, type Fonte } from '@/dominio/procedencia';
import { CORTE_AGRUPAMENTO_BP, CORTE_REVISAO_BP } from '@/dominio/identidade/resolucao';

export const IDIOMA = 'pt-BR';

/** Códigos de aviso que a ação devolve pela URL. */
export const CODIGOS_DE_AVISO = [
  'decidido',
  'decidido_com_ligacao',
  'decidido_sem_propagar',
  'par_sumiu',
  'resolvido_sem_exemplo',
  'resolucao_feita',
  'resolucao_vazia',
  'sem_chave_de_llm',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/**
 * Traduz o código da URL em aviso.
 *
 * `n` carrega a quantidade quando o aviso precisa dela — quantas ocorrências foram
 * ligadas, quantos pares foram avaliados.
 */
export function descreverAviso(codigo: string | undefined, n: number | undefined): Aviso | null {
  // Guarda antes do `switch`, como na tela de jobs: estreita o tipo e descarta
  // código desconhecido — link antigo ou URL editada à mão não são erro, e inventar
  // aviso para eles seria pior que não dizer nada.
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'decidido':
      return {
        tom: 'ok',
        titulo: 'Decisão registrada.',
        corpo: 'Ela vale como exemplo para os julgamentos seguintes.',
      };
    case 'decidido_com_ligacao':
      return {
        tom: 'ok',
        titulo: 'Decisão registrada.',
        corpo: `${contar(n, 'ocorrência ligada ao SKU', 'ocorrências ligadas ao SKU')}. O preço de cada fonte já aparece no SKU.`,
      };
    case 'decidido_sem_propagar':
      return {
        tom: 'atencao',
        titulo: 'Decisão registrada, mas não deu para ligar ao SKU.',
        corpo:
          'A equivalência está gravada e vale como exemplo; a ligação ao SKU falhou — em geral porque o perfil padrão aponta para um slug que não existe no banco. O erro está no log, e a ligação pode ser refeita depois sem perder nada.',
      };
    case 'resolvido_sem_exemplo':
      return {
        tom: 'atencao',
        titulo: 'Decisão registrada, mas não virou exemplo.',
        corpo:
          'Um dos lados não tem forma canônica — sem marca nem modelo extraídos, não há texto para ensinar. A decisão vale; o aprendizado fica para quando a extração melhorar.',
      };
    case 'par_sumiu':
      return {
        tom: 'atencao',
        titulo: 'Esse par já não está na fila.',
        corpo: 'Alguém decidiu antes, ou uma das ocorrências foi apagada.',
      };
    case 'resolucao_feita':
      return {
        tom: 'ok',
        titulo: 'Resolução executada.',
        corpo: `${contar(n, 'ocorrência avaliada', 'ocorrências avaliadas')}.`,
      };
    case 'resolucao_vazia':
      return {
        tom: 'atencao',
        titulo: 'Não havia o que resolver.',
        corpo: 'Toda ocorrência da base já foi avaliada contra os candidatos que existem hoje.',
      };
    case 'sem_chave_de_llm':
      return {
        tom: 'atencao',
        titulo: 'Resolvido o que dava sem LLM.',
        corpo:
          'GTIN igual e marca com código de peça igual foram decididos aqui mesmo. O que depende de julgamento está na fila abaixo, esperando chave de LLM ou você.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu.',
        corpo: 'A decisão não foi gravada. O erro está no log.',
      };
    default:
      return null;
  }
}

function contar(n: number | undefined, singular: string, plural: string): string {
  const valor = n ?? 0;
  return `${String(valor)} ${valor === 1 ? singular : plural}`;
}

/** Lê inteiro não negativo da URL, ignorando lixo. */
export function inteiroDaUrl(bruto: string | string[] | undefined): number | undefined {
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  if (valor === undefined) return undefined;
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Pontos-base como percentual legível. */
export function confiancaLegivel(bp: number): string {
  return `${(bp / 100).toFixed(0)}%`;
}

export interface CabecalhoDoPar {
  /** A frase mais útil que existe sobre este par. Vai em destaque. */
  readonly titulo: string;
  /** O que sobra a dizer. `null` quando dizer de novo seria repetição. */
  readonly detalhe: string | null;
  /** A frase entre aspas? Só quando alguém — um modelo — realmente a disse. */
  readonly detalheEhCitacao: boolean;
}

/**
 * O que o cartão diz sobre o par, em ordem de utilidade.
 *
 * A primeira versão punha sempre uma frase de quem-não-decidiu no destaque e a
 * justificativa embaixo. Ver a tela com três pares mostrou o problema: "a comparação
 * determinística não decidiu" aparecia três vezes, idêntica, ocupando o lugar mais
 * visível — enquanto a informação de verdade ("mesma marca e modelo, mas a quantidade
 * de embalagem difere: 1 contra 3") ficava em segundo plano. Em telefone isso custa
 * duas linhas do espaço mais caro da tela.
 *
 * Então quando não há confiança para explicar, **a justificativa vira o título**.
 * Quando há, o título explica por que ela não bastou e a justificativa é o detalhe.
 *
 * E a aspa é reservada a julgamento de LLM: aspas implicam que alguém falou, e
 * motivo determinístico não foi dito por ninguém — foi calculado.
 */
export function cabecalhoDoPar(par: {
  readonly decisao: string;
  readonly origem: string;
  readonly confiancaBp: number;
  readonly nivel: string;
  readonly justificativa: string | null;
}): CabecalhoDoPar {
  const justificativa =
    par.justificativa === null || par.justificativa.trim() === '' ? null : par.justificativa.trim();
  const ehCitacao = par.origem === 'llm';

  if (par.confiancaBp === 0) {
    return justificativa === null
      ? {
          titulo: 'O sistema não conseguiu decidir. Precisa da sua leitura.',
          detalhe: null,
          detalheEhCitacao: false,
        }
      : { titulo: justificativa, detalhe: null, detalheEhCitacao: false };
  }

  const quem =
    par.origem === 'llm'
      ? 'o julgamento por LLM'
      : par.origem === 'humano'
        ? 'uma revisão anterior'
        : 'a comparação determinística';

  const titulo =
    par.decisao === 'mesmo'
      ? `${maiuscula(quem)} achou que são o mesmo produto, com ${confiancaLegivel(par.confiancaBp)} de confiança — abaixo dos ${confiancaLegivel(CORTE_AGRUPAMENTO_BP)} que agrupam sozinho.`
      : par.decisao === 'diferente'
        ? `${maiuscula(quem)} achou que são produtos diferentes, com ${confiancaLegivel(par.confiancaBp)} de confiança.`
        : `${maiuscula(quem)} ficou em ${confiancaLegivel(par.confiancaBp)}, dentro da zona de revisão (${confiancaLegivel(CORTE_REVISAO_BP)} a ${confiancaLegivel(CORTE_AGRUPAMENTO_BP)}).`;

  return { titulo, detalhe: justificativa, detalheEhCitacao: ehCitacao };
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Etiqueta do nível de evidência, sem jargão de banco na tela. */
export function rotuloDoNivel(nivel: string): string {
  switch (nivel) {
    case 'gtin':
      return 'código de barras';
    case 'marca_modelo':
      return 'marca e código de peça';
    case 'marca':
      return 'marca';
    case 'embedding':
      return 'semelhança de descrição';
    default:
      return 'sem evidência forte';
  }
}

/** Preço formatado, ou a ausência dita por extenso. */
export function precoLegivel(preco: number | null): string {
  return preco === null ? 'sem preço na fonte' : formatarBRL(preco as Centavos);
}

/** Etiqueta de procedência, reusando a tabela do domínio. */
export function fonteLegivel(fonte: string): string {
  return fonte in ETIQUETA_DA_FONTE ? ETIQUETA_DA_FONTE[fonte as Fonte] : fonte;
}

/**
 * O aviso que aparece quando a base ainda não tem o que resolver.
 *
 * Uma tela de revisão vazia é ambígua: pode ser "não há nada pendente, tudo em
 * ordem" ou "nada foi importado ainda". As duas exigem ações opostas de quem olha, e
 * confundi-las é o jeito de a pessoa ficar esperando por algo que não vem.
 */
export function estadoDaBase(params: {
  readonly ocorrencias: number;
  readonly pendentes: number;
  readonly avaliadas: number;
}): Aviso | null {
  if (params.ocorrencias === 0) {
    return {
      tom: 'atencao',
      titulo: 'A base está vazia.',
      corpo:
        'Não há ocorrência nenhuma para comparar. Importe uma planilha ou cole um link em /jobs primeiro.',
    };
  }
  if (params.avaliadas === 0) {
    return {
      tom: 'atencao',
      titulo: 'Nada foi avaliado ainda.',
      corpo:
        'A base tem ocorrências, e nenhum par foi comparado. O botão acima faz a primeira passada.',
    };
  }
  if (params.pendentes === 0) {
    return {
      tom: 'ok',
      titulo: 'Nada esperando por você.',
      corpo:
        'Todo par avaliado foi decidido — pelo sistema ou por alguém. A fila enche de novo quando entrar ocorrência nova.',
    };
  }
  return null;
}
