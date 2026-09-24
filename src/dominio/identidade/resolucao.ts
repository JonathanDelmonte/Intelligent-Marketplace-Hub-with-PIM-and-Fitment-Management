/**
 * O orquestrador da resolução de identidade (M3, etapas 5.4 e 5.5).
 *
 * Junta o que os outros arquivos fazem, na ordem que custa menos:
 *
 * 1. **Preparar** — forma canônica e chave de agrupamento, determinísticas. Roda
 *    hoje, sem chave de LLM, e é o que faz os dois passos seguintes existirem.
 * 2. **Gerar candidato** — por GTIN igual, por chave de agrupamento igual e por
 *    vizinhança de embedding. Os dois primeiros são igualdade indexada e funcionam
 *    sem chave; o terceiro só quando houver embedding.
 * 3. **Decidir de graça** o que o casamento determinístico decide.
 * 4. **Julgar por LLM** só o que sobrou, e só quando vale.
 * 5. **Rotear**: acima do limiar agrupa; na zona cinzenta vai para a fila de
 *    revisão; abaixo dela o candidato é descartado — e descartado **fica gravado**,
 *    senão a varredura seguinte pagaria pelo mesmo par de novo.
 *
 * O que este módulo **não** faz é criar nem ligar SKU. SKU é operacional, carrega
 * `perfil_id` e é criado por decisão humana; a equivalência é conhecimento
 * compartilhado. Ligar uma coisa na outra exige o perfil, e está em `propagacao.ts`.
 */
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { produtoExterno } from '@/infra/banco/schema';
import { ExecucaoInterrompida, type Proposito, type ServicoDeLlm } from '@/infra/llm';
import { chaveDeAgrupamento, formaCanonica } from './canonico';
import {
  casarDeterministicamente,
  valeJulgamento,
  type LadoDoCasamento,
  type NivelDeCasamento,
} from './casamento';
import { RepositorioDeExemplos, type Exemplo } from './exemplos';
import { RepositorioDePares } from './pares';
import { lerRegistro, riquezaDoRegistro, type RegistroDeProduto } from './registro';
import { RepositorioDeEmbeddings } from './vizinhos';

/** Confiança a partir da qual o sistema agrupa sozinho. */
export const CORTE_AGRUPAMENTO_BP = 8_500;

/**
 * Piso da zona cinzenta.
 *
 * Abaixo daqui o par não vai nem para revisão: ocupar a fila de uma pessoa com par
 * improvável é o jeito de fazer a fila ser abandonada, e fila abandonada é pior que
 * fila inexistente — porque parece que alguém está olhando.
 */
export const CORTE_REVISAO_BP = 5_500;

/**
 * Certeza declarada pelo modelo, em três degraus, e a confiança de cada um.
 *
 * Três degraus e não um número de quatro dígitos porque **modelo de linguagem não é
 * calibrado**: pedir "confiança de 0 a 10000" produz um número com aparência de
 * medida e comportamento de chute, e esse número decidiria agrupamento automático.
 * Três degraus é o que ele consegue distinguir de verdade, e o mapeamento para
 * pontos-base é nosso, explícito e ajustável em um lugar.
 */
export const CONFIANCA_POR_CERTEZA = {
  alta: 9_000,
  media: 7_000,
  baixa: 5_000,
} as const;

export const PROPOSITO_JULGAMENTO: Proposito = 'julgamento_identidade';

/**
 * O contrato de saída do julgamento.
 *
 * Pergunta binária mais justificativa, como a especificação pede. A justificativa é
 * obrigatória e não decorativa: é o que uma pessoa lê na fila de revisão para
 * decidir em dois segundos, e é o que permite perceber que o modelo está acertando
 * pelo motivo errado.
 */
export const esquemaJulgamentoDeIdentidade = z.object({
  mesmoProduto: z.boolean(),
  certeza: z.enum(['alta', 'media', 'baixa']),
  justificativa: z.string().trim().min(3).max(1_000),
});

export type JulgamentoDeIdentidade = z.infer<typeof esquemaJulgamentoDeIdentidade>;

type JulgamentoLido =
  | { readonly tipo: 'ok'; readonly id: string; readonly julgamento: JulgamentoDeIdentidade }
  | {
      readonly tipo: 'recusado';
      readonly id: string | null;
      readonly problemas: readonly string[];
    };

const esquemaIdDoPar = z.union([z.string(), z.number()]);

/** `"q3"`, `"Q3"` ou `3` são o mesmo par. */
function lerIdDoPar(bruto: string | number): string {
  const texto = String(bruto).trim().toLowerCase();
  return /^\d+$/.test(texto) ? `q${texto}` : texto;
}

/**
 * A resposta de um pedido com vários pares — e o julgamento torto **não derruba os
 * outros**: vira recusa daquele par, que vai para revisão com o motivo.
 */
export const esquemaDoLoteDeJulgamento = z.object({
  julgamentos: z.array(
    esquemaJulgamentoDeIdentidade
      .extend({ id: esquemaIdDoPar })
      .transform((item): JulgamentoLido => {
        const { id, ...julgamento } = item;
        return { tipo: 'ok', id: lerIdDoPar(id), julgamento };
      })
      .catch((ctx): JulgamentoLido => {
        const id = z.object({ id: esquemaIdDoPar }).safeParse(ctx.value);
        return {
          tipo: 'recusado',
          id: id.success ? lerIdDoPar(id.data.id) : null,
          problemas: ctx.issues.map((problema) => {
            const campo = (problema.path ?? []).join('.');
            const mensagem = problema.message ?? 'valor inválido';
            return campo === '' ? mensagem : `${campo}: ${mensagem}`;
          }),
        };
      }),
  ),
});

/**
 * O que o modelo deve fazer.
 *
 * O critério é o da especificação, e ela dá o exemplo que mais importa: "Refil Filtro
 * Purificador Electrolux PA21G PA26G PE11B Original", "Elemento Filtrante Acquaclean
 * p/ purificador Electrolux" e o código de distribuidor "EF-ELX-21" são **o mesmo
 * produto**. Por isso as instruções mandam ignorar palavra de busca do título
 * ("original" incluída) e decidir pela peça — e por isso as decisões humanas entram
 * como exemplo: o critério fino é do dono do negócio, e se aprende com a fila.
 */
export const INSTRUCOES_DE_IDENTIDADE = `Você recebe pares de registros e decide, para cada par, se os dois descrevem o mesmo produto físico: a mesma peça, com o mesmo encaixe e a mesma função, vendida na mesma quantidade — de forma que, para o comprador, tanto faz levar um ou o outro. Responda um julgamento por par, com o mesmo "id" do par.

Os registros foram extraídos de anúncios de marketplace e de listas de fornecedor. Campos podem estar vazios (null), e o mesmo produto costuma aparecer com nomes, códigos e grafias diferentes: título de marketplace carrega palavra de busca ("original", "premium", "promoção", listas de modelos), e fornecedor usa código interno próprio. "riqueza" diz quantos campos de cada lado estão preenchidos.

Como decidir:
- O que decide é a peça: tipo, modelo da peça, aparelhos em que serve, medida e material. Palavra de busca no título não é atributo.
- EAN igual é sinal forte de mesmo produto. EAN diferente pesa contra, mas não decide sozinho: o mesmo item é revendido com códigos diferentes.
- Quantidade diferente na embalagem (uma unidade contra kit com duas) é produto diferente.
- Atributo que distingue — medida, voltagem, material, aparelho que só um dos lados atende — é produto diferente.
- Cada par se decide sozinho: um par não diz nada sobre o outro.
- Se o contexto trouxer exemplos de decisões anteriores, siga o mesmo critério: são decisões do dono do negócio.
- Faltando informação para decidir, responda o mais provável com certeza "baixa": o par vai para revisão humana.
- Na justificativa, cite em uma ou duas frases o atributo que decidiu.`;

/**
 * Pares por pedido de julgamento.
 *
 * Gratuito primeiro (CLAUDE.md, 3.7): a cota gratuita é de 50 pedidos por dia, e um
 * pedido por par a esgotaria com quatro produtos de vinte vizinhos. Os pares de um
 * produto vão juntos, dez por pedido — mais que isso, e a resposta de um modelo pequeno
 * começa a confundir um par com o outro.
 */
export const MAX_PARES_POR_PEDIDO = 10;

/** Quantos candidatos considerar por produto, somando todas as vias. */
export const MAX_CANDIDATOS = 30;

export interface OpcoesDoResolvedor {
  readonly llm?: ServicoDeLlm | undefined;
  readonly modeloDeJulgamento?: string | undefined;
  readonly modeloDeEmbedding?: string | undefined;
  readonly maxCandidatos?: number | undefined;
  /** Pares por pedido de julgamento. Padrão: `MAX_PARES_POR_PEDIDO`. */
  readonly paresPorPedido?: number | undefined;
  /**
   * Job que originou a resolução, quando houver.
   *
   * Vai para `llm_call.job_id`, e é o que liga custo a trabalho: sem isso a pergunta
   * "por que a conta subiu" só responde por finalidade, e não por qual job gastou.
   */
  readonly jobId?: string | undefined;
}

export interface ResultadoDaResolucao {
  readonly produtoId: string;
  readonly formaCanonica: string;
  readonly chaveAgrupamento: string | null;
  readonly candidatos: number;
  readonly agrupados: number;
  readonly separados: number;
  readonly paraRevisao: number;
  readonly descartados: number;
  /** Chamadas de julgamento feitas. Zero é o normal quando não há chave. */
  readonly julgamentos: number;
  /** Havia par que só o LLM resolveria, e não havia chave. */
  readonly pendenteDeLlm: number;
  /** O `atributos_extraidos` não valida contra o schema do registro. */
  readonly registroInvalido: boolean;
}

interface Candidato {
  readonly id: string;
  readonly via: 'gtin' | 'chave' | 'embedding';
  readonly distanciaBp?: number | undefined;
}

interface LadoCarregado extends LadoDoCasamento {
  readonly id: string;
  readonly formaCanonica: string;
}

/** Um par que o determinístico não decidiu e que vale julgamento. */
interface ParParaJulgar {
  readonly outro: LadoCarregado;
  readonly candidato: Candidato;
  readonly motivoDeterministico: string;
  /**
   * Nível que o casamento determinístico alcançou antes de desistir.
   *
   * Precisa chegar até a gravação, e o motivo apareceu na tela: gravando `'nenhum'`
   * sempre, a fila de revisão dizia "sem evidência forte" para um par casado por marca e
   * código de peça cuja única pendência era a quantidade divergente. Informação errada
   * na tela de revisão é pior que informação nenhuma, porque a pessoa decide com ela.
   */
  readonly nivelDeterministico: NivelDeCasamento;
}

interface Roteado {
  readonly julgou: boolean;
  readonly balde: 'agrupados' | 'separados' | 'paraRevisao' | 'descartados' | 'pendenteDeLlm';
}

export class ResolvedorDeIdentidade {
  private readonly pares: RepositorioDePares;
  private readonly embeddings: RepositorioDeEmbeddings;
  private readonly exemplos: RepositorioDeExemplos;

  constructor(
    private readonly db: Banco,
    private readonly opcoes: OpcoesDoResolvedor = {},
  ) {
    this.pares = new RepositorioDePares(db);
    this.embeddings = new RepositorioDeEmbeddings(db);
    this.exemplos = new RepositorioDeExemplos(db);
  }

  /**
   * Calcula e grava forma canônica e chave de agrupamento de um produto.
   *
   * Determinístico e idempotente. É o passo que **não espera por chave nenhuma**, e
   * é o que torna a resolução por GTIN e por marca + modelo possível hoje.
   */
  async preparar(produtoId: string): Promise<{
    readonly formaCanonica: string;
    readonly chaveAgrupamento: string | null;
    readonly registroInvalido: boolean;
  }> {
    const base = await this.carregar([produtoId]);
    const lado = base.get(produtoId);
    if (lado === undefined) {
      throw new Error(`produto_externo ${produtoId} não existe`);
    }

    const leitura = lerRegistro(lado.registroBruto);
    const registro = leitura.tipo === 'ok' ? leitura.registro : lado.registro;
    const forma = formaCanonica(registro);
    const chave = chaveDeAgrupamento(registro);

    await this.db
      .update(produtoExterno)
      .set({ formaCanonica: forma, chaveAgrupamento: chave, atualizadoEm: new Date() })
      .where(eq(produtoExterno.id, produtoId));

    return {
      formaCanonica: forma,
      chaveAgrupamento: chave,
      registroInvalido: leitura.tipo !== 'ok',
    };
  }

  /** Prepara em lote quem ainda não tem forma canônica. Roda sem chave de LLM. */
  async prepararLote(limite = 200): Promise<number> {
    const pendentes = await this.db
      .select({ id: produtoExterno.id })
      .from(produtoExterno)
      .where(isNull(produtoExterno.formaCanonica))
      .orderBy(produtoExterno.criadoEm)
      .limit(limite);

    let feitos = 0;
    for (const { id } of pendentes) {
      await this.preparar(id);
      feitos += 1;
    }
    return feitos;
  }

  /**
   * Resolve a identidade de um produto contra os candidatos.
   *
   * Propaga `OrcamentoEstourado` — e é a única coisa que propaga. Um par que falhou
   * é um par que falhou; orçamento estourado é motivo para parar o lote inteiro.
   */
  async resolver(produtoId: string): Promise<ResultadoDaResolucao> {
    const preparo = await this.preparar(produtoId);

    const base = (await this.carregar([produtoId])).get(produtoId);
    if (base === undefined) throw new Error(`produto_externo ${produtoId} não existe`);

    const candidatos = await this.candidatos(produtoId, base, preparo.chaveAgrupamento);
    const contagem = {
      agrupados: 0,
      separados: 0,
      paraRevisao: 0,
      descartados: 0,
      julgamentos: 0,
      pendenteDeLlm: 0,
    };

    if (candidatos.length === 0) {
      return { produtoId, ...preparo, candidatos: 0, ...contagem };
    }

    const outros = await this.carregar(candidatos.map((c) => c.id));
    // Exemplos são carregados uma vez por produto, não por par: são contexto, e o
    // contexto não muda entre os pares de uma mesma resolução.
    const exemplos = this.opcoes.llm === undefined ? [] : await this.exemplos.paraPrompt();

    const aJulgar: ParParaJulgar[] = [];

    for (const candidato of candidatos) {
      const outro = outros.get(candidato.id);
      if (outro === undefined) continue;

      const deterministico = casarDeterministicamente(base, outro);

      if (deterministico.decisao !== 'indeciso') {
        const agrupa =
          deterministico.decisao === 'mesmo' && deterministico.confiancaBp >= CORTE_AGRUPAMENTO_BP;
        await this.pares.registrar({
          produtoA: produtoId,
          produtoB: candidato.id,
          decisao: deterministico.decisao,
          origem: 'deterministico',
          nivel: deterministico.nivel,
          confiancaBp: deterministico.confiancaBp,
          status: agrupa || deterministico.decisao === 'diferente' ? 'automatico' : 'pendente',
          justificativa: deterministico.motivo,
          inconsistencias: deterministico.inconsistencias,
          ...(candidato.distanciaBp === undefined ? {} : { distanciaBp: candidato.distanciaBp }),
        });
        if (deterministico.decisao === 'mesmo') {
          if (agrupa) contagem.agrupados += 1;
          else contagem.paraRevisao += 1;
        } else {
          contagem.separados += 1;
        }
        continue;
      }

      if (!valeJulgamento(deterministico, base, outro)) {
        // Nem determinístico nem julgável: registrar como descartado é o que impede
        // a varredura seguinte de reconsiderar o mesmo par para nada.
        await this.pares.registrar({
          produtoA: produtoId,
          produtoB: candidato.id,
          decisao: 'indeciso',
          origem: 'deterministico',
          nivel: deterministico.nivel,
          confiancaBp: 0,
          status: 'descartado',
          justificativa: 'sinal insuficiente dos dois lados para julgar',
          ...(candidato.distanciaBp === undefined ? {} : { distanciaBp: candidato.distanciaBp }),
        });
        contagem.descartados += 1;
        continue;
      }

      aJulgar.push({
        outro,
        candidato,
        motivoDeterministico: deterministico.motivo,
        nivelDeterministico: deterministico.nivel,
      });
    }

    // Os pares que só julgamento resolve vão juntos, e não um pedido por par.
    const porPedido = Math.max(1, this.opcoes.paresPorPedido ?? MAX_PARES_POR_PEDIDO);
    for (let inicio = 0; inicio < aJulgar.length; inicio += porPedido) {
      const roteados = await this.julgarLote(
        base,
        aJulgar.slice(inicio, inicio + porPedido),
        exemplos,
      );
      for (const roteado of roteados) {
        if (roteado.julgou) contagem.julgamentos += 1;
        contagem[roteado.balde] += 1;
      }
    }

    return { produtoId, ...preparo, candidatos: candidatos.length, ...contagem };
  }

  /** Resolve um lote. Para no primeiro estouro de orçamento, sem perder o feito. */
  async resolverLote(limite = 50): Promise<{
    readonly resolvidos: readonly ResultadoDaResolucao[];
    readonly pararamPorOrcamento: boolean;
  }> {
    const alvos = await this.db
      .select({ id: produtoExterno.id })
      .from(produtoExterno)
      .where(isNotNull(produtoExterno.formaCanonica))
      .orderBy(produtoExterno.criadoEm)
      .limit(limite);

    const resolvidos: ResultadoDaResolucao[] = [];
    for (const { id } of alvos) {
      try {
        resolvidos.push(await this.resolver(id));
      } catch (erro) {
        // Orçamento estourado ou cota do provedor: o próximo bateria no mesmo teto.
        if (erro instanceof ExecucaoInterrompida) {
          return { resolvidos, pararamPorOrcamento: true };
        }
        throw erro;
      }
    }
    return { resolvidos, pararamPorOrcamento: false };
  }

  /**
   * Julga um lote de pares do mesmo produto com **um** pedido, e roteia cada par pelo
   * limiar.
   *
   * Sem chave, cada par vai para a fila de revisão com o motivo escrito — que é a
   * resposta honesta: o sistema sabe que não sabe, e quem olhar entende por quê. Par que
   * o modelo não julgou, ou julgou fora do esquema, também vai para revisão, com o
   * motivo; os outros do lote seguem.
   */
  private async julgarLote(
    base: LadoCarregado,
    pares: readonly ParParaJulgar[],
    exemplos: readonly Exemplo[],
  ): Promise<readonly Roteado[]> {
    const servico = this.opcoes.llm;
    const modelo = this.opcoes.modeloDeJulgamento;

    if (servico === undefined || modelo === undefined) {
      const roteados: Roteado[] = [];
      for (const par of pares) {
        roteados.push(
          await this.paraRevisao(
            base,
            par,
            'deterministico',
            `${par.motivoDeterministico}; sem chave de LLM, então ninguém julgou`,
            'pendenteDeLlm',
          ),
        );
      }
      return roteados;
    }

    const resultado = await servico.pedir({
      proposito: PROPOSITO_JULGAMENTO,
      modelo,
      instrucoes: INSTRUCOES_DE_IDENTIDADE,
      entrada: pedidoDeJulgamento(pares.map((par) => ({ a: base, b: par.outro }))),
      contexto: { exemplos },
      esquema: esquemaDoLoteDeJulgamento,
      ...(this.opcoes.jobId === undefined ? {} : { jobId: this.opcoes.jobId }),
    });

    const roteados: Roteado[] = [];

    if (resultado.tipo !== 'ok') {
      const [origem, motivo, balde]: readonly [
        'deterministico' | 'llm',
        string,
        'pendenteDeLlm' | 'paraRevisao',
      ] =
        resultado.tipo === 'sem_chave'
          ? ['deterministico', 'sem chave de LLM, então ninguém julgou', 'pendenteDeLlm']
          : resultado.tipo === 'erro'
            ? ['llm', `falha ao julgar: ${resultado.mensagem}`, 'paraRevisao']
            : [
                'llm',
                `julgamento fora do schema: ${resultado.problemas.join('; ')}`,
                'paraRevisao',
              ];
      for (const par of pares) {
        roteados.push(await this.paraRevisao(base, par, origem, motivo, balde));
      }
      return roteados;
    }

    const porId = new Map<string, JulgamentoLido>();
    for (const item of resultado.valor.julgamentos) {
      if (item.id !== null && !porId.has(item.id)) porId.set(item.id, item);
    }

    for (const [indice, par] of pares.entries()) {
      const item = porId.get(idDoPar(indice));
      if (item?.tipo === 'ok') {
        roteados.push(await this.registrarJulgamento(base, par, item.julgamento));
      } else {
        const motivo =
          item === undefined
            ? 'o modelo não julgou este par'
            : `julgamento fora do schema: ${item.problemas.join('; ')}`;
        roteados.push(await this.paraRevisao(base, par, 'llm', motivo, 'paraRevisao'));
      }
    }
    return roteados;
  }

  /** Par que ninguém decidiu: fica na fila de revisão, com o motivo. */
  private async paraRevisao(
    base: LadoCarregado,
    par: ParParaJulgar,
    origem: 'deterministico' | 'llm',
    justificativa: string,
    balde: 'pendenteDeLlm' | 'paraRevisao',
  ): Promise<Roteado> {
    await this.pares.registrar({
      produtoA: base.id,
      produtoB: par.outro.id,
      decisao: 'indeciso',
      origem,
      nivel: par.nivelDeterministico,
      confiancaBp: 0,
      status: 'pendente',
      justificativa,
      ...(par.candidato.distanciaBp === undefined
        ? {}
        : { distanciaBp: par.candidato.distanciaBp }),
    });
    return { julgou: origem === 'llm', balde };
  }

  /** Grava o que o modelo decidiu e roteia pelo limiar. */
  private async registrarJulgamento(
    base: LadoCarregado,
    par: ParParaJulgar,
    julgamento: JulgamentoDeIdentidade,
  ): Promise<Roteado> {
    const { outro, candidato } = par;
    const distancia =
      candidato.distanciaBp === undefined ? {} : { distanciaBp: candidato.distanciaBp };
    const confiancaBp = CONFIANCA_POR_CERTEZA[julgamento.certeza];
    const nivel = candidato.via === 'embedding' ? 'embedding' : par.nivelDeterministico;

    if (!julgamento.mesmoProduto) {
      await this.pares.registrar({
        produtoA: base.id,
        produtoB: outro.id,
        decisao: 'diferente',
        origem: 'llm',
        nivel,
        confiancaBp,
        status: 'automatico',
        justificativa: julgamento.justificativa,
        ...distancia,
      });
      return { julgou: true, balde: 'separados' };
    }

    const status =
      confiancaBp >= CORTE_AGRUPAMENTO_BP
        ? 'automatico'
        : confiancaBp >= CORTE_REVISAO_BP
          ? 'pendente'
          : 'descartado';

    await this.pares.registrar({
      produtoA: base.id,
      produtoB: outro.id,
      decisao: status === 'descartado' ? 'indeciso' : 'mesmo',
      origem: 'llm',
      nivel,
      confiancaBp,
      status,
      justificativa: julgamento.justificativa,
      ...distancia,
    });

    return {
      julgou: true,
      balde:
        status === 'automatico'
          ? 'agrupados'
          : status === 'pendente'
            ? 'paraRevisao'
            : 'descartados',
    };
  }

  /**
   * Gera candidatos pelas três vias, sem repetir e sem reconsiderar par já avaliado.
   *
   * A ordem das vias é a da qualidade: GTIN, chave de agrupamento, embedding. Se o
   * teto cortar, corta primeiro o que vale menos.
   */
  private async candidatos(
    produtoId: string,
    base: LadoCarregado,
    chave: string | null,
  ): Promise<readonly Candidato[]> {
    const jaAvaliados = await this.pares.jaAvaliados(produtoId);
    const teto = this.opcoes.maxCandidatos ?? MAX_CANDIDATOS;
    const vistos = new Set<string>([produtoId]);
    const saida: Candidato[] = [];

    const acrescentar = (id: string, via: Candidato['via'], distanciaBp?: number): void => {
      if (vistos.has(id) || jaAvaliados.has(id) || saida.length >= teto) return;
      vistos.add(id);
      saida.push({ id, via, ...(distanciaBp === undefined ? {} : { distanciaBp }) });
    };

    if (base.ean !== null) {
      const porGtin = await this.db
        .select({ id: produtoExterno.id })
        .from(produtoExterno)
        .where(and(eq(produtoExterno.ean, base.ean), ne(produtoExterno.id, produtoId)))
        .limit(teto);
      for (const linha of porGtin) acrescentar(linha.id, 'gtin');
    }

    if (chave !== null) {
      const porChave = await this.db
        .select({ id: produtoExterno.id })
        .from(produtoExterno)
        .where(and(eq(produtoExterno.chaveAgrupamento, chave), ne(produtoExterno.id, produtoId)))
        .limit(teto);
      for (const linha of porChave) acrescentar(linha.id, 'chave');
    }

    const modeloDeEmbedding = this.opcoes.modeloDeEmbedding;
    if (modeloDeEmbedding !== undefined && saida.length < teto) {
      const vizinhos = await this.embeddings.vizinhosDe({
        produtoExternoId: produtoId,
        modelo: modeloDeEmbedding,
        limite: teto,
      });
      for (const vizinho of vizinhos ?? []) {
        // Distância de cosseno em pontos-base de 1.0, para não guardar `float`.
        acrescentar(vizinho.produtoExternoId, 'embedding', Math.round(vizinho.distancia * 10_000));
      }
    }

    return saida;
  }

  /** Carrega os lados do casamento em uma consulta. */
  private async carregar(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, LadoCarregado & { readonly registroBruto: unknown }>> {
    if (ids.length === 0) return new Map();

    const linhas = await this.db
      .select({
        id: produtoExterno.id,
        ean: produtoExterno.ean,
        atributos: produtoExterno.atributosExtraidos,
        formaCanonica: produtoExterno.formaCanonica,
        tituloBruto: produtoExterno.tituloBruto,
      })
      .from(produtoExterno)
      .where(inArray(produtoExterno.id, [...ids]));

    const mapa = new Map<string, LadoCarregado & { readonly registroBruto: unknown }>();
    for (const linha of linhas) {
      const leitura = lerRegistro(linha.atributos);
      const registro: RegistroDeProduto =
        leitura.tipo === 'ok' ? leitura.registro : lerRegistroVazio();
      mapa.set(linha.id, {
        id: linha.id,
        ean: linha.ean,
        registro,
        registroBruto: linha.atributos,
        formaCanonica: linha.formaCanonica ?? formaCanonica(registro),
      });
    }
    return mapa;
  }
}

function lerRegistroVazio(): RegistroDeProduto {
  const leitura = lerRegistro({});
  if (leitura.tipo !== 'ok') throw new Error('registro vazio não valida: schema quebrado');
  return leitura.registro;
}

type LadoDaPergunta = LadoDoCasamento & { readonly formaCanonica: string };

/**
 * Os dois lados de um par como vão ao modelo, **ordenados pela forma canônica**.
 *
 * Sem id de banco dentro: o mesmo par de descrições capturado em outra instalação deve
 * bater no mesmo cache. Com `riqueza` porque é o que diz quanta evidência havia — e
 * permite auditar depois se o modelo estava julgando com dado suficiente. E ordenado
 * porque perguntar (A,B) e (B,A) é a mesma pergunta: sem ordenar seriam dois hashes e
 * duas chamadas.
 */
function ladosOrdenados(a: LadoDaPergunta, b: LadoDaPergunta) {
  const lado = (l: LadoDaPergunta) => ({
    canonico: l.formaCanonica,
    ean: l.ean,
    tipoProduto: l.registro.tipoProduto,
    marca: l.registro.marca,
    modeloPeca: l.registro.modeloPeca,
    modelosCompativeis: l.registro.modelosCompativeis,
    material: l.registro.material,
    unidade: l.registro.unidade,
    quantidadeEmbalagem: l.registro.quantidadeEmbalagem,
    riqueza: riquezaDoRegistro(l.registro),
  });
  return a.formaCanonica <= b.formaCanonica
    ? { a: lado(a), b: lado(b) }
    : { a: lado(b), b: lado(a) };
}

/** A pergunta de um par só. É o formato de cada par dentro do pedido em lote. */
export function perguntaDeIdentidade(a: LadoDaPergunta, b: LadoDaPergunta): unknown {
  return {
    pergunta: 'estes dois registros descrevem o mesmo produto físico?',
    ...ladosOrdenados(a, b),
  };
}

/** `q1`, `q2`… — o id de cada par no pedido, por posição. */
function idDoPar(indice: number): string {
  return `q${String(indice + 1)}`;
}

/**
 * O pedido de julgamento de vários pares, e **só** ele vai para o hash de cache.
 *
 * Cada par vai no formato da pergunta de um par só: ordenado, sem id de banco, com a
 * riqueza de cada lado.
 */
export function pedidoDeJulgamento(
  pares: readonly { readonly a: LadoDaPergunta; readonly b: LadoDaPergunta }[],
): unknown {
  return {
    pergunta: 'para cada par, os dois registros descrevem o mesmo produto físico?',
    pares: pares.map((par, indice) => ({ id: idDoPar(indice), ...ladosOrdenados(par.a, par.b) })),
  };
}

/** Produtos com forma canônica e sem par avaliado nenhum. A fila da resolução. */
export async function semResolucao(db: Banco, limite = 100): Promise<readonly string[]> {
  const linhas = await db
    .select({ id: produtoExterno.id })
    .from(produtoExterno)
    .where(
      and(
        isNotNull(produtoExterno.formaCanonica),
        sql`not exists (
          select 1 from par_identidade p
          where p.produto_a_id = ${produtoExterno.id} or p.produto_b_id = ${produtoExterno.id}
        )`,
      ),
    )
    .orderBy(produtoExterno.criadoEm)
    .limit(limite);
  return linhas.map((l) => l.id);
}
