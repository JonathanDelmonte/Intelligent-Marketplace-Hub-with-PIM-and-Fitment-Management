/**
 * Fila de postagem do dia (M10 — 8.7).
 *
 * A especificação chama esta de "a tela mais usada do sistema", e o critério dela
 * é uma frase: "o que postar hoje, ordenado por prazo restante". Então a ordem não
 * é por data de venda, não é por valor e não é por cliente — é por **quanto tempo
 * falta**, porque atraso em conta nova é o que mais custa em reputação.
 *
 * ## O dia é o do vendedor, não o do servidor
 *
 * "Hoje" precisa ser o dia no fuso do vendedor. Um pedido com prazo às 23h de
 * quinta em São Paulo é 02h de sexta em UTC, e um cálculo em UTC o mostraria como
 * "amanhã" na quinta à noite — justamente quando ainda dava para postar. O fuso
 * entra por parâmetro, com padrão brasileiro, e o dia é calculado com `Intl`, sem
 * dependência e sem aritmética de data à mão.
 *
 * ## Sem prazo não é sem urgência
 *
 * Pedido sem prazo de postagem aparece numa faixa própria, no topo, porque a falta
 * do prazo é o problema: não se sabe se está atrasado. Esconder no fim da lista
 * seria transformar dado faltando em pedido esquecido.
 */
export const FUSO_PADRAO = 'America/Sao_Paulo';

export const URGENCIAS = ['sem_prazo', 'atrasado', 'hoje', 'amanha', 'depois'] as const;
export type Urgencia = (typeof URGENCIAS)[number];

/** Ordem de atenção. Número menor aparece primeiro. */
const PESO_DA_URGENCIA: Readonly<Record<Urgencia, number>> = {
  sem_prazo: 0,
  atrasado: 1,
  hoje: 2,
  amanha: 3,
  depois: 4,
};

export const ROTULO_DA_URGENCIA: Readonly<Record<Urgencia, string>> = {
  sem_prazo: 'sem prazo definido',
  atrasado: 'atrasado',
  hoje: 'postar hoje',
  amanha: 'postar amanhã',
  depois: 'depois',
};

export interface PedidoParaPostar {
  readonly id: string;
  readonly idExterno: string;
  readonly plataforma: string;
  readonly qtd: number;
  readonly tituloDoProduto: string | null;
  readonly prazoPostagemAte: Date | null;
  readonly postagemConfirmadaEm: Date | null;
  readonly rastreio: string | null;
}

export interface ItemDaFila extends PedidoParaPostar {
  readonly urgencia: Urgencia;
  /** Horas até o prazo. Negativo quando já passou. `null` sem prazo. */
  readonly horasRestantes: number | null;
}

export interface FilaDoDia {
  readonly itens: readonly ItemDaFila[];
  readonly porUrgencia: Readonly<Record<Urgencia, number>>;
  /** Quantos já foram postados e saíram da fila. */
  readonly jaPostados: number;
}

/** O dia civil de uma data, no fuso informado. `2026-09-14`. */
export function diaNoFuso(data: Date, fuso: string = FUSO_PADRAO): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);
}

/** O dia seguinte, no fuso informado. */
function diaSeguinteNoFuso(data: Date, fuso: string): string {
  return diaNoFuso(new Date(data.getTime() + 24 * 60 * 60 * 1000), fuso);
}

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * A urgência de um prazo, comparado com agora.
 *
 * "Atrasado" vence "hoje": um prazo que já passou hoje é atraso, não tarefa do
 * dia. A ordem das comparações é essa de propósito.
 */
export function urgenciaDe(prazo: Date | null, agora: Date, fuso: string = FUSO_PADRAO): Urgencia {
  if (prazo === null) return 'sem_prazo';
  if (prazo.getTime() < agora.getTime()) return 'atrasado';
  const diaDoPrazo = diaNoFuso(prazo, fuso);
  if (diaDoPrazo === diaNoFuso(agora, fuso)) return 'hoje';
  if (diaDoPrazo === diaSeguinteNoFuso(agora, fuso)) return 'amanha';
  return 'depois';
}

/**
 * Monta a fila do dia.
 *
 * Pedido com postagem confirmada sai da fila — é a definição de pronto. Fica
 * contado em `jaPostados` para a tela poder dizer "3 de 8 feitos", que é o número
 * que faz a pessoa continuar.
 */
export function montarFilaDoDia(
  pedidos: readonly PedidoParaPostar[],
  agora: Date,
  fuso: string = FUSO_PADRAO,
): FilaDoDia {
  const porUrgencia: Record<Urgencia, number> = {
    sem_prazo: 0,
    atrasado: 0,
    hoje: 0,
    amanha: 0,
    depois: 0,
  };

  let jaPostados = 0;
  const itens: ItemDaFila[] = [];

  for (const pedido of pedidos) {
    if (pedido.postagemConfirmadaEm !== null) {
      jaPostados += 1;
      continue;
    }
    const urgencia = urgenciaDe(pedido.prazoPostagemAte, agora, fuso);
    porUrgencia[urgencia] += 1;
    itens.push({
      ...pedido,
      urgencia,
      horasRestantes:
        pedido.prazoPostagemAte === null
          ? null
          : Math.trunc((pedido.prazoPostagemAte.getTime() - agora.getTime()) / MS_POR_HORA),
    });
  }

  // Ordena por urgência e, dentro dela, por prazo mais próximo. Desempate por id
  // para a lista não trocar de ordem entre dois carregamentos.
  const ordenados = [...itens].sort((a, b) => {
    const peso = PESO_DA_URGENCIA[a.urgencia] - PESO_DA_URGENCIA[b.urgencia];
    if (peso !== 0) return peso;
    const prazoA = a.prazoPostagemAte?.getTime() ?? 0;
    const prazoB = b.prazoPostagemAte?.getTime() ?? 0;
    if (prazoA !== prazoB) return prazoA - prazoB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { itens: ordenados, porUrgencia, jaPostados };
}

/** Uma frase dizendo o tamanho do trabalho do dia. */
export function resumoDaFila(fila: FilaDoDia): string {
  const paraAgora = fila.porUrgencia.atrasado + fila.porUrgencia.hoje;
  if (fila.itens.length === 0) {
    return fila.jaPostados === 0
      ? 'Nenhum pedido para postar.'
      : `Tudo postado: ${String(fila.jaPostados)} pedido(s).`;
  }
  if (fila.porUrgencia.atrasado > 0) {
    return `${String(fila.porUrgencia.atrasado)} atrasado(s) e ${String(fila.porUrgencia.hoje)} para hoje. Comece pelos atrasados.`;
  }
  if (paraAgora === 0) {
    return `Nada vence hoje. ${String(fila.itens.length)} pedido(s) na fila.`;
  }
  return `${String(paraAgora)} para postar hoje, de ${String(fila.itens.length)} na fila.`;
}
