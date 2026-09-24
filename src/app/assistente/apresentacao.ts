/**
 * O que o assistente diz, a partir dos números levantados (ADR 0009).
 *
 * Funções puras, com teste: "a Shopee faturou mais, 59% do total" é afirmação sobre
 * dinheiro, e afirmação desse tipo dentro de JSX não tem teste. Nenhuma frase daqui sai
 * de IA — a IA, quando entra, só traduziu a pergunta.
 *
 * Toda resposta tem as mesmas partes, e cada uma tem um motivo:
 *
 * - **entendido**: como a pergunta foi lida. Pergunta mal entendida com número certo é o
 *   erro que ninguém percebe; mostrada, se percebe na hora.
 * - **lead**: a resposta numa frase, com o número.
 * - **notas**: o que falta para o número ser o número inteiro — loja sem pedido, planilha
 *   que para antes do período, pedido sem custo fora da margem.
 * - **acao**: a tela onde se age sobre a resposta.
 */
import type { Consulta, JanelasDoPeriodo, Metrica, Periodo } from '@/dominio/assistente/consulta';
import type {
  FrescorDaLoja,
  GrupoDeMaisVendidos,
  Levantamento,
  PainelDaLoja,
} from '@/dominio/assistente/levantar';
import { diaEMes } from '@/dominio/lojas/estado';
import { variacaoBp, type Painel } from '@/dominio/lojas/painel';
import type { MaisVendido } from '@/dominio/lojas/repositorio';
import {
  diaNoFuso,
  FUSO_PADRAO,
  juntarFilas,
  resumoDaFila,
  ROTULO_DA_URGENCIA,
  type Urgencia,
} from '@/dominio/pedidos/fila-do-dia';
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';
import {
  centavos,
  formatarBRL,
  formatarPontosBase,
  pontosBase,
  type PontosBase,
} from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import { CAMINHO as CAMINHO_DO_CATALOGO } from '../catalogo/constantes';
import { CAMINHO as CAMINHO_DE_IMPORTAR } from '../importar/constantes';
import { diaCurto, margemEmTexto } from '../lojas/apresentacao';
import { caminhoDaAba } from '../lojas/caminhos';
import { CAMINHO as CAMINHO_DA_POSTAGEM } from '../postagem/constantes';
import { aLoja, daLoja, naLoja, ROTULO_DA_PLATAFORMA } from '../ui/rotulos';

export interface LinhaDaResposta {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string | null;
  /** A loja da linha, para o selo ao lado. */
  readonly loja: Plataforma | null;
}

export interface SecaoDaResposta {
  readonly titulo: string | null;
  readonly linhas: readonly LinhaDaResposta[];
}

export interface AcaoDaResposta {
  readonly rotulo: string;
  readonly href: string;
}

export interface Resposta {
  readonly entendido: string;
  readonly lead: string;
  /** A segunda frase, quando há: a comparação com o período de antes. */
  readonly complemento: string | null;
  readonly secoes: readonly SecaoDaResposta[];
  readonly notas: readonly string[];
  readonly acao: AcaoDaResposta | null;
}

export const ROTULO_DA_METRICA: Readonly<Record<Metrica, string>> = {
  resumo: 'Resumo',
  faturamento: 'Faturamento',
  pedidos: 'Pedidos',
  ticket_medio: 'Ticket médio',
  margem: 'Margem',
  mais_vendidos: 'Mais vendidos',
  postar_hoje: 'O que postar hoje',
  repasse_divergente: 'Repasse diferente do esperado',
};

/** O que o assistente sabe responder, para quem perguntou o que ele não sabe. */
export const O_QUE_EU_RESPONDO =
  'faturamento, pedidos, ticket médio, margem, os mais vendidos, o que postar e repasse diferente do esperado — de uma loja, de cada loja ou de todas; hoje, ontem, 7, 30 ou 90 dias, este mês ou o mês passado.';

// ─── Como a pergunta foi entendida, e quando não há resposta ─────────────────

export type ComoEntendi =
  | { readonly tipo: 'pronta' }
  | { readonly tipo: 'regra' }
  | { readonly tipo: 'ia'; readonly deCache: boolean };

/** O rodapé da resposta: quem entendeu a pergunta, e de onde vêm os números. */
export function textoDeComoEntendi(como: ComoEntendi): string {
  const numeros = 'Os números são somas do sistema sobre os pedidos gravados.';
  switch (como.tipo) {
    case 'pronta':
      return `Pergunta pronta, respondida sem IA. ${numeros}`;
    case 'regra':
      return `Entendi a pergunta pelas palavras, sem usar IA. ${numeros}`;
    case 'ia':
      return como.deCache
        ? `A IA gratuita já tinha traduzido esta pergunta antes, e a tradução foi reaproveitada — não gastou cota. ${numeros} A IA não vê nem calcula número.`
        : `A IA gratuita traduziu a pergunta para a consulta acima. ${numeros} A IA não vê nem calcula número.`;
  }
}

export type MotivoSemResposta =
  | { readonly tipo: 'fora_do_alcance' }
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'cota'; readonly ate: Date }
  | { readonly tipo: 'teto' }
  | { readonly tipo: 'falha_da_ia'; readonly motivo: string }
  | { readonly tipo: 'leitura' };

export interface AvisoDoAssistente {
  readonly titulo: string;
  readonly corpo: string;
  /** Um detalhe técnico, em letra menor, quando ajuda a entender o que houve. */
  readonly detalhe: string | null;
  readonly tom: 'neutro' | 'atencao' | 'erro';
}

/** "às 21:00", ou "em 25/09 às 00:00" quando a cota só volta noutro dia. */
function quandoVolta(ate: Date, agora: Date, fuso: string): string {
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
  }).format(ate);
  return diaNoFuso(ate, fuso) === diaNoFuso(agora, fuso)
    ? `às ${hora}`
    : `em ${diaEMes(ate, fuso)} às ${hora}`;
}

/**
 * O que dizer quando não há resposta — e cada caso diz o que fazer.
 *
 * Nenhum é erro de tela: pergunta fora do que se sabe, IA desligada e cota acabada são
 * estados previstos (CLAUDE.md, 3.7), e o caminho sem IA — as prontas — continua aberto
 * em todos eles.
 */
export function avisoSemResposta(
  motivo: MotivoSemResposta,
  agora: Date,
  fuso: string = FUSO_PADRAO,
): AvisoDoAssistente {
  switch (motivo.tipo) {
    case 'fora_do_alcance':
      return {
        titulo: 'Ainda não sei responder essa.',
        corpo: `Hoje eu respondo sobre ${O_QUE_EU_RESPONDO}`,
        detalhe: null,
        tom: 'neutro',
      };
    case 'sem_chave':
      return {
        titulo: 'Não entendi a pergunta pelas palavras.',
        corpo:
          'E a IA, que tentaria entender de outro jeito, não está ligada. Reescreva dizendo o que quer saber — faturamento, pedidos, margem, o que postar — ou use uma pergunta pronta.',
        detalhe:
          'Para ligar a IA gratuita, cole a chave do OpenRouter em LLM_API_KEY, no arquivo .env.',
        tom: 'neutro',
      };
    case 'cota':
      return {
        titulo: 'A cota gratuita de IA acabou por agora.',
        corpo: `Ela volta ${quandoVolta(motivo.ate, agora, fuso)}. Até lá, as perguntas prontas e as que eu entendo pelas palavras continuam respondendo — só a pergunta que precisa da IA espera.`,
        detalhe: null,
        tom: 'atencao',
      };
    case 'teto':
      return {
        titulo: 'O teto de gasto de IA desta pergunta acabou.',
        corpo: 'Tente de novo daqui a pouco, ou use uma pergunta pronta, que não usa IA.',
        detalhe: null,
        tom: 'atencao',
      };
    case 'falha_da_ia':
      return {
        titulo: 'A IA não conseguiu entender a pergunta agora.',
        corpo: 'Tente escrever de outro jeito, ou use uma pergunta pronta, que não usa IA.',
        detalhe: motivo.motivo,
        tom: 'atencao',
      };
    case 'leitura':
      return {
        titulo: 'Não deu para ler os números agora.',
        corpo:
          'A pergunta foi entendida, mas a leitura do banco falhou. O erro ficou no registro do servidor.',
        detalhe: null,
        tom: 'erro',
      };
  }
}

// ─── Pedaços de frase ────────────────────────────────────────────────────────

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "o Mercado Livre e a Shopee"; "a Amazon, o Mercado Livre e a Shopee". */
function emLista(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens.at(-1) ?? ''}`;
}

function percentual(bp: PontosBase): string {
  return formatarPontosBase(pontosBase(Math.abs(bp)), 0);
}

/** A pergunta cobre todas as lojas, somadas ou lado a lado? */
function ehDeTodas(consulta: Consulta): boolean {
  return consulta.lojas.length === 0;
}

/** "da Shopee", "do Mercado Livre e da Shopee", "de todas as lojas". */
function deQuem(lev: Levantamento): string {
  return ehDeTodas(lev.consulta) ? 'de todas as lojas' : emLista(lev.lojas.map(daLoja));
}

/** "na Shopee", ou nada quando a pergunta é de todas: "nenhuma venda hoje". */
function ondeNaFrase(lev: Levantamento): string {
  return ehDeTodas(lev.consulta) ? '' : ` ${emLista(lev.lojas.map(naLoja))}`;
}

/** O nome do mês de um dia: `2026-08-01` → "agosto". */
function nomeDoMes(dia: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${dia}T12:00:00.000Z`),
  );
}

function primeiroDia(janela: { readonly dias: readonly string[] }): string {
  return janela.dias[0] ?? '';
}

function ultimoDia(janela: { readonly dias: readonly string[] }): string {
  return janela.dias.at(-1) ?? '';
}

/** "hoje", "nos últimos 30 dias", "em agosto" — o período dentro da frase. */
export function periodoNaFrase(periodo: Periodo, janelas: JanelasDoPeriodo): string {
  switch (periodo) {
    case 'hoje':
      return 'hoje';
    case 'ontem':
      return 'ontem';
    case 'ultimos_7':
    case 'ultimos_30':
    case 'ultimos_90':
      return `nos últimos ${String(janelas.atual.dias.length)} dias`;
    case 'mes_atual':
      return 'neste mês';
    case 'mes_passado':
      return `em ${nomeDoMes(primeiroDia(janelas.atual))}`;
  }
}

/** "ontem", "nos 30 dias anteriores", "em julho" — o período com que se compara. */
export function anteriorNaFrase(periodo: Periodo, janelas: JanelasDoPeriodo): string {
  switch (periodo) {
    case 'hoje':
      return 'ontem';
    case 'ontem':
      return 'anteontem';
    case 'ultimos_7':
    case 'ultimos_30':
    case 'ultimos_90':
      return `nos ${String(janelas.anterior.dias.length)} dias anteriores`;
    case 'mes_atual':
      return 'no mesmo trecho do mês passado';
    case 'mes_passado':
      return `em ${nomeDoMes(primeiroDia(janelas.anterior))}`;
  }
}

/** "últimos 30 dias (26/08 a 24/09)", "hoje (24/09)" — o período do "entendi assim". */
export function periodoCurto(periodo: Periodo, janelas: JanelasDoPeriodo): string {
  const de = diaCurto(primeiroDia(janelas.atual));
  const ate = diaCurto(ultimoDia(janelas.atual));
  const datas = de === ate ? `(${de})` : `(${de} a ${ate})`;
  switch (periodo) {
    case 'hoje':
      return `hoje ${datas}`;
    case 'ontem':
      return `ontem ${datas}`;
    case 'ultimos_7':
    case 'ultimos_30':
    case 'ultimos_90':
      return `últimos ${String(janelas.atual.dias.length)} dias ${datas}`;
    case 'mes_atual':
      return `este mês ${datas}`;
    case 'mes_passado':
      return `${nomeDoMes(primeiroDia(janelas.atual))} ${datas}`;
  }
}

/**
 * "11% a mais que nos 30 dias anteriores (R$ 3.900,00)."
 *
 * `null` quando não há o que dizer: zero contra zero não é comparação.
 */
export function comparacao(
  atual: number,
  anterior: number,
  formatar: (valor: number) => string,
  antes: string,
): string | null {
  const bp = variacaoBp(atual, anterior);
  if (bp === null) return atual === 0 ? null : `Não houve venda ${antes} para comparar.`;
  if (bp === 0) return `O mesmo que ${antes}.`;
  const lado = bp > 0 ? 'a mais' : 'a menos';
  return `${percentual(bp)} ${lado} que ${antes} (${formatar(anterior)}).`;
}

const emReais = (valor: number): string => formatarBRL(centavos(valor));
const emPedidos = (valor: number): string => contagem(valor, 'pedido', 'pedidos');

// ─── Entendido ───────────────────────────────────────────────────────────────

/** "Faturamento · Shopee · últimos 30 dias (26/08 a 24/09)". */
export function descreverConsulta(lev: Levantamento): string {
  const { consulta } = lev;
  const quem = ehDeTodas(consulta)
    ? consulta.porLoja
      ? 'cada loja'
      : 'todas as lojas'
    : emLista(lev.lojas.map((p) => ROTULO_DA_PLATAFORMA[p]));
  const partes = [ROTULO_DA_METRICA[consulta.metrica], quem];
  if (lev.tipo === 'painel' || lev.tipo === 'mais_vendidos') {
    partes.push(periodoCurto(consulta.periodo, lev.janelas));
  }
  return partes.join(' · ');
}

// ─── Notas de frescor ────────────────────────────────────────────────────────

/**
 * O que falta nos números de cada loja: pedido nenhum, ou planilha que para antes do
 * fim do período.
 *
 * Sem esta nota, "R$ 0 hoje" de uma loja por planilha pareceria um dia sem venda,
 * quando é um dia que ainda não foi importado.
 */
export function notasDeFrescor(
  frescor: readonly FrescorDaLoja[],
  ultimoDiaDaJanela: string,
  umaLoja: boolean,
  fuso: string = FUSO_PADRAO,
): readonly string[] {
  return frescor.flatMap((f): readonly string[] => {
    if (f.estado.tipo === 'sem_dados') {
      return [
        umaLoja
          ? `${maiuscula(aLoja(f.plataforma))} ainda não tem pedido importado. Importe a planilha de pedidos dela para ter números.`
          : `${maiuscula(aLoja(f.plataforma))} ainda não tem pedido importado, e não entra na conta.`,
      ];
    }
    if (
      f.estado.tipo === 'planilha' &&
      f.ultimoPedidoEm !== null &&
      diaNoFuso(f.ultimoPedidoEm, fuso) < ultimoDiaDaJanela
    ) {
      return [
        `Os pedidos ${daLoja(f.plataforma)} vão até ${diaEMes(f.ultimoPedidoEm, fuso)}, a planilha mais recente: o que vendeu depois ainda não está na conta.`,
      ];
    }
    return [];
  });
}

/** Loja só, e sem pedido: o que resolve é importar a planilha dela. */
function acaoDeImportar(lev: Levantamento): AcaoDaResposta | null {
  const [unica] = lev.frescor;
  if (lev.frescor.length !== 1 || unica === undefined || unica.estado.tipo !== 'sem_dados') {
    return null;
  }
  return {
    rotulo: `Importar planilha ${daLoja(unica.plataforma)}`,
    href: `${CAMINHO_DE_IMPORTAR}?loja=${unica.plataforma}`,
  };
}

const ACAO_DE_CUSTO: AcaoDaResposta = {
  rotulo: 'Informar custo no catálogo',
  href: CAMINHO_DO_CATALOGO,
};

// ─── Painel: faturamento, pedidos, ticket, margem, resumo ────────────────────

type LevantamentoDePainel = Extract<Levantamento, { readonly tipo: 'painel' }>;

/** O resto de uma resposta que é só a frase. */
const semComplemento = { complemento: null, secoes: [], notas: [], acao: null } as const;

/** A margem de uma loja, dita junto de quantos pedidos entraram na conta. */
function notaDaMargem(p: Painel): string {
  if (p.pedidos === 0) return 'nenhum pedido';
  if (p.margemBp === null) return 'nenhum pedido com custo';
  if (p.pedidosSemMargem === 0) return `sobre ${emPedidos(p.pedidos)}`;
  return `${contagem(p.pedidosSemMargem, 'pedido sem custo ficou', 'pedidos sem custo ficaram')} de fora`;
}

/** O que dizer da margem que deixou pedido de fora. */
function notaDePedidoSemCusto(p: Painel): string | null {
  if (p.pedidosSemMargem === 0 || p.margemBp === null) return null;
  return `A margem é sobre ${String(p.pedidos - p.pedidosSemMargem)} dos ${emPedidos(p.pedidos)}: ${contagem(p.pedidosSemMargem, 'pedido sem custo ficou', 'pedidos sem custo ficaram')} de fora. Informe o custo no catálogo para a conta ficar inteira.`;
}

/** A resposta sobre uma loja só, ou sobre todas somadas. */
function painelDeUm(lev: LevantamentoDePainel): Omit<Resposta, 'entendido'> {
  const { consulta, janelas, total: t, totalAnterior: a } = lev;
  const quando = periodoNaFrase(consulta.periodo, janelas);
  const antes = anteriorNaFrase(consulta.periodo, janelas);
  const de = deQuem(lev);
  const onde = ondeNaFrase(lev);
  const semVenda = `Nenhuma venda${onde} ${quando}.`;
  const vazio = { secoes: [], notas: [], acao: null };

  switch (consulta.metrica) {
    case 'faturamento':
      if (t.pedidos === 0) return { lead: semVenda, complemento: null, ...vazio };
      return {
        lead: `Faturamento ${de} ${quando}: ${formatarBRL(t.faturamento)}, em ${emPedidos(t.pedidos)}.`,
        complemento: comparacao(t.faturamento, a.faturamento, emReais, antes),
        ...vazio,
      };

    case 'pedidos':
      if (t.pedidos === 0) {
        return { lead: `Nenhum pedido${onde} ${quando}.`, complemento: null, ...vazio };
      }
      return {
        lead: `${maiuscula(emPedidos(t.pedidos))}${onde} ${quando}.`,
        complemento: comparacao(t.pedidos, a.pedidos, emPedidos, antes),
        ...vazio,
      };

    case 'ticket_medio':
      if (t.ticketMedio === null) {
        return {
          lead: `Nenhum pedido${onde} ${quando}, então não há ticket médio.`,
          complemento: null,
          ...vazio,
        };
      }
      return {
        lead: `Ticket médio ${de} ${quando}: ${formatarBRL(t.ticketMedio)}, em ${emPedidos(t.pedidos)}.`,
        complemento:
          a.ticketMedio === null ? null : comparacao(t.ticketMedio, a.ticketMedio, emReais, antes),
        ...vazio,
      };

    case 'margem': {
      if (t.pedidos === 0) {
        return { lead: `Nenhum pedido${onde} ${quando}, então não há margem.`, ...semComplemento };
      }
      if (t.margemBp === null) {
        return {
          lead: `Nenhum pedido${onde} ${quando} tem custo informado, então não há margem para mostrar.`,
          complemento: null,
          secoes: [],
          notas: [],
          acao: ACAO_DE_CUSTO,
        };
      }
      const semCusto = notaDePedidoSemCusto(t);
      return {
        lead: `Margem ${de} ${quando}: ${percentual(t.margemBp)}.`,
        complemento:
          semCusto === null && a.margemBp !== null
            ? `${maiuscula(antes)} foi de ${margemEmTexto(a.margemBp)}.`
            : null,
        secoes: [],
        notas: semCusto === null ? [] : [semCusto],
        acao: semCusto === null ? null : ACAO_DE_CUSTO,
      };
    }

    // Só o resumo chega aqui: as outras três métricas têm levantamento próprio, e estão
    // no mesmo ramo porque o `switch` sobre a métrica precisa cobrir todas.
    case 'resumo':
    case 'mais_vendidos':
    case 'postar_hoje':
    case 'repasse_divergente': {
      if (t.pedidos === 0) return { lead: semVenda, complemento: null, ...vazio };
      const margem = t.margemBp === null ? '' : `, com margem de ${percentual(t.margemBp)}`;
      return {
        lead: `${formatarBRL(t.faturamento)} em ${emPedidos(t.pedidos)}${onde} ${quando}${margem}.`,
        complemento: comparacao(t.faturamento, a.faturamento, emReais, antes),
        secoes: [{ titulo: null, linhas: linhasDoResumo(t) }],
        notas: [],
        acao: null,
      };
    }
  }
}

/** Os números do resumo, um por linha. */
function linhasDoResumo(t: Painel): readonly LinhaDaResposta[] {
  return [
    { rotulo: 'Faturamento', valor: formatarBRL(t.faturamento), nota: null, loja: null },
    {
      rotulo: 'Pedidos',
      valor: String(t.pedidos),
      nota: t.ticketMedio === null ? null : `ticket médio ${formatarBRL(t.ticketMedio)}`,
      loja: null,
    },
    { rotulo: 'Margem', valor: margemEmTexto(t.margemBp), nota: notaDaMargem(t), loja: null },
    {
      rotulo: 'Repasse informado',
      valor: formatarBRL(t.repasse),
      nota:
        t.repasse === 0
          ? 'a planilha não trouxe o repasse'
          : 'o que as lojas disseram que vão pagar',
      loja: null,
    },
  ];
}

/** A fatia de uma loja no total, em pontos-base. */
function fatia(parte: number, todo: number): PontosBase {
  return pontosBase(todo === 0 ? 0 : Math.round((parte * 10_000) / todo));
}

/** A resposta que compara lojas: quem lidera, e cada uma ao lado. */
function painelPorLoja(lev: LevantamentoDePainel): Omit<Resposta, 'entendido'> {
  const { consulta, janelas, total: t, totalAnterior: a } = lev;
  const quando = periodoNaFrase(consulta.periodo, janelas);
  const antes = anteriorNaFrase(consulta.periodo, janelas);
  const semDado = new Set(
    lev.frescor.filter((f) => f.estado.tipo === 'sem_dados').map((f) => f.plataforma),
  );

  /** As lojas por um número, da maior para a menor, só as que têm o número. */
  const ranking = (numero: (l: PainelDaLoja) => number | null): PainelDaLoja[] =>
    lev.porLoja
      .filter((l) => numero(l) !== null)
      .sort((x, y) => (numero(y) ?? 0) - (numero(x) ?? 0));

  // Loja sem pedido nenhum mostra traço, e não zero: zero é "não vendeu", e ela não
  // tem como ter vendido — ainda não entrou dado dela.
  const linha = (l: PainelDaLoja, valor: string, nota: string): LinhaDaResposta =>
    semDado.has(l.plataforma)
      ? {
          rotulo: ROTULO_DA_PLATAFORMA[l.plataforma],
          valor: '—',
          nota: 'nenhum pedido importado ainda',
          loja: l.plataforma,
        }
      : { rotulo: ROTULO_DA_PLATAFORMA[l.plataforma], valor, nota, loja: l.plataforma };

  const noTotal = (frase: string | null): string | null =>
    frase === null ? null : `No total, ${frase.charAt(0).toLowerCase()}${frase.slice(1)}`;

  switch (consulta.metrica) {
    case 'faturamento': {
      const ordem = ranking((l) => l.atual.faturamento);
      const [lider] = ordem.filter((l) => l.atual.pedidos > 0);
      const linhas = ordem.map((l) =>
        linha(
          l,
          formatarBRL(l.atual.faturamento),
          l.atual.pedidos === 0
            ? 'sem venda no período'
            : `${emPedidos(l.atual.pedidos)} · ${percentual(fatia(l.atual.faturamento, t.faturamento))} do total`,
        ),
      );
      if (lider === undefined) {
        return {
          lead: `Nenhuma loja vendeu ${quando}.`,
          ...semComplemento,
          secoes: [{ titulo: null, linhas }],
        };
      }
      const so = lider.atual.faturamento === t.faturamento;
      return {
        lead: so
          ? `Só ${aLoja(lider.plataforma)} vendeu ${quando}: ${formatarBRL(t.faturamento)}.`
          : `${maiuscula(aLoja(lider.plataforma))} faturou mais ${quando}: ${formatarBRL(lider.atual.faturamento)}, ${percentual(fatia(lider.atual.faturamento, t.faturamento))} do total de ${formatarBRL(t.faturamento)}.`,
        complemento: noTotal(comparacao(t.faturamento, a.faturamento, emReais, antes)),
        secoes: [{ titulo: null, linhas }],
        notas: [],
        acao: null,
      };
    }

    case 'pedidos': {
      const ordem = ranking((l) => l.atual.pedidos);
      const [lider] = ordem.filter((l) => l.atual.pedidos > 0);
      const linhas = ordem.map((l) =>
        linha(
          l,
          String(l.atual.pedidos),
          l.atual.ticketMedio === null
            ? 'nenhum pedido'
            : `ticket médio ${formatarBRL(l.atual.ticketMedio)}`,
        ),
      );
      if (lider === undefined) {
        return {
          lead: `Nenhuma loja teve pedido ${quando}.`,
          ...semComplemento,
          secoes: [{ titulo: null, linhas }],
        };
      }
      return {
        lead:
          lider.atual.pedidos === t.pedidos
            ? `Só ${aLoja(lider.plataforma)} teve pedidos ${quando}: ${String(t.pedidos)}.`
            : `${maiuscula(aLoja(lider.plataforma))} teve mais pedidos ${quando}: ${String(lider.atual.pedidos)}, de ${String(t.pedidos)} no total.`,
        complemento: noTotal(comparacao(t.pedidos, a.pedidos, emPedidos, antes)),
        secoes: [{ titulo: null, linhas }],
        notas: [],
        acao: null,
      };
    }

    case 'ticket_medio': {
      const ordem = ranking((l) => l.atual.ticketMedio);
      const linhas = [...ordem, ...lev.porLoja.filter((l) => l.atual.ticketMedio === null)].map(
        (l) =>
          linha(
            l,
            l.atual.ticketMedio === null ? '—' : formatarBRL(l.atual.ticketMedio),
            l.atual.pedidos === 0 ? 'nenhum pedido' : `em ${emPedidos(l.atual.pedidos)}`,
          ),
      );
      const [lider, segundo] = ordem;
      if (lider === undefined || lider.atual.ticketMedio === null) {
        return {
          lead: `Nenhuma loja teve pedido ${quando}, então não há ticket médio.`,
          ...semComplemento,
          secoes: [{ titulo: null, linhas }],
        };
      }
      return {
        lead:
          segundo === undefined
            ? `Só ${aLoja(lider.plataforma)} teve pedidos ${quando}; o ticket médio foi ${formatarBRL(lider.atual.ticketMedio)}.`
            : `${maiuscula(aLoja(lider.plataforma))} tem o maior ticket médio ${quando}: ${formatarBRL(lider.atual.ticketMedio)}.`,
        complemento:
          t.ticketMedio === null
            ? null
            : `Somadas, o ticket médio é ${formatarBRL(t.ticketMedio)}.`,
        secoes: [{ titulo: null, linhas }],
        notas: [],
        acao: null,
      };
    }

    case 'margem': {
      const ordem = ranking((l) => l.atual.margemBp);
      const linhas = [...ordem, ...lev.porLoja.filter((l) => l.atual.margemBp === null)].map((l) =>
        linha(l, margemEmTexto(l.atual.margemBp), notaDaMargem(l.atual)),
      );
      const secoes = [{ titulo: null, linhas }];
      const faltaCusto = lev.porLoja.some((l) => l.atual.pedidosSemMargem > 0);
      const notas = faltaCusto
        ? [
            'Pedido sem custo não entra na margem da loja: ela é a margem dos pedidos que têm custo. Informe o custo no catálogo para a conta ficar inteira.',
          ]
        : [];
      const [lider, segundo] = ordem;
      if (lider === undefined || lider.atual.margemBp === null) {
        return {
          lead:
            t.pedidos === 0
              ? `Nenhuma loja teve pedido ${quando}.`
              : `Nenhuma loja tem pedido com custo informado ${quando}, então não há margem para comparar.`,
          complemento: null,
          secoes,
          notas: [],
          acao: t.pedidos === 0 ? null : ACAO_DE_CUSTO,
        };
      }
      return {
        lead:
          segundo === undefined
            ? `Só ${aLoja(lider.plataforma)} tem pedido com custo ${quando}; a margem foi ${percentual(lider.atual.margemBp)}.`
            : `${maiuscula(aLoja(lider.plataforma))} deu mais margem ${quando}: ${percentual(lider.atual.margemBp)}.`,
        complemento: t.margemBp === null ? null : `Somadas, a margem é ${percentual(t.margemBp)}.`,
        secoes,
        notas,
        acao: faltaCusto ? ACAO_DE_CUSTO : null,
      };
    }

    // Só o resumo chega aqui, como em `painelDeUm`.
    case 'resumo':
    case 'mais_vendidos':
    case 'postar_hoje':
    case 'repasse_divergente': {
      const ordem = ranking((l) => l.atual.faturamento);
      const linhas = ordem.map((l) =>
        linha(
          l,
          formatarBRL(l.atual.faturamento),
          l.atual.pedidos === 0
            ? 'sem venda no período'
            : `${emPedidos(l.atual.pedidos)} · margem ${margemEmTexto(l.atual.margemBp)}`,
        ),
      );
      if (t.pedidos === 0) {
        return {
          lead: `Nenhuma venda ${quando}.`,
          ...semComplemento,
          secoes: [{ titulo: null, linhas }],
        };
      }
      const margem = t.margemBp === null ? '' : `, com margem de ${percentual(t.margemBp)}`;
      return {
        lead: `${formatarBRL(t.faturamento)} em ${emPedidos(t.pedidos)} ${quando}, somando as lojas${margem}.`,
        complemento: comparacao(t.faturamento, a.faturamento, emReais, antes),
        secoes: [{ titulo: null, linhas }],
        notas: [],
        acao: null,
      };
    }
  }
}

// ─── Mais vendidos ───────────────────────────────────────────────────────────

const SEM_PRODUTO = 'Sem produto do catálogo';

function nomeDoProduto(p: MaisVendido): string {
  if (p.skuId === null) return SEM_PRODUTO;
  return p.titulo ?? 'Produto sem nome';
}

function linhaDoProduto(p: MaisVendido, loja: Plataforma | null): LinhaDaResposta {
  const margem = p.margemBp === null ? 'sem custo' : `margem ${margemEmTexto(p.margemBp)}`;
  return {
    rotulo: nomeDoProduto(p),
    valor: formatarBRL(p.faturamento),
    nota: `${emPedidos(p.pedidos)} · ${margem}`,
    loja,
  };
}

function maisVendidos(
  lev: Extract<Levantamento, { readonly tipo: 'mais_vendidos' }>,
): Omit<Resposta, 'entendido'> {
  const quando = periodoNaFrase(lev.consulta.periodo, lev.janelas);
  const temSemProduto = lev.grupos.some((g) => g.produtos.some((p) => p.skuId === null));
  const notas = temSemProduto
    ? [
        `"${SEM_PRODUTO}" junta os pedidos que não casaram com nenhum produto cadastrado. Cadastre ou junte o produto no catálogo para ele aparecer pelo nome.`,
      ]
    : [];

  // O campeão é o do catálogo que mais faturou, em qualquer grupo. O balde dos pedidos
  // sem produto não é produto, e não lidera a frase.
  const candidatos = lev.grupos.flatMap((g: GrupoDeMaisVendidos) =>
    g.produtos.filter((p) => p.skuId !== null).map((p) => ({ p, loja: g.plataforma })),
  );
  const campeao = candidatos.reduce<(typeof candidatos)[number] | undefined>(
    (melhor, c) => (melhor === undefined || c.p.faturamento > melhor.p.faturamento ? c : melhor),
    undefined,
  );

  const umGrupo = lev.grupos.length === 1;
  const secoes: SecaoDaResposta[] = lev.grupos.map((g) => ({
    titulo: umGrupo || g.plataforma === null ? null : ROTULO_DA_PLATAFORMA[g.plataforma],
    linhas:
      g.produtos.length === 0
        ? [{ rotulo: 'Nenhuma venda no período', valor: '—', nota: null, loja: null }]
        : g.produtos.map((p) => linhaDoProduto(p, umGrupo ? null : g.plataforma)),
  }));

  const onde = ondeNaFrase(lev);
  const nenhumaVenda = lev.grupos.every((g) => g.produtos.length === 0);
  if (nenhumaVenda) {
    return {
      lead: `Nenhuma venda${onde} ${quando}.`,
      complemento: null,
      secoes: [],
      notas: [],
      acao: null,
    };
  }
  if (campeao === undefined) {
    return {
      lead: `Nenhum pedido${onde} ${quando} casou com produto do catálogo.`,
      complemento: null,
      secoes,
      notas,
      acao: { rotulo: 'Abrir o catálogo', href: CAMINHO_DO_CATALOGO },
    };
  }

  const emQualLoja = umGrupo || campeao.loja === null ? '' : `, ${naLoja(campeao.loja)}`;
  return {
    lead: `O que mais faturou${onde} ${quando} foi ${nomeDoProduto(campeao.p)}${emQualLoja}: ${formatarBRL(campeao.p.faturamento)} em ${emPedidos(campeao.p.pedidos)}.`,
    complemento: null,
    secoes,
    notas,
    acao: null,
  };
}

// ─── Fila e repasse ──────────────────────────────────────────────────────────

/** Quantos itens da fila a resposta lista: o começo, que é por onde se começa. */
export const ITENS_DA_FILA_NA_RESPOSTA = 5;

/** As urgências que a lista mostra: o que não pode esperar. */
const URGENCIAS_DE_AGORA: readonly Urgencia[] = ['sem_prazo', 'atrasado', 'hoje'];

function fila(
  lev: Extract<Levantamento, { readonly tipo: 'fila' }>,
  agora: Date,
  fuso: string,
): Omit<Resposta, 'entendido'> {
  const junta = juntarFilas(lev.porLoja.map((l) => l.fila));
  const secoes: SecaoDaResposta[] = [];

  if (lev.porLoja.length > 1) {
    secoes.push({
      titulo: 'Por loja',
      linhas: lev.porLoja.map(({ plataforma, fila: f }) => {
        const partes = [
          f.porUrgencia.atrasado > 0
            ? contagem(f.porUrgencia.atrasado, 'atrasado', 'atrasados')
            : '',
          f.porUrgencia.hoje > 0 ? `${String(f.porUrgencia.hoje)} para hoje` : '',
          f.porUrgencia.sem_prazo > 0 ? `${String(f.porUrgencia.sem_prazo)} sem prazo` : '',
        ].filter((p) => p !== '');
        return {
          rotulo: ROTULO_DA_PLATAFORMA[plataforma],
          valor: String(f.itens.length),
          nota:
            f.itens.length === 0
              ? f.jaPostados > 0
                ? 'tudo postado'
                : 'nada na fila'
              : partes.length === 0
                ? 'nada vence hoje'
                : partes.join(' · '),
          loja: plataforma,
        };
      }),
    });
  }

  const primeiros = junta.itens
    .filter((i) => URGENCIAS_DE_AGORA.includes(i.urgencia))
    .slice(0, ITENS_DA_FILA_NA_RESPOSTA);
  if (primeiros.length > 0) {
    secoes.push({
      titulo: 'Por onde começar',
      linhas: primeiros.map((i) => ({
        rotulo: i.tituloDoProduto ?? 'Produto sem cadastro',
        valor: ROTULO_DA_URGENCIA[i.urgencia],
        nota: `pedido ${i.idExterno}${i.qtd > 1 ? ` · ${String(i.qtd)} unidades` : ''}`,
        loja: lev.porLoja.length > 1 ? plataformaDoItem(i.plataforma) : null,
      })),
    });
  }

  // A fila vem dos pedidos gravados: loja por planilha só mostra o que já foi importado.
  const hoje = diaNoFuso(agora, fuso);
  const notas = lev.frescor.flatMap((f): readonly string[] =>
    f.estado.tipo === 'planilha' &&
    f.ultimoPedidoEm !== null &&
    diaNoFuso(f.ultimoPedidoEm, fuso) < hoje
      ? [
          `A fila ${daLoja(f.plataforma)} vem da planilha, que vai até ${diaEMes(f.ultimoPedidoEm, fuso)}: pedido feito depois disso ainda não aparece.`,
        ]
      : [],
  );

  const [unica] = lev.lojas;
  return {
    lead: resumoDaFila(junta),
    complemento: null,
    secoes,
    notas,
    acao:
      lev.lojas.length === 1 && unica !== undefined
        ? { rotulo: `Abrir os pedidos ${daLoja(unica)}`, href: caminhoDaAba(unica, 'pedidos') }
        : { rotulo: 'Abrir Postar hoje', href: CAMINHO_DA_POSTAGEM },
  };
}

/** A plataforma de um item da fila, que chega como texto do banco. */
function plataformaDoItem(valor: string): Plataforma | null {
  return ehPlataforma(valor) ? valor : null;
}

/** "R$ 12,40 a menos do que as taxas explicam". */
function sentidoDaDivergencia(soma: number): string {
  if (soma === 0) return 'que se compensam';
  return `${formatarBRL(centavos(Math.abs(soma)))} ${soma < 0 ? 'a menos' : 'a mais'} do que as taxas explicam`;
}

function repasse(
  lev: Extract<Levantamento, { readonly tipo: 'repasse' }>,
): Omit<Resposta, 'entendido'> {
  const todos = lev.porLoja.flatMap((l) =>
    l.divergentes.map((d) => ({ ...d, plataforma: l.plataforma })),
  );
  const soma = todos.reduce((s, d) => s + d.divergencia, 0);
  const onde = ondeNaFrase(lev);
  const nota =
    'Só entram os pedidos em que a loja informou o repasse, e que ninguém marcou como conferidos.';

  if (todos.length === 0) {
    return {
      lead: `Nenhum repasse diferente do esperado em aberto${onde}.`,
      complemento: null,
      secoes: [],
      notas: [nota],
      acao: null,
    };
  }

  const secoes: SecaoDaResposta[] = [];
  if (lev.porLoja.length > 1) {
    secoes.push({
      titulo: 'Por loja',
      linhas: lev.porLoja.map((l) => ({
        rotulo: ROTULO_DA_PLATAFORMA[l.plataforma],
        valor: String(l.divergentes.length),
        nota:
          l.divergentes.length === 0
            ? 'nada em aberto'
            : sentidoDaDivergencia(l.divergentes.reduce((s, d) => s + d.divergencia, 0)),
        loja: l.plataforma,
      })),
    });
  }
  secoes.push({
    titulo: 'Os maiores',
    linhas: [...todos]
      .sort((x, y) => Math.abs(y.divergencia) - Math.abs(x.divergencia))
      .slice(0, ITENS_DA_FILA_NA_RESPOSTA)
      .map((d) => ({
        rotulo: `Pedido ${d.idExterno}`,
        valor: `${d.divergencia < 0 ? '−' : '+'}${formatarBRL(centavos(Math.abs(d.divergencia)))}`,
        nota: d.divergencia < 0 ? 'a loja repassa menos' : 'a loja repassa mais',
        loja: lev.porLoja.length > 1 ? d.plataforma : null,
      })),
  });

  // A loja com mais divergência é onde conferir primeiro.
  const [maisDivergente] = [...lev.porLoja].sort(
    (x, y) => y.divergentes.length - x.divergentes.length,
  );
  return {
    lead: `${maiuscula(contagem(todos.length, 'pedido', 'pedidos'))} com repasse diferente do esperado${onde}, somando ${sentidoDaDivergencia(soma)}.`,
    complemento: null,
    secoes,
    notas: [nota],
    acao:
      maisDivergente === undefined
        ? null
        : {
            rotulo: `Conferir o repasse ${daLoja(maisDivergente.plataforma)}`,
            href: caminhoDaAba(maisDivergente.plataforma, 'repasse'),
          },
  };
}

// ─── A resposta ──────────────────────────────────────────────────────────────

/**
 * Escreve a resposta de um levantamento.
 *
 * `agora` é o mesmo do levantamento: a nota de "a fila vai até 22/09" compara com o dia
 * de hoje, e hoje tem de ser o mesmo dia da fila.
 */
export function redigirResposta(
  lev: Levantamento,
  agora: Date,
  fuso: string = FUSO_PADRAO,
): Resposta {
  const entendido = descreverConsulta(lev);

  switch (lev.tipo) {
    case 'painel': {
      const umaSo = !lev.consulta.porLoja && (ehDeTodas(lev.consulta) || lev.lojas.length === 1);
      const corpo = umaSo ? painelDeUm(lev) : painelPorLoja(lev);
      const frescor = notasDeFrescor(
        lev.frescor,
        ultimoDia(lev.janelas.atual),
        lev.lojas.length === 1,
        fuso,
      );
      return {
        entendido,
        ...corpo,
        notas: [...frescor, ...corpo.notas],
        acao: corpo.acao ?? acaoDeImportar(lev),
      };
    }
    case 'mais_vendidos': {
      const corpo = maisVendidos(lev);
      const frescor = notasDeFrescor(
        lev.frescor,
        ultimoDia(lev.janelas.atual),
        lev.lojas.length === 1,
        fuso,
      );
      return {
        entendido,
        ...corpo,
        notas: [...frescor, ...corpo.notas],
        acao: corpo.acao ?? acaoDeImportar(lev),
      };
    }
    case 'fila':
      return { entendido, ...fila(lev, agora, fuso) };
    case 'repasse':
      return { entendido, ...repasse(lev) };
  }
}
