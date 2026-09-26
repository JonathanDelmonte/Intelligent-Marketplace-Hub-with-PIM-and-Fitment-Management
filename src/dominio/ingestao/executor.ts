/**
 * Executor de ingestão — consome a fila e grava.
 *
 * Fecha o ciclo do M1: reivindica um job, lê o conteúdo pelo hash, roteia para o
 * extrator do tipo, e grava `produto_externo`. É o lado de trás do orquestrador.
 *
 * ## A honestidade que este arquivo precisa ter
 *
 * Dos nove tipos de entrada, **só dois têm extrator**: planilha de exportação e
 * lista de links. Dos que faltam, seis dependem de LLM e não existem ainda
 * (roadmap, etapas 3.2 a 3.6); `planilha_generica` é o caso fora dessa conta —
 * mapear as colunas dela não gastaria LLM nenhum, falta só saber a plataforma, e
 * por isso ela tem mensagem própria.
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
import {
  type ArmazenamentoDeConteudo,
  ConteudoNaoEncontrado,
  motivoDoArquivoAusente,
} from '@/infra/armazenamento/conteudo';
import type { Fila, JobEnfileirado } from '@/infra/fila/fila';
import type { IngestorDeProdutoExterno } from './produto-externo';
import { TIPO_JOB_INGESTAO, type EntradaDoJobDeIngestao } from './orquestrador';
import type { Orquestrador } from './orquestrador';
import { EXEMPLOS_DE_NOME_DE_EXPORTACAO } from './classificador';
import type { TipoDeEntrada } from './classificador';
import { formatoPorNome } from './planilha/leitor';
import { classificarPlanilha } from '@/dominio/pedidos/planilha';
import { enfileirarImportacaoDePedidos } from '@/dominio/pedidos/tarefa';
import { ImportadorDePlanilha } from './planilha/importador';
import { linksDaPagina } from '@/dominio/web/pagina';
import { PdfIlegivel, textoDoPdf } from '@/infra/pdf/texto';
import {
  FalhaDeRede,
  lerBytes,
  lerTexto,
  type OpcoesDaRede,
  type RespostaDeTexto,
} from '@/infra/web/rede';
import { ehUrlDeAnuncio } from './classificador';
import { capturasDoTexto, extrairDaPagina } from './extratores';
import type { LeitorDeImagem } from './imagem';
import type { ProdutoExternoCapturado } from './produto-externo';

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
      /**
       * A entrada era de outro tipo do que a classificação inicial supôs, e foi
       * passada para o executor certo. Hoje o único caso é planilha de venda, que
       * só se distingue de planilha de anúncio depois de mapear as colunas.
       */
      readonly tipo: 'encaminhado';
      readonly jobId: string;
      readonly para: 'pedidos';
      readonly motivo: string;
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

/** Entrada de página que chegou sem o link — não há o que abrir. */
function motivoDeExtratorAusente(tipo: TipoDeEntrada): string {
  return (
    `não há como ler "${tipo}" sem o link da página. A entrada está guardada: cole o ` +
    'link, ou o texto da tabela, no campo de entrada.'
  );
}

/**
 * Planilha que é planilha, só não se sabe de qual plataforma.
 *
 * Separado de `motivoDeExtratorAusente` porque a mensagem de lá era **falsa aqui**,
 * e mandava a pessoa para o lugar errado. Dizia "depende de extração por LLM", e não
 * depende: as colunas seriam mapeadas por tabela de sinônimo, sem LLM nenhum. O que
 * falta é uma informação só — de qual plataforma são as colunas, para escolher a
 * tabela.
 *
 * O sintoma, visto no navegador e não em teste: a mesma planilha de venda foi para
 * revisão falando de chave de LLM quando chamada `vendas-demo.csv`, e atravessou o
 * sistema inteiro quando chamada `vendas_mercadolivre.csv`. Quem lesse a primeira
 * mensagem iria configurar LLM, que não era o problema.
 */
function motivoDePlataformaDesconhecida(): string {
  return (
    'é planilha, mas o nome do arquivo não diz de qual plataforma — e o mapeamento ' +
    'de colunas depende disso. Não falta LLM: falta o nome. Renomeie incluindo a ' +
    `plataforma (por exemplo ${EXEMPLOS_DE_NOME_DE_EXPORTACAO.join(', ')}) e envie ` +
    'de novo. O conteúdo já está guardado, então reenviar não perde nada.'
  );
}

/** Links de anúncio que uma página de lista enfileira, no máximo. A primeira página da busca. */
export const LINKS_POR_LISTAGEM = 50;

export class ExecutorDeIngestao {
  private readonly importador = new ImportadorDePlanilha();

  constructor(
    private readonly fila: Fila,
    private readonly armazenamento: ArmazenamentoDeConteudo,
    private readonly ingestor: IngestorDeProdutoExterno,
    private readonly orquestrador: Orquestrador,
    /**
     * Rede para ler link colado. `null` — o padrão, e o do teste — deixa o link guardado
     * em revisão, dizendo que esta instalação foi montada sem rede.
     */
    private readonly rede: OpcoesDaRede | null = null,
    private readonly agora: () => Date = () => new Date(),
    /**
     * Lê o texto de uma imagem de tabela (3.6), pela IA com visão. `null` — o padrão, e o
     * do teste — deixa a imagem guardada em revisão, dizendo o que falta.
     */
    private readonly lerImagem: LeitorDeImagem | null = null,
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
      // Arquivo que não está guardado não volta com o tempo: tentar de novo só gastaria
      // as tentativas. Vai para revisão dizendo o que fazer, e lembrando o que espera.
      if (erro instanceof ConteudoNaoEncontrado) {
        const motivo = motivoDoArquivoAusente(erro);
        await this.fila.mandarParaRevisao(job.id, motivo, { aguardandoConteudo: erro.hash });
        return { tipo: 'pendente_revisao', jobId: job.id, motivo };
      }
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

      // Planilha genérica é o único destes que **não** espera LLM: espera um nome
      // de arquivo que diga a plataforma. Mensagem própria, por isso.
      case 'planilha_generica': {
        // Tabela **colada** — do WhatsApp, de um e-mail — não tem nome de arquivo para
        // renomear: vai para a leitura de linhas, que é o que ela é.
        if (payload.nomeArquivo === null && payload.url === null) {
          return this.processarTexto(job, payload);
        }
        const motivo = motivoDePlataformaDesconhecida();
        await this.fila.mandarParaRevisao(job.id, motivo);
        return { tipo: 'pendente_revisao', jobId: job.id, motivo };
      }

      case 'anuncio_marketplace':
        return this.processarPagina(job, payload, { anuncio: true });

      case 'catalogo_distribuidor':
        return this.processarPagina(job, payload, { anuncio: false });

      case 'listagem_categoria':
        return this.processarListagem(job, payload);

      case 'texto_colado':
        return this.processarTexto(job, payload);

      case 'tabela_precos_pdf':
        return this.processarPdf(job, payload);

      case 'imagem_tabela':
        return this.processarImagem(job, payload);
    }
  }

  private async revisao(job: JobEnfileirado, motivo: string): Promise<ResultadoDoProcessamento> {
    await this.fila.mandarParaRevisao(job.id, motivo);
    return { tipo: 'pendente_revisao', jobId: job.id, motivo };
  }

  /**
   * Lê o link. Devolve o texto, ou o motivo de revisão quando a página não serve.
   *
   * Falha passageira — rede fora, 429, erro 5xx — **lança**: o job é reagendado com
   * espera, e o link é lido de novo mais tarde. Página que não existe (404) ou que recusa
   * quem não é navegador (403) vira revisão: ler de novo não muda nada.
   */
  private async lerLink(
    url: string,
  ): Promise<
    | { readonly tipo: 'ok'; readonly resposta: RespostaDeTexto }
    | { readonly tipo: 'revisao'; readonly motivo: string }
  > {
    if (this.rede === null) {
      return {
        tipo: 'revisao',
        motivo:
          'esta instalação foi montada sem rede, e o link não foi lido. Ele está guardado: reenfileire quando houver rede.',
      };
    }
    let resposta: RespostaDeTexto;
    try {
      resposta = await lerTexto(url, this.rede);
    } catch (erro) {
      if (erro instanceof FalhaDeRede && erro.message.startsWith('endereço recusado')) {
        return { tipo: 'revisao', motivo: erro.message };
      }
      throw erro;
    }
    if (resposta.status === 404 || resposta.status === 410) {
      return { tipo: 'revisao', motivo: `a página não existe mais (${String(resposta.status)}).` };
    }
    if (resposta.status === 401 || resposta.status === 403) {
      return {
        tipo: 'revisao',
        motivo: `o site recusou a leitura (${String(resposta.status)}): ele só abre no navegador. Cole o título e o preço como texto.`,
      };
    }
    if (resposta.status >= 400) {
      throw new Error(`o site respondeu ${String(resposta.status)} ao ler ${url}.`);
    }
    return { tipo: 'ok', resposta };
  }

  /** Link de anúncio ou de catálogo: uma captura por produto que a página declara. */
  private async processarPagina(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
    opcoes: { readonly anuncio: boolean },
  ): Promise<ResultadoDoProcessamento> {
    const tipo = payload.classificacao.tipoDeEntrada;
    if (payload.url === null) return this.revisao(job, motivoDeExtratorAusente(tipo));

    const lido = await this.lerLink(payload.url);
    if (lido.tipo === 'revisao') return this.revisao(job, lido.motivo);

    const extraido = extrairDaPagina({
      html: lido.resposta.texto,
      url: lido.resposta.url,
      site: payload.classificacao.site,
      coletadoEm: this.agora(),
      anuncio: opcoes.anuncio,
    });
    if (extraido.tipo === 'revisao') return this.revisao(job, extraido.motivo);

    return this.gravarTodas(job, tipo, extraido.capturas);
  }

  /** Página de lista: um job por link de anúncio que ela aponta. */
  private async processarListagem(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    if (payload.url === null) return this.revisao(job, 'lista sem endereço');

    const lido = await this.lerLink(payload.url);
    if (lido.tipo === 'revisao') return this.revisao(job, lido.motivo);

    const links = linksDaPagina(lido.resposta.texto, lido.resposta.url)
      .filter(ehUrlDeAnuncio)
      .slice(0, LINKS_POR_LISTAGEM);
    if (links.length === 0) {
      return this.revisao(
        job,
        'a página de lista não trouxe link de anúncio — a plataforma pode montar a lista no navegador. Cole os links dos anúncios, um por linha.',
      );
    }

    const filhos = await this.orquestrador.receberLista(links);
    await this.fila.concluir(job.id, {
      filhosEnfileirados: filhos.length,
      jobsFilhos: filhos.map((f) => f.job.id),
    });
    return { tipo: 'enfileirou_filhos', jobId: job.id, quantidade: filhos.length };
  }

  /**
   * Tabela de preços em PDF — arquivo enviado ou link: o texto do PDF, lido linha por
   * linha como a tabela colada.
   */
  private async processarPdf(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    let bytes: Uint8Array;
    let origem: string;
    if (payload.hashConteudo !== null) {
      bytes = await this.armazenamento.ler(payload.hashConteudo);
      origem = payload.nomeArquivo ?? 'tabela em PDF';
    } else if (payload.url !== null) {
      if (this.rede === null) {
        return this.revisao(
          job,
          'esta instalação foi montada sem rede, e o PDF não foi lido. Ele está guardado: reenfileire quando houver rede.',
        );
      }
      const lido = await lerBytes(payload.url, this.rede);
      if (lido.status >= 400 && lido.status < 500) {
        return this.revisao(job, `o link do PDF respondeu ${String(lido.status)}.`);
      }
      if (lido.status >= 500)
        throw new Error(`o site respondeu ${String(lido.status)} ao ler o PDF.`);
      bytes = lido.bytes;
      origem = new URL(lido.url).hostname.replace(/^www\./, '');
    } else {
      return this.revisao(job, 'PDF sem conteúdo guardado e sem endereço.');
    }

    let texto: string;
    try {
      texto = await textoDoPdf(bytes);
    } catch (erro) {
      if (erro instanceof PdfIlegivel) return this.revisao(job, erro.message);
      throw erro;
    }

    const capturas = capturasDoTexto({
      texto,
      coletadoEm: this.agora(),
      fonte: 'm1_planilha',
      origem,
    });
    if (capturas.length === 0) {
      return this.revisao(
        job,
        texto.trim() === ''
          ? 'o PDF não tem texto — deve ser imagem escaneada. Tire um print da tabela e envie a imagem, que a IA lê; ou envie a tabela em planilha ou em texto.'
          : 'o PDF não tem linha com preço ou código de peça que desse para ler.',
      );
    }
    return this.gravarTodas(job, 'tabela_precos_pdf', capturas);
  }

  /**
   * Imagem de tabela — o print do WhatsApp (3.6). A IA transcreve o texto da imagem, e a
   * transcrição passa pela mesma leitura de linhas da tabela colada: um produto por linha
   * com preço ou código de peça.
   *
   * Sem chave, a imagem fica guardada em revisão, dizendo isso. Provedor fora e cota
   * esgotada **lançam**: o job é reagendado, e a imagem é lida mais tarde.
   */
  private async processarImagem(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    let bytes: Uint8Array;
    let origem: string;
    if (payload.hashConteudo !== null) {
      bytes = await this.armazenamento.ler(payload.hashConteudo);
      origem = payload.nomeArquivo ?? 'imagem de tabela';
    } else if (payload.url !== null) {
      if (this.rede === null) {
        return this.revisao(
          job,
          'esta instalação foi montada sem rede, e a imagem não foi lida. Ela está guardada: reenfileire quando houver rede.',
        );
      }
      const lido = await lerBytes(payload.url, this.rede);
      if (lido.status >= 400 && lido.status < 500) {
        return this.revisao(
          job,
          `o site recusou a imagem (${String(lido.status)}). Salve a imagem e envie o arquivo.`,
        );
      }
      if (lido.status >= 400) {
        throw new Error(`o site respondeu ${String(lido.status)} ao ler ${payload.url}.`);
      }
      bytes = lido.bytes;
      origem = payload.url;
    } else {
      return this.revisao(job, 'imagem sem conteúdo guardado e sem link.');
    }

    const semChave =
      'a leitura de imagem usa a IA, e esta instalação está sem a chave dela. A imagem está guardada: com LLM_API_KEY no .env, reenfileire. Enquanto isso, o texto da tabela colado no campo de entrada já é lido.';
    if (this.lerImagem === null) return this.revisao(job, semChave);

    const lida = await this.lerImagem(bytes, job.tentativas);
    switch (lida.tipo) {
      case 'sem_chave':
        return this.revisao(job, semChave);
      case 'ilegivel':
        return this.revisao(job, lida.motivo);
      case 'provedor_falhou':
        throw new Error(`a IA não respondeu à leitura da imagem: ${lida.motivo}`);
      case 'ok':
        break;
    }

    const capturas = capturasDoTexto({
      texto: lida.texto,
      coletadoEm: this.agora(),
      fonte: 'm1_planilha',
      origem,
    });
    if (capturas.length === 0) {
      return this.revisao(
        job,
        lida.texto.trim() === ''
          ? 'a IA não achou texto na imagem. Se for foto, tente um print mais nítido, ou cole o texto da tabela.'
          : 'a imagem foi lida, mas nenhuma linha tem preço ou código de peça. Confira se é a tabela, ou cole o texto dela.',
      );
    }
    return this.gravarTodas(job, 'imagem_tabela', capturas);
  }

  /** Tabela de fornecedor colada como texto: uma captura por linha de produto. */
  private async processarTexto(
    job: JobEnfileirado,
    payload: EntradaDoJobDeIngestao,
  ): Promise<ResultadoDoProcessamento> {
    const texto =
      payload.texto ??
      (payload.hashConteudo === null
        ? null
        : await this.armazenamento.lerTexto(payload.hashConteudo));
    if (texto === null || texto.trim() === '') return this.revisao(job, 'texto vazio');

    const capturas = capturasDoTexto({
      texto,
      coletadoEm: this.agora(),
      fonte: 'manual',
      origem: 'texto colado',
    });
    if (capturas.length === 0) {
      return this.revisao(
        job,
        'nenhuma linha com preço ou código de peça. Cole a tabela com um produto por linha — por exemplo "Refil PA21G - 38,00".',
      );
    }
    return this.gravarTodas(job, 'texto_colado', capturas);
  }

  /**
   * Grava as capturas, enfileira a resolução de identidade de cada uma e conclui o job.
   *
   * O mesmo laço da planilha, com o mesmo motivo de enfileirar também o duplicado: se
   * o job quebrar entre gravar e enfileirar, a reexecução vê a linha como duplicada.
   */
  private async gravarTodas(
    job: JobEnfileirado,
    tipoDeEntrada: TipoDeEntrada,
    capturas: readonly ProdutoExternoCapturado[],
  ): Promise<ResultadoDoProcessamento> {
    let gravados = 0;
    let duplicados = 0;
    let rejeitados = 0;
    const recusadas: { readonly titulo: string; readonly problemas: readonly string[] }[] = [];

    for (const captura of capturas) {
      const resultado = await this.ingestor.gravar(captura);
      if (resultado.tipo === 'pendente_revisao') {
        rejeitados += 1;
        recusadas.push({ titulo: captura.tituloBruto, problemas: resultado.problemas });
        continue;
      }
      if (resultado.tipo === 'gravado') gravados += 1;
      else duplicados += 1;
      await this.fila.enfileirar({
        tipo: TIPO_JOB_IDENTIDADE,
        chaveIdempotencia: chaveDeIdentidade(resultado.id),
        entrada: { produtoExternoId: resultado.id },
      });
    }

    const contagem: ContagemDaIngestao = { gravados, duplicados, rejeitados };
    await this.fila.concluir(job.id, { ...contagem, rejeitadas: recusadas });
    return {
      tipo: 'concluido',
      jobId: job.id,
      tipoDeEntrada,
      contagem,
      colunasNaoReconhecidas: [],
    };
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

    /*
     * Planilha de **venda** não grava aqui.
     *
     * A distinção entre anúncio e venda só é possível depois de ler o cabeçalho e
     * mapear as colunas — nome de arquivo não serve, porque cada painel nomeia como
     * quer e o dono renomeia. Então este executor descobre e **encaminha**, em vez
     * de crescer para gravar pedido: pedido é dado operacional e exige `perfil_id`,
     * e este executor grava base compartilhada, que não tem perfil nenhum.
     */
    const classificacaoDaPlanilha = classificarPlanilha(
      importado.mapeamento.mapeadas.map((c) => c.campo),
    );
    if (classificacaoDaPlanilha.tipo === 'pedidos') {
      await enfileirarImportacaoDePedidos(this.fila, {
        hashConteudo: payload.hashConteudo,
        plataforma,
        nomeArquivo: payload.nomeArquivo ?? null,
      });
      const encaminhado = {
        encaminhadoPara: 'pedidos',
        motivo: classificacaoDaPlanilha.motivo,
        linhaDoCabecalho: importado.linhaDoCabecalho,
        linhas: importado.linhas.length,
      };
      await this.fila.concluir(job.id, encaminhado);
      return {
        tipo: 'encaminhado',
        jobId: job.id,
        para: 'pedidos',
        motivo: classificacaoDaPlanilha.motivo,
      };
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
