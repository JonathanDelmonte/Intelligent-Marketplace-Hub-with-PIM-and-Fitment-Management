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
import { formatarBRL, type Centavos } from '@/lib/dinheiro';

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
export function estadoDaBase(contagem: Readonly<Record<VereditoDeTriagem, number>>): Aviso | null {
  const total = contagem.aprovado + contagem.descartar + contagem.perguntar + contagem.ressalva;
  if (total === 0) {
    return {
      tom: 'atencao',
      titulo: 'Nenhum fornecedor cadastrado',
      corpo:
        'Cadastre o primeiro abaixo. O sistema não decide por você: ele faz as cinco perguntas que eliminam a maioria dos candidatos antes de você perder tempo.',
    };
  }
  if (contagem.aprovado === 0 && contagem.perguntar > 0) {
    return {
      tom: 'atencao',
      titulo: `${String(contagem.perguntar)} fornecedor(es) com pergunta sem resposta`,
      corpo:
        'Nenhum está aprovado ainda, e isso é falta de resposta, não reprovação. Copie a mensagem de contato e mande.',
    };
  }
  return null;
}
