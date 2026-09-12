/**
 * Tributo por unidade vendida, por regime.
 *
 * Parte de M8, não de M12: aqui só entra o que afeta a margem de uma venda. O
 * cadastro de NCM, CEST, CST e `cClassTrib`, o teto do MEI e os prazos de 2027
 * são do módulo fiscal (M12).
 */
import { ZERO, aplicarPontosBase, centavos, ratear } from '@/lib/dinheiro';
import type { Centavos, PontosBase } from '@/lib/dinheiro';
import type { ContextoDoVendedor } from './tipos';

export interface TributoCalculado {
  readonly valor: Centavos;
  /** Explicação curta, para aparecer na decomposição da tela de preço. */
  readonly explicacao: string;
  /** Motivo pelo qual o tributo não pôde ser calculado, quando for o caso. */
  readonly incerteza: 'nenhuma' | 'regime_cpf' | 'das_sem_unidades_previstas' | 'aliquota_ausente';
}

/**
 * Tributo atribuível a uma unidade vendida.
 *
 * Os três regimes se comportam de forma estruturalmente diferente, e essa
 * diferença importa para o preço:
 *
 * - **CPF** não tem tributo sobre a venda a modelar aqui. Devolve zero **com
 *   incerteza declarada**, porque zero silencioso viraria margem otimista: a
 *   pessoa física que vende com habitualidade tem obrigação de IRPF, e há o
 *   prazo de 01/01/2027 que exige CNPJ para PF contribuinte de CBS. O aviso
 *   correspondente é `regime_cpf_sem_tributo`.
 *
 * - **MEI** paga DAS **fixo** por mês, não percentual. Então o tributo por
 *   unidade depende de quantas unidades se espera vender — o que é uma
 *   estimativa, e o rateio precisa ser exato para a soma das unidades fechar com
 *   o DAS do mês. É o caso de uso de `ratear`.
 *
 * - **Simples** é percentual sobre a receita, então é direto.
 */
export function tributoPorUnidade(preco: Centavos, vendedor: ContextoDoVendedor): TributoCalculado {
  switch (vendedor.regimeFiscal) {
    case 'cpf':
      return {
        valor: ZERO,
        explicacao: 'regime CPF: nenhum tributo sobre a venda modelado',
        incerteza: 'regime_cpf',
      };

    case 'mei': {
      const das = vendedor.dasMensal;
      const unidades = vendedor.unidadesPrevistasNoMes;

      if (das === undefined || unidades === undefined || unidades <= 0) {
        return {
          valor: ZERO,
          explicacao: 'DAS do MEI não rateado: falta o valor mensal ou as unidades previstas',
          incerteza: 'das_sem_unidades_previstas',
        };
      }

      // O rateio distribui o resto de centavo, então a soma das unidades do mês
      // é exatamente o DAS. A primeira fatia é a maior — usá-la é a escolha
      // conservadora, que não subestima a margem.
      const fatias = ratear(das, Math.trunc(unidades));
      const primeira = fatias[0] ?? ZERO;

      return {
        valor: primeira,
        explicacao: `DAS do MEI rateado em ${String(Math.trunc(unidades))} unidade(s) previstas no mês`,
        incerteza: 'nenhuma',
      };
    }

    case 'simples': {
      const aliquota = vendedor.aliquotaSimples;
      if (aliquota === undefined) {
        return {
          valor: ZERO,
          explicacao: 'Simples sem alíquota efetiva informada',
          incerteza: 'aliquota_ausente',
        };
      }
      return {
        valor: aplicarPontosBase(preco, aliquota),
        explicacao: 'alíquota efetiva do Simples sobre o preço',
        incerteza: 'nenhuma',
      };
    }
  }
}

/**
 * Provisão de devolução, como custo esperado por venda.
 *
 * A especificação pede a taxa de devolução "como custo, não como surpresa". O
 * modelo: se uma fração das vendas volta, cada devolução custa o frete de ida,
 * o frete de volta, a embalagem perdida e o produto (que pode voltar
 * inutilizável). O custo esperado por venda é a taxa vezes esse total.
 *
 * O frete de volta é modelado igual ao de ida. Em frete grátis do ML o vendedor
 * paga os dois, que é o caso que mais dói e o que este cálculo precisa capturar.
 */
export function provisaoDeDevolucao(params: {
  readonly custoProduto: Centavos;
  readonly embalagem: Centavos;
  readonly frete: Centavos;
  readonly taxaEsperada: PontosBase;
}): Centavos {
  const custoDeUmaDevolucao = centavos(
    params.custoProduto + params.embalagem + params.frete + params.frete,
  );
  return aplicarPontosBase(custoDeUmaDevolucao, params.taxaEsperada);
}
