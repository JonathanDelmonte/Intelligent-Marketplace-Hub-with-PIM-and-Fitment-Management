/**
 * Tradução da fila de postagem para a tela.
 *
 * Função pura e testada, separada do componente pelo motivo de sempre: o texto que
 * diz "atrasado" ou "ainda dá tempo" muda o que a pessoa faz nos próximos minutos,
 * e isso merece teste.
 */
import { ROTULO_DA_URGENCIA, type Urgencia } from '@/dominio/pedidos/fila-do-dia';
import { contagem } from '@/lib/texto';
import { centavos, formatarBRL, type Centavos } from '@/lib/dinheiro';

export type TomDaUrgencia = 'alerta' | 'atencao' | 'neutro';

export function tomDaUrgencia(urgencia: Urgencia): TomDaUrgencia {
  switch (urgencia) {
    case 'atrasado':
      return 'alerta';
    case 'sem_prazo':
    case 'hoje':
      return 'atencao';
    case 'amanha':
    case 'depois':
      return 'neutro';
  }
}

export function rotuloDaUrgencia(urgencia: Urgencia): string {
  return ROTULO_DA_URGENCIA[urgencia];
}

/**
 * O tempo restante em palavras.
 *
 * Hora é a unidade certa aqui: "faltam 5 horas" muda o que a pessoa faz agora, e
 * "faltam 0,2 dias" não. Acima de 48 horas vira dia, porque aí a urgência já não é
 * de hoje e o número exato deixou de importar.
 */
export function tempoRestanteEmTexto(horas: number | null): string {
  if (horas === null) return 'sem prazo';
  if (horas < 0) {
    const atraso = Math.abs(horas);
    if (atraso < 24) return `${String(atraso)}h de atraso`;
    const dias = Math.trunc(atraso / 24);
    return dias === 1 ? '1 dia de atraso' : `${String(dias)} dias de atraso`;
  }
  if (horas === 0) return 'vence agora';
  if (horas < 48) return `faltam ${String(horas)}h`;
  return `faltam ${String(Math.trunc(horas / 24))} dias`;
}

/** Divergência de repasse em texto, dizendo de que lado ela está. */
export function divergenciaEmTexto(divergencia: Centavos): string {
  if (divergencia < 0) {
    return `${formatarBRL(centavos(Math.abs(divergencia)))} a menos do que as taxas explicam`;
  }
  return `${formatarBRL(divergencia)} a mais do que as taxas explicam`;
}

/**
 * O aviso de consignação, quando há unidade anunciada sem conferência.
 *
 * Mora nesta tela e não só na de consignação porque o risco se realiza **aqui**: é
 * postando que se descobre que a peça não está na loja. E é uma linha só, que
 * aparece apenas quando há risco — seção permanente seria ruído diário para um
 * trabalho semanal.
 *
 * `null` quando não há nada a dizer, para a tela não renderizar caixa vazia.
 */
export function avisoDeConsignacao(unidadesEmRisco: number): string | null {
  if (unidadesEmRisco <= 0) return null;
  const unidades = contagem(unidadesEmRisco, 'unidade', 'unidades');
  const verbo = unidadesEmRisco === 1 ? 'está anunciada' : 'estão anunciadas';
  return `${unidades} em consignação ${verbo} sem conferência. Confira antes de vender o que talvez já tenha saído no balcão do parceiro.`;
}

export const CODIGOS_DE_AVISO = [
  'postado',
  'repasse_conferido',
  'repasse_de_volta',
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
    case 'postado':
      return {
        tom: 'ok',
        titulo: 'Postagem confirmada',
        corpo: 'O pedido saiu da fila. O rastreio fica gravado no pedido.',
      };
    case 'repasse_conferido':
      return {
        tom: 'ok',
        titulo: 'Repasse conferido',
        corpo:
          'A linha saiu da lista de diferenças. O pedido não mudou: a diferença continua registrada e recalculável — o que ficou gravado é que você já olhou.',
      };
    case 'repasse_de_volta':
      return {
        tom: 'ok',
        titulo: 'Diferença de volta à lista',
        corpo: 'A marca de conferido saiu. A linha voltou para o que está esperando você olhar.',
      };
    case 'nao_encontrado':
      return {
        tom: 'atencao',
        titulo: 'Esse pedido não está mais aqui',
        corpo: 'Pode ter sido confirmado em outra aba. A fila abaixo já está atualizada.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu para gravar',
        corpo: 'Nada foi alterado. Tente de novo; se repetir, o log do servidor tem o motivo.',
      };
  }
}
