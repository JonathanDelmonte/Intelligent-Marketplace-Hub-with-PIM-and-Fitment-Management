/**
 * A conferência do fornecedor (M5, etapa 7.3): o CNPJ na Receita, e a vitrine.
 *
 * A especificação: "dado o nome e o CNPJ do fornecedor, procurar se existe loja com esse
 * nome/CNPJ no ML, Shopee e Amazon. Isso é M0 + busca, e é barato." E é gratuito
 * (CLAUDE.md, 3.7): o cadastro vem da BrasilAPI, e a busca é o buscador gratuito — os
 * mesmos do garimpo.
 *
 * ## O que a conferência responde, e o que não responde
 *
 * - **Loja própria com o nome inteiro** — endereço de loja ou de perfil de vendedor no
 *   marketplace, e todas as palavras do nome no título ou no endereço — responde "vende
 *   direto" com **sim**. É o descarte, com o link na tela para conferir.
 * - Loja com parte do nome, ou anúncio que cita o nome, é **indício**: o fornecedor pode
 *   ser a marca que outros revendem, e "Mundo dos Filtros" não é "Filtros Brasil". Fica
 *   listado para a pessoa olhar, e a pergunta continua aberta.
 * - Não achar nada **não** responde "não": busca não prova ausência.
 * - Resposta dada à mão nunca é trocada — pessoa que olhou é origem mais forte que busca
 *   (CLAUDE.md, 3.3). Quem grava respeita isso; aqui só se lê e se classifica.
 * - CNPJ baixado, inapto ou que a Receita não conhece vira aviso no cartão.
 *
 * O que é regra — o nome que casa, a página que é loja — é função pura com teste. A
 * busca e a consulta entram por parâmetro, e o teste não sai para a internet.
 */
import { z } from 'zod';
import { lerDocumento } from '@/dominio/documento';
import { siteDaUrl } from '@/dominio/ingestao/classificador';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import { buscarNaWeb, type OpcoesDoBuscador, type ResultadoDeBusca } from '@/dominio/web/buscador';
import {
  consultarCnpj,
  fraseDeInexistente,
  lerCadastro,
  type OpcoesDaReceita,
} from '@/dominio/web/receita';
import { FalhaDeRede } from '@/infra/web/rede';

/** O domínio de cada vitrine, para a busca por `site:`. */
export const DOMINIO_DA_VITRINE: Readonly<Record<Plataforma, string>> = {
  ml: 'mercadolivre.com.br',
  shopee: 'shopee.com.br',
  amazon: 'amazon.com.br',
};

/** Conferência mais velha que isso é refeita: fornecedor que não vendia pode passar a vender. */
export const VALIDADE_DA_CONFERENCIA_DIAS = 90;

// ─── O nome ─────────────────────────────────────────────────────────────────

/** Sufixo societário e palavra de ligação: não identificam ninguém. */
const PALAVRAS_DE_FORMA = new Set([
  'ltda',
  'me',
  'epp',
  'eireli',
  'sa',
  'cia',
  'mei',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
]);

/**
 * O que o negócio faz, e não quem ele é. "Acme Distribuidora" e "Acme Comércio" são a
 * mesma Acme; a loja dela no marketplace costuma se chamar só "Acme".
 */
const PALAVRAS_DE_RAMO = new Set([
  'comercio',
  'comercial',
  'distribuidora',
  'distribuicao',
  'distribuidor',
  'importadora',
  'importacao',
  'importados',
  'exportadora',
  'atacado',
  'atacadista',
  'varejo',
  'industria',
  'industrial',
  'fabrica',
  'loja',
  'store',
  'oficial',
  'brasil',
  'group',
  'grupo',
]);

/** Minúsculo, sem acento, e só letra, número e espaço. */
export function normalizarNome(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface NomeParaConferir {
  /** Todas as palavras que identificam: o nome sem forma societária e sem ligação. */
  readonly inteiro: readonly string[];
  /** Sem as palavras de ramo também. Vazio quando o nome é só ramo. */
  readonly nucleo: readonly string[];
}

export function nomeParaConferir(nome: string): NomeParaConferir {
  const palavras = normalizarNome(nome)
    .split(' ')
    .filter((p) => p !== '' && !PALAVRAS_DE_FORMA.has(p));
  return { inteiro: palavras, nucleo: palavras.filter((p) => !PALAVRAS_DE_RAMO.has(p)) };
}

/**
 * O nome identifica alguém? Nome só de ramo ("Distribuidora de Filtros") ou curto demais
 * ("MK") casa com a loja de outro, e aí o que se acha é indício, nunca resposta.
 */
export function nomeIdentifica(nome: NomeParaConferir): boolean {
  return nome.nucleo.join('').length >= 3;
}

/** O nome para a busca: como foi cadastrado, sem a forma societária. */
export function nomeDeBusca(nome: string): string {
  return nome
    .replace(/(^|\s)(ltda|eireli|epp|me|mei|cia|s\.?\/?a\.?)(?=\s|$|[.,])\.?/gi, ' ')
    .replace(/[\s,.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Todas as palavras aparecem no texto, como palavra — "acme" não casa com "acmeflex". */
function palavrasNoTexto(palavras: readonly string[], texto: string): boolean {
  if (palavras.length === 0) return false;
  const conjunto = new Set(normalizarNome(texto).split(' '));
  return palavras.every((p) => conjunto.has(p));
}

/**
 * O nome está no endereço, como nome da loja: `/loja/acme-distribuidora`,
 * `/acmedistribuidora`. Cada trecho do caminho é lido como palavras — todas as do nome
 * precisam estar lá — ou, sem separador, precisa ser o nome inteiro junto. "acme" não
 * está em `/loja/acmeflex`.
 */
function palavrasNoEndereco(palavras: readonly string[], url: string): boolean {
  if (palavras.length === 0) return false;
  let trechos: readonly string[];
  try {
    trechos = new URL(url).pathname.split('/');
  } catch {
    return false;
  }
  const junto = palavras.join('');
  return trechos.some((trecho) => {
    let legivel: string;
    try {
      legivel = decodeURIComponent(trecho);
    } catch {
      legivel = trecho;
    }
    const doTrecho = normalizarNome(legivel).split(' ');
    if (palavras.every((p) => doTrecho.includes(p))) return true;
    // Junto curto demais casa com qualquer coisa: "mk" é trecho de muita loja.
    return junto.length >= 4 && doTrecho.join('') === junto;
  });
}

// ─── A página ───────────────────────────────────────────────────────────────

/** Caminho da Shopee que não é nome de loja. */
const CAMINHOS_DA_SHOPEE = new Set([
  'search',
  'mall',
  'm',
  'buyer',
  'cart',
  'user',
  'product',
  'daily_discover',
  'flash_sale',
  'universal-link',
  'verify',
  'seller',
  'shop',
]);

/**
 * O endereço é de loja ou de perfil de vendedor — e não de anúncio, busca ou categoria?
 *
 * - Mercado Livre: `/loja/<nome>`, `/perfil/<apelido>`, `/pagina/<apelido>`, os
 *   subdomínios `loja.` e `perfil.`, e a lista de um vendedor (`_CustId_`, `_Loja_`).
 * - Shopee: `/shop/<número>`, ou um caminho de uma palavra só que não é anúncio
 *   (`-i.<loja>.<item>`) nem categoria (`-cat.<número>`).
 * - Amazon: loja de marca (`/stores/`), vitrine de vendedor (`/shops/`, `/s?me=`) e
 *   perfil de vendedor (`/sp?seller=`).
 */
export function ehPaginaDeLoja(url: string, plataforma: Plataforma): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const caminho = u.pathname;
  switch (plataforma) {
    case 'ml':
      return (
        (/^(loja|perfil)\./i.test(u.hostname) && caminho.length > 1) ||
        /^\/(loja|perfil|pagina)\/[^/]+/i.test(caminho) ||
        /_CustId_|_Loja_/i.test(caminho)
      );
    case 'shopee': {
      if (/^\/shop\/\d+\/?$/.test(caminho)) return true;
      const segmentos = caminho.split('/').filter((s) => s !== '');
      const unico = segmentos.length === 1 ? segmentos[0] : undefined;
      return (
        unico !== undefined &&
        !CAMINHOS_DA_SHOPEE.has(unico.toLowerCase()) &&
        !/-i\.\d+\.\d+|-cat\.\d+/i.test(unico) &&
        /^[a-z0-9_.-]+$/i.test(unico)
      );
    }
    case 'amazon':
      return (
        /^\/(stores|shops)\//i.test(caminho) ||
        (/^\/s\/?$/.test(caminho) && u.searchParams.has('me')) ||
        (/^\/sp\/?$/.test(caminho) && u.searchParams.has('seller'))
      );
  }
}

/** A vitrine de um endereço — só as três onde se vende; AliExpress e 1688 não contam. */
export function vitrineDaUrl(url: string): Plataforma | null {
  const site = siteDaUrl(url);
  return PLATAFORMAS.find((p) => p === site) ?? null;
}

// ─── O que se achou ─────────────────────────────────────────────────────────

export interface Encontro {
  readonly plataforma: Plataforma;
  readonly titulo: string;
  readonly url: string;
}

/**
 * Um resultado de busca, contra os nomes do fornecedor.
 *
 * `loja` responde a pergunta: página de loja, e todas as palavras de um nome que
 * identifica alguém. O resto que cita o nome é `indicio`. Resultado fora das três
 * vitrines, ou que não cita o nome, é `null`.
 */
export function classificarResultado(
  resultado: ResultadoDeBusca,
  nomes: readonly NomeParaConferir[],
): { readonly plataforma: Plataforma; readonly tipo: 'loja' | 'indicio' } | null {
  const plataforma = vitrineDaUrl(resultado.url);
  if (plataforma === null) return null;

  const texto = `${resultado.titulo} ${resultado.trecho}`;
  const casaInteiro = (n: NomeParaConferir) =>
    palavrasNoTexto(n.inteiro, resultado.titulo) || palavrasNoEndereco(n.inteiro, resultado.url);
  const responde = nomes.some((n) => nomeIdentifica(n) && casaInteiro(n));
  const casaParte = nomes.some(
    (n) =>
      palavrasNoTexto(n.inteiro, texto) ||
      palavrasNoTexto(n.nucleo, texto) ||
      palavrasNoEndereco(n.nucleo, resultado.url),
  );

  if (responde && ehPaginaDeLoja(resultado.url, plataforma)) return { plataforma, tipo: 'loja' };
  if (nomes.some(casaInteiro) || casaParte) return { plataforma, tipo: 'indicio' };
  return null;
}

// ─── O registro da conferência ──────────────────────────────────────────────

const esquemaDoEncontro = z.object({
  plataforma: z.enum(PLATAFORMAS),
  titulo: z.string(),
  url: z.string(),
});

const esquemaDoCadastroConferido = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('sem_documento') }),
  z.object({ tipo: z.literal('cpf') }),
  z.object({ tipo: z.literal('invalido'), motivo: z.string() }),
  z.object({ tipo: z.literal('inexistente'), frase: z.string(), fonte: z.string() }),
  z.object({
    tipo: z.literal('encontrado'),
    frase: z.string(),
    ativo: z.boolean(),
    atacadista: z.boolean(),
    fabricante: z.boolean(),
    nome: z.string(),
    fonte: z.string(),
  }),
  z.object({ tipo: z.literal('falhou'), motivo: z.string() }),
]);
export type CadastroConferido = z.infer<typeof esquemaDoCadastroConferido>;

const esquemaDaVitrine = z.object({
  buscadoComo: z.string(),
  /** As vitrines cuja busca respondeu. As outras ficaram por conferir. */
  conferidas: z.array(z.enum(PLATAFORMAS)),
  lojas: z.array(esquemaDoEncontro),
  indicios: z.array(esquemaDoEncontro),
  falha: z.string().nullable(),
});
export type VitrineConferida = z.infer<typeof esquemaDaVitrine>;

/** O que fica gravado no fornecedor. Lido de volta com Zod: jsonb antigo pode ter outra forma. */
export const esquemaDaConferencia = z.object({
  em: z.iso.datetime(),
  cadastro: esquemaDoCadastroConferido,
  vitrine: esquemaDaVitrine,
});
export type Conferencia = z.infer<typeof esquemaDaConferencia>;

/** A conferência gravada, ou `null` quando não há — ou quando a forma não é mais esta. */
export function lerConferencia(bruto: unknown): Conferencia | null {
  if (bruto === null || bruto === undefined) return null;
  const lida = esquemaDaConferencia.safeParse(bruto);
  return lida.success ? lida.data : null;
}

/** A conferência achou loja própria: é a resposta "sim" para "vende direto". */
export function achouLojaPropria(conferencia: Conferencia): boolean {
  return conferencia.vitrine.lojas.length > 0;
}

/** A busca chegou ao fim em todas as vitrines — ou parou porque já achou a loja. */
export function vitrineConcluida(conferencia: Conferencia): boolean {
  return (
    achouLojaPropria(conferencia) || conferencia.vitrine.conferidas.length === PLATAFORMAS.length
  );
}

/** Conferência que não chegou ao fim — buscador ou Receita recusou — é refeita antes. */
export const REPETIR_CONFERENCIA_INCOMPLETA_HORAS = 12;

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * O fornecedor precisa de conferência automática agora?
 *
 * Nunca conferido: sim. Conferência completa: depois de noventa dias, porque quem não
 * vendia na vitrine pode ter passado a vender. Incompleta: depois de doze horas. E quem
 * a pessoa já respondeu que vende direto não precisa: já está descartado, por quem olhou.
 */
export function precisaDeConferencia(
  fornecedor: {
    readonly vendeDiretoMarketplace: boolean | null;
    readonly vendeDiretoFonte: Fonte | null;
    readonly conferencia: Conferencia | null;
  },
  agora: Date,
): boolean {
  if (fornecedor.vendeDiretoMarketplace === true && fornecedor.vendeDiretoFonte === 'manual') {
    return false;
  }
  const conferencia = fornecedor.conferencia;
  if (conferencia === null) return true;

  const idadeHoras = (agora.getTime() - new Date(conferencia.em).getTime()) / MS_POR_HORA;
  const completa = vitrineConcluida(conferencia) && conferencia.cadastro.tipo !== 'falhou';
  return completa
    ? idadeHoras >= VALIDADE_DA_CONFERENCIA_DIAS * 24
    : idadeHoras >= REPETIR_CONFERENCIA_INCOMPLETA_HORAS;
}

// ─── A conferência ──────────────────────────────────────────────────────────

export interface OpcoesDaConferencia {
  readonly buscador?: OpcoesDoBuscador | undefined;
  readonly receita?: OpcoesDaReceita | undefined;
  /** Pausa entre uma busca e outra, para o buscador não achar que é robô. */
  readonly pausa?: ((ms: number) => Promise<void>) | undefined;
  readonly agora?: (() => Date) | undefined;
}

/** Entre uma busca e a próxima. Três buscas em sequência, sem pausa, parecem robô. */
export const PAUSA_ENTRE_BUSCAS_MS = 1_500;

const pausaReal = (ms: number) =>
  new Promise<void>((resolver) => {
    setTimeout(resolver, ms);
  });

async function conferirCadastro(
  documento: string | null,
  opcoes: OpcoesDaReceita,
): Promise<CadastroConferido> {
  if (documento === null || documento.trim() === '') return { tipo: 'sem_documento' };
  const lido = lerDocumento(documento);
  if (lido.tipo === 'vazio') return { tipo: 'sem_documento' };
  if (lido.tipo === 'invalido') return { tipo: 'invalido', motivo: lido.motivo };
  // Pessoa física não tem cadastro público para consultar — e não é, por si, defeito.
  if (lido.documento.tipo === 'cpf') return { tipo: 'cpf' };

  const cnpj = lido.documento.valor;
  try {
    const consulta = await consultarCnpj(cnpj, opcoes);
    if (consulta.tipo === 'inexistente') {
      return { tipo: 'inexistente', frase: fraseDeInexistente(cnpj), fonte: consulta.fonte };
    }
    const leitura = lerCadastro(cnpj, consulta.cadastro);
    return {
      tipo: 'encontrado',
      frase: leitura.frase,
      ativo: leitura.ativo,
      atacadista: leitura.atacadista,
      fabricante: leitura.fabricante,
      nome: leitura.nomeParaBusca,
      fonte: consulta.fonte,
    };
  } catch (erro) {
    if (!(erro instanceof FalhaDeRede)) throw erro;
    return { tipo: 'falhou', motivo: erro.message };
  }
}

/**
 * Confere um fornecedor: o CNPJ na Receita, e uma busca por vitrine.
 *
 * A busca usa o nome como está cadastrado — é o nome pelo qual a pessoa conhece o
 * fornecedor. O resultado é comparado com ele e com o nome fantasia da Receita, quando
 * há. Para na primeira loja própria achada: a resposta já é "sim", e busca a mais só
 * gasta a paciência do buscador. Falha do buscador no meio não perde o que já achou.
 */
export async function conferirFornecedor(
  fornecedor: { readonly nome: string; readonly cnpj: string | null },
  opcoes: OpcoesDaConferencia = {},
): Promise<Conferencia> {
  const agora = opcoes.agora?.() ?? new Date();
  const pausa = opcoes.pausa ?? pausaReal;

  const cadastro = await conferirCadastro(fornecedor.cnpj, opcoes.receita ?? {});
  const nomes = [nomeParaConferir(fornecedor.nome)];
  if (cadastro.tipo === 'encontrado') nomes.push(nomeParaConferir(cadastro.nome));

  const buscadoComo = nomeDeBusca(fornecedor.nome);
  const conferidas: Plataforma[] = [];
  const lojas: Encontro[] = [];
  const indicios: Encontro[] = [];
  const vistos = new Set<string>();
  let falha: string | null = null;

  for (const [indice, plataforma] of PLATAFORMAS.entries()) {
    if (indice > 0) await pausa(PAUSA_ENTRE_BUSCAS_MS);
    let resultados: readonly ResultadoDeBusca[];
    try {
      resultados = await buscarNaWeb(
        `${buscadoComo} site:${DOMINIO_DA_VITRINE[plataforma]}`,
        opcoes.buscador ?? {},
      );
    } catch (erro) {
      if (!(erro instanceof FalhaDeRede)) throw erro;
      falha = erro.message;
      break;
    }
    conferidas.push(plataforma);

    for (const resultado of resultados) {
      if (vistos.has(resultado.url)) continue;
      const classe = classificarResultado(resultado, nomes);
      if (classe === null) continue;
      vistos.add(resultado.url);
      const encontro = {
        plataforma: classe.plataforma,
        titulo: resultado.titulo,
        url: resultado.url,
      };
      if (classe.tipo === 'loja') lojas.push(encontro);
      else indicios.push(encontro);
    }
    if (lojas.length > 0) break;
  }

  return {
    em: agora.toISOString(),
    cadastro,
    vitrine: {
      buscadoComo,
      conferidas,
      lojas,
      // Indício demais é ruído: os cinco primeiros dão a ideia.
      indicios: indicios.slice(0, 5),
      falha,
    },
  };
}
