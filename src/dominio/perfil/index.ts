/**
 * O perfil de vendedor ativo.
 *
 * Primeiro consumidor real: o leitor de código de barras precisa do `perfil_id`
 * para achar o SKU próprio e para gravar a leitura, e precisa do regime fiscal
 * para o M8 calcular margem. Até aqui nenhuma tela dependia de perfil, e por isso
 * não havia onde resolvê-lo.
 *
 * O slug vem de `BANCADA_PERFIL_PADRAO`. É configuração e não código (ADR 0003):
 * o dia em que houver um segundo perfil deve ser um `INSERT` e uma variável, não
 * um `if`.
 *
 * ## O que este módulo traduz
 *
 * A tabela guarda o regime fiscal como enum e dois números soltos — DAS mensal e
 * alíquota do Simples. O M8 quer um `ContextoDoVendedor`, que é outra forma: com
 * `temCnpj` derivado, e com os campos opcionais presentes **só quando se sabe**.
 * A tradução tem regra, e regra tem teste.
 */
import { eq } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { perfilVendedor } from '@/infra/banco/schema';
import { perfilId, type PerfilId } from '@/dominio/catalogo/sku';
import { esquemaMarcaVisual, type MarcaVisual } from '@/config/marca';
import type { ContextoDoVendedor, RegimeFiscal } from '@/dominio/precificacao/tipos';
import { centavos } from '@/lib/dinheiro';
import { pontosBase } from '@/lib/dinheiro';

export interface PerfilAtivo {
  readonly id: PerfilId;
  readonly slug: string;
  readonly nome: string;
  readonly regime: RegimeFiscal;
  readonly visual: MarcaVisual | null;
  /** Pronto para o M8 consumir. */
  readonly contextoDoVendedor: ContextoDoVendedor;
}

export class PerfilNaoEncontrado extends Error {
  override readonly name = 'PerfilNaoEncontrado';

  constructor(readonly slug: string) {
    super(
      `nenhum perfil de vendedor com slug "${slug}". Rode npm run db:seed, ou ajuste ` +
        'BANCADA_PERFIL_PADRAO para o slug que existe.',
    );
  }
}

/**
 * Traduz a linha do perfil para o contexto que o M8 espera.
 *
 * Função pura e exportada porque é onde mora a regra:
 *
 * - **CPF não tem CNPJ.** Parece tautologia e não é: é o que faz o M8 aplicar a
 *   tabela de pessoa física, que tem comissão diferente.
 * - **Campo opcional só entra quando se sabe.** `dasMensal` ausente não vira zero;
 *   fica de fora, e o M8 avisa que não pode ratear o DAS. Zero seria pior que
 *   ausente, porque zero é uma afirmação — "não pago DAS" — e ausente é a
 *   verdade: "não sei quanto".
 * - **`unidadesPrevistasNoMes` não existe na tabela** e não é inventado aqui. Sem
 *   ele o M8 não rateia o DAS por unidade e diz isso. Virá do M10, quando houver
 *   histórico de pedido para contar.
 */
export function contextoDoVendedorDe(params: {
  readonly regime: RegimeFiscal;
  readonly dasMensal: number | null;
  readonly aliquotaSimplesBp: number | null;
}): ContextoDoVendedor {
  const temCnpj = params.regime !== 'cpf';

  return {
    regimeFiscal: params.regime,
    temCnpj,
    ...(params.regime === 'mei' && params.dasMensal !== null
      ? { dasMensal: centavos(params.dasMensal) }
      : {}),
    ...(params.regime === 'simples' && params.aliquotaSimplesBp !== null
      ? { aliquotaSimples: pontosBase(params.aliquotaSimplesBp) }
      : {}),
  };
}

/** Carrega o perfil pelo slug. Lança quando não existe, com o que fazer. */
export async function carregarPerfil(db: Banco, slug: string): Promise<PerfilAtivo> {
  const linhas = await db
    .select({
      id: perfilVendedor.id,
      slug: perfilVendedor.slug,
      nome: perfilVendedor.nome,
      regime: perfilVendedor.regime,
      dasMensal: perfilVendedor.dasMensal,
      aliquotaSimplesBp: perfilVendedor.aliquotaSimplesBp,
      marcaVisual: perfilVendedor.marcaVisual,
      ativo: perfilVendedor.ativo,
    })
    .from(perfilVendedor)
    .where(eq(perfilVendedor.slug, slug))
    .limit(1);

  const linha = linhas[0];
  if (linha === undefined) throw new PerfilNaoEncontrado(slug);

  // Leitura tolerante do jsonb de marca: perfil com tema gravado em formato
  // antigo não pode impedir o sistema de abrir. Sem tema, cai no padrão do CSS.
  const visual = esquemaMarcaVisual.safeParse(linha.marcaVisual);

  return {
    id: perfilId(linha.id),
    slug: linha.slug,
    nome: linha.nome,
    regime: linha.regime,
    visual: visual.success ? visual.data : null,
    contextoDoVendedor: contextoDoVendedorDe({
      regime: linha.regime,
      dasMensal: linha.dasMensal,
      aliquotaSimplesBp: linha.aliquotaSimplesBp,
    }),
  };
}
