/**
 * O leitor de página do garimpo (M6, ferramenta `ler_pagina`).
 *
 * Abre o endereço que uma busca apontou e tira dele o que responde às perguntas do
 * dossiê — sem IA, pela forma das coisas (`pagina.ts`):
 *
 * - **preço** → "onde é mais barato", do dado estruturado da loja, ou do texto;
 * - **quem vende e a que preço** → "quem já vende";
 * - **CNPJ** com dígito verificador → vira item de `cnpj`, que confere se a empresa
 *   existe, está ativa e é atacadista;
 * - **códigos de modelo** que a página cita além dos do alvo → "em que mais serve",
 *   como candidato a confirmar, igual à base local.
 *
 * Uma página responde a mais de uma pergunta, e o achado leva a família que responde —
 * e não a do item que mandou ler. É por isso que a busca pede cada página uma vez só.
 *
 * ## Página que não abre não derruba o dossiê
 *
 * 404, tempo esgotado, endereço que não é página: o passo acontece, sem achado, e o
 * dossiê segue. É diferente do buscador fora do ar — lá nada funciona, e o job espera;
 * aqui é uma página entre muitas, e esperar por ela seria parar o dossiê por um link.
 */
import { codigosDeModelo } from '@/dominio/identidade/canonico';
import { ZERO, formatarBRL } from '@/lib/dinheiro';
import { itemDaFamilia, type Achado, type ItemDaFronteira } from '../fronteira';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';
import {
  cnpjsNoTexto,
  ofertasDaPagina,
  precosNoTexto,
  textoVisivel,
  tituloDaPagina,
  type OfertaDaPagina,
} from './pagina';
import { FalhaDeRede, lerTexto, type OpcoesDaRede } from './rede';

/** Quantos códigos novos uma página pode sugerir. Como na base local: seis. */
export const CODIGOS_POR_PAGINA = 6;

/** CNPJs por página que viram item de conferência. Rodapé de loja cita dois, no máximo. */
export const CNPJS_POR_PAGINA = 3;

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function semParametros(url: string): string {
  return (url.split('#')[0] ?? url).split('?')[0] ?? url;
}

/** A oferta com preço mais baixo, ou a primeira quando nenhuma tem preço. */
function melhorOferta(ofertas: readonly OfertaDaPagina[]): OfertaDaPagina | null {
  const comPreco = ofertas.filter(
    (o) => o.preco !== null && (o.moeda === null || o.moeda === 'BRL'),
  );
  if (comPreco.length > 0) {
    return comPreco.reduce((a, b) => ((b.preco ?? 0) < (a.preco ?? 0) ? b : a));
  }
  return ofertas[0] ?? null;
}

export interface OpcoesDoLeitor extends OpcoesDaRede {
  readonly agora?: (() => Date) | undefined;
}

export class InvestigadorDePagina implements Investigador {
  readonly ferramenta = 'ler_pagina' as const;

  constructor(private readonly opcoes: OpcoesDoLeitor = {}) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    let url: string;
    let html: string;
    try {
      const resposta = await lerTexto(pedido.item.alvo, this.opcoes);
      const tipo = resposta.tipo ?? 'text/html';
      if (resposta.status >= 400 || !/html|xml|text\/plain/i.test(tipo)) {
        return { achados: [], custoCentavos: ZERO };
      }
      url = resposta.url;
      html = resposta.texto;
    } catch (erro) {
      if (erro instanceof FalhaDeRede) return { achados: [], custoCentavos: ZERO };
      throw erro;
    }

    const agora = (this.opcoes.agora?.() ?? new Date()).toISOString();
    const onde = dominio(url);
    const titulo = tituloDaPagina(html) ?? onde;
    const texto = textoVisivel(html);
    const achados: Achado[] = [];
    const fronteira: ItemDaFronteira[] = [];

    // Preço e quem vende: do dado estruturado primeiro, do texto depois.
    const oferta = melhorOferta(ofertasDaPagina(html));
    const precoEstruturado = oferta?.preco ?? null;
    const preco = precoEstruturado ?? precosNoTexto(texto)[0] ?? null;
    const nome = oferta?.nome ?? titulo;
    if (preco !== null) {
      const deOnde = precoEstruturado === null ? ' (preço lido do texto da página)' : '';
      const disponibilidade = oferta?.disponibilidade ?? null;
      const estoque = disponibilidade === null ? '' : `, ${disponibilidade}`;
      const marca = oferta?.marca ?? null;
      const gtin = oferta?.gtin ?? null;
      achados.push({
        id: `onde_e_mais_barato:${semParametros(url).slice(0, 200)}`,
        familia: 'onde_e_mais_barato',
        oQue: `${formatarBRL(preco)} em ${onde}${estoque}: ${nome}${deOnde}.`,
        origemUrl: url,
        achadoEm: agora,
      });
      const quem = oferta?.vendedor ?? onde;
      achados.push({
        id: `quem_ja_vende:${semParametros(url).slice(0, 200)}`,
        familia: 'quem_ja_vende',
        oQue: `${quem} vende "${nome}" por ${formatarBRL(preco)}${marca === null ? '' : ` — marca ${marca}`}${gtin === null ? '' : `, GTIN ${gtin}`}.`,
        origemUrl: url,
        achadoEm: agora,
      });
    }

    // CNPJ citado na página: quem é, de verdade, se confere na consulta à Receita.
    for (const cnpj of cnpjsNoTexto(texto).slice(0, CNPJS_POR_PAGINA)) {
      fronteira.push(
        itemDaFamilia({
          id: `cnpj:${cnpj}`,
          familia: pedido.item.familia === 'quem_fabrica' ? 'quem_fabrica' : 'quem_distribui',
          alvo: cnpj,
          ferramenta: 'cnpj',
        }),
      );
    }

    // Códigos que a página cita além dos do alvo: candidatos a compatível.
    const doAlvo = new Set(codigosDeModelo(pedido.alvoDoDossie));
    if (doAlvo.size > 0) {
      const citados = codigosDeModelo(`${titulo} ${texto.slice(0, 20_000)}`);
      if (citados.some((c) => doAlvo.has(c))) {
        for (const codigo of citados.filter((c) => !doAlvo.has(c)).slice(0, CODIGOS_POR_PAGINA)) {
          achados.push({
            id: `em_que_mais_serve:${codigo}`,
            familia: 'em_que_mais_serve',
            oQue: `${codigo} é citado junto com o alvo em ${onde}. Candidato a compatível, a confirmar com segunda fonte.`,
            origemUrl: url,
            achadoEm: agora,
          });
        }
      }
    }

    return { achados, fronteira, custoCentavos: ZERO };
  }
}
