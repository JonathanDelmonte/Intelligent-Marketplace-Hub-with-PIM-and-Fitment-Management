/**
 * Tradução do quadro de consignação para a tela.
 *
 * Função pura e testada, separada do componente pelo motivo de sempre: o texto que
 * diz "nunca conferido" ou "em dia" muda o que a pessoa faz hoje, e isso merece
 * teste.
 */
import {
  ROTULO_DO_ESTADO,
  type EstadoDeConferencia,
  type QuadroDeConferencia,
} from '@/dominio/consignacao/conferencia';
import type { Fechamento } from '@/dominio/consignacao/fechamento';
import { contagem } from '@/lib/texto';
import { formatarBRL } from '@/lib/dinheiro';

export type Tom = 'alerta' | 'atencao' | 'neutro';

export function tomDoEstado(estado: EstadoDeConferencia): Tom {
  switch (estado) {
    // Nunca conferido é alerta junto com vencida, e não um degrau abaixo: não saber
    // se o estoque existe é pior que saber que a conferência atrasou.
    case 'nunca':
    case 'vencida':
      return 'alerta';
    case 'vence_hoje':
      return 'atencao';
    case 'em_dia':
      return 'neutro';
  }
}

export function rotuloDoEstado(estado: EstadoDeConferencia): string {
  return ROTULO_DO_ESTADO[estado];
}

/** Quanto tempo desde a última conferência, em palavras. */
export function desdeAUltimaEmTexto(dias: number | null): string {
  if (dias === null) return 'nunca conferido';
  if (dias === 0) return 'conferido hoje';
  if (dias === 1) return 'conferido ontem';
  return `conferido há ${String(dias)} dias`;
}

/**
 * A frase de abertura do quadro.
 *
 * Lidera pelo número que decide o que fazer agora — unidades expostas sem
 * conferência —, não pela contagem de linhas. "12 linhas de consignação" não muda
 * comportamento; "7 unidades anunciadas que ninguém conferiu" muda.
 */
export function resumoDoQuadro(quadro: QuadroDeConferencia): string {
  if (quadro.itens.length === 0) {
    return 'Nenhum item em consignação. Quando um parceiro deixar peça com você, cadastre aqui para não vender o que já saiu no balcão dele.';
  }

  if (quadro.unidadesEmRisco === 0) {
    return `Conferência em dia. ${contagem(quadro.itens.length, 'item', 'itens')} em consignação.`;
  }

  const parceiros = quadro.parceirosEmRisco;
  const onde =
    parceiros.length === 1
      ? `em ${parceiros[0] ?? ''}`
      : `em ${String(parceiros.length)} parceiros`;

  const unidades = contagem(quadro.unidadesEmRisco, 'unidade anunciada', 'unidades anunciadas');
  return `${unidades} sem conferência ${onde}. Se vender o que já saiu no balcão, é cancelamento — e cancelamento pesa na conta.`;
}

/** O fechamento em uma linha, dizendo se dá para pagar sem conversa. */
export function resumoDoFechamento(fechamento: Fechamento): string {
  if (fechamento.porParceiro.length === 0) {
    return 'Nenhuma venda de item consignado neste período.';
  }

  const base = `${formatarBRL(fechamento.totalARepassar)} a repassar, ${contagem(fechamento.unidades, 'unidade', 'unidades')}.`;

  if (fechamento.completo) return `${base} Sem pendência: dá para pagar.`;

  const pendentes = fechamento.porParceiro.filter((p) => !p.completo).length;
  return `${base} ${contagem(pendentes, 'parceiro', 'parceiros')} com item sem preço de repasse combinado — o total ainda vai subir.`;
}

/** O mês do fechamento como as pessoas o escrevem: `setembro de 2026`. */
export function mesEmTexto(de: string): string {
  const [ano, mes] = de.split('-');
  if (ano === undefined || mes === undefined) return de;
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${ano}-${mes}-01T12:00:00Z`),
  );
  return `${nome} de ${ano}`;
}

export const CODIGOS_DE_AVISO = [
  'conferido',
  'cadastrado',
  'nao_encontrado',
  'sem_dados',
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
    case 'conferido':
      return {
        tom: 'ok',
        titulo: 'Conferência registrada',
        corpo:
          'A contagem do parceiro substituiu a do sistema, e o prazo reiniciou. Se o número mudou, o anúncio pode precisar de ajuste de estoque.',
      };
    case 'cadastrado':
      return {
        tom: 'ok',
        titulo: 'Item em consignação cadastrado',
        corpo: 'Entra como nunca conferido, no topo do quadro — é o estado honesto.',
      };
    case 'nao_encontrado':
      return {
        tom: 'atencao',
        titulo: 'Esse item não está mais aqui',
        corpo: 'Pode ter sido alterado em outra aba. O quadro abaixo já está atualizado.',
      };
    case 'sem_dados':
      return {
        tom: 'atencao',
        titulo: 'Faltou preencher',
        corpo: 'Parceiro, produto e quantidade são obrigatórios. Nada foi gravado.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu para gravar',
        corpo: 'Nada foi alterado. Tente de novo; se repetir, o log do servidor tem o motivo.',
      };
  }
}
