/**
 * O buscador do garimpo (M6, ferramenta `busca_web`): a versão HTML do DuckDuckGo.
 *
 * Gratuito e sem chave (CLAUDE.md, 3.7): a versão HTML devolve os resultados em
 * marcação simples, sem JavaScript, e cada resultado traz o endereço real dentro do
 * parâmetro `uddg`. Buscador com API oficial pede chave e cobra; este não.
 *
 * ## O que uma busca rende
 *
 * - **Achado**, quando o resultado já responde à pergunta da família: um distribuidor
 *   que se diz distribuidor, uma loja com preço no trecho, um fabricante. Com o
 *   endereço do resultado como fonte.
 * - **Ramificação**, sempre: as três primeiras páginas viram itens de `ler_pagina`, que
 *   é onde o preço, o CNPJ e o dado estruturado estão. E CNPJ que aparece no trecho vira
 *   item de `cnpj`, para conferir se o distribuidor existe e está ativo.
 *
 * ## Quando o buscador recusa
 *
 * O DuckDuckGo responde 202 quando acha que há pedido demais, e às vezes devolve a
 * página de confirmação de robô. As duas viram `FalhaDeRede`: o passo não aconteceu, e
 * o job do garimpo é reagendado — "não consegui procurar" não é "procurei e não achei",
 * e contar como passo sem achado levaria o dossiê a parar por saturação sem ter olhado.
 */
import { ZERO, formatarBRL } from '@/lib/dinheiro';
import { itemDaFamilia, type Achado, type ItemDaFronteira } from '../fronteira';
import type { FamiliaDeHipotese } from '../hipoteses';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';
import { cnpjsNoTexto, precosNoTexto } from '@/dominio/web/pagina';
import { buscarNaWeb, type OpcoesDoBuscador, type ResultadoDeBusca } from '@/dominio/web/buscador';

/** Páginas que uma busca manda ler. Três: o resto da primeira página raramente muda o dossiê. */
export const PAGINAS_PARA_LER = 3;

/** Achados por passo, como na base local: um passo com quarenta achados é ilegível. */
export const ACHADOS_POR_BUSCA = 6;

/**
 * O que se busca para cada pergunta.
 *
 * Palavra de quem vende, e não de quem compra: "distribuidor atacado" acha o
 * distribuidor, "comprar" acha a loja.
 */
export const CONSULTA_DA_FAMILIA: Readonly<Record<FamiliaDeHipotese, (alvo: string) => string>> = {
  onde_e_mais_barato: (a) => `${a} preço`,
  quem_distribui: (a) => `${a} distribuidor atacado`,
  quem_fabrica: (a) => `${a} fabricante`,
  que_outras_pecas: (a) => `${a} peças de reposição`,
  em_que_mais_serve: (a) => `${a} compatível com`,
  quem_ja_vende: (a) => `${a} comprar`,
  demanda_publica: (a) => `${a} pregão licitação`,
};

/**
 * O que faz um resultado de busca já ser resposta, por família.
 *
 * Família sem sinal aqui não vira achado na busca: a resposta dela está na página, e a
 * busca só ramifica.
 */
const SINAL: Partial<Record<FamiliaDeHipotese, RegExp>> = {
  quem_distribui: /distribuidor|distribuidora|atacad|revenda autorizada/i,
  quem_fabrica: /fabricante|fabricad|ind[uú]stria|manufatur/i,
  quem_ja_vende: /mercado ?livre|shopee|amazon|magalu|magazine luiza|americanas|casas bahia|loja/i,
};

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Id estável de um achado de busca: a mesma página, na mesma família, é o mesmo achado. */
function idDoAchado(familia: FamiliaDeHipotese, url: string): string {
  const semParametros = url.split('?')[0] ?? url;
  return `${familia}:busca:${semParametros.slice(0, 160)}`;
}

/** O que o resultado responde, em uma frase — ou `null` quando ele só ramifica. */
function oQueORespondeu(familia: FamiliaDeHipotese, resultado: ResultadoDeBusca): string | null {
  const texto = `${resultado.titulo} ${resultado.trecho}`;
  const onde = dominio(resultado.url);

  if (familia === 'onde_e_mais_barato') {
    const precos = precosNoTexto(texto);
    if (precos.length === 0) return null;
    const menor = precos.reduce((a, b) => (b < a ? b : a));
    return `${formatarBRL(menor)} em ${onde}: ${resultado.titulo}. Preço do trecho da busca — a página confirma.`;
  }

  const sinal = SINAL[familia];
  if (sinal === undefined || !sinal.test(texto)) return null;
  return `${resultado.titulo} (${onde})${resultado.trecho === '' ? '' : ` — ${resultado.trecho.slice(0, 160)}`}`;
}

export interface OpcoesDaBuscaWeb extends OpcoesDoBuscador {
  readonly agora?: (() => Date) | undefined;
}

export class InvestigadorDeBuscaWeb implements Investigador {
  readonly ferramenta = 'busca_web' as const;

  constructor(private readonly opcoes: OpcoesDaBuscaWeb = {}) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    const familia = pedido.item.familia;
    const consulta = CONSULTA_DA_FAMILIA[familia](pedido.item.alvo);
    const resultados = await buscarNaWeb(consulta, this.opcoes);

    const agora = (this.opcoes.agora?.() ?? new Date()).toISOString();
    const achados: Achado[] = [];
    for (const resultado of resultados) {
      const oQue = oQueORespondeu(familia, resultado);
      if (oQue === null) continue;
      achados.push({
        id: idDoAchado(familia, resultado.url),
        familia,
        oQue,
        origemUrl: resultado.url,
        achadoEm: agora,
      });
      if (achados.length >= ACHADOS_POR_BUSCA) break;
    }

    // Ramificação: ler as primeiras páginas, e conferir CNPJ que já apareceu no trecho.
    // O id é pelo endereço, e não pela família: a mesma página achada por duas buscas é
    // lida uma vez só — e a leitura responde a todas as famílias que a página responder.
    const fronteira: ItemDaFronteira[] = resultados.slice(0, PAGINAS_PARA_LER).map((r) =>
      itemDaFamilia({
        id: `ler:${r.url.slice(0, 300)}`,
        familia,
        alvo: r.url,
        ferramenta: 'ler_pagina',
        ajusteDeValor: -5,
      }),
    );
    for (const resultado of resultados) {
      for (const cnpj of cnpjsNoTexto(`${resultado.titulo} ${resultado.trecho}`)) {
        fronteira.push(
          itemDaFamilia({
            id: `cnpj:${cnpj}`,
            familia,
            alvo: cnpj,
            ferramenta: 'cnpj',
            ajusteDeValor: -5,
          }),
        );
      }
    }

    return { achados, fronteira, custoCentavos: ZERO };
  }
}
