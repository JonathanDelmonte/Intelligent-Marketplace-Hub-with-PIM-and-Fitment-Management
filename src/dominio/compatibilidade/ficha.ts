/**
 * Saída dupla do fosso: a ficha que vai para o anúncio e a resposta ao comprador.
 *
 * A especificação pede as duas a partir da mesma base, e a razão é que elas têm
 * que concordar: publicar "serve no PA26G" na ficha e responder "não sei" na
 * pergunta é pior do que não ter nenhuma das duas.
 *
 * ## O que é honesto dizer sobre o formato da ficha do Mercado Livre
 *
 * Não há conta conectada nem documentação acessível de forma automatizada, então
 * **os nomes de coluna daqui são o melhor palpite informado, não fato conferido** —
 * a mesma situação do mapeamento de exportação da fase 3, e a mesma disciplina:
 * está dito em voz alta, e o dia em que houver uma planilha de verdade o ajuste é
 * em um lugar. O conteúdo — marca, modelo, variação, ano — é o que a ficha de
 * compatibilidade pede em qualquer versão dela.
 *
 * ## A regra que atravessa o arquivo
 *
 * Só entra na ficha o que é publicável: decisão `serve`, confiança acima do corte,
 * sem conflito aberto. Tudo o mais aparece **retido, com o motivo** — porque a
 * pergunta que a tela precisa responder não é "o que publicar", é "por que este
 * não foi publicado".
 */
import { codigosDeModelo } from '@/dominio/identidade/canonico';
import { ehInferida, ETIQUETA_DA_EVIDENCIA, forcaDaEvidencia, type Evidencia } from './evidencia';
import { analisarModelo, type RegistroDeGramaticas } from './gramatica';
import { GRAMATICAS_SEMENTE } from './gramaticas';
import { LIMIAR_PUBLICACAO_BP, type Decisao } from './resolucao';

/** O aparelho, no mínimo que a ficha e a resposta precisam. */
export interface AparelhoDaFicha {
  readonly tipo: string;
  readonly marca: string;
  readonly modelo: string;
  readonly variante: string | null;
  readonly familia: string | null;
  readonly anoDe?: number | null;
  readonly anoAte?: number | null;
}

export interface CompatibilidadeParaFicha {
  readonly decisao: Decisao;
  readonly confiancaBp: number;
  readonly conflito: string | null;
  readonly evidencias: readonly Evidencia[];
  readonly aparelho: AparelhoDaFicha;
}

export interface LinhaDaFicha {
  readonly tipo: string;
  readonly marca: string;
  readonly modelo: string;
  readonly variante: string | null;
  readonly anoDe: number | null;
  readonly anoAte: number | null;
  readonly confiancaBp: number;
}

export const MOTIVOS_DE_RETENCAO = [
  'abaixo_do_corte',
  'conflito_aberto',
  'nao_serve',
  'indefinido',
] as const;
export type MotivoDeRetencao = (typeof MOTIVOS_DE_RETENCAO)[number];

const TEXTO_DA_RETENCAO: Readonly<Record<MotivoDeRetencao, string>> = {
  abaixo_do_corte: 'a evidência ainda não é suficiente para publicar',
  conflito_aberto: 'há fontes discordando, e ninguém decidiu',
  nao_serve: 'a evidência diz que não serve',
  indefinido: 'ninguém afirmou nada que decida',
};

export function descreverRetencao(motivo: MotivoDeRetencao): string {
  return TEXTO_DA_RETENCAO[motivo];
}

export interface LinhaRetida extends LinhaDaFicha {
  readonly motivo: MotivoDeRetencao;
  readonly conflito: string | null;
}

export interface Ficha {
  readonly publicaveis: readonly LinhaDaFicha[];
  readonly retidas: readonly LinhaRetida[];
}

function linha(c: CompatibilidadeParaFicha): LinhaDaFicha {
  return {
    tipo: c.aparelho.tipo,
    marca: c.aparelho.marca,
    modelo: c.aparelho.modelo,
    variante: c.aparelho.variante,
    anoDe: c.aparelho.anoDe ?? null,
    anoAte: c.aparelho.anoAte ?? null,
    confiancaBp: c.confiancaBp,
  };
}

function ehPublicavel(c: CompatibilidadeParaFicha): boolean {
  return c.decisao === 'serve' && c.confiancaBp >= LIMIAR_PUBLICACAO_BP && c.conflito === null;
}

function motivoDaRetencao(c: CompatibilidadeParaFicha): MotivoDeRetencao {
  if (c.conflito !== null) return 'conflito_aberto';
  if (c.decisao === 'nao_serve') return 'nao_serve';
  if (c.decisao === 'indefinido') return 'indefinido';
  return 'abaixo_do_corte';
}

/** Ordem estável: marca, modelo, variação. É como a pessoa lê a ficha. */
function ordenar<T extends LinhaDaFicha>(linhas: readonly T[]): readonly T[] {
  return [...linhas].sort(
    (a, b) =>
      a.marca.localeCompare(b.marca, 'pt-BR') ||
      a.modelo.localeCompare(b.modelo, 'pt-BR') ||
      (a.variante ?? '').localeCompare(b.variante ?? '', 'pt-BR'),
  );
}

export function montarFicha(compatibilidades: readonly CompatibilidadeParaFicha[]): Ficha {
  const publicaveis: LinhaDaFicha[] = [];
  const retidas: LinhaRetida[] = [];
  for (const c of compatibilidades) {
    if (ehPublicavel(c)) publicaveis.push(linha(c));
    else retidas.push({ ...linha(c), motivo: motivoDaRetencao(c), conflito: c.conflito });
  }
  return { publicaveis: ordenar(publicaveis), retidas: ordenar(retidas) };
}

/** Cabeçalho da planilha de compatibilidade. Ver a ressalva no topo do arquivo. */
export const COLUNAS_DA_FICHA = [
  'Tipo',
  'Marca',
  'Modelo',
  'Variação',
  'Ano de',
  'Ano até',
] as const;

/** Separador `;` e sem aspas desnecessárias, que é o que planilha brasileira lê. */
const SEPARADOR = ';';

function celula(valor: string | number | null): string {
  if (valor === null) return '';
  const texto = String(valor);
  return texto.includes(SEPARADOR) || texto.includes('"')
    ? `"${texto.replaceAll('"', '""')}"`
    : texto;
}

/**
 * A ficha em CSV, para importação em massa.
 *
 * O caminho padrão de publicação é gerar arquivo, não chamar API (ADR 0002): o
 * arquivo funciona sem credencial, sem app aprovado e sem risco de conta, e é
 * conferível antes de subir.
 */
export function fichaEmCsv(ficha: Ficha): string {
  const linhas = [COLUNAS_DA_FICHA.join(SEPARADOR)];
  for (const l of ficha.publicaveis) {
    linhas.push(
      [l.tipo, l.marca, l.modelo, l.variante, l.anoDe, l.anoAte].map(celula).join(SEPARADOR),
    );
  }
  return `${linhas.join('\n')}\n`;
}

/**
 * Bloco de texto para a descrição do anúncio.
 *
 * Vazio quando não há nada publicável — e vazio de propósito, porque um bloco
 * "Compatível com:" seguido de nada é pior que a ausência do bloco.
 */
export function textoParaDescricao(ficha: Ficha): string {
  if (ficha.publicaveis.length === 0) return '';
  const itens = ficha.publicaveis.map((l) =>
    l.variante === null ? `${l.marca} ${l.modelo}` : `${l.marca} ${l.modelo} (${l.variante})`,
  );
  return `Compatível com:\n${itens.map((i) => `• ${i}`).join('\n')}`;
}

// ─── Resposta ao comprador (base de M16) ─────────────────────────────────────

export const TIPOS_DE_RESPOSTA = [
  'serve',
  'nao_serve',
  'em_duvida',
  'parente_confirmado',
  'nao_sei',
  'sem_modelo',
] as const;
export type TipoDeResposta = (typeof TIPOS_DE_RESPOSTA)[number];

export interface Resposta {
  readonly tipo: TipoDeResposta;
  /** Texto pronto para responder, sem promessa que a base não sustenta. */
  readonly texto: string;
  /** Códigos de modelo encontrados na pergunta. */
  readonly codigos: readonly string[];
  readonly aparelho: AparelhoDaFicha | null;
  readonly confiancaBp: number;
  /** Etiquetas das fontes que sustentam a resposta, para conferir antes de enviar. */
  readonly fontes: readonly string[];
}

/**
 * As fontes que o vendedor pode citar ao responder.
 *
 * Só entra o que **pesou** na decisão. Evidência de força zero — o anúncio próprio —
 * aparecia na lista de fontes citáveis, e isso convidava a apontar o próprio anúncio
 * como prova ao comprador: exatamente o raciocínio circular que a força zero existe
 * para impedir. Apareceu conferindo a resposta na tela.
 */
function fontesDe(evidencias: readonly Evidencia[]): readonly string[] {
  const rotulos = evidencias
    .filter((e) => !e.negativa && forcaDaEvidencia(e) > 0)
    .map((e) => ETIQUETA_DA_EVIDENCIA[e.tipo]);
  return [...new Set(rotulos)];
}

/**
 * O código citado é variação de um modelo que já está confirmado?
 *
 * A pergunta do comprador quase nunca traz a marca — "serve no meu PA26G?" — e
 * não precisa: para cada aparelho conhecido, analisar o código citado **sob a
 * marca daquele aparelho** e comparar a família resolve sem chutar marca.
 */
function parenteConfirmado(
  codigos: readonly string[],
  compatibilidades: readonly CompatibilidadeParaFicha[],
  gramaticas: RegistroDeGramaticas,
): CompatibilidadeParaFicha | null {
  for (const c of compatibilidades) {
    if (!ehPublicavel(c) || c.aparelho.familia === null) continue;
    for (const codigo of codigos) {
      const analise = analisarModelo(c.aparelho.marca, codigo, gramaticas);
      if (analise.ok && analise.analise.familia === c.aparelho.familia) return c;
    }
  }
  return null;
}

/**
 * Responde "serve no meu modelo X?" a partir da base, sem prometer o que ela não
 * sustenta.
 *
 * Nunca diz "serve" com dado abaixo do corte de publicação. Prometer compatibilidade
 * para fechar uma venda é o jeito mais caro de vender: devolução, frete de volta e
 * reclamação, que em marketplace pesa mais que a venda perdida.
 */
export function responder(params: {
  readonly pergunta: string;
  readonly compatibilidades: readonly CompatibilidadeParaFicha[];
  readonly gramaticas?: RegistroDeGramaticas;
}): Resposta {
  const gramaticas = params.gramaticas ?? GRAMATICAS_SEMENTE;
  const codigos = codigosDeModelo(params.pergunta);

  if (codigos.length === 0) {
    return {
      tipo: 'sem_modelo',
      texto:
        'Para confirmar, me diga o modelo do aparelho — costuma estar na etiqueta atrás ou embaixo.',
      codigos: [],
      aparelho: null,
      confiancaBp: 0,
      fontes: [],
    };
  }

  const citados = new Set(codigos);
  const candidatas = params.compatibilidades.filter((c) => {
    const analise = analisarModelo(c.aparelho.marca, c.aparelho.modelo, gramaticas);
    return citados.has(analise.ok ? analise.analise.codigo : c.aparelho.modelo.toUpperCase());
  });

  const negativa = candidatas.find((c) => c.decisao === 'nao_serve');
  if (negativa !== undefined) {
    return {
      tipo: 'nao_serve',
      texto: `Nesse modelo (${negativa.aparelho.marca} ${negativa.aparelho.modelo}) esta peça não serve. Se quiser, me diga o modelo e eu vejo qual é a peça certa.`,
      codigos,
      aparelho: negativa.aparelho,
      confiancaBp: negativa.confiancaBp,
      fontes: [],
    };
  }

  const boa = candidatas.find(ehPublicavel);
  if (boa !== undefined) {
    return {
      tipo: 'serve',
      texto: `Serve, sim — ${boa.aparelho.marca} ${boa.aparelho.modelo} está na nossa tabela de compatibilidade.`,
      codigos,
      aparelho: boa.aparelho,
      confiancaBp: boa.confiancaBp,
      fontes: fontesDe(boa.evidencias),
    };
  }

  const duvidosa = candidatas[0];
  if (duvidosa !== undefined) {
    return {
      tipo: 'em_duvida',
      texto: `Ainda não posso confirmar para esse modelo — prefiro checar do que garantir errado. Me dá um instante que eu confiro no manual do fabricante e volto.`,
      codigos,
      aparelho: duvidosa.aparelho,
      confiancaBp: duvidosa.confiancaBp,
      fontes: [],
    };
  }

  const parente = parenteConfirmado(codigos, params.compatibilidades, gramaticas);
  if (parente !== null) {
    const inferida = parente.evidencias.every((e) => ehInferida(e.tipo));
    return {
      tipo: 'parente_confirmado',
      texto: `Esse modelo é da mesma linha do ${parente.aparelho.marca} ${parente.aparelho.modelo}, que já está confirmado${inferida ? '' : ' pelo fabricante'} — mas eu não confirmo o seu sem checar. Me dá um instante.`,
      codigos,
      aparelho: parente.aparelho,
      confiancaBp: parente.confiancaBp,
      fontes: fontesDe(parente.evidencias),
    };
  }

  return {
    tipo: 'nao_sei',
    texto: `Não tenho esse modelo na tabela ainda. Vou checar com o fabricante e te respondo — prefiro confirmar do que arriscar.`,
    codigos,
    aparelho: null,
    confiancaBp: 0,
    fontes: [],
  };
}
