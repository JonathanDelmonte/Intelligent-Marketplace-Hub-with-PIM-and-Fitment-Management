/**
 * Persistência de fornecedor, com a triagem aplicada na leitura.
 *
 * A triagem não é gravada. É função pura sobre as cinco respostas, e recalcular na
 * leitura é o que faz mudança de critério valer para o cadastro antigo — se o
 * veredito fosse coluna, subir o limite de prazo deixaria a base com dois
 * vereditos conforme a data do cadastro. O mesmo raciocínio de família e linhagem
 * em compatibilidade.
 *
 * **Fornecedor é base compartilhada: sem `perfil_id`** (ADR 0003). "A Acme posta
 * com etiqueta e emite nota" é verdade sobre a Acme, não sobre o vendedor. O que é
 * do perfil é o preço que ela cobra de um SKU seu — e aí o filtro entra pelo SKU.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PerfilId } from '@/dominio/catalogo/sku';
import type { Fonte } from '@/dominio/procedencia';
import { centavos, type Centavos } from '@/lib/dinheiro';
import type { Banco } from '@/infra/banco/cliente';
import { fornecedor, fornecedorPrecoHistorico, fornecedorSku, sku } from '@/infra/banco/schema';
import { triarFornecedor, type CriterioDeTriagem, type Triagem } from './triagem';

export const CANAIS = ['whatsapp', 'email', 'telefone'] as const;
export type Canal = (typeof CANAIS)[number];

export const ORIGENS = ['nacional', 'importado', 'china'] as const;
export type Origem = (typeof ORIGENS)[number];

export interface DadosDoFornecedor {
  readonly nome: string;
  readonly cnpj?: string | null;
  readonly site?: string | null;
  readonly contato?: string | null;
  readonly canal?: Canal | null;
  readonly origem?: Origem | null;
  readonly notas?: string | null;
  readonly fonte: Fonte;
}

/** As cinco respostas, como chegam do formulário: `undefined` = não mexeu. */
export interface RespostasInformadas {
  readonly postaComEtiqueta?: boolean | null;
  readonly emiteNf?: boolean | null;
  readonly prazoPostagemDias?: number | null;
  readonly pedidoMinimoReais?: Centavos | null;
  readonly pedidoMinimoUn?: number | null;
  readonly vendeDiretoMarketplace?: boolean | null;
}

export interface FornecedorGravado {
  readonly id: string;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly site: string | null;
  readonly contato: string | null;
  readonly canal: Canal | null;
  readonly origem: Origem | null;
  readonly notas: string | null;
  readonly confiabilidade: number | null;
  readonly postaComEtiqueta: boolean | null;
  readonly emiteNf: boolean | null;
  readonly prazoPostagemDias: number | null;
  readonly pedidoMinimoReais: Centavos | null;
  readonly pedidoMinimoUn: number | null;
  readonly vendeDiretoMarketplace: boolean | null;
  /** Recalculada a cada leitura, nunca gravada. */
  readonly triagem: Triagem;
}

export class FornecedorInvalido extends Error {
  override readonly name = 'FornecedorInvalido';
}

/**
 * A linha de `fornecedor` como o driver devolve.
 *
 * Declarada em vez de inferida do `select` porque ela atravessa três métodos, e
 * tipo inferido de consulta muda de forma quando a consulta muda de colunas — o
 * que faria o erro aparecer longe da causa.
 */
interface LinhaDeFornecedor {
  readonly id: string;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly site: string | null;
  readonly contato: string | null;
  readonly canal: Canal | null;
  readonly origem: Origem | null;
  readonly notas: string | null;
  readonly confiabilidade: number | null;
  readonly postaComEtiqueta: boolean | null;
  readonly emiteNf: boolean | null;
  readonly prazoPostagemDias: number | null;
  readonly pedidoMinimoReais: number | null;
  readonly pedidoMinimoUn: number | null;
  readonly vendeDiretoMarketplace: boolean | null;
}

/** Dinheiro que vem do banco passa pelo construtor, não por conversão de tipo. */
function dinheiroDoBanco(valor: number | null): Centavos | null {
  return valor === null ? null : centavos(valor);
}

/** Aumento de preço acima disto vira aviso. Escolha do projeto, configurável. */
export const AUMENTO_QUE_AVISA_BP = 500;

export interface PrecoDoFornecedor {
  readonly fornecedorId: string;
  readonly fornecedorNome: string;
  readonly preco: Centavos | null;
  readonly codigoNoFornecedor: string | null;
  readonly precoAtualizadoEm: Date | null;
  /** Veredito da triagem, para a tela não oferecer quem já foi descartado. */
  readonly triagem: Triagem;
}

export class RepositorioDeFornecedores {
  constructor(
    private readonly db: Banco,
    private readonly criterio?: CriterioDeTriagem,
  ) {}

  private triar(linha: {
    readonly postaComEtiqueta: boolean | null;
    readonly emiteNf: boolean | null;
    readonly prazoPostagemDias: number | null;
    readonly pedidoMinimoReais: number | null;
    readonly pedidoMinimoUn: number | null;
    readonly vendeDiretoMarketplace: boolean | null;
  }): Triagem {
    const respostas = {
      postaComEtiqueta: linha.postaComEtiqueta,
      emiteNf: linha.emiteNf,
      prazoPostagemDias: linha.prazoPostagemDias,
      pedidoMinimoReais: dinheiroDoBanco(linha.pedidoMinimoReais),
      pedidoMinimoUn: linha.pedidoMinimoUn,
      vendeDiretoMarketplace: linha.vendeDiretoMarketplace,
    };
    return this.criterio === undefined
      ? triarFornecedor(respostas)
      : triarFornecedor(respostas, this.criterio);
  }

  private colunas() {
    return {
      id: fornecedor.id,
      nome: fornecedor.nome,
      cnpj: fornecedor.cnpj,
      site: fornecedor.site,
      contato: fornecedor.contato,
      canal: fornecedor.canal,
      origem: fornecedor.origem,
      notas: fornecedor.notas,
      confiabilidade: fornecedor.confiabilidade,
      postaComEtiqueta: fornecedor.postaComEtiqueta,
      emiteNf: fornecedor.emiteNf,
      prazoPostagemDias: fornecedor.prazoPostagemDias,
      pedidoMinimoReais: fornecedor.pedidoMinimoReais,
      pedidoMinimoUn: fornecedor.pedidoMinimoUn,
      vendeDiretoMarketplace: fornecedor.vendeDiretoMarketplace,
    };
  }

  private montar(linha: LinhaDeFornecedor): FornecedorGravado {
    return {
      ...linha,
      pedidoMinimoReais: dinheiroDoBanco(linha.pedidoMinimoReais),
      triagem: this.triar(linha),
    };
  }

  async criar(dados: DadosDoFornecedor): Promise<FornecedorGravado> {
    const nome = dados.nome.trim();
    if (nome === '') throw new FornecedorInvalido('fornecedor sem nome');

    const gravados = await this.db
      .insert(fornecedor)
      .values({
        nome,
        cnpj: dados.cnpj ?? null,
        site: dados.site ?? null,
        contato: dados.contato ?? null,
        canal: dados.canal ?? null,
        origem: dados.origem ?? null,
        notas: dados.notas ?? null,
        fonte: dados.fonte,
      })
      .returning(this.colunas());

    const criado = gravados[0];
    if (criado === undefined) throw new FornecedorInvalido(`não gravou o fornecedor ${nome}`);
    return this.montar(criado);
  }

  /**
   * Grava as respostas informadas, deixando as outras como estavam.
   *
   * `undefined` é "não mexeu" e `null` é "apagar a resposta" — a distinção existe
   * porque um formulário que manda todos os campos apagaria o que não foi editado,
   * e apagar resposta por descuido devolve o fornecedor para a fila de perguntas.
   */
  async responder(id: string, respostas: RespostasInformadas): Promise<FornecedorGravado | null> {
    const campos = {
      ...(respostas.postaComEtiqueta === undefined
        ? {}
        : { postaComEtiqueta: respostas.postaComEtiqueta }),
      ...(respostas.emiteNf === undefined ? {} : { emiteNf: respostas.emiteNf }),
      ...(respostas.prazoPostagemDias === undefined
        ? {}
        : { prazoPostagemDias: respostas.prazoPostagemDias }),
      ...(respostas.pedidoMinimoReais === undefined
        ? {}
        : { pedidoMinimoReais: respostas.pedidoMinimoReais }),
      ...(respostas.pedidoMinimoUn === undefined
        ? {}
        : { pedidoMinimoUn: respostas.pedidoMinimoUn }),
      ...(respostas.vendeDiretoMarketplace === undefined
        ? {}
        : {
            vendeDiretoMarketplace: respostas.vendeDiretoMarketplace,
            // Registrar **quando** se soube importa: a resposta envelhece, e
            // fornecedor que não vendia na vitrine ano passado pode vender hoje.
            vendeDiretoVerificadoEm: new Date(),
          }),
    };

    if (Object.keys(campos).length === 0) return this.porId(id);

    const alterados = await this.db
      .update(fornecedor)
      .set({ ...campos, atualizadoEm: new Date() })
      .where(eq(fornecedor.id, id))
      .returning(this.colunas());

    const linha = alterados[0];
    return linha === undefined ? null : this.montar(linha);
  }

  async porId(id: string): Promise<FornecedorGravado | null> {
    const linhas = await this.db
      .select(this.colunas())
      .from(fornecedor)
      .where(eq(fornecedor.id, id))
      .limit(1);
    const linha = linhas[0];
    return linha === undefined ? null : this.montar(linha);
  }

  /** Todos, em ordem alfabética — a ordem em que se procura um nome. */
  async listar(limite = 100): Promise<readonly FornecedorGravado[]> {
    const linhas = await this.db
      .select(this.colunas())
      .from(fornecedor)
      .orderBy(fornecedor.nome)
      .limit(limite);
    return linhas.map((l) => this.montar(l));
  }

  /** Contagem por veredito, para a tela dizer o tamanho da base sem carregar tudo. */
  async contarPorVeredito(): Promise<Readonly<Record<Triagem['veredito'], number>>> {
    const todos = await this.listar(1_000);
    const contagem = { descartar: 0, perguntar: 0, ressalva: 0, aprovado: 0 };
    for (const f of todos) contagem[f.triagem.veredito] += 1;
    return contagem;
  }

  /**
   * Grava o preço de um SKU num fornecedor e devolve o aumento, quando houver.
   *
   * O histórico é o que detecta **aumento silencioso**: o fornecedor sobe o preço,
   * ninguém avisa, e a margem só aparece errada no fechamento do mês. Por isso o
   * histórico recebe uma linha a cada gravação, mesmo quando o preço não mudou —
   * saber que o preço foi conferido ontem vale tanto quanto saber qual é.
   */
  async registrarPreco(params: {
    readonly fornecedorId: string;
    readonly skuId: string;
    readonly preco: Centavos;
    readonly fonte: Fonte;
    readonly codigoNoFornecedor?: string | null;
    readonly urlOrigem?: string | null;
    readonly estoqueInformado?: number | null;
  }): Promise<{
    readonly precoAnterior: Centavos | null;
    readonly variacaoBp: number | null;
    readonly aumentoRelevante: boolean;
  }> {
    const anteriores = await this.db
      .select({ preco: fornecedorSku.preco })
      .from(fornecedorSku)
      .where(
        and(
          eq(fornecedorSku.fornecedorId, params.fornecedorId),
          eq(fornecedorSku.skuId, params.skuId),
        ),
      )
      .limit(1);

    const precoAnterior = dinheiroDoBanco(anteriores[0]?.preco ?? null);

    const valores = {
      fornecedorId: params.fornecedorId,
      skuId: params.skuId,
      preco: params.preco,
      precoAtualizadoEm: new Date(),
      codigoNoFornecedor: params.codigoNoFornecedor ?? null,
      urlOrigem: params.urlOrigem ?? null,
      estoqueInformado: params.estoqueInformado ?? null,
      fonte: params.fonte,
    };

    await this.db
      .insert(fornecedorSku)
      .values(valores)
      .onConflictDoUpdate({
        target: [fornecedorSku.fornecedorId, fornecedorSku.skuId],
        set: { ...valores, atualizadoEm: new Date() },
      });

    await this.db.insert(fornecedorPrecoHistorico).values({
      fornecedorId: params.fornecedorId,
      skuId: params.skuId,
      preco: params.preco,
      fonte: params.fonte,
    });

    if (precoAnterior === null || precoAnterior === 0) {
      return { precoAnterior, variacaoBp: null, aumentoRelevante: false };
    }

    // Pontos-base inteiros, como toda porcentagem deste sistema: comparar float de
    // preço para decidir se "subiu" é a forma de avisar de aumento que não houve.
    const variacaoBp = Math.trunc(((params.preco - precoAnterior) * 10_000) / precoAnterior);
    return {
      precoAnterior,
      variacaoBp,
      aumentoRelevante: variacaoBp >= AUMENTO_QUE_AVISA_BP,
    };
  }

  /** Quem vende este SKU e a quanto, mais barato primeiro. */
  async precosDoSku(perfil: PerfilId, skuId: string): Promise<readonly PrecoDoFornecedor[]> {
    const linhas = await this.db
      .select({
        fornecedorId: fornecedorSku.fornecedorId,
        fornecedorNome: fornecedor.nome,
        preco: fornecedorSku.preco,
        codigoNoFornecedor: fornecedorSku.codigoNoFornecedor,
        precoAtualizadoEm: fornecedorSku.precoAtualizadoEm,
        postaComEtiqueta: fornecedor.postaComEtiqueta,
        emiteNf: fornecedor.emiteNf,
        prazoPostagemDias: fornecedor.prazoPostagemDias,
        pedidoMinimoReais: fornecedor.pedidoMinimoReais,
        pedidoMinimoUn: fornecedor.pedidoMinimoUn,
        vendeDiretoMarketplace: fornecedor.vendeDiretoMarketplace,
      })
      .from(fornecedorSku)
      .innerJoin(fornecedor, eq(fornecedor.id, fornecedorSku.fornecedorId))
      // O SKU é do perfil, então o filtro por perfil entra por aqui — mesmo que o
      // fornecedor seja base compartilhada.
      .innerJoin(sku, eq(sku.id, fornecedorSku.skuId))
      .where(and(eq(fornecedorSku.skuId, skuId), eq(sku.perfilId, perfil)))
      .orderBy(sql`${fornecedorSku.preco} asc nulls last`);

    return linhas.map((l) => ({
      fornecedorId: l.fornecedorId,
      fornecedorNome: l.fornecedorNome,
      preco: dinheiroDoBanco(l.preco),
      codigoNoFornecedor: l.codigoNoFornecedor,
      precoAtualizadoEm: l.precoAtualizadoEm,
      triagem: this.triar(l),
    }));
  }

  /** Histórico de preço, mais recente primeiro. É o que mostra o aumento. */
  async historicoDePreco(
    fornecedorId: string,
    skuId: string,
    limite = 20,
  ): Promise<readonly { readonly preco: Centavos; readonly em: Date }[]> {
    const linhas = await this.db
      .select({
        preco: fornecedorPrecoHistorico.preco,
        em: fornecedorPrecoHistorico.coletadoEm,
      })
      .from(fornecedorPrecoHistorico)
      .where(
        and(
          eq(fornecedorPrecoHistorico.fornecedorId, fornecedorId),
          eq(fornecedorPrecoHistorico.skuId, skuId),
        ),
      )
      .orderBy(desc(fornecedorPrecoHistorico.coletadoEm))
      .limit(limite);

    return linhas.map((l) => ({ preco: centavos(l.preco), em: l.em }));
  }
}
