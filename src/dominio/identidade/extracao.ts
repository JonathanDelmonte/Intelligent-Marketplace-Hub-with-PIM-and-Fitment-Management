/**
 * Extração do registro estruturado por IA, em lote (M3, etapa 5.1).
 *
 * A planilha do marketplace traz título, preço e às vezes EAN; o catálogo do
 * distribuidor traz título e código. Nenhum dos dois traz `{tipo, marca, modelo}` em
 * coluna, e sem isso a forma canônica fica vazia e a chave de agrupamento, nula: a via
 * determinística mais valiosa do M3 — a que liga o `PA21G` do anúncio ao `EF-ELX-21`
 * do distribuidor — não tem o que morder (pendências, 3.2). Separar marca, peça e
 * aparelho num título de marketplace é texto livre heterogêneo, que é onde o ADR 0005
 * diz que IA entra.
 *
 * ## Em lote, porque o gratuito tem cota
 *
 * Regra do dono (CLAUDE.md, 3.7): tudo funciona de graça primeiro. O plano gratuito do
 * OpenRouter dá 50 pedidos por dia, e um título por pedido esgotaria a cota com uma
 * planilha de cinquenta linhas. Vinte títulos por pedido são mil por dia.
 *
 * ## O determinístico antes, e depois
 *
 * Antes de pedir: registro que já tem marca e modelo não vai ao modelo; título igual a
 * um já lido copia o que foi lido; título repetido no lote vai uma vez só. Depois da
 * resposta: marca, código, material e medida que não aparecem no título são
 * descartados. É a regra de `null` em vez de invenção aplicada por código — modelo
 * pequeno "lembra" que o PA21G é da Electrolux, e o título pode não dizer isso.
 *
 * ## O que acontece com cada item
 *
 * - **Lido**: vira registro, mesclado ao que já havia sem sobrescrever o que havia —
 *   dado de origem fraca não sobrescreve o de origem forte (CLAUDE.md, 3.3).
 * - **Recusado pelo esquema**: fica marcado, com o motivo, e não volta ao modelo
 *   sozinho. É o `pendente_revisao` da especificação: o registro ruim fica, o lixo não
 *   é gravado.
 * - **Sem resposta** — o modelo pulou o item, ou a resposta inteira veio torta: volta,
 *   em lote menor, metade a cada tentativa, até três. A tentativa vai na pergunta, e é
 *   isso que faz dela outra pergunta: sem isso, o item que volta sozinho perguntaria
 *   exatamente o mesmo, e o cache devolveria a mesma resposta sem ele — o teste pegou.
 *
 * A marca de tudo isso mora em `atributos_extraidos.extracao`, junto do registro.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno } from '@/infra/banco/schema';
import type { Proposito, ServicoDeLlm } from '@/infra/llm';
import { chaveDeAgrupamento, codigosDeModelo, formaCanonica, normalizarTexto } from './canonico';
import {
  REGISTRO_VAZIO,
  esquemaRegistroDeProduto,
  lerRegistro,
  type RegistroDeProduto,
} from './registro';

export const PROPOSITO_EXTRACAO: Proposito = 'extracao';

/** Títulos por pedido. Vinte por pedido, com 50 pedidos por dia, são mil títulos por dia. */
export const TAMANHO_DO_LOTE_DE_EXTRACAO = 20;

/** Tentativas antes de desistir de um item que o modelo não responde. */
export const MAX_TENTATIVAS_DE_EXTRACAO = 3;

/** O lote de quem já tentou `n` vezes: metade a cada tentativa, nunca menos que um. */
export function tamanhoDoLote(tentativas: number): number {
  return Math.max(1, Math.trunc(TAMANHO_DO_LOTE_DE_EXTRACAO / 2 ** tentativas));
}

/**
 * O que o modelo deve fazer.
 *
 * Curto e com exemplo de código, porque quem lê é o modelo gratuito que o roteador
 * escolher — e modelo pequeno segue regra curta melhor que parágrafo.
 */
export const INSTRUCOES_DE_EXTRACAO = `Você recebe títulos de anúncios de marketplace e de listas de fornecedor de peças, e devolve o registro estruturado de cada produto: um registro por produto, com o mesmo "id" da entrada.

Os campos:
- tipoProduto: o que a peça é, em poucas palavras e em minúsculas ("refil de filtro", "resistência", "correia de lavadora").
- marca: a marca da peça, como escrita no título. Peça "para" ou "compatível com" aparelho de outra marca não é daquela marca: se o título não disser a marca da própria peça, marca é null.
- modeloPeca: o código da própria peça ("EF-ELX-21", "DA29-00020B"), nunca o modelo do aparelho.
- modelosCompativeis: os modelos de aparelho em que a peça serve, como aparecem no título ("PA21G", "PE11B").
- dimensoes: comprimentoMm, larguraMm e alturaMm — só as medidas que o título diz, convertidas para milímetros.
- material, unidade ("un", "par", "kit", "metro") e quantidadeEmbalagem (quantas peças vêm juntas, número inteiro).

A regra que não se quebra: o que o título não diz é null, ou lista vazia. Não complete de memória, não deduza pelo que costuma ser, e não escreva "N/A", "não informado" nem "-". Palavra de venda ("original", "promoção", "pronta entrega", "frete grátis") não é atributo.

"codigosNoTitulo", quando vem, traz os códigos que o sistema já reconheceu no título: use-os para separar o código da peça dos modelos de aparelho.`;

// ─── O pedido e a resposta ──────────────────────────────────────────────────

/** `p1`, `p2`… — curto, porque vai vinte vezes em cada pedido e vinte vezes na resposta. */
function idDoItem(indice: number): string {
  return `p${String(indice + 1)}`;
}

/** O id como o modelo devolveu: `"p3"`, `"P3"` ou `3` são o mesmo item. */
function lerId(bruto: string | number): string {
  const texto = String(bruto).trim().toLowerCase();
  return /^\d+$/.test(texto) ? `p${texto}` : texto;
}

/**
 * A pergunta que vai ao modelo, e **só** ela vai para o hash de cache.
 *
 * Sem id de banco dentro, como a pergunta de identidade: o mesmo lote de títulos
 * capturado em outra instalação deve bater no mesmo cache. A tentativa entra só a
 * partir da segunda, para a primeira continuar sendo a pergunta que se reaproveita.
 */
export function pedidoDeExtracao(titulos: readonly string[], tentativa = 0): unknown {
  return {
    ...(tentativa > 0 ? { tentativa: tentativa + 1 } : {}),
    produtos: titulos.map((titulo, indice) => {
      const codigos = codigosDeModelo(titulo);
      return {
        id: idDoItem(indice),
        titulo,
        ...(codigos.length > 0 ? { codigosNoTitulo: codigos } : {}),
      };
    }),
  };
}

export type ItemExtraido =
  | { readonly tipo: 'ok'; readonly id: string; readonly registro: RegistroDeProduto }
  | {
      readonly tipo: 'recusado';
      readonly id: string | null;
      readonly problemas: readonly string[];
    };

const esquemaIdDoItem = z.union([z.string(), z.number()]);

/**
 * Um item da resposta — e o item que não valida **não derruba o lote**.
 *
 * O `.catch` é o que faz isso: o item torto vira `recusado`, com os problemas e o id
 * quando dá para ler, e os outros dezenove do lote são aproveitados. Sem ele, um
 * `"quantidadeEmbalagem": "três"` num item jogaria fora a resposta inteira.
 */
const esquemaItemDoLote = esquemaRegistroDeProduto
  .extend({ id: esquemaIdDoItem })
  .transform((item): ItemExtraido => {
    const { id, ...registro } = item;
    return { tipo: 'ok', id: lerId(id), registro };
  })
  .catch((ctx): ItemExtraido => {
    const id = z.object({ id: esquemaIdDoItem }).safeParse(ctx.value);
    return {
      tipo: 'recusado',
      id: id.success ? lerId(id.data.id) : null,
      problemas: ctx.issues.map((problema) => {
        // No `.catch` o problema ainda é o cru, com caminho e mensagem opcionais.
        const campo = (problema.path ?? []).join('.');
        const mensagem = problema.message ?? 'valor inválido';
        return campo === '' ? mensagem : `${campo}: ${mensagem}`;
      }),
    };
  });

export const esquemaDoLoteExtraido = z.object({ registros: z.array(esquemaItemDoLote) });

// ─── Depois da resposta: o que o título sustenta ────────────────────────────

/** Só letras e dígitos: `EF-ELX-21`, `ef elx 21` e `EFELX21` são o mesmo código. */
function compacto(texto: string): string {
  return normalizarTexto(texto).replace(/ /g, '');
}

/** Os números do título, com vírgula ou ponto decimal: `30cm` → 30, `1,5 m` → 1,5. */
function numerosDoTitulo(titulo: string): readonly number[] {
  return [...titulo.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}

/**
 * A medida em milímetros aparece no título, em mm, cm ou m?
 *
 * Conversão de polegada fica de fora de propósito: `1/2"` vira dois números soltos, e
 * aceitar qualquer medida que "bata" com uma conta de polegada deixaria passar invenção.
 */
function medidaNoTitulo(mm: number, numeros: readonly number[]): boolean {
  return numeros.some(
    (n) =>
      Math.abs(n - mm) < 0.01 || Math.abs(n * 10 - mm) < 0.01 || Math.abs(n * 1000 - mm) < 0.01,
  );
}

/** Quantidade na embalagem que o título diz: o número, ou "par" e "dupla" para dois. */
function quantidadeNoTitulo(quantidade: number, titulo: string): boolean {
  const normal = ` ${normalizarTexto(titulo)} `;
  if (normal.includes(` ${String(quantidade)} `)) return true;
  // `2un`, `kit2`, `x2`: número colado em letra, que o `normalizarTexto` não separa.
  if (new RegExp(`(^|[^0-9])${String(quantidade)}([^0-9]|$)`).test(normal.replace(/ /g, ' '))) {
    return true;
  }
  return quantidade === 2 && /\s(par|dupla|duplo)\s/.test(normal);
}

export interface RegistroConferido {
  readonly registro: RegistroDeProduto;
  /** Campos que o modelo preencheu e o título não sustenta. */
  readonly descartados: readonly string[];
}

/**
 * Descarta o que o modelo escreveu e o título não diz.
 *
 * É a regra de `null` em vez de invenção, aplicada depois da resposta, por código: a
 * instrução pede, e esta função garante. Marca, código, material, medida e quantidade
 * são conferidos contra o título; o tipo e a unidade não, porque são descrição —
 * "refil de filtro" pode não estar escrito assim em lugar nenhum e estar certo.
 */
export function conferirComOTitulo(registro: RegistroDeProduto, titulo: string): RegistroConferido {
  const normal = ` ${normalizarTexto(titulo)} `;
  const junto = compacto(titulo);
  const numeros = numerosDoTitulo(titulo);
  const descartados: string[] = [];

  const naFrase = (valor: string): boolean => {
    const procurado = normalizarTexto(valor);
    return procurado !== '' && normal.includes(` ${procurado} `);
  };
  const noCodigo = (valor: string): boolean => {
    const procurado = compacto(valor);
    return procurado !== '' && junto.includes(procurado);
  };

  const marca = registro.marca !== null && !naFrase(registro.marca) ? null : registro.marca;
  if (marca !== registro.marca) descartados.push('marca');

  const modeloPeca =
    registro.modeloPeca !== null && !noCodigo(registro.modeloPeca) ? null : registro.modeloPeca;
  if (modeloPeca !== registro.modeloPeca) descartados.push('modeloPeca');

  const modelosCompativeis = registro.modelosCompativeis.filter(noCodigo);
  if (modelosCompativeis.length !== registro.modelosCompativeis.length) {
    descartados.push('modelosCompativeis');
  }

  const material =
    registro.material !== null && !naFrase(registro.material) ? null : registro.material;
  if (material !== registro.material) descartados.push('material');

  const quantidadeEmbalagem =
    registro.quantidadeEmbalagem !== null &&
    !quantidadeNoTitulo(registro.quantidadeEmbalagem, titulo)
      ? null
      : registro.quantidadeEmbalagem;
  if (quantidadeEmbalagem !== registro.quantidadeEmbalagem) {
    descartados.push('quantidadeEmbalagem');
  }

  let dimensoes = registro.dimensoes;
  if (dimensoes !== null) {
    const medida = (mm: number | null): number | null =>
      mm !== null && medidaNoTitulo(mm, numeros) ? mm : null;
    const conferidas = {
      comprimentoMm: medida(dimensoes.comprimentoMm),
      larguraMm: medida(dimensoes.larguraMm),
      alturaMm: medida(dimensoes.alturaMm),
    };
    if (
      conferidas.comprimentoMm !== dimensoes.comprimentoMm ||
      conferidas.larguraMm !== dimensoes.larguraMm ||
      conferidas.alturaMm !== dimensoes.alturaMm
    ) {
      descartados.push('dimensoes');
    }
    const alguma =
      conferidas.comprimentoMm !== null ||
      conferidas.larguraMm !== null ||
      conferidas.alturaMm !== null;
    dimensoes = alguma ? conferidas : null;
  }

  return {
    registro: {
      ...registro,
      marca,
      modeloPeca,
      modelosCompativeis,
      material,
      quantidadeEmbalagem,
      dimensoes,
    },
    descartados,
  };
}

/**
 * Junta o que o título rendeu ao que o produto já tinha, **sem sobrescrever**.
 *
 * O que já estava veio de origem igual ou mais forte — uma pessoa, uma planilha com a
 * coluna, um extrator de página —, e a leitura de um título é a origem mais fraca que
 * há. Só preenche o que está vazio.
 */
export function mesclarRegistro(
  atual: RegistroDeProduto,
  doTitulo: RegistroDeProduto,
): RegistroDeProduto {
  return {
    tipoProduto: atual.tipoProduto ?? doTitulo.tipoProduto,
    marca: atual.marca ?? doTitulo.marca,
    modeloPeca: atual.modeloPeca ?? doTitulo.modeloPeca,
    modelosCompativeis:
      atual.modelosCompativeis.length > 0 ? atual.modelosCompativeis : doTitulo.modelosCompativeis,
    dimensoes: atual.dimensoes ?? doTitulo.dimensoes,
    material: atual.material ?? doTitulo.material,
    unidade: atual.unidade ?? doTitulo.unidade,
    quantidadeEmbalagem: atual.quantidadeEmbalagem ?? doTitulo.quantidadeEmbalagem,
  };
}

// ─── A marca no produto ─────────────────────────────────────────────────────

export const ESTADOS_DA_EXTRACAO = ['feito', 'recusado', 'tentar_de_novo'] as const;
export type EstadoDaExtracao = (typeof ESTADOS_DA_EXTRACAO)[number];

const esquemaMarcaDeExtracao = z.object({
  estado: z.enum(ESTADOS_DA_EXTRACAO),
  tentativas: z.number().int().nonnegative(),
  em: z.string(),
  /** Modelo pedido; `null` quando o determinístico bastou. */
  modelo: z.string().nullable(),
  /**
   * O que o título rendeu, já conferido e antes de mesclar. É o que se copia para
   * outro produto de título igual — e não o registro mesclado, que pode ter dado que
   * veio da planilha daquele produto e não vale para este.
   */
  doTitulo: z.unknown().optional(),
  problemas: z.array(z.string()).default([]),
  descartados: z.array(z.string()).default([]),
});
export type MarcaDeExtracao = z.infer<typeof esquemaMarcaDeExtracao>;

/** A marca de extração de um `atributos_extraidos`, ou `null` quando não há. */
export function lerMarcaDeExtracao(atributos: unknown): MarcaDeExtracao | null {
  const lido = z.object({ extracao: esquemaMarcaDeExtracao }).safeParse(atributos);
  return lido.success ? lido.data.extracao : null;
}

function comoObjeto(atributos: unknown): Record<string, unknown> {
  const lido = z.record(z.string(), z.unknown()).safeParse(atributos);
  return lido.success ? lido.data : {};
}

// ─── O extrator ─────────────────────────────────────────────────────────────

export interface OpcoesDoExtrator {
  readonly llm: ServicoDeLlm;
  readonly modelo: string;
  /** Relógio injetável, para o teste fixar a data da marca. */
  readonly agora?: (() => Date) | undefined;
}

export type ResultadoDaExtracao =
  | { readonly tipo: 'nada_a_extrair' }
  | {
      readonly tipo: 'lote';
      readonly selecionados: number;
      /** Resolvidos sem pedido: já tinham marca e modelo, ou título igual já lido. */
      readonly semPedido: number;
      /** Títulos distintos que foram ao modelo. */
      readonly enviados: number;
      /** Produtos com registro novo — os que a resolução de identidade precisa rever. */
      readonly lidos: readonly string[];
      readonly recusados: number;
      readonly paraTentarDeNovo: number;
      /** Campos descartados por não estarem no título, somando o lote. */
      readonly descartes: number;
      readonly chamada: 'feita' | 'cache' | 'nenhuma' | 'sem_chave' | 'erro';
      readonly erro?: string | undefined;
    };

interface Pendente {
  readonly id: string;
  readonly titulo: string;
  readonly atributos: Record<string, unknown>;
  readonly registro: RegistroDeProduto;
  readonly tentativas: number;
}

const ESTADO = sql<string | null>`${produtoExterno.atributosExtraidos}->'extracao'->>'estado'`;
const TENTATIVAS = sql<number>`coalesce((${produtoExterno.atributosExtraidos}->'extracao'->>'tentativas')::int, 0)`;

/**
 * Quem espera extração: sem chave de agrupamento, e sem marca — ou marcado para tentar
 * de novo, abaixo do teto de tentativas.
 */
const ESPERA_EXTRACAO = and(
  isNull(produtoExterno.chaveAgrupamento),
  sql`(${ESTADO} is null or (${ESTADO} = 'tentar_de_novo' and ${TENTATIVAS} < ${MAX_TENTATIVAS_DE_EXTRACAO}))`,
);

/** Quantos produtos esperam a leitura do título. A tela de juntar iguais mostra. */
export async function esperandoExtracao(db: Banco): Promise<number> {
  const [linha] = await db
    .select({ quantos: sql<number>`count(*)::int` })
    .from(produtoExterno)
    .where(ESPERA_EXTRACAO);
  return linha?.quantos ?? 0;
}

export class ExtratorDeRegistros {
  constructor(
    private readonly db: Banco,
    private readonly opcoes: OpcoesDoExtrator,
  ) {}

  private agora(): Date {
    return this.opcoes.agora?.() ?? new Date();
  }

  /**
   * Extrai um lote: no máximo um pedido ao modelo.
   *
   * Propaga `ExecucaoInterrompida` — a cota do provedor ou o teto da execução —, e o que
   * foi resolvido sem pedido antes dela já está gravado. O resto volta como valor.
   */
  async extrairLote(): Promise<ResultadoDaExtracao> {
    const pendentes = await this.selecionar();
    if (pendentes.length === 0) return { tipo: 'nada_a_extrair' };

    const lidos: string[] = [];
    let semPedido = 0;

    // 1. Já tem marca e modelo: nada a perguntar. Só faltava a chave ser calculada.
    const aLer: Pendente[] = [];
    for (const pendente of pendentes) {
      if (chaveDeAgrupamento(pendente.registro) !== null) {
        await this.gravarLido(pendente, null, null, []);
        lidos.push(pendente.id);
        semPedido += 1;
      } else {
        aLer.push(pendente);
      }
    }

    // 2. Título igual a um já lido: copia o que ele rendeu.
    const jaLidos = await this.lidosPorTitulo([...new Set(aLer.map((p) => p.titulo))]);
    const aPerguntar: Pendente[] = [];
    for (const pendente of aLer) {
      const lido = jaLidos.get(pendente.titulo);
      if (lido === undefined) {
        aPerguntar.push(pendente);
        continue;
      }
      await this.gravarLido(pendente, lido.registro, lido.modelo, []);
      lidos.push(pendente.id);
      semPedido += 1;
    }

    const base = {
      tipo: 'lote' as const,
      selecionados: pendentes.length,
      semPedido,
    };
    if (aPerguntar.length === 0) {
      return {
        ...base,
        enviados: 0,
        lidos,
        recusados: 0,
        paraTentarDeNovo: 0,
        descartes: 0,
        chamada: 'nenhuma',
      };
    }

    // 3. Título repetido no lote vai uma vez só.
    const titulos = [...new Set(aPerguntar.map((p) => p.titulo))];
    const resultado = await this.opcoes.llm.pedir({
      proposito: PROPOSITO_EXTRACAO,
      modelo: this.opcoes.modelo,
      instrucoes: INSTRUCOES_DE_EXTRACAO,
      entrada: pedidoDeExtracao(titulos, pendentes[0]?.tentativas ?? 0),
      esquema: esquemaDoLoteExtraido,
    });

    if (resultado.tipo === 'sem_chave' || resultado.tipo === 'erro') {
      // Nada é marcado: a falha não é do item, e contá-la como tentativa faria um
      // problema de configuração — chave recusada, privacidade do gratuito — descartar
      // o catálogo inteiro, três lotes por vez.
      return {
        ...base,
        enviados: titulos.length,
        lidos,
        recusados: 0,
        paraTentarDeNovo: 0,
        descartes: 0,
        chamada: resultado.tipo,
        ...(resultado.tipo === 'erro' ? { erro: resultado.mensagem } : {}),
      };
    }

    const porTitulo = new Map<string, ItemExtraido>();
    if (resultado.tipo === 'ok') {
      const porId = new Map<string, ItemExtraido>();
      for (const item of resultado.valor.registros) {
        if (item.id !== null && !porId.has(item.id)) porId.set(item.id, item);
      }
      titulos.forEach((titulo, indice) => {
        const item = porId.get(idDoItem(indice));
        if (item !== undefined) porTitulo.set(titulo, item);
      });
    }
    const problemasDoLote =
      resultado.tipo === 'pendente_revisao' ? resultado.problemas.slice(0, 5) : [];

    let recusados = 0;
    let paraTentarDeNovo = 0;
    let descartes = 0;

    for (const pendente of aPerguntar) {
      const item = porTitulo.get(pendente.titulo);

      if (item?.tipo === 'ok') {
        const conferido = conferirComOTitulo(item.registro, pendente.titulo);
        await this.gravarLido(
          pendente,
          conferido.registro,
          this.opcoes.modelo,
          conferido.descartados,
        );
        lidos.push(pendente.id);
        descartes += conferido.descartados.length;
        continue;
      }

      if (item?.tipo === 'recusado') {
        await this.gravarMarca(pendente, {
          estado: 'recusado',
          tentativas: pendente.tentativas + 1,
          modelo: this.opcoes.modelo,
          problemas: item.problemas.slice(0, 5),
        });
        recusados += 1;
        continue;
      }

      // Sem resposta para o item. Na última tentativa vira recusa, com o motivo.
      const tentativas = pendente.tentativas + 1;
      const esgotou = tentativas >= MAX_TENTATIVAS_DE_EXTRACAO;
      await this.gravarMarca(pendente, {
        estado: esgotou ? 'recusado' : 'tentar_de_novo',
        tentativas,
        modelo: this.opcoes.modelo,
        problemas:
          problemasDoLote.length > 0
            ? problemasDoLote
            : [`o modelo não devolveu este item (tentativa ${String(tentativas)})`],
      });
      if (esgotou) recusados += 1;
      else paraTentarDeNovo += 1;
    }

    return {
      ...base,
      enviados: titulos.length,
      lidos,
      recusados,
      paraTentarDeNovo,
      descartes,
      chamada: resultado.deCache ? 'cache' : 'feita',
    };
  }

  /**
   * O próximo lote: quem tentou menos vai primeiro, e o lote é do tamanho da tentativa.
   *
   * Todos do lote têm o mesmo número de tentativas — é isso que faz o lote de quem já
   * falhou uma vez ser a metade, e por isso uma pergunta nova.
   */
  private async selecionar(): Promise<readonly Pendente[]> {
    const [primeiro] = await this.db
      .select({ tentativas: TENTATIVAS })
      .from(produtoExterno)
      .where(ESPERA_EXTRACAO)
      .orderBy(asc(TENTATIVAS), asc(produtoExterno.criadoEm))
      .limit(1);
    if (primeiro === undefined) return [];

    const tentativas = Number(primeiro.tentativas);
    const linhas = await this.db
      .select({
        id: produtoExterno.id,
        titulo: produtoExterno.tituloBruto,
        atributos: produtoExterno.atributosExtraidos,
      })
      .from(produtoExterno)
      .where(and(ESPERA_EXTRACAO, sql`${TENTATIVAS} = ${tentativas}`))
      .orderBy(asc(produtoExterno.criadoEm), asc(produtoExterno.id))
      .limit(tamanhoDoLote(tentativas));

    return linhas.map((linha) => {
      const leitura = lerRegistro(linha.atributos);
      return {
        id: linha.id,
        titulo: linha.titulo,
        atributos: comoObjeto(linha.atributos),
        registro: leitura.tipo === 'ok' ? leitura.registro : REGISTRO_VAZIO,
        tentativas,
      };
    });
  }

  /** O que cada título já rendeu em outro produto, para copiar sem perguntar. */
  private async lidosPorTitulo(
    titulos: readonly string[],
  ): Promise<
    ReadonlyMap<string, { readonly registro: RegistroDeProduto; readonly modelo: string | null }>
  > {
    const mapa = new Map<
      string,
      { readonly registro: RegistroDeProduto; readonly modelo: string | null }
    >();
    if (titulos.length === 0) return mapa;

    const linhas = await this.db
      .select({ titulo: produtoExterno.tituloBruto, atributos: produtoExterno.atributosExtraidos })
      .from(produtoExterno)
      .where(
        and(
          inArray(produtoExterno.tituloBruto, [...titulos]),
          sql`${ESTADO} = 'feito'`,
          sql`${produtoExterno.atributosExtraidos}->'extracao'->'doTitulo' is not null`,
        ),
      );

    for (const linha of linhas) {
      if (mapa.has(linha.titulo)) continue;
      const marca = lerMarcaDeExtracao(linha.atributos);
      if (marca === null) continue;
      const leitura = lerRegistro(marca.doTitulo);
      if (leitura.tipo === 'ok')
        mapa.set(linha.titulo, { registro: leitura.registro, modelo: marca.modelo });
    }
    return mapa;
  }

  /**
   * Grava o registro lido e recalcula forma canônica e chave de agrupamento.
   *
   * `doTitulo` nulo é o caso de quem já tinha marca e modelo: nada foi lido, e o que se
   * grava é a marca e a chave que faltava calcular.
   */
  private async gravarLido(
    pendente: Pendente,
    doTitulo: RegistroDeProduto | null,
    modelo: string | null,
    descartados: readonly string[],
  ): Promise<void> {
    const registro =
      doTitulo === null ? pendente.registro : mesclarRegistro(pendente.registro, doTitulo);
    const marca: MarcaDeExtracao = {
      estado: 'feito',
      tentativas: pendente.tentativas + (modelo === null ? 0 : 1),
      em: this.agora().toISOString(),
      modelo,
      ...(doTitulo === null ? {} : { doTitulo }),
      problemas: [],
      descartados: [...descartados],
    };

    await this.db
      .update(produtoExterno)
      .set({
        atributosExtraidos: { ...pendente.atributos, ...registro, extracao: marca },
        formaCanonica: formaCanonica(registro),
        chaveAgrupamento: chaveDeAgrupamento(registro),
        atualizadoEm: new Date(),
      })
      .where(eq(produtoExterno.id, pendente.id));
  }

  private async gravarMarca(
    pendente: Pendente,
    params: {
      readonly estado: Exclude<EstadoDaExtracao, 'feito'>;
      readonly tentativas: number;
      readonly modelo: string;
      readonly problemas: readonly string[];
    },
  ): Promise<void> {
    const marca: MarcaDeExtracao = {
      estado: params.estado,
      tentativas: params.tentativas,
      em: this.agora().toISOString(),
      modelo: params.modelo,
      problemas: [...params.problemas],
      descartados: [],
    };
    await this.db
      .update(produtoExterno)
      .set({
        atributosExtraidos: { ...pendente.atributos, extracao: marca },
        atualizadoEm: new Date(),
      })
      .where(eq(produtoExterno.id, pendente.id));
  }
}
