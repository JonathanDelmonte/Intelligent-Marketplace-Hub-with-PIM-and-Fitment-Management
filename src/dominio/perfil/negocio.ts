/**
 * Os dados do negócio, que o dono preenche na tela "Meu negócio".
 *
 * Pedido do dono, em 24/09: o sistema precisa ser flexível a ponto de ele não ter de
 * informar nada pelo chat. Estado, regime, documento e certificado moram no aplicativo;
 * o que se pode calcular — quanto vende por mês, e em que plataforma — sai dos pedidos
 * importados, e ninguém digita.
 *
 * O que se grava aqui muda o que o resto do sistema responde: o regime decide a tabela
 * de comissão e o rateio do DAS no M8, o teto alimenta o controle do MEI, e o conjunto
 * decide a recomendação de emissor de nota (`fiscal/emissor.ts`).
 */
import { and, count, eq, gte, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { pedido, perfilVendedor } from '@/infra/banco/schema';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { lerDocumento, type Documento } from '@/dominio/documento';
import { TETO_MEI_ANUAL } from '@/dominio/fiscal/teto';
import { lerDia } from '@/lib/dia';
import {
  PLATAFORMAS,
  REGIMES_FISCAIS,
  type Plataforma,
  type RegimeFiscal,
} from '@/dominio/precificacao/tipos';
import { ehUf, type Uf } from './uf';

/**
 * O "por mês" do sistema: os últimos 30 dias, e não o mês do calendário.
 *
 * No dia 3, o mês do calendário tem três dias de venda — e a previsão do mês sairia
 * dez vezes menor, com o DAS rateado dez vezes maior em cada unidade. A janela móvel
 * dá o mesmo número no dia 3 e no dia 28.
 */
export const DIAS_DA_JANELA_DO_MES = 30;

export function inicioDaJanelaDoMes(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_DA_JANELA_DO_MES * 86_400_000);
}

export interface DadosDoNegocio {
  readonly nome: string;
  readonly regime: RegimeFiscal;
  readonly documento: Documento | null;
  readonly inscricaoEstadual: string | null;
  readonly uf: Uf | null;
  /** Quando o CNPJ abriu. Decide o teto proporcional do MEI no ano da abertura. */
  readonly abertoEm: Date | null;
  /** `null` é "não tem certificado". */
  readonly certificadoValidoAte: Date | null;
  /** Centavos. Só vale no MEI. */
  readonly dasMensal: number | null;
  /** Pontos-base. Só vale no Simples. */
  readonly aliquotaSimplesBp: number | null;
  /** Centavos. */
  readonly tetoAnual: number | null;
}

const campoDeDia = (mensagem: string) =>
  z
    .string()
    .trim()
    .refine((texto) => texto === '' || lerDia(texto) !== null, mensagem);

/**
 * O que a tela manda, já lido e validado pela ação.
 *
 * Regime e documento têm de concordar, e a recusa é aqui, e não no banco: MEI e Simples
 * são CNPJ, pessoa física é CPF. Documento do tipo errado é quase sempre o CPF do dono
 * digitado no lugar do CNPJ da empresa — e a nota sairia no nome errado.
 */
export const esquemaDoNegocio = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'o nome precisa de dois caracteres ou mais')
      .max(120, 'o nome passa de 120 caracteres'),
    regime: z.enum(REGIMES_FISCAIS, 'regime desconhecido'),
    documento: z.string().trim().max(30, 'o documento passa de 30 caracteres'),
    inscricaoEstadual: z
      .string()
      .trim()
      .max(20, 'a inscrição estadual passa de 20 caracteres')
      .regex(/^[0-9A-Za-z.\-/ ]*$/, 'a inscrição estadual tem só números, letras e pontuação'),
    uf: z.string().trim().toUpperCase(),
    abertoEm: campoDeDia('a data de abertura não é um dia que exista'),
    certificadoValidoAte: campoDeDia('a validade do certificado não é um dia que exista'),
    dasMensal: z.number().int().nonnegative('o DAS não pode ser negativo').nullable(),
    aliquotaSimplesBp: z
      .number()
      .int()
      .min(0, 'a alíquota não pode ser negativa')
      .max(10_000, 'a alíquota passa de 100%')
      .nullable(),
    tetoAnual: z.number().int().positive('o teto precisa ser maior que zero').nullable(),
  })
  .transform((bruto, contexto) => {
    const lido = lerDocumento(bruto.documento);
    if (lido.tipo === 'invalido') {
      contexto.addIssue({ code: 'custom', path: ['documento'], message: lido.motivo });
      return z.NEVER;
    }
    const documento = lido.tipo === 'ok' ? lido.documento : null;
    if (documento !== null) {
      const pede = bruto.regime === 'cpf' ? 'cpf' : 'cnpj';
      if (documento.tipo !== pede) {
        contexto.addIssue({
          code: 'custom',
          path: ['documento'],
          message:
            pede === 'cnpj'
              ? 'MEI e Simples são empresa: o documento é o CNPJ, e o informado é um CPF.'
              : 'Pessoa física vende com CPF, e o informado é um CNPJ. Se já há empresa, o regime é MEI ou Simples.',
        });
        return z.NEVER;
      }
    }
    if (bruto.uf !== '' && !ehUf(bruto.uf)) {
      contexto.addIssue({ code: 'custom', path: ['uf'], message: 'estado desconhecido' });
      return z.NEVER;
    }

    return {
      nome: bruto.nome,
      regime: bruto.regime,
      documento,
      inscricaoEstadual: bruto.inscricaoEstadual === '' ? null : bruto.inscricaoEstadual,
      uf: ehUf(bruto.uf) ? bruto.uf : null,
      abertoEm: lerDia(bruto.abertoEm),
      certificadoValidoAte: lerDia(bruto.certificadoValidoAte),
      dasMensal: bruto.dasMensal,
      aliquotaSimplesBp: bruto.aliquotaSimplesBp,
      // O MEI tem teto por lei; deixar o campo em branco não pode apagar o teto do
      // controle do ano. Nos outros regimes, em branco é sem teto.
      tetoAnual: bruto.tetoAnual ?? (bruto.regime === 'mei' ? TETO_MEI_ANUAL : null),
    } satisfies DadosDoNegocio;
  });

function documentoGravado(texto: string | null): Documento | null {
  if (texto === null) return null;
  const lido = lerDocumento(texto);
  return lido.tipo === 'ok' ? lido.documento : null;
}

export class RepositorioDoNegocio {
  constructor(private readonly db: Banco) {}

  async ler(perfil: PerfilId): Promise<DadosDoNegocio | null> {
    const linhas = await this.db
      .select({
        nome: perfilVendedor.nome,
        regime: perfilVendedor.regime,
        cnpjOuCpf: perfilVendedor.cnpjOuCpf,
        inscricaoEstadual: perfilVendedor.inscricaoEstadual,
        uf: perfilVendedor.uf,
        abertoEm: perfilVendedor.abertoEm,
        certificadoValidoAte: perfilVendedor.certificadoValidoAte,
        dasMensal: perfilVendedor.dasMensal,
        aliquotaSimplesBp: perfilVendedor.aliquotaSimplesBp,
        tetoAnual: perfilVendedor.tetoAnual,
      })
      .from(perfilVendedor)
      .where(eq(perfilVendedor.id, perfil))
      .limit(1);
    const linha = linhas[0];
    if (linha === undefined) return null;
    return {
      nome: linha.nome,
      regime: linha.regime,
      documento: documentoGravado(linha.cnpjOuCpf),
      inscricaoEstadual: linha.inscricaoEstadual,
      uf: linha.uf !== null && ehUf(linha.uf) ? linha.uf : null,
      abertoEm: linha.abertoEm,
      certificadoValidoAte: linha.certificadoValidoAte,
      dasMensal: linha.dasMensal,
      aliquotaSimplesBp: linha.aliquotaSimplesBp,
      tetoAnual: linha.tetoAnual,
    };
  }

  async gravar(perfil: PerfilId, dados: DadosDoNegocio): Promise<boolean> {
    const atualizados = await this.db
      .update(perfilVendedor)
      .set({
        nome: dados.nome,
        regime: dados.regime,
        cnpjOuCpf: dados.documento?.valor ?? null,
        inscricaoEstadual: dados.inscricaoEstadual,
        uf: dados.uf,
        abertoEm: dados.abertoEm,
        certificadoValidoAte: dados.certificadoValidoAte,
        dasMensal: dados.dasMensal,
        aliquotaSimplesBp: dados.aliquotaSimplesBp,
        tetoAnual: dados.tetoAnual,
        atualizadoEm: new Date(),
      })
      .where(eq(perfilVendedor.id, perfil))
      .returning({ id: perfilVendedor.id });
    return atualizados.length > 0;
  }

  /**
   * Unidades vendidas desde uma data — a soma das quantidades, e não o número de
   * pedidos: um pedido de três peças são três fatias do DAS.
   *
   * É a previsão do mês que o M8 usa para ratear o DAS do MEI por unidade. Vendeu tanto
   * nos últimos 30 dias, deve vender perto disso nos próximos: estimativa, e dita como
   * tal na explicação da margem.
   */
  async unidadesVendidas(perfil: PerfilId, desde: Date): Promise<number> {
    const [linha] = await this.db
      .select({ unidades: sum(pedido.qtd) })
      .from(pedido)
      .where(and(eq(pedido.perfilId, perfil), gte(pedido.data, desde)));
    return Number(linha?.unidades ?? 0);
  }

  /**
   * Vendas por plataforma desde uma data, contadas nos pedidos importados.
   *
   * É o "quanto vende por mês" que não precisa ser perguntado: a importação de pedidos
   * (M10) já tem a resposta.
   */
  async vendasPorPlataforma(
    perfil: PerfilId,
    desde: Date,
  ): Promise<Readonly<Record<Plataforma, number>>> {
    const linhas = await this.db
      .select({ plataforma: pedido.plataforma, quantos: count() })
      .from(pedido)
      .where(and(eq(pedido.perfilId, perfil), gte(pedido.data, desde)))
      .groupBy(pedido.plataforma);

    const vendas: Record<Plataforma, number> = { ml: 0, shopee: 0, amazon: 0 };
    for (const linha of linhas) {
      if ((PLATAFORMAS as readonly string[]).includes(linha.plataforma)) {
        vendas[linha.plataforma] = linha.quantos;
      }
    }
    return vendas;
  }
}
