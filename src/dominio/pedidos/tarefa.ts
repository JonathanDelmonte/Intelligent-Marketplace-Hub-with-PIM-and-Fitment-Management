/**
 * A importação de pedido como tarefa de fila (M10 — 8.6).
 *
 * ## Por que é um job próprio, e não um ramo do executor de ingestão
 *
 * A distinção entre planilha de anúncio e de venda só é possível **depois** de ler
 * o cabeçalho e mapear as colunas — nome de arquivo não serve, porque cada painel
 * nomeia como quer. Então a ingestão descobre, e encaminha.
 *
 * A alternativa era injetar repositório de pedido e resolvedor de perfil dentro do
 * executor de ingestão. Ficaria mais curto e pior: pedido é dado operacional e
 * exige `perfil_id`, e o executor de ingestão grava base compartilhada, que não
 * tem perfil nenhum. Misturar os dois colocaria perfil num lugar que não precisa
 * dele, e é o tipo de acoplamento que só dói dois meses depois.
 *
 * O custo é reler o arquivo. É armazenamento endereçado por hash em disco local, e
 * reler é exatamente o que a retomada de job já faz.
 */
import { z } from 'zod';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { formatoPorNome } from '@/dominio/ingestao/planilha/leitor';
import type { ImportadorDePlanilha } from '@/dominio/ingestao/planilha/importador';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import type { ArmazenamentoDeConteudo } from '@/infra/armazenamento/conteudo';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { ResultadoDoTique, Tarefa } from '@/infra/fila/poller';
import { registradorSilencioso, type Registrador } from '@/infra/log';
import { converterLinhaEmPedido } from './importador';
import type { RepositorioDePedidos } from './repositorio';

export const TIPO_JOB_PEDIDOS = 'importar_pedidos';
export const NOME_DA_TAREFA_DE_PEDIDOS = 'pedidos';

export const esquemaEntradaDePedidos = z.object({
  hashConteudo: z.string().min(1),
  plataforma: z.enum(PLATAFORMAS),
  nomeArquivo: z.string().nullable().default(null),
});

export type EntradaDePedidos = z.infer<typeof esquemaEntradaDePedidos>;

/**
 * Chave de idempotência: o hash do conteúdo.
 *
 * É o alvo **e** o evento ao mesmo tempo, diferente da coleta de compatibilidade:
 * a mesma planilha reimportada é o mesmo trabalho, e o resultado é idempotente
 * porque o pedido é gravado por `(plataforma, id_externo)`. Subir o arquivo duas
 * vezes não deve gerar dois jobs.
 */
export function chaveDePedidos(hashConteudo: string): string {
  return hashConteudo;
}

export async function enfileirarImportacaoDePedidos(
  fila: Fila,
  entrada: EntradaDePedidos,
  registrador: Registrador = registradorSilencioso,
): Promise<boolean> {
  try {
    await fila.enfileirar({
      tipo: TIPO_JOB_PEDIDOS,
      entrada,
      chaveIdempotencia: chaveDePedidos(entrada.hashConteudo),
    });
    return true;
  } catch (erro) {
    registrador.aviso('pedidos.nao_enfileirou', { hash: entrada.hashConteudo, erro });
    return false;
  }
}

export interface ContagemDePedidos {
  readonly gravados: number;
  readonly atualizados: number;
  readonly rejeitados: number;
  readonly semSku: number;
}

export type ResultadoDoJobDePedidos =
  | { readonly tipo: 'fila_vazia' }
  | {
      readonly tipo: 'concluido';
      readonly jobId: string;
      readonly contagem: ContagemDePedidos;
      readonly avisos: readonly string[];
    }
  | { readonly tipo: 'pendente_revisao'; readonly jobId: string; readonly motivo: string }
  | {
      readonly tipo: 'falhou';
      readonly jobId: string;
      readonly erro: string;
      readonly reagendado: boolean;
    };

/** Resolve o perfil dono da operação. Injetado para o executor não ler ambiente. */
export type ResolverPerfil = () => Promise<PerfilId>;

export class ExecutorDePedidos {
  constructor(
    private readonly fila: Fila,
    private readonly armazenamento: ArmazenamentoDeConteudo,
    private readonly importador: ImportadorDePlanilha,
    private readonly pedidos: RepositorioDePedidos,
    private readonly resolverPerfil: ResolverPerfil,
  ) {}

  async processarProximo(): Promise<ResultadoDoJobDePedidos> {
    const job = await this.fila.reivindicar({ tipos: [TIPO_JOB_PEDIDOS] });
    if (job === null) return { tipo: 'fila_vazia' };

    const analise = esquemaEntradaDePedidos.safeParse(job.entrada);
    if (!analise.success) {
      const motivo = `entrada do job não valida: ${analise.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    try {
      return await this.importar(job, analise.data);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const { reagendado } = await this.fila.falhar(job.id, mensagem);
      return { tipo: 'falhou', jobId: job.id, erro: mensagem, reagendado };
    }
  }

  private async importar(
    job: JobEnfileirado,
    entrada: EntradaDePedidos,
  ): Promise<ResultadoDoJobDePedidos> {
    const formato = formatoPorNome(entrada.nomeArquivo ?? '') ?? 'csv';
    const conteudo =
      formato === 'xlsx'
        ? ({ formato: 'xlsx', bytes: await this.armazenamento.ler(entrada.hashConteudo) } as const)
        : ({
            formato: 'csv',
            texto: await this.armazenamento.lerTexto(entrada.hashConteudo),
          } as const);

    const lido = await this.importador.importar({ conteudo, plataforma: entrada.plataforma });
    if (lido.tipo === 'pendente_revisao') {
      await this.fila.mandarParaRevisao(job.id, lido.motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo: lido.motivo };
    }

    const perfil = await this.resolverPerfil();
    const avisos = new Set<string>();
    let gravados = 0;
    let atualizados = 0;
    let semSku = 0;
    let rejeitados = lido.rejeitadas.length;

    for (const [indice, linha] of lido.linhas.entries()) {
      const convertida = converterLinhaEmPedido(linha.bruto, {
        plataforma: entrada.plataforma,
        fonte: 'm1_planilha',
      });

      if (!convertida.ok) {
        rejeitados += 1;
        avisos.add(`linha ${String(linha.numeroDaLinha)}: ${convertida.motivo}`);
        continue;
      }

      for (const aviso of convertida.avisos) avisos.add(aviso);

      const registro = await this.pedidos.registrar(perfil, convertida.captura);
      if (registro.novo) gravados += 1;
      else atualizados += 1;
      if (!registro.casouComSku) semSku += 1;

      if ((indice + 1) % 50 === 0) {
        await this.fila.salvarProgresso(job.id, {
          linhasProcessadas: indice + 1,
          totalDeLinhas: lido.linhas.length,
          gravados,
          atualizados,
          rejeitados,
        });
      }
    }

    const contagem: ContagemDePedidos = { gravados, atualizados, rejeitados, semSku };
    await this.fila.concluir(job.id, {
      ...contagem,
      linhaDoCabecalho: lido.linhaDoCabecalho,
      colunasNaoReconhecidas: lido.colunasNaoReconhecidas,
      avisos: [...avisos],
      rejeitadas: lido.rejeitadas,
    });

    return { tipo: 'concluido', jobId: job.id, contagem, avisos: [...avisos] };
  }
}

export function camposDaImportacaoDePedidos(
  resultado: ResultadoDoJobDePedidos,
): Record<string, unknown> {
  switch (resultado.tipo) {
    case 'fila_vazia':
      return {};
    case 'concluido':
      return {
        jobId: resultado.jobId,
        ...resultado.contagem,
        ...(resultado.avisos.length === 0 ? {} : { avisos: resultado.avisos.length }),
      };
    case 'pendente_revisao':
      return { jobId: resultado.jobId, motivo: resultado.motivo };
    case 'falhou':
      return { jobId: resultado.jobId, erro: resultado.erro, reagendado: resultado.reagendado };
  }
}

export function tarefaDePedidos(
  executor: ExecutorDePedidos,
  registrador: Registrador = registradorSilencioso,
): Tarefa {
  const log = registrador.com({ tarefa: NOME_DA_TAREFA_DE_PEDIDOS });

  return {
    nome: NOME_DA_TAREFA_DE_PEDIDOS,
    async executar(): Promise<ResultadoDoTique> {
      const resultado = await executor.processarProximo();
      const campos = camposDaImportacaoDePedidos(resultado);

      switch (resultado.tipo) {
        case 'fila_vazia':
          return { ocioso: true };
        case 'falhou':
          log.aviso('pedidos.job_falhou', campos);
          return { ocioso: false, campos };
        case 'pendente_revisao':
          log.info('pedidos.job_para_revisao', campos);
          return { ocioso: false, campos };
        case 'concluido':
          log.info('pedidos.job_concluido', campos);
          return { ocioso: false, campos };
      }
    },
  };
}
