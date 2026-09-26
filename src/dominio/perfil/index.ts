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
import { RepositorioDoNegocio, inicioDaJanelaDoMes } from './negocio';

/**
 * `essencial-emporium` → `Essencial Emporium`.
 *
 * Só troca separador por espaço e sobe a inicial de cada palavra. Não corrige
 * acento nem sabe de marca nenhuma: é transformação de texto, e o nome de verdade
 * entra por argumento da semeadura ou pela tela.
 *
 * Mora no domínio, e não no script de semeadura, por um motivo bobo e real: o
 * script chama `principal()` no topo do módulo, então importá-lo num teste rodaria
 * a semeadura e chamaria `process.exit`.
 */
export function nomeLegivelDoSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((parte) => parte !== '')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

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
 * - **`unidadesPrevistasNoMes` não existe na tabela** e não é inventado aqui: vem da
 *   contagem de unidades nos pedidos importados dos últimos 30 dias, e só entra quando
 *   essa contagem é passada e é maior que zero. Sem ele o M8 não rateia o DAS por
 *   unidade e diz isso — zero pedidos importados não é "vendo zero por mês", é "não sei".
 */
export function contextoDoVendedorDe(params: {
  readonly regime: RegimeFiscal;
  readonly dasMensal: number | null;
  readonly aliquotaSimplesBp: number | null;
  /** Unidades vendidas nos últimos 30 dias, quando contadas. */
  readonly unidadesNoMes?: number | null;
}): ContextoDoVendedor {
  const temCnpj = params.regime !== 'cpf';
  const unidades = params.unidadesNoMes ?? null;

  return {
    regimeFiscal: params.regime,
    temCnpj,
    ...(params.regime === 'mei' && params.dasMensal !== null
      ? {
          dasMensal: centavos(params.dasMensal),
          ...(unidades !== null && unidades > 0 ? { unidadesPrevistasNoMes: unidades } : {}),
        }
      : {}),
    ...(params.regime === 'simples' && params.aliquotaSimplesBp !== null
      ? { aliquotaSimples: pontosBase(params.aliquotaSimplesBp) }
      : {}),
  };
}

/**
 * Carrega o perfil pelo slug. Lança quando não existe, com o que fazer.
 *
 * `agora` marca a janela de 30 dias das unidades vendidas; é parâmetro para o teste
 * poder fixá-la.
 */
export async function carregarPerfil(
  db: Banco,
  slug: string,
  agora: Date = new Date(),
): Promise<PerfilAtivo> {
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

  // Só o MEI com DAS rateia por unidade, então só nele a contagem roda — as outras
  // telas carregam o perfil sem pagar uma consulta a mais.
  const unidadesNoMes =
    linha.regime === 'mei' && linha.dasMensal !== null
      ? await new RepositorioDoNegocio(db).unidadesVendidas(
          perfilId(linha.id),
          inicioDaJanelaDoMes(agora),
        )
      : null;

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
      unidadesNoMes,
    }),
  };
}

/**
 * O que o ajuste depois de restaurar fez com o perfil desta instalação.
 *
 * - `existia`: a cópia tem o perfil com o nome que esta instalação usa.
 * - `renomeado`: a cópia tinha um perfil só, com outro nome, e ele passou a ter este.
 * - `ausente`: a cópia não tem perfil nenhum, ou tem vários e nenhum com este nome — não
 *   há como saber qual é o desta instalação.
 */
export type AjusteDoPerfil = 'existia' | 'renomeado' | 'ausente';

/**
 * Depois de restaurar a cópia de outra instalação, o perfil que esta usa pode ter outro
 * nome na cópia: no computador, o `.env` costuma dar o nome da loja; na nuvem, sem
 * configuração, é `principal` (ADR 0014). Sem este ajuste, restaurar a cópia da nuvem no
 * computador — ou o contrário — deixaria toda tela sem perfil.
 *
 * Com um perfil só na cópia, ele passa a ter o nome que esta instalação procura: os dados
 * e o identificador continuam os mesmos, e só a chave de busca muda. Com vários, e nenhum
 * com este nome, não há como saber qual é o desta instalação, e nada muda.
 */
export async function ajustarPerfilDaInstalacao(db: Banco, slug: string): Promise<AjusteDoPerfil> {
  const perfis = await db
    .select({ id: perfilVendedor.id, slug: perfilVendedor.slug })
    .from(perfilVendedor);
  if (perfis.some((perfil) => perfil.slug === slug)) return 'existia';

  const [unico, ...outros] = perfis;
  if (unico === undefined || outros.length > 0) return 'ausente';

  await db
    .update(perfilVendedor)
    .set({ slug, atualizadoEm: new Date() })
    .where(eq(perfilVendedor.id, unico.id));
  return 'renomeado';
}
