/**
 * Registro de tabelas de taxa, resolvido por plataforma e data.
 *
 * A resolução por data existe porque margem realizada de três meses atrás precisa
 * ser recalculável com a tabela que valia naquele dia — senão a conferência de
 * repasse (M10) acusa diferença que não existe.
 */
import type { Plataforma, TabelaDeTaxas } from '../tipos';
import { TABELA_AMAZON_2026_09 } from './amazon';
import { TABELA_ML_2026_09 } from './mercado-livre';
import { TABELA_SHOPEE_2026_09 } from './shopee';

export * from './amazon';
export * from './mercado-livre';
export * from './shopee';

/** Todas as tabelas conhecidas, em ordem de vigência decrescente. */
export const TABELAS: readonly TabelaDeTaxas[] = [
  TABELA_ML_2026_09,
  TABELA_SHOPEE_2026_09,
  TABELA_AMAZON_2026_09,
];

export class TabelaDeTaxasAusente extends Error {
  override readonly name = 'TabelaDeTaxasAusente';
  constructor(plataforma: Plataforma, em: Date) {
    super(
      `Nenhuma tabela de taxas vigente para ${plataforma} em ${em.toISOString()}. ` +
        'Cadastre a tabela da plataforma antes de precificar.',
    );
  }
}

/**
 * Devolve a tabela vigente de uma plataforma numa data.
 *
 * Lança em vez de devolver um padrão: precificar com tabela errada é pior que
 * não precificar, porque o resultado parece válido.
 */
export function tabelaVigente(plataforma: Plataforma, em: Date = new Date()): TabelaDeTaxas {
  const candidatas = TABELAS.filter(
    (t) =>
      t.plataforma === plataforma &&
      t.vigenteDe.getTime() <= em.getTime() &&
      (t.vigenteAte === null || t.vigenteAte.getTime() > em.getTime()),
  );

  // Mais de uma vigente na mesma data é erro de cadastro; a mais recente vence,
  // e o rótulo na decomposição permite achar o duplicado.
  const escolhida = candidatas.reduce<TabelaDeTaxas | null>(
    (melhor, atual) =>
      melhor === null || atual.vigenteDe.getTime() > melhor.vigenteDe.getTime() ? atual : melhor,
    null,
  );

  if (escolhida === null) throw new TabelaDeTaxasAusente(plataforma, em);
  return escolhida;
}
