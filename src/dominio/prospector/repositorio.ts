/**
 * Persistência do dossiê (M6 — 10.7, 10.8).
 *
 * **Base compartilhada: sem `perfil_id`.** Um dossiê sobre "refil de purificador
 * Electrolux" vale para qualquer perfil que venda isso — é conhecimento do mundo, como
 * compatibilidade e fornecedor (ADR 0003).
 *
 * ## Grava a cada passo, e é por isso que o teto não perde trabalho
 *
 * A tabela `dossie` guarda as três listas vivas em `jsonb` desde o schema da fase 1,
 * com a nota de que existe "para que uma execução interrompida seja retomável, e para
 * que um agente que estoura o orçamento salve o dossiê parcial". Este módulo é o que
 * cumpre a promessa.
 *
 * O `upsert` é por alvo: investigar o mesmo alvo duas vezes continua o dossiê em vez
 * de criar um segundo. Dois dossiês do mesmo alvo seria a pior forma de perder
 * informação — nenhum dos dois estaria errado, e nenhum dos dois estaria completo.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Banco } from '@/infra/banco/cliente';
import { dossie } from '@/infra/banco/schema';
import { centavos } from '@/lib/dinheiro';
import { resumirDossie, type DossieParaGravar, type ResumoDoDossie } from './dossie';

export interface DossieGravado extends DossieParaGravar {
  readonly id: string;
  /** Recalculado na leitura: é leitura sobre o dossiê de agora. */
  readonly resumo: ResumoDoDossie;
  readonly atualizadoEm: Date;
}

/**
 * Normaliza o alvo para servir de chave.
 *
 * "Refil Purificador PA21G" e "refil purificador pa21g " são o mesmo alvo, e tratar
 * como dois criaria dois dossiês parciais do mesmo assunto — o modo mais silencioso de
 * perder investigação paga.
 *
 * O resultado vai para `alvo_chave`, e **não** para `alvo`. Ficava nos dois até a tela
 * do garimpo existir, e aí "correia de máquina de lavar" apareceu escrito "correia de
 * maquina de lavar" para quem ia ler o dossiê.
 */
export function chaveDoAlvo(alvo: string): string {
  return alvo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class RepositorioDeDossies {
  constructor(private readonly db: Banco) {}

  /**
   * Grava o dossiê, continuando o do mesmo alvo quando já existe.
   *
   * Chamado **a cada passo** pelo executor, e não só no fim: é o que faz o estouro de
   * orçamento deixar o trabalho salvo em vez de perdido.
   */
  async salvar(paraGravar: DossieParaGravar): Promise<DossieGravado> {
    const chave = chaveDoAlvo(paraGravar.alvo);

    const existentes = await this.db
      .select({ id: dossie.id })
      .from(dossie)
      .where(eq(dossie.alvoChave, chave))
      .limit(1);

    // As listas são copiadas para array mutável porque é o que a escrita do Drizzle
    // aceita. Cópia na borda, não `as`: o domínio continua `readonly`, e o banco
    // recebe o que ele sabe gravar.
    const valores = {
      hipoteses: [...paraGravar.hipoteses],
      fronteira: [...paraGravar.fronteira],
      achados: [...paraGravar.achados],
      orcamentoCentavos: paraGravar.orcamentoCentavos,
      gastoCentavos: paraGravar.gastoCentavos,
      orcamentoPassos: paraGravar.orcamentoPassos,
      passosGastos: paraGravar.passosGastos,
      motivoParada: paraGravar.motivoParada,
      recomendacao: paraGravar.recomendacao,
      atualizadoEm: new Date(),
    };

    const existente = existentes[0];
    const [linha] =
      existente === undefined
        ? await this.db
            .insert(dossie)
            // `alvo` guarda o que a pessoa escreveu, `alvo_chave` a identidade. Na
            // atualização o `alvo` **não** entra: quem salva a cada passo é o executor,
            // com o mesmo alvo, e deixar a escrita de fora impede que uma chamada
            // posterior com grafia pior sobrescreva a boa.
            .values({ alvo: paraGravar.alvo.trim(), alvoChave: chave, ...valores })
            .returning()
        : await this.db.update(dossie).set(valores).where(eq(dossie.id, existente.id)).returning();

    if (linha === undefined) throw new Error('dossiê não foi gravado');
    return paraDossie(linha);
  }

  /** O dossiê de um alvo, se houver. */
  async porAlvo(alvo: string): Promise<DossieGravado | null> {
    const [linha] = await this.db
      .select()
      .from(dossie)
      .where(eq(dossie.alvoChave, chaveDoAlvo(alvo)))
      .limit(1);

    return linha === undefined ? null : paraDossie(linha);
  }

  async porId(id: string): Promise<DossieGravado | null> {
    const [linha] = await this.db.select().from(dossie).where(eq(dossie.id, id)).limit(1);
    return linha === undefined ? null : paraDossie(linha);
  }

  /** Os últimos dossiês, para a tela. Mais recentes primeiro. */
  async ultimos(limite = 25): Promise<readonly DossieGravado[]> {
    const linhas = await this.db
      .select()
      .from(dossie)
      .orderBy(desc(dossie.atualizadoEm))
      .limit(limite);
    return linhas.map(paraDossie);
  }

  /**
   * Dossiês que pararam no teto e têm hipótese em aberto.
   *
   * É a fila de "vale continuar": parou por limite, não por saturação, e ainda tem o
   * que perseguir. Quem parou por saturação **não** entra — aumentar o teto ali não
   * traria nada, e oferecer isso seria vender passo inútil.
   */
  async valeContinuar(limite = 25): Promise<readonly DossieGravado[]> {
    const linhas = await this.db
      .select()
      .from(dossie)
      .where(
        and(
          sql`${dossie.motivoParada} in ('orcamento_passos', 'orcamento_reais')`,
          sql`jsonb_array_length(${dossie.hipoteses}) > 0`,
        ),
      )
      .orderBy(desc(dossie.atualizadoEm))
      .limit(limite);

    return linhas.map(paraDossie).filter((d) => d.resumo.hipotesesAbertas > 0);
  }
}

/**
 * A linha como o Drizzle a devolve.
 *
 * Os `jsonb` já vêm tipados pelo schema (`$type`), então não há `as` em lugar nenhum
 * deste arquivo — o tipo entra na borda do banco, onde ele pertence.
 */
type LinhaDeDossie = typeof dossie.$inferSelect;

function paraDossie(linha: LinhaDeDossie): DossieGravado {
  const parcial: DossieParaGravar = {
    alvo: linha.alvo,
    hipoteses: linha.hipoteses,
    fronteira: linha.fronteira,
    achados: linha.achados,
    orcamentoCentavos: centavos(linha.orcamentoCentavos),
    gastoCentavos: centavos(linha.gastoCentavos),
    orcamentoPassos: linha.orcamentoPassos,
    passosGastos: linha.passosGastos,
    motivoParada: linha.motivoParada,
    recomendacao: linha.recomendacao,
  };

  return {
    id: linha.id,
    ...parcial,
    resumo: resumirDossie(parcial),
    atualizadoEm: linha.atualizadoEm,
  };
}
