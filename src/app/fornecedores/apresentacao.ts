/**
 * Tradução da triagem de fornecedor para a tela.
 *
 * Função pura e separada do componente pelo motivo de sempre: texto que decide o
 * que a pessoa entende merece teste, e componente React não é lugar de testar
 * redação.
 */
import {
  ETIQUETA_DO_VEREDITO,
  TEXTO_DA_PERGUNTA,
  type Pergunta,
} from '@/dominio/fornecedores/triagem';
import type { VereditoDeTriagem } from '@/dominio/fornecedores/triagem';
import {
  MINIMO_DE_PEDIDOS_MEDIDOS,
  type Confiabilidade,
} from '@/dominio/fornecedores/confiabilidade';
import {
  vitrineConcluida,
  type Conferencia,
  type Encontro,
} from '@/dominio/fornecedores/conferencia';
import { formatarDocumento, lerDocumento } from '@/dominio/documento';
import type { Fonte } from '@/dominio/procedencia';
import { formatarBRL, type Centavos } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';

/** Tom visual de cada veredito. `alerta` é o descarte, que precisa saltar. */
export type TomDoVeredito = 'ok' | 'atencao' | 'alerta';

export function tomDoVeredito(veredito: VereditoDeTriagem): TomDoVeredito {
  switch (veredito) {
    case 'aprovado':
      return 'ok';
    case 'descartar':
      return 'alerta';
    case 'perguntar':
    case 'ressalva':
      return 'atencao';
  }
}

export function etiquetaDoVeredito(veredito: VereditoDeTriagem): string {
  return ETIQUETA_DO_VEREDITO[veredito];
}

/** Uma resposta em palavras, distinguindo "não perguntei" de "não". */
export function respostaEmTexto(valor: boolean | null): string {
  if (valor === null) return 'não perguntei';
  return valor ? 'sim' : 'não';
}

/**
 * "Vende na mesma vitrine", dizendo quem respondeu quando foi a conferência: o "sim" dela
 * é para conferir no link, e a pessoa pode trocar a resposta.
 */
export function vitrineEmTexto(valor: boolean | null, fonte: Fonte | null): string {
  if (valor === true && fonte !== null && fonte !== 'manual') {
    return 'sim, pela conferência (link abaixo)';
  }
  return respostaEmTexto(valor);
}

/**
 * A confiabilidade em uma linha. Sem nota com poucos pedidos: a tela diz quantos faltam,
 * em vez de mostrar um número que é mais sorte que medida.
 */
export function confiabilidadeEmTexto(medida: Confiabilidade | undefined): string {
  if (medida === undefined || medida.tipo === 'sem_pedidos') return 'sem pedido medido';
  if (medida.tipo === 'poucos') {
    return `${contagem(medida.medidos, 'pedido medido', 'pedidos medidos')} — a nota sai com ${String(MINIMO_DE_PEDIDOS_MEDIDOS)}`;
  }
  return `${String(medida.nota)} de 5 — ${String(medida.noPrazo)} de ${String(medida.medidos)} postados no prazo`;
}

/** O que a confiabilidade mede, para quem quer saber de onde vem o número. */
export const COMO_SE_MEDE_A_CONFIABILIDADE =
  'Pedidos dos últimos 180 dias, com a postagem confirmada, de produto que só este fornecedor atende. No prazo é até o prazo da plataforma ou, sem ele, até o prazo que o fornecedor prometeu.';

/** O documento como se lê: com pontuação, e dizendo quando não confere. */
export function documentoEmTexto(documento: string | null): string {
  if (documento === null || documento.trim() === '') return 'sem CNPJ';
  const lido = lerDocumento(documento);
  if (lido.tipo !== 'ok') return `CNPJ ${documento} (não confere)`;
  const rotulo = lido.documento.tipo === 'cpf' ? 'CPF' : 'CNPJ';
  return `${rotulo} ${formatarDocumento(lido.documento)}`;
}

/** Uma data de conferência como se lê: `24/09/2026`. */
function diaEmTexto(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function vitrinesEmTexto(plataformas: readonly Encontro['plataforma'][]): string {
  const nomes = plataformas.map((p) => ROTULO_DA_PLATAFORMA[p]);
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1) ?? ''}`;
}

export interface LinkDaConferencia {
  readonly rotulo: string;
  readonly url: string;
}

/** A conferência em blocos de texto, com os links do que se achou. */
export interface ConferenciaNaTela {
  readonly quando: string;
  readonly tom: 'ok' | 'atencao' | 'alerta';
  /** O que a Receita disse. */
  readonly cadastro: string;
  readonly cadastroPreocupa: boolean;
  /** O que a busca concluiu, em uma frase. */
  readonly vitrine: string;
  readonly lojas: readonly LinkDaConferencia[];
  readonly indicios: readonly LinkDaConferencia[];
}

/**
 * O motivo que o serviço deu, sem o ponto final e sem o "tente de novo mais tarde": a
 * frase em volta já diz o que acontece depois.
 */
function motivoCurto(motivo: string): string {
  return motivo.replace(/\s*Tente de novo mais tarde\.?\s*$/i, '').replace(/[.\s]+$/, '');
}

function link(encontro: Encontro): LinkDaConferencia {
  return {
    rotulo: `${ROTULO_DA_PLATAFORMA[encontro.plataforma]}: ${encontro.titulo}`,
    url: encontro.url,
  };
}

export function conferenciaNaTela(conferencia: Conferencia): ConferenciaNaTela {
  const { cadastro, vitrine } = conferencia;

  let textoDoCadastro: string;
  let cadastroPreocupa = false;
  switch (cadastro.tipo) {
    case 'sem_documento':
      textoDoCadastro = 'Sem CNPJ cadastrado: a Receita não foi consultada.';
      break;
    case 'cpf':
      textoDoCadastro = 'CPF: pessoa física, sem cadastro público para consultar.';
      break;
    case 'invalido':
      textoDoCadastro = `O documento cadastrado não confere — ${cadastro.motivo}`;
      cadastroPreocupa = true;
      break;
    case 'inexistente':
      textoDoCadastro = `${cadastro.frase} Quem apresenta CNPJ que não existe não é fornecedor.`;
      cadastroPreocupa = true;
      break;
    case 'encontrado':
      textoDoCadastro = cadastro.frase;
      cadastroPreocupa = !cadastro.ativo;
      break;
    case 'falhou':
      textoDoCadastro = `A Receita não respondeu: ${motivoCurto(cadastro.motivo)}. A próxima conferência tenta de novo.`;
      break;
  }

  let textoDaVitrine: string;
  if (vitrine.lojas.length > 0) {
    textoDaVitrine =
      'Achou loja própria com esse nome: ele vende na mesma vitrine. Confira no link — se não for ele, responda "não" nas perguntas.';
  } else if (!vitrineConcluida(conferencia)) {
    const feitas =
      vitrine.conferidas.length === 0
        ? 'Nenhuma vitrine foi conferida'
        : `Conferido só em ${vitrinesEmTexto(vitrine.conferidas)}`;
    textoDaVitrine = `${feitas}: ${motivoCurto(vitrine.falha ?? 'a busca parou')}. A próxima conferência completa o resto.`;
  } else if (vitrine.indicios.length > 0) {
    textoDaVitrine =
      'Nenhuma loja com o nome inteiro, mas o nome aparece nos links abaixo. Vale olhar: pode ser a marca dele revendida por outros, ou a loja com outro nome.';
  } else {
    textoDaVitrine = `Nenhuma loja com "${vitrine.buscadoComo}" no Mercado Livre, na Shopee e na Amazon. Não achar não prova que ele não vende lá: a pergunta continua valendo.`;
  }

  return {
    quando: diaEmTexto(conferencia.em),
    tom:
      vitrine.lojas.length > 0 || cadastroPreocupa
        ? 'alerta'
        : vitrine.indicios.length > 0
          ? 'atencao'
          : 'ok',
    cadastro: textoDoCadastro,
    cadastroPreocupa,
    vitrine: textoDaVitrine,
    lojas: vitrine.lojas.map(link),
    indicios: vitrine.indicios.map(link),
  };
}

/** O pedido mínimo em uma frase, com as duas formas que ele tem. */
export function pedidoMinimoEmTexto(reais: Centavos | null, unidades: number | null): string {
  if (reais === null && unidades === null) return 'não perguntei';
  const partes: string[] = [];
  if (reais !== null && reais > 0) partes.push(formatarBRL(reais));
  if (unidades !== null && unidades > 0) partes.push(`${String(unidades)} un`);
  return partes.length === 0 ? 'não tem' : partes.join(' ou ');
}

/** O prazo em uma frase. Zero é resposta: posta no mesmo dia. */
export function prazoEmTexto(dias: number | null): string {
  if (dias === null) return 'não perguntei';
  if (dias === 0) return 'no mesmo dia';
  return dias === 1 ? '1 dia útil' : `${String(dias)} dias úteis`;
}

/** As perguntas que faltam, em texto, para a tela listar o que ainda perguntar. */
export function perguntasEmTexto(pendentes: readonly Pergunta[]): readonly string[] {
  return pendentes.map((p) => TEXTO_DA_PERGUNTA[p]);
}

export const CODIGOS_DE_AVISO = [
  'criado',
  'respondido',
  'descartado',
  'sem_nome',
  'documento_invalido',
  'conferido',
  'conferido_loja',
  'conferido_incompleto',
  'nao_encontrado',
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
    case 'criado':
      return {
        tom: 'ok',
        titulo: 'Fornecedor cadastrado',
        corpo:
          'As cinco perguntas começam em branco. Use a mensagem de primeiro contato — ela já vem com o que falta perguntar.',
      };
    case 'respondido':
      return {
        tom: 'ok',
        titulo: 'Resposta gravada',
        corpo: 'O veredito é recalculado na hora, com o que você sabe agora.',
      };
    case 'descartado':
      return {
        tom: 'atencao',
        titulo: 'Descartado: vende na mesma vitrine',
        corpo:
          'Ele tem preço de fábrica e você tem o preço dele. Fica cadastrado, para não voltar à lista de candidatos por engano.',
      };
    case 'sem_nome':
      return {
        tom: 'atencao',
        titulo: 'Faltou o nome',
        corpo: 'Sem nome não há como procurar depois, nem conferir se já está cadastrado.',
      };
    case 'documento_invalido':
      return {
        tom: 'atencao',
        titulo: 'O CNPJ não confere',
        corpo:
          'O dígito verificador não bate — um número trocado na digitação vira o CNPJ de ninguém. Nada foi gravado: confira e cadastre de novo, ou deixe o CNPJ em branco.',
      };
    case 'conferido':
      return {
        tom: 'ok',
        titulo: 'Conferido',
        corpo: 'O resultado está no cartão do fornecedor, com os links do que a busca achou.',
      };
    case 'conferido_loja':
      return {
        tom: 'atencao',
        titulo: 'Achou loja própria na vitrine',
        corpo:
          'O fornecedor foi descartado: vende na mesma vitrine. O link está no cartão — se não for ele, responda "não" nas perguntas.',
      };
    case 'conferido_incompleto':
      return {
        tom: 'atencao',
        titulo: 'A conferência não chegou ao fim',
        corpo:
          'O buscador ou a Receita não responderam desta vez. O que deu para conferir está no cartão, e a conferência automática tenta de novo mais tarde.',
      };
    case 'nao_encontrado':
      return {
        tom: 'atencao',
        titulo: 'Esse fornecedor não existe mais',
        corpo: 'A lista abaixo já está atualizada.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu para gravar',
        corpo: 'Nada foi alterado. Tente de novo; se repetir, o log do servidor tem o motivo.',
      };
  }
}

/** Diagnóstico do estado da base, para a tela vazia não ficar muda. */
export function estadoDaBase(
  porVeredito: Readonly<Record<VereditoDeTriagem, number>>,
): Aviso | null {
  const total =
    porVeredito.aprovado + porVeredito.descartar + porVeredito.perguntar + porVeredito.ressalva;
  if (total === 0) {
    return {
      tom: 'atencao',
      titulo: 'Nenhum fornecedor cadastrado',
      corpo:
        'Cadastre o primeiro abaixo. O sistema não decide por você: ele faz as cinco perguntas que eliminam a maioria dos candidatos antes de você perder tempo.',
    };
  }
  if (porVeredito.aprovado === 0 && porVeredito.perguntar > 0) {
    return {
      tom: 'atencao',
      titulo: `${contagem(porVeredito.perguntar, 'fornecedor', 'fornecedores')} com pergunta sem resposta`,
      corpo:
        'Nenhum está aprovado ainda, e isso é falta de resposta, não reprovação. Copie a mensagem de contato e mande.',
    };
  }
  return null;
}
