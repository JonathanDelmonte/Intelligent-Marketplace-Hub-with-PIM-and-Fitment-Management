/**
 * Semeia o primeiro perfil de vendedor.
 *
 * É a etapa 2 da ordem de construção: "criar `perfil_vendedor` e `credencial` com
 * a primeira linha". O nome e o regime vêm de ambiente e de argumento de linha de
 * comando, **nunca de literal no código** — é exatamente o ponto do ADR 0003: o
 * segundo perfil é um `INSERT`, não um branch.
 *
 * Idempotente: rodar duas vezes não cria dois perfis.
 *
 * ```sh
 * npm run db:seed -- --nome="Essencial Emporium" --regime=cpf
 * ```
 */
import { eq } from 'drizzle-orm';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { REGIMES_FISCAIS } from '@/dominio/precificacao/tipos';
import type { RegimeFiscal } from '@/dominio/precificacao/tipos';
import { lerAmbiente } from '@/config/ambiente';
import { esquemaMarcaVisual } from '@/config/marca';
import { banco } from './cliente';
import { perfilVendedor } from './schema';

/** Teto anual do MEI. Vale só para o regime `mei`. */
const TETO_MEI = reaisParaCentavos(81_000);

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

function comoSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function principal(): Promise<void> {
  const ambiente = lerAmbiente();
  const db = banco();

  const regimeBruto = argumento('regime') ?? 'cpf';
  if (!(REGIMES_FISCAIS as readonly string[]).includes(regimeBruto)) {
    throw new Error(`regime inválido: ${regimeBruto}. Use um de ${REGIMES_FISCAIS.join(', ')}.`);
  }
  const regime = regimeBruto as RegimeFiscal;

  // O nome vem de argumento ou do slug configurado. Nenhum nome de vendedor é
  // literal no código.
  const slug = argumento('slug') ?? ambiente.BANCADA_PERFIL_PADRAO;
  const nome = argumento('nome') ?? slug;

  const existente = await db
    .select({ id: perfilVendedor.id })
    .from(perfilVendedor)
    .where(eq(perfilVendedor.slug, comoSlug(slug)))
    .limit(1);

  if (existente.length > 0) {
    console.log(`Perfil "${slug}" já existe. Nada a fazer.`);
    return;
  }

  const marcaVisual = esquemaMarcaVisual.parse({ nomeExibicao: nome });

  const [criado] = await db
    .insert(perfilVendedor)
    .values({
      slug: comoSlug(slug),
      nome,
      regime,
      tetoAnual: regime === 'mei' ? TETO_MEI : null,
      marcaVisual,
      ativo: true,
    })
    .returning({ id: perfilVendedor.id, slug: perfilVendedor.slug });

  console.log(
    `Perfil criado: ${criado?.slug ?? slug} (${criado?.id ?? 'sem id'}), regime ${regime}.`,
  );
  console.log(
    'Nenhuma credencial foi criada: elas entram pelo fluxo de OAuth e ficam cifradas ' +
      'na tabela `credencial` (ADR 0007).',
  );
}

principal().then(
  () => process.exit(0),
  (erro: unknown) => {
    console.error('Falha ao semear:', erro);
    process.exit(1);
  },
);
