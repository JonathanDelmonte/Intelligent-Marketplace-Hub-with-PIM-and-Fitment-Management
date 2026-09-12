/**
 * Casamento determinístico de identidade (M3, o que vem antes do LLM).
 *
 * A regra de ouro do ADR 0005 dita a ordem: **LLM entra onde a entrada é texto
 * livre heterogêneo ou a decisão exige julgamento sobre evidência incompleta.**
 * Dois registros com o mesmo GTIN não exigem julgamento nenhum, e pagar token para
 * confirmar o óbvio é o jeito mais rápido de estourar o teto de R$ 100/mês.
 *
 * Este módulo existe para duas coisas, e a segunda é a que costuma ser esquecida:
 *
 * 1. **Decidir de graça o que é decidível de graça** — mesmo GTIN, mesma
 *    marca e mesmo código de peça.
 * 2. **Descartar de graça o que é obviamente diferente.** Sem isso, cada produto
 *    novo geraria uma chamada de julgamento por vizinho, e vizinho é o que o
 *    `pgvector` devolve em quantidade.
 *
 * Nada aqui toca banco: é função pura sobre dois registros, com teste. Confiança em
 * **pontos-base** e não em fração, pela mesma razão que dinheiro é em centavos —
 * `0.85` é um `float` no meio de um sistema que não tem nenhum.
 */
import type { RegistroDeProduto } from './registro';
import { chaveDeAgrupamento, normalizarMarca } from './canonico';

/** Nível de evidência que sustentou a decisão. Vai gravado, para auditoria. */
export const NIVEIS_DE_CASAMENTO = ['gtin', 'marca_modelo', 'marca', 'nenhum'] as const;
export type NivelDeCasamento = (typeof NIVEIS_DE_CASAMENTO)[number];

export const DECISOES = ['mesmo', 'diferente', 'indeciso'] as const;
export type Decisao = (typeof DECISOES)[number];

/**
 * Confiança de cada nível, em pontos-base.
 *
 * Os números e o raciocínio de cada um:
 *
 * - `GTIN_IGUAL` (10 000) é o único caso definitivo do sistema. GTIN **é** a
 *   identidade da unidade de venda, atribuída pelo dono da marca; dois registros
 *   com o mesmo GTIN válido são o mesmo produto por definição.
 * - `GTIN_DIFERENTE` (9 000) é forte e não definitivo: o mesmo produto ganha GTIN
 *   novo em reembalagem, e vendedor digita EAN errado no anúncio com frequência
 *   maior que zero.
 * - `MARCA_MODELO_IGUAL` (8 500) é o caso que o M3 existe para resolver — o
 *   distribuidor que chama de `EF-ELX-21` e o anúncio que chama de `PA21G`.
 * - `MARCA_MODELO_DIFERENTE` (7 500): mesma marca, código de peça diferente.
 *   `PA21G` e `PA26G` são refis distintos, de aparelhos distintos.
 * - `MARCA_DIFERENTE` (7 000): peça da Electrolux e peça da Acquaclean para o
 *   mesmo aparelho são produtos diferentes, com preço e qualidade diferentes. Esse
 *   é o caso do genérico, e confundir os dois erra a margem nos dois sentidos.
 */
export const CONFIANCA = {
  GTIN_IGUAL: 10_000,
  GTIN_DIFERENTE: 9_000,
  MARCA_MODELO_IGUAL: 8_500,
  MARCA_MODELO_DIFERENTE: 7_500,
  MARCA_DIFERENTE: 7_000,
} as const;

/** Um lado do casamento: o registro extraído mais o GTIN, que não mora nele. */
export interface LadoDoCasamento {
  /** GTIN já canonicalizado em 13 dígitos, ou `null`. O ingestor garante a forma. */
  readonly ean: string | null;
  readonly registro: RegistroDeProduto;
}

export interface ResultadoDoCasamento {
  readonly decisao: Decisao;
  readonly nivel: NivelDeCasamento;
  /** Pontos-base, 0 a 10 000. Zero quando a decisão é `indeciso`. */
  readonly confiancaBp: number;
  readonly motivo: string;
  /**
   * Contradições entre as duas fontes que **não** mudaram a decisão.
   *
   * Existe porque a alternativa é escolher em silêncio, e a especificação pede o
   * contrário em toda a seção de compatibilidade: sinalizar inconsistência em vez
   * de decidir sozinho. Dois registros com o mesmo GTIN e quantidades declaradas
   * diferentes são o mesmo produto — e uma das duas extrações está errada, o que é
   * informação que alguém precisa ver.
   */
  readonly inconsistencias: readonly string[];
}

/**
 * Quantidade de embalagem conflita entre os dois lados?
 *
 * `null` de um lado não é conflito: é ausência. Só conflita quando os dois lados
 * afirmam, e afirmam coisas diferentes.
 */
function quantidadeConflita(a: LadoDoCasamento, b: LadoDoCasamento): boolean {
  const qa = a.registro.quantidadeEmbalagem;
  const qb = b.registro.quantidadeEmbalagem;
  return qa !== null && qb !== null && qa !== qb;
}

function descreverConflitoDeQuantidade(a: LadoDoCasamento, b: LadoDoCasamento): string {
  return `quantidade de embalagem declarada difere: ${String(a.registro.quantidadeEmbalagem)} contra ${String(b.registro.quantidadeEmbalagem)}`;
}

/**
 * Decide identidade sem LLM, quando for decidível sem LLM.
 *
 * A ordem das guardas é a ordem da força da evidência, e a primeira que responde
 * encerra. `indeciso` é resposta legítima e frequente — é o caso que o embedding e
 * o julgamento por LLM existem para resolver.
 */
export function casarDeterministicamente(
  a: LadoDoCasamento,
  b: LadoDoCasamento,
): ResultadoDoCasamento {
  const inconsistencias: string[] = [];

  // 1. GTIN. O único caso definitivo, e por isso o primeiro.
  if (a.ean !== null && b.ean !== null) {
    if (a.ean === b.ean) {
      // Quantidade diferente com GTIN igual não desfaz o casamento: o GTIN é
      // atribuído à unidade de venda, então ele é quem tem razão. Mas uma das duas
      // extrações errou a quantidade, e isso vai anotado.
      if (quantidadeConflita(a, b)) inconsistencias.push(descreverConflitoDeQuantidade(a, b));
      return {
        decisao: 'mesmo',
        nivel: 'gtin',
        confiancaBp: CONFIANCA.GTIN_IGUAL,
        motivo: `mesmo GTIN ${a.ean}`,
        inconsistencias,
      };
    }
    return {
      decisao: 'diferente',
      nivel: 'gtin',
      confiancaBp: CONFIANCA.GTIN_DIFERENTE,
      motivo: `GTIN diferente: ${a.ean} contra ${b.ean}`,
      inconsistencias,
    };
  }

  // 2. Marca e código de peça. É o caso que o módulo existe para resolver.
  const chaveA = chaveDeAgrupamento(a.registro);
  const chaveB = chaveDeAgrupamento(b.registro);

  if (chaveA !== null && chaveB !== null) {
    if (chaveA === chaveB) {
      // Aqui a quantidade **manda**, ao contrário do caso do GTIN: sem GTIN não há
      // árbitro, e "refil avulso" e "kit de três refis" com a mesma marca e o mesmo
      // código são produtos de venda diferentes, com preço diferente. Vai para
      // revisão em vez de virar um SKU errado.
      if (quantidadeConflita(a, b)) {
        return {
          decisao: 'indeciso',
          nivel: 'marca_modelo',
          confiancaBp: 0,
          motivo: `mesma marca e modelo (${chaveA}), mas ${descreverConflitoDeQuantidade(a, b)}`,
          inconsistencias,
        };
      }
      return {
        decisao: 'mesmo',
        nivel: 'marca_modelo',
        confiancaBp: CONFIANCA.MARCA_MODELO_IGUAL,
        motivo: `mesma marca e mesmo código de peça (${chaveA})`,
        inconsistencias,
      };
    }

    const [marcaA = '', modeloA = ''] = chaveA.split('|');
    const [marcaB = '', modeloB = ''] = chaveB.split('|');

    if (marcaA === marcaB) {
      return {
        decisao: 'diferente',
        nivel: 'marca_modelo',
        confiancaBp: CONFIANCA.MARCA_MODELO_DIFERENTE,
        motivo: `mesma marca (${marcaA}), código de peça diferente: ${modeloA} contra ${modeloB}`,
        inconsistencias,
      };
    }

    return {
      decisao: 'diferente',
      nivel: 'marca',
      confiancaBp: CONFIANCA.MARCA_DIFERENTE,
      motivo: `marca diferente: ${marcaA} contra ${marcaB}`,
      inconsistencias,
    };
  }

  // 3. Só marca, sem código de peça dos dois lados. Marca diferente já basta para
  // separar; marca igual não basta para juntar, e aí o LLM decide.
  const marcaA = a.registro.marca === null ? null : normalizarMarca(a.registro.marca);
  const marcaB = b.registro.marca === null ? null : normalizarMarca(b.registro.marca);

  if (marcaA !== null && marcaB !== null && marcaA !== '' && marcaB !== '' && marcaA !== marcaB) {
    return {
      decisao: 'diferente',
      nivel: 'marca',
      confiancaBp: CONFIANCA.MARCA_DIFERENTE,
      motivo: `marca diferente: ${marcaA} contra ${marcaB}`,
      inconsistencias,
    };
  }

  if (quantidadeConflita(a, b)) {
    return {
      decisao: 'diferente',
      nivel: 'nenhum',
      confiancaBp: CONFIANCA.MARCA_DIFERENTE,
      motivo: descreverConflitoDeQuantidade(a, b),
      inconsistencias,
    };
  }

  return {
    decisao: 'indeciso',
    nivel: 'nenhum',
    confiancaBp: 0,
    motivo: 'falta GTIN ou código de peça dos dois lados; precisa de julgamento',
    inconsistencias,
  };
}

/**
 * O par vale uma chamada de LLM?
 *
 * Custa dinheiro, então a pergunta é feita antes e não depois. Não vale quando a
 * decisão já saiu determinística, e não vale quando um dos lados não tem sinal
 * nenhum: julgar `{}` contra `{}` não pode dar certo, e a resposta do modelo seria
 * um chute com aparência de justificativa — que é pior que não ter resposta.
 */
export function valeJulgamento(
  resultado: ResultadoDoCasamento,
  a: LadoDoCasamento,
  b: LadoDoCasamento,
): boolean {
  if (resultado.decisao !== 'indeciso') return false;
  return temSinal(a) && temSinal(b);
}

function temSinal(lado: LadoDoCasamento): boolean {
  const r = lado.registro;
  return (
    r.tipoProduto !== null ||
    r.marca !== null ||
    r.modeloPeca !== null ||
    r.modelosCompativeis.length > 0
  );
}
