/**
 * As vendas dos últimos 30 dias, arrumadas por produto e por loja.
 *
 * É de onde saem o "você cobra" da tabela, os números do alto da lista e o cartão de
 * vendidos do produto. Arquivo próprio porque a lista e o produto usam, e arquivo de
 * página só pode exportar a página.
 */
import type { VendaDoProduto } from '@/dominio/lojas/repositorio';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { VendaNaLoja } from './conta';

export function vendasPorSku(
  vendas: readonly VendaDoProduto[],
): ReadonlyMap<string, Partial<Record<Plataforma, VendaNaLoja>>> {
  const mapa = new Map<string, Partial<Record<Plataforma, VendaNaLoja>>>();
  for (const venda of vendas) {
    const doProduto = mapa.get(venda.skuId) ?? {};
    doProduto[venda.plataforma] = {
      unidades: venda.unidades,
      faturamento: venda.faturamento,
      margem: venda.margem,
      faturamentoComMargem: venda.faturamentoComMargem,
      unidadesComMargem: venda.unidadesComMargem,
    };
    mapa.set(venda.skuId, doProduto);
  }
  return mapa;
}
