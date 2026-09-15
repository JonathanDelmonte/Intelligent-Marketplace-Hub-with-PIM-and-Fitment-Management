/**
 * Sensor de demanda pública via PNCP (M6 — 10.4).
 *
 * A especificação explica por que isto vale mais que parece: "órgão público compra
 * refil, toner e peça de ar-condicionado em volume, os preços são dados abertos, e
 * **quase nenhum vendedor de marketplace olha para lá**. Aqui ele vira sensor de
 * demanda e de preço de referência."
 *
 * ## O que está pronto e o que falta
 *
 * Pronto: a montagem da consulta, a leitura das linhas com validação por Zod, e a
 * estatística de preço de referência — que é o que transforma uma lista de compras
 * públicas em número utilizável. Tudo determinístico e testado.
 *
 * Falta: a chamada. A política de rede deste ambiente recusa `pncp.gov.br`
 * (`CONNECT` 403), então a porta existe com implementação ausente, como a base de
 * GTIN do M14 — e o loop de fronteira já sabe pular item cuja ferramenta não está
 * disponível, em vez de gastar passo para descobrir no meio.
 *
 * ## Por que a mediana, e não a média
 *
 * Compra pública tem cauda longa: um único contrato de mil unidades a preço de
 * atacado, ou um item cadastrado com preço errado por dois zeros, arrasta a média
 * para longe do que o mercado pratica. A mediana não se move por causa de um. É a
 * mesma escolha do detector de queda real de preço do M13.
 */
import { z } from 'zod';
import type { EstadoDaCapacidade } from '@/plataformas/capacidades';
import { centavos, reaisParaCentavos, type Centavos } from '@/lib/dinheiro';

export class PncpIndisponivel extends Error {
  override readonly name = 'PncpIndisponivel';
  constructor(
    readonly provedor: string,
    readonly estado: EstadoDaCapacidade,
  ) {
    super(`consulta ao PNCP indisponível em "${provedor}": ${estado.tipo}`);
  }
}

/** Uma compra pública de um item, do jeito que interessa aqui. */
export const esquemaItemDoPncp = z.object({
  /** Descrição do item como o órgão a escreveu. Texto livre, e é o que se casa. */
  descricao: z.string().trim().min(1),
  quantidade: z.number().positive(),
  /** Valor unitário em reais, como o PNCP publica. */
  valorUnitario: z.number().nonnegative(),
  /** Órgão comprador, para o dossiê poder citar a fonte. */
  orgao: z.string().trim().min(1),
  /** Data da publicação, `AAAA-MM-DD`. */
  data: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  urlOrigem: z.string().trim().url(),
});
export type ItemDoPncp = z.infer<typeof esquemaItemDoPncp>;

export interface ConsultaAoPncp {
  /** O termo, como o órgão escreveria: "refil de purificador de água". */
  readonly termo: string;
  /** Janela de busca, em dias para trás. */
  readonly diasParaTras: number;
}

/**
 * A porta.
 *
 * `estadoDaConsulta` é descoberto em runtime e não é constante compilada, pelo mesmo
 * motivo dos adaptadores de plataforma: a disponibilidade de uma fonte pública muda
 * sem aviso, e a verdade é o que respondeu hoje (ADR 0001).
 */
export interface SensorDePncp {
  readonly nome: string;
  estadoDaConsulta(): EstadoDaCapacidade;
  consultar(consulta: ConsultaAoPncp): Promise<readonly ItemDoPncp[]>;
}

/**
 * A implementação honesta de "não há como perguntar".
 *
 * Não é placeholder para quando der: é o comportamento correto enquanto a rede deste
 * ambiente recusa o domínio. Nenhuma tela quebra e nenhum passo é gasto — a
 * indisponibilidade é estado, e o resto do sistema já trata estado.
 */
export class SensorDePncpAusente implements SensorDePncp {
  readonly nome = 'nenhum';

  estadoDaConsulta(): EstadoDaCapacidade {
    return { tipo: 'sem_credencial', modo: 'm2_publico' };
  }

  consultar(_consulta: ConsultaAoPncp): Promise<readonly ItemDoPncp[]> {
    return Promise.reject(new PncpIndisponivel(this.nome, this.estadoDaConsulta()));
  }
}

/**
 * Casa a descrição do órgão com o termo procurado.
 *
 * Por palavra e não por substring, porque a descrição de compra pública é longa e
 * burocrática: "AQUISIÇÃO DE REFIL PARA PURIFICADOR DE ÁGUA, TIPO VELA, CONFORME
 * ESPECIFICAÇÃO EM ANEXO". Procurar a frase inteira não casaria; procurar as palavras
 * do termo casa.
 *
 * Exige **todas** as palavras do termo, e não alguma: "refil purificador" não pode
 * casar com uma compra de purificador inteiro, que é outro produto e outro preço.
 */
export function descricaoCasa(descricao: string, termo: string): boolean {
  const normalizar = (t: string): string =>
    t
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();

  const texto = normalizar(descricao);
  const palavras = normalizar(termo)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3);

  return palavras.length > 0 && palavras.every((p) => texto.includes(p));
}

export interface ReferenciaDePreco {
  readonly itens: number;
  readonly unidades: number;
  /** Mediana do valor unitário. A referência honesta. */
  readonly medianaUnitario: Centavos;
  readonly menorUnitario: Centavos;
  readonly maiorUnitario: Centavos;
  /** Órgãos distintos que compraram. Um órgão só não é demanda, é um contrato. */
  readonly orgaos: number;
}

/**
 * Mediana de uma lista de inteiros, já ordenada internamente.
 *
 * Com quantidade par, devolve o **menor** dos dois centrais em vez da média deles.
 * Média de dois centavos inteiros pode dar meio centavo, e meio centavo não existe
 * (ADR 0004) — arredondar aqui seria inventar precisão que a fonte não tem.
 */
export function medianaDeCentavos(valores: readonly Centavos[]): Centavos {
  if (valores.length === 0) return centavos(0);
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor((ordenados.length - 1) / 2);
  return ordenados[meio] ?? centavos(0);
}

/**
 * A referência de preço a partir das compras achadas.
 *
 * `null` quando não há item que case: zero item não é preço zero, e devolver zero
 * faria o prospector recomendar vender a qualquer preço.
 */
export function referenciaDePreco(
  itens: readonly ItemDoPncp[],
  termo: string,
): ReferenciaDePreco | null {
  const relevantes = itens.filter((i) => descricaoCasa(i.descricao, termo));
  if (relevantes.length === 0) return null;

  const unitarios = relevantes.map((i) => reaisParaCentavos(i.valorUnitario.toFixed(2)));

  return {
    itens: relevantes.length,
    unidades: relevantes.reduce((soma, i) => soma + i.quantidade, 0),
    medianaUnitario: medianaDeCentavos(unitarios),
    menorUnitario: centavos(Math.min(...unitarios)),
    maiorUnitario: centavos(Math.max(...unitarios)),
    orgaos: new Set(relevantes.map((i) => i.orgao.trim().toLowerCase())).size,
  };
}

export type ResultadoDoPncp =
  | {
      readonly tipo: 'achou';
      readonly referencia: ReferenciaDePreco;
      readonly itens: readonly ItemDoPncp[];
    }
  | { readonly tipo: 'sem_demanda'; readonly provedor: string }
  | { readonly tipo: 'indisponivel'; readonly motivo: string };

/**
 * Consulta o sensor sem nunca lançar por indisponibilidade.
 *
 * Distingue três desfechos, e a distinção é o ponto — a mesma do M14: `achou`,
 * `sem_demanda` (o PNCP respondeu e não há compra pública deste item) e
 * `indisponivel` (não há como perguntar). Colapsar os dois últimos em "não achei"
 * faria o prospector concluir que não existe demanda pública quando ele apenas não
 * conseguiu olhar.
 */
export async function medirDemandaPublica(
  sensor: SensorDePncp,
  consulta: ConsultaAoPncp,
): Promise<ResultadoDoPncp> {
  const estado = sensor.estadoDaConsulta();
  if (estado.tipo !== 'disponivel' && estado.tipo !== 'presumido') {
    return {
      tipo: 'indisponivel',
      motivo:
        estado.tipo === 'sem_credencial'
          ? 'nenhum sensor de PNCP configurado'
          : `consulta ao PNCP indisponível (${estado.tipo})`,
    };
  }

  try {
    const itens = await sensor.consultar(consulta);
    const referencia = referenciaDePreco(itens, consulta.termo);
    return referencia === null
      ? { tipo: 'sem_demanda', provedor: sensor.nome }
      : {
          tipo: 'achou',
          referencia,
          itens: itens.filter((i) => descricaoCasa(i.descricao, consulta.termo)),
        };
  } catch (erro) {
    return {
      tipo: 'indisponivel',
      motivo: erro instanceof Error ? erro.message : 'falha ao consultar o PNCP',
    };
  }
}
