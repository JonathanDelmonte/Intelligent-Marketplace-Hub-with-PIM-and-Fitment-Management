/**
 * Importador de planilha de exportação (M1, etapa 3.7).
 *
 * Junta leitor e mapeamento, e é o único extrator do M1 que **não gasta LLM
 * nenhum**: exportação de plataforma tem estrutura conhecida, então mapeamento
 * fixo por sinônimo resolve. É por isso que é o primeiro a ser construído.
 *
 * Duas invariantes herdadas do M1:
 *
 * - Tudo que entra vira `produto_externo`, nunca `sku` direto.
 * - Linha que não valida vira `pendente_revisao` com o bruto preservado, nunca
 *   descarte.
 */
import { z } from 'zod';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import type { ProdutoExternoCapturado } from '../produto-externo';
import { lerPlanilha, type ConteudoDePlanilha, type Grade } from './leitor';
import {
  camposObrigatoriosAusentes,
  mapearCabecalho,
  quantidadeReconhecida,
  type Campo,
  type ResultadoDoMapeamento,
} from './mapeamento';

/**
 * Quantas linhas do topo podem ser lixo antes do cabeçalho.
 *
 * Exportação de painel traz linha de título, aviso de validade, linha em branco.
 * Presumir cabeçalho na linha 1 faria a importação inteira deslocar em silêncio,
 * que é o pior modo de falhar: nada reclama e todo dado fica na coluna errada.
 */
export const MAX_LINHAS_ANTES_DO_CABECALHO = 12;

/** Mínimo de colunas reconhecidas para uma linha ser aceita como cabeçalho. */
export const MIN_COLUNAS_PARA_CABECALHO = 2;

export interface LinhaImportada {
  /** Número da linha no arquivo, 1-based, como o usuário vê na planilha. */
  readonly numeroDaLinha: number;
  readonly captura: ProdutoExternoCapturado;
}

export interface LinhaRejeitada {
  readonly numeroDaLinha: number;
  readonly motivo: string;
  readonly problemas: readonly string[];
  /** A linha como veio, para revisão. */
  readonly bruto: Readonly<Record<string, string>>;
}

export type ResultadoDaImportacao =
  | {
      readonly tipo: 'importado';
      readonly plataforma: Plataforma;
      /** Linha do arquivo onde o cabeçalho foi achado, 1-based. */
      readonly linhaDoCabecalho: number;
      readonly linhas: readonly LinhaImportada[];
      readonly rejeitadas: readonly LinhaRejeitada[];
      /** Colunas que o mapeador não reconheceu. Acrescente sinônimos. */
      readonly colunasNaoReconhecidas: readonly string[];
      /** Campos que apareceram em duas colunas; a primeira venceu. */
      readonly camposDuplicados: readonly Campo[];
      readonly mapeamento: ResultadoDoMapeamento;
    }
  | {
      readonly tipo: 'pendente_revisao';
      readonly motivo: string;
      /** As primeiras linhas do arquivo, para a pessoa entender o que chegou. */
      readonly amostra: Grade;
    };

export class ImportadorDePlanilha {
  /**
   * Importa uma planilha de exportação.
   *
   * Nunca lança por conteúdo — só por falha de leitura do formato, que é o que a
   * fila deve reagendar. Planilha irreconhecível vira `pendente_revisao` com
   * amostra anexada.
   */
  async importar(params: {
    readonly conteudo: ConteudoDePlanilha;
    readonly plataforma: Plataforma;
    /** Procedência do dado. Exportação de painel é `m1_planilha`. */
    readonly fonte?: Fonte;
    readonly coletadoEm?: Date;
  }): Promise<ResultadoDaImportacao> {
    const grade = await lerPlanilha(params.conteudo);
    const fonte: Fonte = params.fonte ?? 'm1_planilha';
    const coletadoEm = params.coletadoEm ?? new Date();

    if (grade.length === 0) {
      return { tipo: 'pendente_revisao', motivo: 'a planilha está vazia', amostra: [] };
    }

    const achado = acharCabecalho(grade, params.plataforma);
    if (achado === null) {
      return {
        tipo: 'pendente_revisao',
        motivo:
          `nenhuma das primeiras ${String(MAX_LINHAS_ANTES_DO_CABECALHO)} linhas parece um ` +
          `cabeçalho de exportação de ${params.plataforma}. Confira se o arquivo é a ` +
          'exportação certa, ou acrescente os nomes de coluna à tabela de sinônimos.',
        amostra: grade.slice(0, MAX_LINHAS_ANTES_DO_CABECALHO),
      };
    }

    const { indice: indiceDoCabecalho, mapeamento } = achado;

    const ausentes = camposObrigatoriosAusentes(mapeamento);
    if (ausentes.length > 0) {
      return {
        tipo: 'pendente_revisao',
        motivo:
          `o cabeçalho foi reconhecido na linha ${String(indiceDoCabecalho + 1)}, mas falta ` +
          `campo indispensável: ${ausentes.join(', ')}`,
        amostra: grade.slice(0, indiceDoCabecalho + 3),
      };
    }

    const linhas: LinhaImportada[] = [];
    const rejeitadas: LinhaRejeitada[] = [];

    for (let i = indiceDoCabecalho + 1; i < grade.length; i += 1) {
      const celulas = grade[i] ?? [];
      const numeroDaLinha = i + 1;
      const bruto = montarBruto(mapeamento, celulas);

      const convertida = converterLinha({
        bruto,
        plataforma: params.plataforma,
        fonte,
        coletadoEm,
      });

      if (convertida.ok) {
        linhas.push({ numeroDaLinha, captura: convertida.captura });
      } else {
        rejeitadas.push({
          numeroDaLinha,
          motivo: convertida.motivo,
          problemas: convertida.problemas,
          bruto,
        });
      }
    }

    return {
      tipo: 'importado',
      plataforma: params.plataforma,
      linhaDoCabecalho: indiceDoCabecalho + 1,
      linhas,
      rejeitadas,
      colunasNaoReconhecidas: mapeamento.naoReconhecidas.map((c) => c.nome),
      camposDuplicados: mapeamento.duplicados,
      mapeamento,
    };
  }
}

/**
 * Procura o cabeçalho nas primeiras linhas.
 *
 * Critério: a linha com mais colunas reconhecidas, desde que passe do mínimo. Não
 * é "a primeira que passa" porque uma linha de aviso pode casar duas colunas por
 * coincidência, e a linha seguinte casar oito — escolher a melhor é mais robusto
 * que escolher a primeira.
 */
export function acharCabecalho(
  grade: Grade,
  plataforma: Plataforma,
): { readonly indice: number; readonly mapeamento: ResultadoDoMapeamento } | null {
  const limite = Math.min(grade.length, MAX_LINHAS_ANTES_DO_CABECALHO);

  let melhorIndice = -1;
  let melhorContagem = 0;

  for (let i = 0; i < limite; i += 1) {
    const contagem = quantidadeReconhecida(grade[i] ?? [], plataforma);
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhorIndice = i;
    }
  }

  if (melhorIndice === -1 || melhorContagem < MIN_COLUNAS_PARA_CABECALHO) return null;

  return {
    indice: melhorIndice,
    mapeamento: mapearCabecalho(grade[melhorIndice] ?? [], plataforma),
  };
}

/** Monta um objeto campo → texto a partir da linha e do mapeamento. */
function montarBruto(
  mapeamento: ResultadoDoMapeamento,
  celulas: readonly string[],
): Record<string, string> {
  const bruto: Record<string, string> = {};
  for (const coluna of mapeamento.mapeadas) {
    bruto[coluna.campo] = (celulas[coluna.indice] ?? '').trim();
  }
  return bruto;
}

type Conversao =
  | { readonly ok: true; readonly captura: ProdutoExternoCapturado }
  | { readonly ok: false; readonly motivo: string; readonly problemas: readonly string[] };

const esquemaLinha = z.object({
  titulo: z.string().trim().min(3, 'título muito curto para identificar um produto'),
  preco: z.string().optional(),
  id_externo: z.string().optional(),
  ean: z.string().optional(),
  url: z.string().optional(),
  quantidade: z.string().optional(),
  sku_vendedor: z.string().optional(),
});

function converterLinha(params: {
  readonly bruto: Readonly<Record<string, string>>;
  readonly plataforma: Plataforma;
  readonly fonte: Fonte;
  readonly coletadoEm: Date;
}): Conversao {
  const analise = esquemaLinha.safeParse(params.bruto);

  if (!analise.success) {
    return {
      ok: false,
      motivo: 'a linha não tem o mínimo para virar um produto',
      problemas: analise.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const linha = analise.data;
  const preco = interpretarPreco(linha.preco);

  if (preco.tipo === 'ilegivel') {
    return {
      ok: false,
      motivo: `preço ilegível: ${JSON.stringify(linha.preco)}`,
      problemas: ['preco: não é um valor monetário reconhecível'],
    };
  }

  const url = linha.url !== undefined && linha.url !== '' ? linha.url : null;
  const ean = normalizarEan(linha.ean);

  return {
    ok: true,
    captura: {
      tituloBruto: linha.titulo,
      url,
      plataformaOuSite: params.plataforma,
      precoReais: preco.valor,
      vendedor: null,
      fonte: params.fonte,
      coletadoEm: params.coletadoEm,
      atributos: {
        ...(linha.id_externo !== undefined && linha.id_externo !== ''
          ? { idExterno: linha.id_externo }
          : {}),
        ...(ean !== null ? { ean } : {}),
        ...(linha.sku_vendedor !== undefined && linha.sku_vendedor !== ''
          ? { skuVendedor: linha.sku_vendedor }
          : {}),
        ...(linha.quantidade !== undefined && linha.quantidade !== ''
          ? { quantidade: linha.quantidade }
          : {}),
      },
      /**
       * Conteúdo que define a identidade da captura, para o hash.
       *
       * Inclui o id externo quando existe: duas linhas com o mesmo título mas ids
       * diferentes são dois anúncios, e sem isso a segunda seria tratada como
       * recaptura da primeira e desapareceria.
       */
      conteudoBruto: [params.plataforma, linha.id_externo ?? '', linha.titulo]
        .map((p) => `${String(p.length)}:${p}`)
        .join(''),
    },
  };
}

type PrecoInterpretado =
  | { readonly tipo: 'ausente'; readonly valor: null }
  | { readonly tipo: 'valor'; readonly valor: string }
  | { readonly tipo: 'ilegivel' };

/**
 * Formas aceitas de valor monetário, em ordem de tentativa.
 *
 * Cada forma corresponde a uma convenção real, e é **validada inteira** antes de
 * converter. A primeira versão deste código era uma cadeia de heurísticas
 * ("tem ponto? tem vírgula? o último manda?") e aceitava `1.2.3` como `123` —
 * corrupção silenciosa de preço, que é o pior defeito possível aqui. Validar a
 * forma completa é o que impede isso.
 *
 * A ordem importa em um ponto: decimal exige um grupo de **até dois** dígitos, e
 * milhar exige grupos de **exatamente três**, então as formas não se sobrepõem.
 * `1,50` é um e cinquenta; `1,500` é mil e quinhentos.
 */
const FORMAS_DE_PRECO: readonly {
  readonly padrao: RegExp;
  /** Como chegar ao número com ponto decimal. */
  readonly converter: (valor: string) => string;
}[] = [
  // Inteiro puro: 1234
  { padrao: /^-?\d+$/, converter: (v) => v },
  // Decimal com ponto: 69.90
  { padrao: /^-?\d+\.\d{1,2}$/, converter: (v) => v },
  // Decimal com vírgula: 69,90
  { padrao: /^-?\d+,\d{1,2}$/, converter: (v) => v.replace(',', '.') },
  // Milhar com ponto e decimal com vírgula (pt-BR): 1.234,56
  {
    padrao: /^-?\d{1,3}(\.\d{3})+,\d{1,2}$/,
    converter: (v) => v.replace(/\./g, '').replace(',', '.'),
  },
  // Milhar com vírgula e decimal com ponto (en-US): 1,234.56
  { padrao: /^-?\d{1,3}(,\d{3})+\.\d{1,2}$/, converter: (v) => v.replace(/,/g, '') },
  // Só milhar com ponto: 1.234
  { padrao: /^-?\d{1,3}(\.\d{3})+$/, converter: (v) => v.replace(/\./g, '') },
  // Só milhar com vírgula: 1,234
  { padrao: /^-?\d{1,3}(,\d{3})+$/, converter: (v) => v.replace(/,/g, '') },
];

/**
 * Interpreta preço vindo de célula de planilha.
 *
 * O formato varia muito mais do que parece, e cada caso abaixo aparece em
 * exportação de verdade: `1.234,56`, `1,234.56`, `R$ 69,90`, `69.9` (célula
 * numérica do XLSX), `69,90 ` com espaço, e o espaço inquebrável que o Excel
 * escreve junto do símbolo.
 *
 * Célula vazia é **ausente**, não erro: anúncio de rascunho não tem preço, e
 * rejeitar a linha por isso perderia um anúncio que existe. Célula só com o
 * símbolo da moeda também é ausente — planilha desleixada põe o `R$` numa coluna
 * e o número na seguinte, e a coluna vizinha aparece no relatório de colunas não
 * reconhecidas, que é onde a pessoa vai procurar.
 */
export function interpretarPreco(bruto: string | undefined): PrecoInterpretado {
  if (bruto === undefined) return { tipo: 'ausente', valor: null };

  const limpo = bruto
    .replace(/[\s\u00A0]/g, '')
    .replace(/^R\$?/i, '')
    .trim();

  if (limpo === '' || limpo === '-') return { tipo: 'ausente', valor: null };

  for (const forma of FORMAS_DE_PRECO) {
    if (forma.padrao.test(limpo)) return { tipo: 'valor', valor: forma.converter(limpo) };
  }

  return { tipo: 'ilegivel' };
}

/** Mantém só os dígitos do EAN, e devolve `null` quando o tamanho não serve. */
export function normalizarEan(bruto: string | undefined): string | null {
  if (bruto === undefined) return null;
  const digitos = bruto.replace(/\D/g, '');
  if (digitos === '') return null;
  return /^\d{8}$|^\d{12,14}$/.test(digitos) ? digitos : null;
}
