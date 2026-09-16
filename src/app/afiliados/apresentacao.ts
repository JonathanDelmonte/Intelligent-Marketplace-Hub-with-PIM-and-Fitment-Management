/**
 * O que a tela de afiliados diz. Funções puras, com teste.
 *
 * As regras — teto de oito por dia, espaçamento de 45 minutos, conversão nula sem
 * clique — são do domínio. O que mora aqui é o texto da decisão e a leitura do
 * formulário: preço digitado, URL, e o desconto contra a referência.
 */
import type { Desempenho, DecisaoDePublicacao } from '@/dominio/afiliados/publicacao';
import { OFERTAS_POR_DIA } from '@/dominio/afiliados/publicacao';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import {
  centavos,
  formatarPontosBase,
  lerReaisDigitados,
  pontosBase,
  proporcaoEmPontosBase,
  type Centavos,
  type PontosBase,
} from '@/lib/dinheiro';

export { ROTULO_DA_PLATAFORMA };

/** Qual variável de ambiente carrega a tag de cada plataforma. */
export const VARIAVEL_DA_TAG: Readonly<Record<Plataforma, string>> = {
  ml: 'AFILIADO_TAG_ML',
  shopee: 'AFILIADO_TAG_SHOPEE',
  amazon: 'AFILIADO_TAG_AMAZON',
};

/** A tag de cada plataforma: o texto configurado, ou `null` quando não há. */
export type TagsDeAfiliado = Readonly<Record<Plataforma, string | null>>;

/**
 * As tags do ambiente, normalizadas.
 *
 * O parâmetro é a forma do ambiente, e não o tipo `Ambiente`: assim o teste passa três
 * campos em vez de montar uma configuração inteira com chave mestra e banco.
 *
 * Tag em branco conta como ausente. `AFILIADO_TAG_ML=""` no `.env` é o jeito mais
 * comum de "ainda não configurei", e gerar link com tag vazia seria pior que recusar —
 * o link sairia parecendo de afiliado sem pagar comissão nenhuma.
 */
export function tagsDoAmbiente(ambiente: {
  readonly AFILIADO_TAG_ML?: string | undefined;
  readonly AFILIADO_TAG_SHOPEE?: string | undefined;
  readonly AFILIADO_TAG_AMAZON?: string | undefined;
}): TagsDeAfiliado {
  return {
    ml: naoVazia(ambiente.AFILIADO_TAG_ML),
    shopee: naoVazia(ambiente.AFILIADO_TAG_SHOPEE),
    amazon: naoVazia(ambiente.AFILIADO_TAG_AMAZON),
  };
}

function naoVazia(valor: string | undefined): string | null {
  const limpa = (valor ?? '').trim();
  return limpa === '' ? null : limpa;
}

/** As plataformas que têm tag configurada, na ordem de `PLATAFORMAS`. */
export function plataformasComTag(tags: TagsDeAfiliado): readonly Plataforma[] {
  return PLATAFORMAS.filter((p) => tags[p] !== null);
}

/** As que não têm. É o que a tela precisa nomear para a configuração ser possível. */
export function plataformasSemTag(tags: TagsDeAfiliado): readonly Plataforma[] {
  return PLATAFORMAS.filter((p) => tags[p] === null);
}

/**
 * O desconto da oferta contra a referência.
 *
 * `null` quando não há referência: sem ela não existe desconto, e chamar de zero
 * afirmaria que o preço está no nível da referência — que é outra coisa.
 */
export function descontoContra(preco: Centavos, referencia: Centavos | null): PontosBase | null {
  if (referencia === null || referencia <= 0) return null;
  if (preco >= referencia) return pontosBase(0);
  return proporcaoEmPontosBase(centavos(referencia - preco), referencia, 'baixo');
}

export interface EtiquetaDoDesconto {
  readonly texto: string;
  readonly tom: 'ok' | 'atencao' | 'neutro';
}

/**
 * A etiqueta de desconto de uma oferta da fila.
 *
 * Três estados, e não dois: com desconto, sem desconto medido, e **sem referência**. O
 * último é o que costuma sumir da tela — uma oferta sem mediana mostraria "0%", e isso
 * afirma que o preço está no nível do mercado quando ninguém mediu nada.
 */
export function etiquetaDoDesconto(oferta: {
  readonly scoreDescontoBp: PontosBase;
  readonly medianaNoventaDias: Centavos | null;
}): EtiquetaDoDesconto {
  if (oferta.medianaNoventaDias === null) {
    return { texto: 'sem referência', tom: 'neutro' };
  }
  if (oferta.scoreDescontoBp <= 0) {
    return { texto: 'sem desconto', tom: 'atencao' };
  }
  return { texto: `${formatarPontosBase(oferta.scoreDescontoBp, 0)} abaixo`, tom: 'ok' };
}

export interface TextoDaDecisao {
  readonly titulo: string;
  readonly corpo: string;
  readonly tom: 'ok' | 'atencao' | 'neutro';
}

/**
 * A decisão de publicar, em texto.
 *
 * "Esperar" não é erro e não é falha: é o teto e o espaçamento fazendo o trabalho de
 * impedir que oito ofertas saiam em dez minutos e o grupo silencie todo mundo.
 */
export function textoDaDecisao(decisao: DecisaoDePublicacao): TextoDaDecisao {
  switch (decisao.tipo) {
    case 'publicar':
      return {
        tom: 'ok',
        titulo: 'Dá para publicar agora.',
        corpo: `É a de maior desconto na fila. O teto é de ${String(OFERTAS_POR_DIA)} por dia, e a próxima espera o intervalo mínimo.`,
      };
    case 'esperar':
      return {
        tom: 'atencao',
        titulo:
          decisao.minutosRestantes > 0
            ? `Esperar ${String(decisao.minutosRestantes)} ${decisao.minutosRestantes === 1 ? 'minuto' : 'minutos'}.`
            : 'Esperar.',
        corpo: decisao.motivo,
      };
    case 'nada_na_fila':
      return {
        tom: 'neutro',
        titulo: 'Nada na fila.',
        corpo:
          'Acrescente uma oferta abaixo. O desconto é medido contra a referência que você informar — sem referência não há desconto para ordenar.',
      };
  }
}

/**
 * A frase do alto da tela: só os números.
 *
 * A leitura deles — clique sem venda é texto de post, venda nenhuma é oferta — fica
 * junto do painel, e não aqui. Explicação longe do número é explicação que ninguém
 * associa ao número, e repetida nos dois lugares é a mesma frase divergindo depois.
 */
export function resumoDaFila(params: {
  readonly pendentes: number;
  readonly desempenho: Desempenho;
}): string {
  const { pendentes, desempenho } = params;

  if (pendentes === 0 && desempenho.publicadas === 0) {
    return 'Nenhuma oferta na fila. O desconto é medido contra a mediana de 90 dias — o monitor de preço é onde essa mediana aparece.';
  }

  const fila =
    pendentes === 0
      ? 'Nada esperando publicação'
      : `${String(pendentes)} ${pendentes === 1 ? 'oferta espera' : 'ofertas esperam'} publicação`;

  if (desempenho.publicadas === 0) {
    return `${fila}, e nenhuma saiu ainda.`;
  }

  const saiu = desempenho.publicadas === 1 ? 'saiu' : 'saíram';
  const cliques = desempenho.cliques === 1 ? '1 clique' : `${String(desempenho.cliques)} cliques`;

  return `${fila}. ${String(desempenho.publicadas)} já ${saiu}, com ${cliques}.`;
}

/** Preço digitado em reais, ou `null`. A mesma leitura das outras telas. */
export function lerPreco(bruto: string): Centavos | null {
  return lerReaisDigitados(bruto);
}

export const CODIGOS_DE_AVISO = [
  'gravada',
  'publicada',
  'ja_publicada',
  'desempenho',
  'sem_tag',
  'url_invalida',
  'preco_invalido',
  'numero_invalido',
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
    case 'gravada':
      return {
        tom: 'ok',
        titulo: 'Oferta na fila.',
        corpo: 'O link já saiu com a sua tag. A ordem é por desconto real decrescente.',
      };
    case 'publicada':
      return {
        tom: 'ok',
        titulo: 'Marcada como publicada.',
        corpo:
          'A hora ficou gravada, e é dela que sai o intervalo até a próxima. Marcar de novo não a reescreve.',
      };
    case 'ja_publicada':
      return {
        tom: 'atencao',
        titulo: 'Essa já estava publicada.',
        corpo: 'Nada mudou. A hora da primeira publicação é a que vale.',
      };
    case 'desempenho':
      return {
        tom: 'ok',
        titulo: 'Desempenho informado.',
        corpo:
          'Os números substituem os anteriores, porque o painel de afiliado mostra o total acumulado.',
      };
    case 'sem_tag':
      return {
        tom: 'erro',
        titulo: 'Sem tag de afiliado para essa plataforma.',
        corpo:
          'Nada foi gravado. Link sem tag é link comum, e publicar um deles é trabalho que não paga comissão — configure a variável de ambiente da plataforma.',
      };
    case 'url_invalida':
      return {
        tom: 'erro',
        titulo: 'Essa URL não serve.',
        corpo: 'Precisa ser um endereço http ou https do anúncio. Nada foi gravado.',
      };
    case 'preco_invalido':
      return {
        tom: 'erro',
        titulo: 'Preço fora de forma.',
        corpo: 'Use um valor como 49,90. Nada foi gravado.',
      };
    case 'numero_invalido':
      return {
        tom: 'erro',
        titulo: 'Esses números não fecham.',
        corpo:
          'Clique e conversão são inteiros não negativos, e conversão não passa de clique — ninguém compra sem clicar. Nada foi alterado.',
      };
    case 'falha':
      return { tom: 'erro', titulo: 'Não deu.', corpo: 'Nada foi gravado. O erro está no log.' };
  }
}
