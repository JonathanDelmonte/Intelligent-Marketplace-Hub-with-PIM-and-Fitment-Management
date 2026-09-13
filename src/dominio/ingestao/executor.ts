/**
 * Executor de ingestão — consome a fila e grava.
 *
 * Fecha o ciclo do M1: reivindica um job, lê o conteúdo pelo hash, roteia para o
 * extrator do tipo, e grava `produto_externo`. É o lado de trás do orquestrador.
 *
 * ## A honestidade que este arquivo precisa ter
 *
 * Dos nove tipos de entrada, **só dois têm extrator**: planilha de exportação e
 * lista de links. Os outros dependem de LLM e não existem ainda (roadmap, etapas
 * 3.2 a 3.6).
 *
 * O executor **não finge**. Tipo sem extrator vai para `pendente_revisao` com o
 * motivo dizendo exatamente o que falta. Duas razões:
 *
 * - A alternativa seria falhar como erro, e o job entraria em backoff tentando
 *   de novo para sempre um extrator que não existe.
 * - A pessoa vê na tela de jobs o que o sistema ainda não sabe fazer, em vez de
 *   um erro genérico que parece defeito.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { TIPO_JOB_IDENTIDADE, chaveDeIdentidade } from '@/dominio/identidade/tarefa';
import type { ArmazenamentoDeConteudo } from '@/infra/armazenamento/conteudo';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { IngestorDeProdutoExterno } from './produto-externo';
import { TIPO_JOB_INGESTAO, type EntradaDoJobDeIngestao } from './orquestrador';
import type { Orquestrador } from './orquestrador';
import type { TipoDeEntrada } from './classificador';
import { formatoPorNome } from './planilha/leitor';
import { ImportadorDePlanilha } from './planilha/importador';

export interface ContagemDaIngestao {
  readonly gravados: number;
  readonly duplicados: number;
  readonly rejeitados: number;
}

export type ResultadoDoProcessamento =
  | { readonly tipo: 'fila_vazia' }
  | {
      readonly tipo: 'concluido';
      readonly jobId: string;
      readonly tipoDeEntrada: TipoDeEntrada;
      readonly contagem: ContagemDaIngestao;
      /** Colunas que o mapeamento não reconheceu, quando foi planilha. */
      readonly colunasNaoReconhecidas: readonly string[];
    }
  | {
      readonly tipo: 'enfileirou_filhos';
      readonly jobId: string;
      readonly quantidade: number;
    }
  | {
      readonly tipo: 'pendente_revisao';
      readonly jobId: string;
      readonly motivo: string;
    }
  | {
      readonly tipo: 'falhou';
      readonly jobId: string;
      readonly erro: string;
      readonly reagendado: boolean;
    };

/** Mensagem única para tipo que espera extrator com LLM. */
function motivoDeExtratorAusente(tipo: TipoDeEntrada): string {
  return (
    `não há extrator para "${tipo}" ainda. Esse tipo depende de extração por LLM ` +
    '(roadmap, etapas 3.2 a 3.6), que precisa de chave de LLM configurada. ' +
    'A entrada está guardada e será processada quando o extrator existir.'
  );
}

export class ExecutorDeIngestao {
  private readonly importador = new ImportadorDePlanilha();

  constructor(
    private readonly fila: Fila,
    private readonly armazenamento: ArmazenamentoDeConteudo,
    private readonly ingestor: IngestorDeProdutoExterno,
    private readonly orquestrador: Orquestrador,
  ) {}

  /**
   * Processa um job. Devolve `fila_vazia` quando não há nada pronto.
   *
   * Nunca lança: erro de conteúdo vira `pendente_revisao`, erro de
   * infraestrutura vira `falhou` com reagendamento por backoff. Deixar escapar
   * faria o poller morrer e a fila parar.
   */
  async processarProximo(): Promise<ResultadoDoProcessamento> {
    const job = await this.fila.reivindicar({ tipos: [TIPO_JOB_INGESTAO] });
    if (job === null) return { tipo: 'fila_vazia' };

    try {
      return await this.processar(job);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      const { reagendado } = await this.fila.falhar(job.id, mensagem);
      return { tipo: 'falhou', jobId: job.id, erro: mensagem, reagendado };
    }
  }

  /** Processa até esgotar a fila ou atingir o limite. Devolve o que fez. */
  async processarTodos(limite = 100): Promise<readonly ResultadoDoProcessamento[]> {
    const resultados: ResultadoDoProcessamento[] = [];

    for (let i = 0; i < limite; i += 1) {
      const resultado = await this.processarProximo();
      if (resultado.tipo === 'fila_vazia') break;
      resultados.push(resultado);
    }

    return resultados;
  }

  private async processar(job: JobEnfileirado): Promise<ResultadoDoProcessamento> {
    const payload = job.entrada as EntradaDoJobDeIngestao | null;

    if (payload === null || typeof payload !== 'object' || !('classificacao' in payload)) {
      const motivo = 'payload do job não tem a forma esperada de uma ingestão';
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    const tipo = payload.classificacao.tipoDeEntrada;

    switch (tipo) {
      case 'planilha_exportacao':
        return this.processarPlanilha(job, payload);

      case 'lista_de_links':
        return this.processarListaDeLinks(job, payload);

      case 'desconhecido': {
        const motivo = `entrada não reconhecida: ${payload.classificacao.motivo}`;
        await this.fila.mandarParaRevisao(job.id, motivo);
        return { tipo: 'pendente_revisao', jobId: job.id, motivo };
      }

      // Todos dependem de extração por LLM, que não existe ainda.
      case 'anuncio_marketplace':
      case 'listagem_categoria':
      case 'catalogo_distribuidor':
      case 'tabela_precos_pdf':
      case 'imagem_tabela':
      case 'planilha_generica':
      case 'texto_colado': {
        const motivo = motivoDeExtratorAusente(tipo);
        await this.fila.mandarParaRevisao(job.id, motivo);
        return { tipo: 'pendente_revisao', jobId: job.id, motivo };
      }
    }
  }

  private async processarPlanilha(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    const plataforma = payload.classificacao.site;

    if (plataforma === null || !ehPlataformaDeVenda(plataforma)) {
      const motivo =
        `a planilha foi reconhecida como exportação, mas não de qual plataforma ` +
        `(site detectado: ${plataforma ?? 'nenhum'}). Informe a plataforma à mão.`;
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    if (payload.hashConteudo === null) {
      const motivo = 'planilha sem conteúdo guardado: o arquivo não chegou ao armazenamento';
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    const formato = formatoPorNome(payload.nomeArquivo ?? '') ?? 'csv';
    const conteudo =
      formato === 'xlsx'
        ? ({ formato: 'xlsx', bytes: await this.armazenamento.ler(payload.hashConteudo) } as const)
        : ({
            formato: 'csv',
            texto: await this.armazenamento.lerTexto(payload.hashConteudo),
          } as const);

    const importado = await this.importador.importar({ conteudo, plataforma });

    if (importado.tipo === 'pendente_revisao') {
      await this.fila.mandarParaRevisao(job.id, importado.motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo: importado.motivo };
    }

    let gravados = 0;
    let duplicados = 0;
    let rejeitados = importado.rejeitadas.length;

    for (const [indice, linha] of importado.linhas.entries()) {
      const resultado = await this.ingestor.gravar(linha.captura);

      if (resultado.tipo === 'gravado') gravados += 1;
      else if (resultado.tipo === 'duplicado') duplicados += 1;
      else rejeitados += 1;

      // A ocorrência gravada entra na fila de resolução de identidade, e é isso que
      // faz o grafo crescer **a cada link colado** em vez de a cada vez que alguém
      // abre a tela e clica.
      //
      // Enfileira também o `duplicado`, e o motivo é a retomada: se o job quebrar
      // entre gravar a linha e enfileirar, a reexecução vê a linha como duplicada —
      // e se só o `gravado` enfileirasse, essa ocorrência ficaria sem resolução para
      // sempre. A chave de idempotência é o id da ocorrência, então reenfileirar não
      // cria job repetido nem reabre job concluído.
      if (resultado.tipo === 'gravado' || resultado.tipo === 'duplicado') {
        await this.fila.enfileirar({
          tipo: TIPO_JOB_IDENTIDADE,
          chaveIdempotencia: chaveDeIdentidade(resultado.id),
          entrada: { produtoExternoId: resultado.id },
        });
      }

      // Progresso a cada 50 linhas: uma planilha que quebra na linha 4000 retoma
      // de perto disso em vez de reprocessar tudo.
      if ((indice + 1) % 50 === 0) {
        await this.fila.salvarProgresso(job.id, {
          linhasProcessadas: indice + 1,
          totalDeLinhas: importado.linhas.length,
          gravados,
          duplicados,
          rejeitados,
        });
      }
    }

    const contagem: ContagemDaIngestao = { gravados, duplicados, rejeitados };

    await this.fila.concluir(job.id, {
      ...contagem,
      linhaDoCabecalho: importado.linhaDoCabecalho,
      colunasNaoReconhecidas: importado.colunasNaoReconhecidas,
      camposDuplicados: importado.camposDuplicados,
      // As linhas rejeitadas ficam no resultado, não descartadas: é o que permite
      // corrigir à mão sem reimportar a planilha inteira.
      rejeitadas: importado.rejeitadas,
    });

    return {
      tipo: 'concluido',
      jobId: job.id,
      tipoDeEntrada: 'planilha_exportacao',
      contagem,
      colunasNaoReconhecidas: importado.colunasNaoReconhecidas,
    };
  }

  private async processarListaDeLinks(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    const urls = payload.classificacao.urls ?? [];

    if (urls.length === 0) {
      const motivo = 'a entrada foi classificada como lista de links, mas nenhuma URL sobrou';
      await this.fila.mandarParaRevisao(job.id, motivo);
      return { tipo: 'pendente_revisao', jobId: job.id, motivo };
    }

    const filhos = await this.orquestrador.receberLista(urls);

    await this.fila.concluir(job.id, {
      filhosEnfileirados: filhos.length,
      jobsFilhos: filhos.map((f) => f.job.id),
    });

    return { tipo: 'enfileirou_filhos', jobId: job.id, quantidade: filhos.length };
  }
}

/**
 * O site reconhecido é uma das três plataformas de venda?
 *
 * O classificador reconhece mais sites que as três — 1688, Alibaba e AliExpress
 * entram como fonte de custo de origem. Nenhum deles exporta planilha de
 * anúncios, então só as três passam por aqui.
 */
function ehPlataformaDeVenda(site: string): site is Plataforma {
  return site === 'ml' || site === 'shopee' || site === 'amazon';
}
