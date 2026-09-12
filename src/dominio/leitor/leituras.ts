/**
 * Leituras de balcão: registro, sincronização e histórico.
 *
 * A especificação pede que o leitor funcione offline, porque loja tem sinal ruim.
 * O que isso exige do lado do servidor é uma coisa só, e é de correção, não de
 * funcionalidade: **receber a fila do dispositivo mais de uma vez sem duplicar**.
 *
 * Conexão de loja cai no meio do envio. O dispositivo não sabe se o servidor
 * recebeu, então reenvia — é a única coisa que ele pode fazer. Se o servidor
 * tratar reenvio como leitura nova, quarenta leituras de um balcão viram oitenta,
 * e a tela de histórico deixa de ser confiável justamente na sessão que importa.
 *
 * A chave é `id_local`, gerada no dispositivo antes de haver rede. Mesma
 * disciplina da fila de jobs: `ON CONFLICT` resolve no banco, não em `if` na
 * aplicação.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Banco } from '@/infra/banco/cliente';
import { leitura } from '@/infra/banco/schema';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { normalizarGtin } from '@/dominio/gtin';
import { VEREDITOS } from './veredito';
import type { MotivoDoVeredito, Veredito } from './veredito';

export const DECISOES = ['comprou', 'nao_comprou', 'indeciso'] as const;
export type Decisao = (typeof DECISOES)[number];

export const ROTULO_DA_DECISAO: Readonly<Record<Decisao, string>> = {
  comprou: 'comprei',
  nao_comprou: 'não comprei',
  indeciso: 'ainda não decidi',
};

/**
 * Uma leitura como o dispositivo a envia.
 *
 * Validada com Zod porque **é fronteira externa**: vem de um navegador, com dado
 * que passou por armazenamento local e pode ter sido escrito por uma versão
 * anterior do aplicativo. É o mesmo cuidado que a tela de jobs tem ao ler payload
 * de job antigo.
 */
export const esquemaLeituraEnviada = z.object({
  idLocal: z.string().trim().min(1).max(64),
  gtin: z.string().trim().min(8).max(20),
  custoUnitario: z.number().int().nonnegative().nullable().default(null),
  unidadesNoLote: z.number().int().positive().nullable().default(null),
  veredito: z.enum(VEREDITOS),
  precoDeReferencia: z.number().int().nonnegative().nullable().default(null),
  margemBp: z.number().int().nullable().default(null),
  confiancaBp: z.number().int().min(0).max(10_000).nullable().default(null),
  motivos: z
    .array(z.object({ codigo: z.string(), severidade: z.string(), mensagem: z.string() }))
    .nullable()
    .default(null),
  decisao: z.enum(DECISOES).nullable().default(null),
  local: z.string().trim().max(120).nullable().default(null),
  /** Quando a leitura aconteceu no dispositivo, que não é quando sincronizou. */
  lidoEm: z.coerce.date(),
});

export type LeituraEnviada = z.input<typeof esquemaLeituraEnviada>;

export interface LeituraGravada {
  readonly id: string;
  readonly idLocal: string;
  readonly gtin: string;
  readonly gtinCanonico: string | null;
  readonly custoUnitario: number | null;
  readonly unidadesNoLote: number | null;
  readonly veredito: Veredito;
  readonly precoDeReferencia: number | null;
  readonly margemBp: number | null;
  readonly confiancaBp: number | null;
  readonly motivos: readonly MotivoDoVeredito[];
  readonly decisao: Decisao | null;
  readonly local: string | null;
  readonly lidoEm: Date;
}

export interface ResultadoDaSincronizacao {
  readonly gravadas: number;
  readonly atualizadas: number;
  readonly recusadas: readonly { readonly idLocal: string; readonly motivo: string }[];
}

/** Teto por descarga. Fila maior sincroniza em mais de uma ida. */
export const MAX_POR_DESCARGA = 200;

export class RepositorioDeLeituras {
  constructor(private readonly db: Banco) {}

  /**
   * Recebe uma fila de leituras. Idempotente por `(perfil, idLocal)`.
   *
   * Reenvio da mesma leitura **atualiza** em vez de duplicar, e atualizar é o
   * comportamento certo e não um detalhe: a pessoa escaneia, o veredito aparece,
   * e só depois ela marca se comprou. Essas duas coisas são a mesma leitura em
   * dois momentos, e a segunda chega com a decisão preenchida.
   *
   * Leitura malformada não derruba a fila inteira: entra em `recusadas` com o
   * motivo, e o resto grava. Uma linha estragada não pode custar as outras 39.
   */
  async sincronizar(params: {
    readonly perfil: PerfilId;
    readonly leituras: readonly LeituraEnviada[];
  }): Promise<ResultadoDaSincronizacao> {
    const recusadas: { idLocal: string; motivo: string }[] = [];
    let gravadas = 0;
    let atualizadas = 0;

    for (const bruta of params.leituras.slice(0, MAX_POR_DESCARGA)) {
      const lida = esquemaLeituraEnviada.safeParse(bruta);
      if (!lida.success) {
        recusadas.push({
          idLocal: typeof bruta.idLocal === 'string' ? bruta.idLocal : '(sem id)',
          motivo: lida.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }

      const dados = lida.data;
      const gtin = normalizarGtin(dados.gtin);

      const inseridas = await this.db
        .insert(leitura)
        .values({
          perfilId: params.perfil,
          idLocal: dados.idLocal,
          gtin: dados.gtin,
          // `null` quando o código não identifica a unidade (caixa) ou quando nem
          // é um GTIN válido — e a leitura é guardada de qualquer forma, porque o
          // que aconteceu no balcão aconteceu.
          gtinCanonico: gtin?.ean13 ?? null,
          custoUnitario: dados.custoUnitario,
          unidadesNoLote: dados.unidadesNoLote,
          veredito: dados.veredito,
          precoDeReferencia: dados.precoDeReferencia,
          margemBp: dados.margemBp,
          confiancaBp: dados.confiancaBp,
          motivos: dados.motivos,
          decisao: dados.decisao,
          local: dados.local,
          lidoEm: dados.lidoEm,
        })
        .onConflictDoUpdate({
          target: [leitura.perfilId, leitura.idLocal],
          set: {
            custoUnitario: sql`excluded.custo_unitario`,
            veredito: sql`excluded.veredito`,
            precoDeReferencia: sql`excluded.preco_de_referencia`,
            margemBp: sql`excluded.margem_bp`,
            confiancaBp: sql`excluded.confianca_bp`,
            motivos: sql`excluded.motivos`,
            decisao: sql`excluded.decisao`,
            local: sql`excluded.local`,
            sincronizadoEm: new Date(),
            atualizadoEm: new Date(),
          },
        })
        .returning({
          id: leitura.id,
          criadoEm: leitura.criadoEm,
          atualizadoEm: leitura.atualizadoEm,
        });

      const linha = inseridas[0];
      if (linha === undefined) continue;
      // Criação e atualização se distinguem pelos dois instantes: no `insert` eles
      // são iguais, no `update` o de atualização avança.
      if (linha.atualizadoEm.getTime() === linha.criadoEm.getTime()) gravadas += 1;
      else atualizadas += 1;
    }

    return { gravadas, atualizadas, recusadas };
  }

  /** As últimas leituras do perfil, mais recentes primeiro. */
  async ultimas(params: {
    readonly perfil: PerfilId;
    readonly limite?: number;
  }): Promise<readonly LeituraGravada[]> {
    const linhas = await this.db
      .select()
      .from(leitura)
      .where(eq(leitura.perfilId, params.perfil))
      .orderBy(desc(leitura.lidoEm))
      .limit(params.limite ?? 100);

    return linhas.map(paraLeitura);
  }

  /**
   * O que este perfil já avaliou deste código.
   *
   * É a segunda pergunta de quem escaneia: "eu já olhei isso?". Sem ela, avaliar
   * o mesmo item duas vezes no mesmo balcão é o normal.
   */
  async doGtin(params: {
    readonly perfil: PerfilId;
    readonly gtinCanonico: string;
    readonly limite?: number;
  }): Promise<readonly LeituraGravada[]> {
    const linhas = await this.db
      .select()
      .from(leitura)
      .where(
        and(eq(leitura.perfilId, params.perfil), eq(leitura.gtinCanonico, params.gtinCanonico)),
      )
      .orderBy(desc(leitura.lidoEm))
      .limit(params.limite ?? 20);

    return linhas.map(paraLeitura);
  }

  /** Contagem por decisão, para a tela dizer o que a sessão rendeu. */
  async contagemPorDecisao(params: {
    readonly perfil: PerfilId;
  }): Promise<Readonly<Record<Decisao | 'sem_decisao', number>>> {
    const linhas = await this.db
      .select({ decisao: leitura.decisao, n: sql<number>`count(*)::int` })
      .from(leitura)
      .where(eq(leitura.perfilId, params.perfil))
      .groupBy(leitura.decisao);

    const base: Record<Decisao | 'sem_decisao', number> = {
      comprou: 0,
      nao_comprou: 0,
      indeciso: 0,
      sem_decisao: 0,
    };

    for (const linha of linhas) {
      const chave = linha.decisao;
      if (chave === null) base.sem_decisao = linha.n;
      else if ((DECISOES as readonly string[]).includes(chave)) base[chave as Decisao] = linha.n;
    }
    return base;
  }
}

interface LinhaDeLeitura {
  id: string;
  idLocal: string;
  gtin: string;
  gtinCanonico: string | null;
  custoUnitario: number | null;
  unidadesNoLote: number | null;
  veredito: string;
  precoDeReferencia: number | null;
  margemBp: number | null;
  confiancaBp: number | null;
  motivos: unknown;
  decisao: string | null;
  local: string | null;
  lidoEm: Date;
}

const esquemaMotivos = z.array(
  z.object({
    codigo: z.string(),
    severidade: z.enum(['vermelho', 'amarelo', 'informativo']),
    mensagem: z.string(),
  }),
);

function paraLeitura(linha: LinhaDeLeitura): LeituraGravada {
  const motivos = esquemaMotivos.safeParse(linha.motivos);
  const veredito = (VEREDITOS as readonly string[]).includes(linha.veredito)
    ? (linha.veredito as Veredito)
    : 'sem_dado';
  const decisao =
    linha.decisao !== null && (DECISOES as readonly string[]).includes(linha.decisao)
      ? (linha.decisao as Decisao)
      : null;

  return {
    id: linha.id,
    idLocal: linha.idLocal,
    gtin: linha.gtin,
    gtinCanonico: linha.gtinCanonico,
    custoUnitario: linha.custoUnitario,
    unidadesNoLote: linha.unidadesNoLote,
    veredito,
    precoDeReferencia: linha.precoDeReferencia,
    margemBp: linha.margemBp,
    confiancaBp: linha.confiancaBp,
    // Leitura tolerante: motivo gravado por versão anterior não pode impedir a
    // tela de histórico de abrir.
    motivos: motivos.success ? (motivos.data as readonly MotivoDoVeredito[]) : [],
    decisao,
    local: linha.local,
    lidoEm: linha.lidoEm,
  };
}
