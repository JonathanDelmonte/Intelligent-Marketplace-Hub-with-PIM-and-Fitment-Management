/**
 * O que a área de uma loja diz, a partir do que foi lido (ADR 0009).
 *
 * Funções puras, com teste: "margem de 23%", "11% a mais que os 30 dias anteriores" e
 * "3 pedidos atrasados" são afirmações sobre dinheiro, e afirmação desse tipo dentro de
 * JSX não tem teste.
 *
 * Nada aqui pergunta o nome da loja. O texto de cada capacidade vem do estado que o
 * adaptador declarou, e a frase de como conectar vem do próprio adaptador.
 */
import { variacaoBp, type Painel, type PontoDaSerie } from '@/dominio/lojas/painel';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { formatarBRL, formatarPontosBase, pontosBase, type PontosBase } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import type { MapaDeCapacidades } from '@/plataformas/adaptador';
import {
  CAPACIDADES,
  ROTULO_DA_CAPACIDADE,
  motivoDeIndisponibilidade,
  type Capacidade,
  type ModoAcesso,
} from '@/plataformas/capacidades';
import { caminhoDaAba, type AbaDaLoja } from './caminhos';

export const ROTULO_DA_ABA: Readonly<Record<AbaDaLoja, string>> = {
  resumo: 'Resumo',
  pedidos: 'Pedidos',
  anuncios: 'Anúncios',
  perguntas: 'Perguntas',
  repasse: 'Repasse',
  conexao: 'Conexão',
};

/** `2026-09-24` → `24/09`. */
export function diaCurto(dia: string): string {
  const [, mes = '', d = ''] = dia.split('-');
  return `${d}/${mes}`;
}

/**
 * A frase embaixo do gráfico: o melhor dia e quantos ficaram sem venda.
 *
 * É o que o gráfico diz em palavras — para quem não enxerga barra, e para quem enxerga
 * e quer o número exato do pico sem passar o mouse.
 */
export function resumoDaSerie(serie: readonly PontoDaSerie[]): string {
  const comVenda = serie.filter((p) => p.pedidos > 0);
  if (comVenda.length === 0) return 'Nenhuma venda nestes dias.';

  const melhor = comVenda.reduce((a, b) => (b.faturamento > a.faturamento ? b : a));
  const semVenda = serie.length - comVenda.length;
  const pico = `Melhor dia: ${diaCurto(melhor.dia)}, ${formatarBRL(melhor.faturamento)}.`;
  return semVenda === 0
    ? `${pico} Todos os dias tiveram venda.`
    : `${pico} ${contagem(semVenda, 'dia sem venda', 'dias sem venda')}.`;
}

// ─── Os números do alto ──────────────────────────────────────────────────────

export interface NumeroNaTela {
  readonly rotulo: string;
  readonly valor: string;
  readonly nota: string;
  /** `alta` e `baixa` só na variação do faturamento; o resto é neutro. */
  readonly tom: 'alta' | 'baixa' | 'neutro';
}

/** Percentual como se lê: "23%", "−3%". O menos é o sinal tipográfico, não o hífen. */
function percentual(bp: PontosBase): string {
  return formatarPontosBase(bp, 0).replace('-', '−');
}

/** A margem como se lê, ou um traço quando não há como saber. */
export function margemEmTexto(margemBp: PontosBase | null): string {
  return margemBp === null ? '—' : percentual(margemBp);
}

/** "+11% sobre os 30 dias anteriores", ou o que dizer quando não há base. */
export function variacaoEmTexto(atual: number, anterior: number, dias: number): string {
  const bp = variacaoBp(atual, anterior);
  if (bp === null) {
    return atual === 0
      ? `sem venda nos ${String(dias)} dias anteriores`
      : `nenhuma venda nos ${String(dias)} dias anteriores`;
  }
  if (bp === 0) return `igual aos ${String(dias)} dias anteriores`;
  const sinal = bp > 0 ? '+' : '−';
  return `${sinal}${percentual(pontosBase(Math.abs(bp)))} sobre os ${String(dias)} dias anteriores`;
}

/**
 * Os quatro números do alto da área da loja — e da visão geral, com todas somadas.
 *
 * Faturamento, pedidos, margem e repasse. A margem diz quantos pedidos ficaram de fora
 * por falta de custo, porque "23%" sobre metade dos pedidos é outra afirmação que "23%".
 */
export function numerosDoPainel(
  atual: Painel,
  anterior: Painel,
  dias: number,
): readonly NumeroNaTela[] {
  const bp = variacaoBp(atual.faturamento, anterior.faturamento);
  const margemNota =
    atual.pedidos === 0
      ? 'sem pedido na janela'
      : atual.pedidosSemMargem === 0
        ? 'depois das taxas da loja e do custo'
        : atual.pedidosSemMargem === atual.pedidos
          ? 'nenhum pedido tem custo: informe no catálogo'
          : `${contagem(atual.pedidosSemMargem, 'pedido sem custo ficou', 'pedidos sem custo ficaram')} de fora`;

  return [
    {
      rotulo: 'Faturamento',
      valor: formatarBRL(atual.faturamento),
      nota: variacaoEmTexto(atual.faturamento, anterior.faturamento, dias),
      tom: bp === null || bp === 0 ? 'neutro' : bp > 0 ? 'alta' : 'baixa',
    },
    {
      rotulo: 'Pedidos',
      valor: String(atual.pedidos),
      nota:
        atual.ticketMedio === null
          ? 'nenhum na janela'
          : `ticket médio ${formatarBRL(atual.ticketMedio)}`,
      tom: 'neutro',
    },
    { rotulo: 'Margem', valor: margemEmTexto(atual.margemBp), nota: margemNota, tom: 'neutro' },
    {
      rotulo: 'Repasse informado',
      valor: formatarBRL(atual.repasse),
      nota:
        atual.repasse === 0 && atual.pedidos > 0
          ? 'a planilha não trouxe o repasse'
          : 'o que a loja disse que vai pagar',
      tom: 'neutro',
    },
  ];
}

// ─── O que precisa de você nesta loja ────────────────────────────────────────

export interface LeiturasDaLoja {
  readonly postagem: {
    readonly atrasados: number;
    readonly hoje: number;
    readonly semPrazo: number;
  };
  readonly divergenciasDeRepasse: number;
  readonly pedidosSemCusto: number;
  readonly duvidasRecorrentes: number;
}

export interface PendenciaDaLoja {
  readonly chave: string;
  readonly texto: string;
  readonly acao: string;
  readonly href: string;
  readonly tom: 'agora' | 'atencao';
}

/**
 * O que esta loja pede de você, do mais urgente ao menos.
 *
 * Só entra o que tem trabalho: linha com zero não é pendência, e lista de zeros treina a
 * pessoa a não ler a lista. Vazia, a tela diz que não há nada esperando.
 */
export function pendenciasDaLoja(
  plataforma: Plataforma,
  leituras: LeiturasDaLoja,
): readonly PendenciaDaLoja[] {
  const itens: PendenciaDaLoja[] = [];
  const { atrasados, hoje, semPrazo } = leituras.postagem;

  const urgentes = atrasados + semPrazo;
  if (urgentes + hoje > 0) {
    const partes: string[] = [];
    if (atrasados > 0) partes.push(contagem(atrasados, 'atrasado', 'atrasados'));
    if (semPrazo > 0) partes.push(`${String(semPrazo)} sem prazo conhecido`);
    if (hoje > 0) partes.push(`${String(hoje)} para hoje`);
    itens.push({
      chave: 'postagem',
      texto: `${contagem(urgentes + hoje, 'pedido para postar', 'pedidos para postar')}: ${partes.join(', ')}.`,
      acao: 'Ver pedidos',
      href: caminhoDaAba(plataforma, 'pedidos'),
      tom: urgentes > 0 ? 'agora' : 'atencao',
    });
  }

  if (leituras.divergenciasDeRepasse > 0) {
    itens.push({
      chave: 'repasse',
      texto: `${contagem(leituras.divergenciasDeRepasse, 'repasse veio', 'repasses vieram')} diferente do que as taxas explicam.`,
      acao: 'Conferir',
      href: caminhoDaAba(plataforma, 'repasse'),
      tom: 'atencao',
    });
  }

  if (leituras.duvidasRecorrentes > 0) {
    itens.push({
      chave: 'perguntas',
      texto: `${contagem(leituras.duvidasRecorrentes, 'dúvida se repete', 'dúvidas se repetem')}: o anúncio pede conserto.`,
      acao: 'Ver perguntas',
      href: caminhoDaAba(plataforma, 'perguntas'),
      tom: 'atencao',
    });
  }

  if (leituras.pedidosSemCusto > 0) {
    itens.push({
      chave: 'custo',
      texto: `${contagem(leituras.pedidosSemCusto, 'pedido sem custo', 'pedidos sem custo')} na janela: a margem deles não sai.`,
      acao: 'Informar custo',
      href: '/catalogo',
      tom: 'atencao',
    });
  }

  return itens;
}

// ─── O catálogo visto de uma loja ────────────────────────────────────────────

/** O que o produto precisa ter para virar anúncio. */
export interface ProntidaoDoProduto {
  readonly temCusto: boolean;
  readonly temEan: boolean;
  readonly compatibilidadesPublicaveis: number;
}

/**
 * O que falta para anunciar o produto, em palavras. Vazio é pronto.
 *
 * Custo vem primeiro porque sem ele não sai preço — e sem preço não há anúncio que não
 * seja chute. Código de barras e onde serve vêm depois: o anúncio sai sem eles, e sai
 * pior.
 */
export function faltasDoProduto(produto: ProntidaoDoProduto): readonly string[] {
  const faltas: string[] = [];
  if (!produto.temCusto) faltas.push('custo');
  if (!produto.temEan) faltas.push('código de barras');
  if (produto.compatibilidadesPublicaveis === 0) faltas.push('onde serve');
  return faltas;
}

// ─── O que a loja libera ─────────────────────────────────────────────────────

export const SITUACOES = [
  'funciona',
  'previsto',
  'sem_conexao',
  'nao_oferece',
  'bloqueado',
] as const;
export type Situacao = (typeof SITUACOES)[number];

export const ROTULO_DA_SITUACAO: Readonly<Record<Situacao, string>> = {
  funciona: 'Funciona',
  previsto: 'Previsto',
  sem_conexao: 'Sem conexão',
  nao_oferece: 'Não oferece',
  bloqueado: 'Bloqueado',
};

/** Por onde cada modo de acesso chega, em palavras de quem vende. */
const POR_ONDE: Readonly<Record<ModoAcesso, string>> = {
  m0_link: 'pelo link público do anúncio',
  m1_planilha: 'pela planilha do painel da loja',
  m2_publico: 'pela página pública',
  m3_api: 'pela API oficial',
};

export interface CapacidadeNaTela {
  readonly capacidade: Capacidade;
  readonly rotulo: string;
  readonly como: string;
  readonly situacao: Situacao;
}

/** A primeira letra em maiúscula, para rótulo de capacidade que vem em caixa baixa. */
function frase(texto: string): string {
  return texto.length === 0
    ? texto
    : `${texto[0]?.toLocaleUpperCase('pt-BR') ?? ''}${texto.slice(1)}`;
}

/**
 * Cada capacidade da loja, com o estado dela em palavras.
 *
 * "Previsto" é o estado de tudo que a matriz declarou e a sonda ainda não conferiu —
 * dizer "funciona" aí seria confundir expectativa com fato, que é exatamente o que o
 * estado `presumido` existe para impedir.
 */
export function capacidadesNaTela(mapa: MapaDeCapacidades): readonly CapacidadeNaTela[] {
  return CAPACIDADES.map((capacidade) => {
    const estado = mapa[capacidade];
    const rotulo = frase(ROTULO_DA_CAPACIDADE[capacidade]);
    switch (estado.tipo) {
      case 'disponivel':
        return { capacidade, rotulo, como: frase(estado.rotulo), situacao: 'funciona' };
      case 'presumido':
        return {
          capacidade,
          rotulo,
          como: `${frase(POR_ONDE[estado.modo])} — ainda não conferido`,
          situacao: 'previsto',
        };
      case 'sem_credencial':
        return {
          capacidade,
          rotulo,
          como: frase(motivoDeIndisponibilidade(estado) ?? ''),
          situacao: 'sem_conexao',
        };
      case 'inexistente':
        return {
          capacidade,
          rotulo,
          como: frase(motivoDeIndisponibilidade(estado) ?? ''),
          situacao: 'nao_oferece',
        };
      case 'bloqueado':
        return {
          capacidade,
          rotulo,
          como: frase(motivoDeIndisponibilidade(estado) ?? ''),
          situacao: 'bloqueado',
        };
    }
  });
}
