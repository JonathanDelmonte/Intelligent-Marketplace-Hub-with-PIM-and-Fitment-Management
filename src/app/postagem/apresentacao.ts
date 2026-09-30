/**
 * Tradução da fila de postagem para a tela.
 *
 * Função pura e testada, separada do componente pelo motivo de sempre: o texto que
 * diz "atrasado" ou "ainda dá tempo" muda o que a pessoa faz nos próximos minutos,
 * e isso merece teste.
 */
import {
  FUSO_PADRAO,
  ROTULO_DA_URGENCIA,
  type FilaDoDia,
  type ItemDaFila,
  type Urgencia,
} from '@/dominio/pedidos/fila-do-dia';
import { contagem } from '@/lib/texto';
import { centavos, formatarBRL, type Centavos } from '@/lib/dinheiro';
import { IDIOMA } from '../ui/tempo';

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

/**
 * A divergência curta, para a casa da tabela: "R$ 11,29 a menos". O "do que as taxas
 * explicam" fica uma vez só, na frase de cima da tabela, e não em cada linha.
 */
export function diferencaCurta(divergencia: Centavos): string {
  if (divergencia < 0) return `${formatarBRL(centavos(Math.abs(divergencia)))} a menos`;
  return `${formatarBRL(divergencia)} a mais`;
}

/**
 * O repasse de uma loja, como a linha do atalho o diz. O repasse mora na área de cada
 * loja (ADR 0009), e aqui só aparece quanto espera conferência em cada uma.
 */
export function repasseDaLojaEmTexto(paraConferir: number): string {
  return paraConferir === 0
    ? 'nada para conferir'
    : `${contagem(paraConferir, 'pedido', 'pedidos')} com repasse diferente do esperado`;
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
          'A linha saiu da lista de diferenças. O pedido não mudou: a diferença continua registrada e recalculável, e o que ficou gravado é que você já olhou.',
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

// ─── A tela em números e em grupos ───────────────────────────────────────────

/** O tom da nota de um número do alto, na escala de `ui/numeros`. */
export type TomDoNumeroDaFila = 'neutro' | 'alta' | 'baixa' | 'atencao';

export interface NumeroDaFila {
  readonly chave: 'atrasado' | 'hoje' | 'sem_prazo' | 'postados';
  readonly rotulo: string;
  readonly valor: number;
  readonly nota: string;
  readonly tom: TomDoNumeroDaFila;
  /** O grupo da tabela que o cartão abre; `null` quando não há o que abrir. */
  readonly ancora: string | null;
}

/** A âncora do grupo de uma urgência na tabela, para o número do alto levar até ele. */
export function ancoraDoGrupo(urgencia: Urgencia): string {
  return `grupo-${urgencia}`;
}

/**
 * Os quatro números do alto: o que passou do prazo, o que vence hoje, o que não tem
 * prazo e o que já saiu.
 *
 * O zero também fala, e fala bem: "nenhum passou do prazo" em verde é o que a pessoa quer
 * ler, e um zero mudo parece dado faltando. Cada número com fila atrás leva ao grupo dele
 * na tabela, porque o grupo dos sem prazo vem primeiro e pode ter trinta linhas.
 */
export function numerosDaFila(fila: FilaDoDia): readonly NumeroDaFila[] {
  const { atrasado, hoje, sem_prazo: semPrazo } = fila.porUrgencia;
  const ancora = (urgencia: Urgencia, quantos: number): string | null =>
    quantos === 0 ? null : `#${ancoraDoGrupo(urgencia)}`;
  return [
    {
      chave: 'atrasado',
      rotulo: 'Atrasados',
      valor: atrasado,
      nota: atrasado === 0 ? 'nenhum passou do prazo' : 'comece por estes',
      tom: atrasado === 0 ? 'alta' : 'baixa',
      ancora: ancora('atrasado', atrasado),
    },
    {
      chave: 'hoje',
      rotulo: 'Para hoje',
      valor: hoje,
      nota: hoje === 0 ? 'nada vence hoje' : 'vencem hoje, e ainda dá tempo',
      tom: hoje === 0 ? 'neutro' : 'atencao',
      ancora: ancora('hoje', hoje),
    },
    {
      chave: 'sem_prazo',
      rotulo: 'Sem prazo',
      valor: semPrazo,
      nota: semPrazo === 0 ? 'todos têm prazo' : 'não se sabe se atrasou',
      tom: semPrazo === 0 ? 'neutro' : 'atencao',
      ancora: ancora('sem_prazo', semPrazo),
    },
    {
      chave: 'postados',
      rotulo: 'Já postados',
      valor: fila.jaPostados,
      nota: fila.jaPostados === 0 ? 'nenhum ainda' : 'saíram da fila',
      tom: fila.jaPostados === 0 ? 'neutro' : 'alta',
      ancora: null,
    },
  ];
}

/** O título e a frase de cada grupo da tabela. */
const GRUPO_DA_URGENCIA: Readonly<
  Record<Urgencia, { readonly titulo: string; readonly explicacao: string }>
> = {
  sem_prazo: {
    titulo: 'Sem prazo definido',
    explicacao: 'A planilha não trouxe o prazo. Confira na loja se ainda dá tempo.',
  },
  atrasado: { titulo: 'Atrasados', explicacao: 'O prazo já passou. Poste estes primeiro.' },
  hoje: { titulo: 'Para hoje', explicacao: 'Vencem hoje, e ainda dá tempo.' },
  amanha: { titulo: 'Para amanhã', explicacao: 'Dá para adiantar, se sobrar tempo hoje.' },
  depois: { titulo: 'Depois', explicacao: 'Sem pressa por enquanto.' },
};

export interface GrupoDaFila {
  readonly urgencia: Urgencia;
  readonly titulo: string;
  readonly explicacao: string;
  readonly tom: TomDaUrgencia;
  readonly ancora: string;
  readonly itens: readonly ItemDaFila[];
}

/**
 * A fila em grupos de urgência, na ordem em que ela já vem.
 *
 * A ordem é a da fila (`fila-do-dia`), que decide e testa: sem prazo primeiro, depois o
 * atraso, depois o dia. Aqui só se corta onde a urgência muda, para a tabela dizer em
 * que grupo cada linha está sem repetir a palavra em todas elas.
 */
export function gruposDaFila(fila: FilaDoDia): readonly GrupoDaFila[] {
  const grupos = new Map<Urgencia, ItemDaFila[]>();
  for (const item of fila.itens) {
    const lista = grupos.get(item.urgencia);
    if (lista === undefined) grupos.set(item.urgencia, [item]);
    else lista.push(item);
  }
  return [...grupos].map(([urgencia, itens]) => ({
    urgencia,
    ...GRUPO_DA_URGENCIA[urgencia],
    tom: tomDaUrgencia(urgencia),
    ancora: ancoraDoGrupo(urgencia),
    itens,
  }));
}

/**
 * O pé da tabela quando há pedido que não casou com produto do catálogo.
 *
 * Uma frase para todos, e não uma por linha: repetida em cada pedido, a explicação
 * empurrava a fila para baixo e ninguém a lia da segunda vez em diante.
 */
export function semProdutoEmTexto(quantos: number): string | null {
  if (quantos <= 0) return null;
  const pedidos = contagem(quantos, 'pedido não casou', 'pedidos não casaram');
  const margem = quantos === 1 ? 'não tem margem calculada' : 'não têm margem calculada';
  return `${pedidos} com nenhum produto do catálogo, então ${margem}. Cadastre o código de barras no produto e importe a planilha de novo.`;
}

/**
 * O dia de hoje por extenso, no fuso de quem vende: "Quarta-feira, 30 de setembro".
 *
 * Mora no alto da tela porque "hoje" é a palavra do título, e a aba fica aberta de um dia
 * para o outro.
 */
export function hojeEmTexto(agora: Date, fuso: string = FUSO_PADRAO): string {
  const texto = new Intl.DateTimeFormat(IDIOMA, {
    day: 'numeric',
    month: 'long',
    timeZone: fuso,
    weekday: 'long',
  }).format(agora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
