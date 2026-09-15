/**
 * O loop de fronteira do prospector (M6 — 10.1, 10.2, 10.6).
 *
 * As três listas vivas da especificação: **hipóteses** (o que pode ser verdade),
 * **fronteira** (o que vale investigar a seguir) e **achados** (o que foi confirmado,
 * com evidência). A cada passo o agente escolhe da fronteira o item de maior valor
 * esperado por custo, investiga, atualiza as três listas, e decide se continua.
 *
 * ## Este arquivo é determinístico de propósito
 *
 * A parte que exige julgamento — *o que investigar a seguir* quando a fronteira está
 * vazia, *em quem acreditar* quando as fontes discordam — é LLM, e entra por fora. O
 * que mora aqui é a **máquina**: ordenar a fronteira, contar orçamento, detectar
 * saturação, não repetir investigação.
 *
 * A separação paga duas vezes. Primeiro porque máquina determinística se testa com
 * dezenas de cenários em milissegundos, e agente com LLM não. Segundo porque o erro
 * caro do módulo não é escolher a hipótese errada — é **não parar**, e não parar é
 * falha de máquina, não de julgamento.
 *
 * ## Valor esperado por custo, não valor esperado
 *
 * Duas hipóteses de valor 80: uma custa uma busca, a outra custa ler seis páginas.
 * Ordenar por valor escolheria qualquer uma; ordenar por valor **por custo** escolhe
 * a barata primeiro — e é o que faz um orçamento pequeno render investigação inteira
 * em vez de meia.
 *
 * ## Saturação é a parada que importa
 *
 * Orçamento estourado é parada por limite; saturação é parada por **ter terminado**.
 * Três investigações seguidas sem achado novo é o número da especificação, e ele é o
 * que impede o agente de gastar o resto do teto confirmando o que já sabe.
 */
import { definicaoDaFamilia, type FamiliaDeHipotese, type Ferramenta } from './hipoteses';

/** Investigações seguidas sem achado novo que encerram por saturação. */
export const SATURACAO_EM_PASSOS = 3;

/**
 * Custo mínimo de um item, em passos.
 *
 * Existe para a divisão do valor por custo nunca ser por zero, e o piso é um porque
 * **toda** investigação custa pelo menos uma chamada — mesmo a que lê base local
 * custa tempo e um registro no dossiê.
 */
export const CUSTO_MINIMO = 1;

export const MOTIVOS_DE_PARADA = [
  'saturacao',
  'orcamento_passos',
  'orcamento_reais',
  'fronteira_vazia',
  'concluido',
] as const;
export type MotivoDeParada = (typeof MOTIVOS_DE_PARADA)[number];

/** Um item da fronteira: algo que vale investigar, e quanto se espera dele. */
export interface ItemDaFronteira {
  readonly id: string;
  readonly familia: FamiliaDeHipotese;
  /** O que investigar, em texto: um termo de busca, uma URL, um CNPJ. */
  readonly alvo: string;
  /**
   * Valor esperado de 0 a 100. Começa no `valorBase` da família e é ajustado pelo
   * agente conforme o dossiê cresce.
   */
  readonly valorEsperado: number;
  /** Custo em passos. Ler seis páginas custa seis. */
  readonly custoEmPassos: number;
  /** Ferramenta necessária. Item sem ferramenta disponível não é escolhido. */
  readonly ferramenta: Ferramenta;
}

/** Uma hipótese em aberto: o que pode ser verdade, e o que falta para saber. */
export interface Hipotese {
  readonly id: string;
  readonly familia: FamiliaDeHipotese;
  readonly enunciado: string;
  /** `aberta` | `confirmada` | `descartada`. Hipótese descartada não volta. */
  readonly estado: 'aberta' | 'confirmada' | 'descartada';
}

/**
 * Um achado: o que foi confirmado, **com a URL de onde veio**.
 *
 * A URL não é opcional e não é enfeite: é o que a especificação chama de dossiê
 * auditável, e sem ela o achado é uma afirmação sem fonte — exatamente o que a
 * disciplina de evidência do M4 existe para evitar.
 */
export interface Achado {
  readonly id: string;
  readonly familia: FamiliaDeHipotese;
  readonly oQue: string;
  readonly origemUrl: string;
  readonly achadoEm: string;
}

export interface EstadoDaBusca {
  readonly hipoteses: readonly Hipotese[];
  readonly fronteira: readonly ItemDaFronteira[];
  readonly achados: readonly Achado[];
  /** Ids já investigados. Impede repetir o mesmo passo e girar em falso. */
  readonly investigados: readonly string[];
  readonly passosGastos: number;
  /** Investigações seguidas sem achado novo. Zera a cada achado. */
  readonly passosSemAchado: number;
}

export const ESTADO_INICIAL: EstadoDaBusca = {
  hipoteses: [],
  fronteira: [],
  achados: [],
  investigados: [],
  passosGastos: 0,
  passosSemAchado: 0,
};

/**
 * Valor esperado por custo, em pontos por passo.
 *
 * Inteiro por mil para não comparar float: `80/3` e `80/3` em IEEE-754 comparam
 * igual, mas somas de ordenação com empates viram ordem instável — e ordem instável
 * num agente significa que duas execuções do mesmo dossiê investigam em ordens
 * diferentes, o que torna a auditoria impossível.
 */
export function valorPorCusto(item: ItemDaFronteira): number {
  const custo = Math.max(CUSTO_MINIMO, item.custoEmPassos);
  return Math.trunc((item.valorEsperado * 1000) / custo);
}

export interface LimitesDaBusca {
  readonly passos: number;
  /** Ferramentas disponíveis nesta execução. Sem rede, a lista é curta. */
  readonly ferramentas: readonly Ferramenta[];
  readonly saturacaoEmPassos?: number;
}

export type ProximoPasso =
  | { readonly tipo: 'investigar'; readonly item: ItemDaFronteira }
  | { readonly tipo: 'parar'; readonly motivo: MotivoDeParada; readonly explicacao: string };

/**
 * Decide o próximo passo.
 *
 * Função pura sobre o estado: recebe as três listas e os limites, devolve "investiga
 * este item" ou "para, por este motivo". Não chama nada e não guarda nada — o que
 * permite testar a máquina de parada com dezenas de cenários sem tocar em rede.
 *
 * A ordem das verificações é a ordem da honestidade: **primeiro o que já terminou**
 * (saturação), depois o que estourou (orçamento), por último a falta de caminho. Um
 * agente que reporta "orçamento estourado" quando na verdade saturou faz o dono
 * aumentar o teto para nada.
 */
export function proximoPasso(estado: EstadoDaBusca, limites: LimitesDaBusca): ProximoPasso {
  const saturacao = limites.saturacaoEmPassos ?? SATURACAO_EM_PASSOS;

  if (estado.passosSemAchado >= saturacao) {
    return {
      tipo: 'parar',
      motivo: 'saturacao',
      explicacao: `${String(estado.passosSemAchado)} investigações seguidas sem achado novo. Parar aqui é ter terminado, não ter esbarrado no teto — aumentar o orçamento não traria mais nada.`,
    };
  }

  if (estado.passosGastos >= limites.passos) {
    return {
      tipo: 'parar',
      motivo: 'orcamento_passos',
      explicacao: `O teto de ${String(limites.passos)} passos foi alcançado. O dossiê está salvo como está, e dá para continuar com um teto maior.`,
    };
  }

  const escolhido = escolherDaFronteira(estado, limites.ferramentas);

  if (escolhido === null) {
    return {
      tipo: 'parar',
      motivo: 'fronteira_vazia',
      explicacao:
        'Não há mais nada na fronteira que dê para investigar com as ferramentas desta execução.',
    };
  }

  return { tipo: 'investigar', item: escolhido };
}

/**
 * O melhor item investigável da fronteira.
 *
 * Filtra o que já foi investigado e o que exige ferramenta ausente, e ordena por
 * valor por custo. O desempate é pelo `id`, e não é detalhe: sem desempate estável,
 * duas execuções do mesmo dossiê investigam em ordens diferentes e a auditoria
 * deixa de valer.
 */
export function escolherDaFronteira(
  estado: EstadoDaBusca,
  ferramentas: readonly Ferramenta[],
): ItemDaFronteira | null {
  const tem = new Set(ferramentas);
  const jaFoi = new Set(estado.investigados);

  const candidatos = estado.fronteira.filter((i) => !jaFoi.has(i.id) && tem.has(i.ferramenta));
  if (candidatos.length === 0) return null;

  return (
    [...candidatos].sort(
      (a, b) => valorPorCusto(b) - valorPorCusto(a) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export interface ResultadoDaInvestigacao {
  /** Achados novos. Lista vazia é o que conta para a saturação. */
  readonly achados: readonly Achado[];
  /** Hipóteses novas, que o agente levanta a partir do que leu. */
  readonly hipoteses?: readonly Hipotese[];
  /** Itens novos na fronteira. É assim que a investigação se ramifica. */
  readonly fronteira?: readonly ItemDaFronteira[];
  /** Hipóteses que este passo fechou, por id. */
  readonly confirmadas?: readonly string[];
  readonly descartadas?: readonly string[];
}

/**
 * Aplica o resultado de uma investigação ao estado.
 *
 * Pura e total: nunca lança, e sempre devolve estado consistente. O contador de
 * saturação é o que mais importa aqui — ele **zera** quando houve achado e **cresce**
 * quando não houve, e é essa contagem que decide a parada por ter terminado.
 */
export function aplicarInvestigacao(
  estado: EstadoDaBusca,
  item: ItemDaFronteira,
  resultado: ResultadoDaInvestigacao,
): EstadoDaBusca {
  const houveAchado = resultado.achados.length > 0;
  const confirmadas = new Set(resultado.confirmadas ?? []);
  const descartadas = new Set(resultado.descartadas ?? []);

  const hipoteses = [...estado.hipoteses, ...(resultado.hipoteses ?? [])].map((h): Hipotese =>
    confirmadas.has(h.id)
      ? { ...h, estado: 'confirmada' }
      : descartadas.has(h.id)
        ? { ...h, estado: 'descartada' }
        : h,
  );

  // A fronteira cresce sem duplicar: o agente ramifica a partir do que leu, e ler
  // duas páginas que citam o mesmo distribuidor não deve enfileirá-lo duas vezes.
  const idsNaFronteira = new Set(estado.fronteira.map((i) => i.id));
  const novosDaFronteira = (resultado.fronteira ?? []).filter((i) => !idsNaFronteira.has(i.id));

  return {
    hipoteses,
    fronteira: [...estado.fronteira, ...novosDaFronteira],
    achados: [...estado.achados, ...resultado.achados],
    investigados: [...estado.investigados, item.id],
    passosGastos: estado.passosGastos + Math.max(CUSTO_MINIMO, item.custoEmPassos),
    passosSemAchado: houveAchado ? 0 : estado.passosSemAchado + 1,
  };
}

/** Item de fronteira a partir de uma família, com o valor base dela. */
export function itemDaFamilia(params: {
  readonly id: string;
  readonly familia: FamiliaDeHipotese;
  readonly alvo: string;
  readonly ferramenta: Ferramenta;
  readonly custoEmPassos?: number;
  readonly ajusteDeValor?: number;
}): ItemDaFronteira {
  const base = definicaoDaFamilia(params.familia).valorBase;
  // O ajuste é somado e recortado em 0..100: o agente aumenta o valor de uma família
  // quando o dossiê mostra que ela está rendendo, e diminui quando não.
  const valorEsperado = Math.min(100, Math.max(0, base + (params.ajusteDeValor ?? 0)));

  return {
    id: params.id,
    familia: params.familia,
    alvo: params.alvo,
    valorEsperado,
    custoEmPassos: Math.max(CUSTO_MINIMO, params.custoEmPassos ?? 1),
    ferramenta: params.ferramenta,
  };
}
