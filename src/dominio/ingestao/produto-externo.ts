/**
 * Gravação de `produto_externo` (M1, etapa 3.9).
 *
 * Duas invariantes que a especificação declara e este módulo aplica:
 *
 * 1. **Tudo que entra vira `produto_externo`, nunca `sku` direto.** Você captura
 *    dezenas de ocorrências do mesmo produto em lugares diferentes antes de saber
 *    que são o mesmo produto. Fundir na captura é o erro que destrói a base.
 * 2. **Schema que falha vira `pendente_revisao`, nunca descarte.** O registro
 *    ruim é mais valioso que registro nenhum: dá para corrigir à mão, e ensina o
 *    extrator.
 *
 * E a disciplina de custo do ADR 0005: `hash_conteudo` é único, então recapturar
 * a mesma página não paga extração nem embedding de novo.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { reaisParaCentavos } from '@/lib/dinheiro';
import type { Fonte } from '@/dominio/procedencia';
import { FONTES } from '@/dominio/procedencia';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno, precoHistorico } from '@/infra/banco/schema';

/**
 * Schema de um produto externo capturado.
 *
 * O que é obrigatório aqui é deliberadamente pouco: **só o título bruto e a
 * procedência**. Exigir preço faria uma página sem preço visível ser descartada,
 * e uma ocorrência sem preço ainda alimenta o grafo de identidade.
 *
 * `atributos` aceita qualquer objeto porque é a saída de extração por LLM, e
 * atributo que não aparece é `null` — nunca invenção.
 */
export const esquemaProdutoExternoCapturado = z.object({
  tituloBruto: z.string().trim().min(3, 'título muito curto para identificar um produto'),
  url: z.string().url().nullable().default(null),
  plataformaOuSite: z.string().trim().min(1).nullable().default(null),
  /** Preço em **reais**, como veio da página. Convertido para centavos ao gravar. */
  precoReais: z.union([z.number(), z.string()]).nullable().default(null),
  moeda: z.string().trim().length(3).default('BRL'),
  vendedor: z.string().trim().nullable().default(null),
  vendasEstimadas: z.number().int().nonnegative().nullable().default(null),
  atributos: z.record(z.string(), z.unknown()).nullable().default(null),
  fonte: z.enum(FONTES),
  coletadoEm: z.coerce.date().default(() => new Date()),
  /** Conteúdo bruto que originou a captura, para calcular o hash. */
  conteudoBruto: z.string().nullable().default(null),
});

export type ProdutoExternoCapturado = z.input<typeof esquemaProdutoExternoCapturado>;

export type ResultadoDaGravacao =
  | {
      readonly tipo: 'gravado';
      readonly id: string;
      readonly hashConteudo: string;
    }
  | {
      readonly tipo: 'duplicado';
      readonly id: string;
      readonly hashConteudo: string;
      /** `true` quando o preço mudou e uma linha de histórico foi acrescentada. */
      readonly precoAtualizado: boolean;
    }
  | {
      readonly tipo: 'pendente_revisao';
      readonly motivo: string;
      readonly problemas: readonly string[];
      /** O que veio, preservado para revisão humana. Nunca descartado. */
      readonly bruto: unknown;
    };

/**
 * Hash do conteúdo capturado.
 *
 * Calculado do **conteúdo bruto** quando houver (o HTML, o texto da célula), e
 * da identidade extraída quando não. A escolha importa: hash do HTML muda a cada
 * variação de anúncio e recaptura de verdade; hash da identidade colapsaria
 * capturas legitimamente diferentes.
 *
 * A URL entra sempre que existe, porque o mesmo título em dois vendedores são duas
 * ocorrências — e é exatamente isso que o grafo precisa saber.
 */
export function calcularHashConteudo(params: {
  readonly conteudoBruto?: string | null;
  readonly url?: string | null;
  readonly tituloBruto: string;
  readonly plataformaOuSite?: string | null;
}): string {
  const partes = [
    params.url ?? '',
    params.plataformaOuSite ?? '',
    params.conteudoBruto ?? normalizarTitulo(params.tituloBruto),
  ];
  // Prefixa cada parte com o próprio tamanho em vez de usar um separador: nenhum
  // conteúdo consegue simular a fronteira, e o arquivo-fonte fica ASCII puro.
  const canonico = partes.map((parte) => `${String(parte.length)}:${parte}`).join('');
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Normaliza título para o hash.
 *
 * Só o que não muda o produto: caixa, acento e espaço repetido. **Não** remove
 * palavra-chave de SEO nem reordena termos — isso é trabalho do M3, que decide
 * identidade com julgamento, e fazer aqui colapsaria produtos diferentes.
 */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class IngestorDeProdutoExterno {
  constructor(private readonly db: Banco) {}

  /**
   * Valida e grava uma captura.
   *
   * Nunca lança por dado ruim: schema que falha devolve `pendente_revisao` com o
   * bruto preservado. Lança apenas por falha de infraestrutura, que é o que a
   * fila deve reagendar com backoff.
   */
  async gravar(bruto: unknown): Promise<ResultadoDaGravacao> {
    const analise = esquemaProdutoExternoCapturado.safeParse(bruto);

    if (!analise.success) {
      const problemas = analise.error.issues.map((i) => {
        const campo = i.path.join('.');
        return campo === '' ? i.message : `${campo}: ${i.message}`;
      });
      return {
        tipo: 'pendente_revisao',
        motivo: 'a captura não valida contra o schema',
        problemas,
        bruto,
      };
    }

    const capturado = analise.data;

    // Preço vem da página como texto de formato imprevisível. Preço ilegível não
    // invalida a captura: vira `null` com nota, porque a ocorrência ainda serve
    // ao grafo de identidade.
    let precoCentavos: number | null = null;
    if (capturado.precoReais !== null) {
      try {
        precoCentavos = reaisParaCentavos(capturado.precoReais);
      } catch {
        return {
          tipo: 'pendente_revisao',
          motivo: `preço ilegível: ${JSON.stringify(capturado.precoReais)}`,
          problemas: ['precoReais: não é um valor monetário reconhecível'],
          bruto,
        };
      }
    }

    const hashConteudo = calcularHashConteudo(capturado);

    const inseridos = await this.db
      .insert(produtoExterno)
      .values({
        tituloBruto: capturado.tituloBruto,
        url: capturado.url,
        plataformaOuSite: capturado.plataformaOuSite,
        preco: precoCentavos,
        moeda: capturado.moeda,
        vendedor: capturado.vendedor,
        vendasEstimadas: capturado.vendasEstimadas,
        atributosExtraidos: capturado.atributos,
        hashConteudo,
        fonte: capturado.fonte,
        coletadoEm: capturado.coletadoEm,
        origemUrl: capturado.url,
      })
      .onConflictDoNothing({ target: produtoExterno.hashConteudo })
      .returning({ id: produtoExterno.id });

    const criado = inseridos[0];

    if (criado !== undefined) {
      if (precoCentavos !== null) {
        await this.registrarPreco(criado.id, precoCentavos, capturado.fonte, capturado.coletadoEm);
      }
      return { tipo: 'gravado', id: criado.id, hashConteudo };
    }

    // Já existia: recaptura da mesma página. Não paga extração de novo, mas o
    // preço pode ter mudado, e a série histórica é o que alimenta o detector de
    // queda real (M13) e o de aumento silencioso de fornecedor (M5).
    const existente = await this.buscarPorHash(hashConteudo);
    if (existente === null) {
      throw new Error(`conflito no hash ${hashConteudo}, mas o registro não foi encontrado`);
    }

    let precoAtualizado = false;
    if (precoCentavos !== null && precoCentavos !== existente.preco) {
      await this.db
        .update(produtoExterno)
        .set({ preco: precoCentavos, coletadoEm: capturado.coletadoEm, atualizadoEm: new Date() })
        .where(eq(produtoExterno.id, existente.id));
      await this.registrarPreco(existente.id, precoCentavos, capturado.fonte, capturado.coletadoEm);
      precoAtualizado = true;
    }

    return { tipo: 'duplicado', id: existente.id, hashConteudo, precoAtualizado };
  }

  private async registrarPreco(
    produtoExternoId: string,
    preco: number,
    fonte: Fonte,
    coletadoEm: Date,
  ): Promise<void> {
    await this.db.insert(precoHistorico).values({ produtoExternoId, preco, fonte, coletadoEm });
  }

  async buscarPorHash(
    hashConteudo: string,
  ): Promise<{ readonly id: string; readonly preco: number | null } | null> {
    const linhas = await this.db
      .select({ id: produtoExterno.id, preco: produtoExterno.preco })
      .from(produtoExterno)
      .where(eq(produtoExterno.hashConteudo, hashConteudo))
      .limit(1);
    return linhas[0] ?? null;
  }

  /** Série histórica de preço, mais antiga primeiro. */
  async historicoDePreco(
    produtoExternoId: string,
  ): Promise<readonly { readonly preco: number; readonly coletadoEm: Date }[]> {
    const linhas = await this.db
      .select({ preco: precoHistorico.preco, coletadoEm: precoHistorico.coletadoEm })
      .from(precoHistorico)
      .where(eq(precoHistorico.produtoExternoId, produtoExternoId))
      .orderBy(precoHistorico.coletadoEm);

    return linhas.flatMap((l) =>
      l.preco === null ? [] : [{ preco: l.preco, coletadoEm: l.coletadoEm }],
    );
  }
}
