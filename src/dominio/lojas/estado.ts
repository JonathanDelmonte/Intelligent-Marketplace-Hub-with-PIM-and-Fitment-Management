/**
 * Em que pé está cada loja: conectada, por planilha ou sem dados (ADR 0009).
 *
 * É a legenda que a barra mostra embaixo do nome de cada loja, e a primeira coisa que
 * a área da loja diz. As três respostas são estados normais, e nenhum é erro: nenhuma
 * tela depende de loja conectada (ADR 0002).
 *
 * ## "Por planilha" diz até quando
 *
 * Loja por planilha tem números tão novos quanto a última exportação, e a legenda diz
 * a data do pedido mais recente que entrou. "Faturamento de R$ 3.910" sem essa data
 * pareceria o mês inteiro, quando pode faltar a última semana.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

export const ESTADOS_DA_LOJA = ['conectada', 'planilha', 'sem_dados'] as const;
export type TipoDeEstadoDaLoja = (typeof ESTADOS_DA_LOJA)[number];

/** O que se lê do banco sobre uma loja para dizer em que pé ela está. */
export interface NumerosDaLoja {
  readonly plataforma: Plataforma;
  /** Pedidos gravados desta loja, em qualquer data. */
  readonly pedidos: number;
  /** A data do pedido mais recente. `null` sem pedido nenhum. */
  readonly ultimoPedidoEm: Date | null;
  /** Há credencial de API ativa e dentro da validade. */
  readonly conectada: boolean;
}

export interface EstadoDaLoja {
  readonly tipo: TipoDeEstadoDaLoja;
  /** Legenda curta, para a barra: "Por planilha · até 22/09". */
  readonly legenda: string;
  /** Frase para o cabeçalho da área da loja. */
  readonly frase: string;
}

/** Dia e mês no fuso do vendedor: "22/09". */
export function diaEMes(data: Date, fuso: string = FUSO_PADRAO): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
  }).format(data);
}

export function estadoDaLoja(numeros: NumerosDaLoja, fuso: string = FUSO_PADRAO): EstadoDaLoja {
  if (numeros.conectada) {
    return {
      tipo: 'conectada',
      legenda: 'Conectada',
      frase: 'Conectada pela API: pedidos e anúncios chegam sozinhos.',
    };
  }

  if (numeros.pedidos > 0 && numeros.ultimoPedidoEm !== null) {
    const ate = diaEMes(numeros.ultimoPedidoEm, fuso);
    return {
      tipo: 'planilha',
      legenda: `Por planilha · até ${ate}`,
      frase: `Por planilha: os números vão até ${ate}, a data do pedido mais recente importado.`,
    };
  }

  return {
    tipo: 'sem_dados',
    legenda: 'Sem dados',
    frase: 'Nenhum pedido desta loja ainda. Importe a planilha de pedidos do painel dela.',
  };
}
