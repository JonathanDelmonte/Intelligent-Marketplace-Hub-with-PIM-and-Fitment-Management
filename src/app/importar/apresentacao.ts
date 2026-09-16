/**
 * A lógica da tela de importação, separada do JSX.
 *
 * Existe como módulo próprio porque **é a parte que pode estar errada**. Layout
 * errado se vê; resumo de payload errado não — e o payload chega como `unknown`
 * de uma coluna `jsonb`, escrito por uma versão do código que pode não ser esta.
 *
 * Sendo função pura, tem teste. O JSX não tem, e essa é uma escolha consciente:
 * montar `@testing-library/react` para verificar que uma tabela renderiza `<tr>`
 * custa dependência e tempo de suíte para cobrir o que o compilador e o olho já
 * cobrem. O que o olho não cobre é `resumirEntrada` recebendo o payload de um job
 * de dois meses atrás.
 *
 * Regra que vale para tudo aqui: **nada lança**. Uma linha da tabela que não
 * consegue ser resumida vira texto de recurso, porque a tela de observabilidade
 * ficar em branco é pior que uma linha feia — é justamente quando algo está
 * errado que ela precisa abrir.
 */
import { z } from 'zod';
import { TIPOS_DE_ENTRADA, type TipoDeEntrada } from '@/dominio/ingestao/classificador';
import { STATUS_JOB, type JobDetalhado, type StatusJob } from '@/infra/fila/fila';
import { IDIOMA, formatarAbsoluto, formatarRelativo } from '../ui/tempo';
import { contagem } from '@/lib/texto';

// ─── Status ──────────────────────────────────────────────────────────────────

export const ROTULO_DO_STATUS: Readonly<Record<StatusJob, string>> = {
  pendente: 'na fila',
  rodando: 'rodando',
  concluido: 'concluído',
  falhou: 'falhou',
  pendente_revisao: 'revisar',
};

/**
 * Explicação de cada status, para quem abre a tela sem conhecer o sistema.
 *
 * `pendente_revisao` é o que mais precisa de explicação: parece erro e não é.
 * Metade do valor desta tela é ensinar isso sem obrigar a ler a especificação.
 */
export const EXPLICACAO_DO_STATUS: Readonly<Record<StatusJob, string>> = {
  pendente: 'esperando o processador da fila pegar',
  rodando: 'em execução agora',
  concluido: 'terminou e gravou',
  falhou: 'esgotou as tentativas; o erro fica visível',
  pendente_revisao: 'esperando decisão humana — não é erro, e nada foi descartado',
};

/** Cor por status. Nome de variável CSS, nunca cor literal (ADR 0003). */
export const COR_DO_STATUS: Readonly<Record<StatusJob, string>> = {
  pendente: 'var(--cor-texto-fraco)',
  rodando: 'var(--cor-primaria)',
  concluido: 'var(--cor-ok)',
  falhou: 'var(--cor-erro)',
  pendente_revisao: 'var(--cor-aviso)',
};

export function ehStatusConhecido(valor: string): valor is StatusJob {
  return (STATUS_JOB as readonly string[]).includes(valor);
}

// ─── Tipos de entrada ────────────────────────────────────────────────────────

export const ROTULO_DO_TIPO_DE_ENTRADA: Readonly<Record<TipoDeEntrada, string>> = {
  anuncio_marketplace: 'anúncio de marketplace',
  listagem_categoria: 'listagem de categoria',
  catalogo_distribuidor: 'catálogo de distribuidor',
  tabela_precos_pdf: 'tabela de preços em PDF',
  imagem_tabela: 'imagem de tabela',
  planilha_exportacao: 'planilha de exportação',
  planilha_generica: 'planilha genérica',
  lista_de_links: 'lista de links',
  texto_colado: 'texto colado',
  desconhecido: 'não reconhecido',
};

export function rotuloDoTipoDeEntrada(valor: string): string {
  return (TIPOS_DE_ENTRADA as readonly string[]).includes(valor)
    ? ROTULO_DO_TIPO_DE_ENTRADA[valor as TipoDeEntrada]
    : valor;
}

// ─── Resumo da entrada do job ────────────────────────────────────────────────

/**
 * Schema tolerante do payload de ingestão.
 *
 * Tolerante de propósito: campo a mais passa, campo a menos não derruba. O
 * payload no banco foi escrito por alguma versão do orquestrador, e a tela precisa
 * abrir mesmo para o job gravado antes do último `deploy`. Validação rígida é para
 * fronteira de entrada; aqui a fronteira é de leitura do próprio banco.
 */
const esquemaEntrada = z.object({
  classificacao: z.object({
    tipoDeEntrada: z.string(),
    site: z.string().nullish(),
    confiancaBp: z.number().nullish(),
    motivo: z.string().nullish(),
    urls: z.array(z.string()).nullish(),
  }),
  hashConteudo: z.string().nullish(),
  nomeArquivo: z.string().nullish(),
  url: z.string().nullish(),
  texto: z.string().nullish(),
});

export interface ResumoDaEntrada {
  /** O que a pessoa reconhece: nome do arquivo, URL, ou início do texto. */
  readonly titulo: string;
  readonly tipoDeEntrada: string | null;
  readonly site: string | null;
  readonly confiancaBp: number | null;
  readonly motivoDaClassificacao: string | null;
  /** Verdadeiro quando o payload não tem a forma de uma ingestão. */
  readonly formaInesperada: boolean;
}

export const MAX_TITULO = 90;

export function resumirEntrada(entrada: unknown): ResumoDaEntrada {
  const lido = esquemaEntrada.safeParse(entrada);

  if (!lido.success) {
    return {
      titulo: 'payload em formato não reconhecido',
      tipoDeEntrada: null,
      site: null,
      confiancaBp: null,
      motivoDaClassificacao: null,
      formaInesperada: true,
    };
  }

  const p = lido.data;
  const urls = p.classificacao.urls ?? [];

  const titulo =
    p.nomeArquivo ??
    p.url ??
    (p.texto === null || p.texto === undefined || p.texto.trim() === ''
      ? urls.length > 0
        ? `${String(urls.length)} links`
        : 'entrada sem identificação'
      : recortar(p.texto.trim(), MAX_TITULO));

  return {
    titulo: recortar(titulo, MAX_TITULO),
    tipoDeEntrada: p.classificacao.tipoDeEntrada,
    site: p.classificacao.site ?? null,
    confiancaBp: p.classificacao.confiancaBp ?? null,
    motivoDaClassificacao: p.classificacao.motivo ?? null,
    formaInesperada: false,
  };
}

// ─── Resumo do resultado ─────────────────────────────────────────────────────

/**
 * Schema tolerante do resultado, que tem formas diferentes por tipo de job.
 *
 * Planilha grava contagem; lista de links grava filhos enfileirados. Em vez de
 * uma união discriminada (que exigiria gravar um discriminante que hoje não
 * existe), cada campo é opcional e só o que veio aparece.
 */
const esquemaResultado = z.object({
  gravados: z.number().nullish(),
  duplicados: z.number().nullish(),
  rejeitados: z.number().nullish(),
  linhaDoCabecalho: z.number().nullish(),
  colunasNaoReconhecidas: z.array(z.string()).nullish(),
  camposDuplicados: z.array(z.string()).nullish(),
  filhosEnfileirados: z.number().nullish(),
  rejeitadas: z.array(z.unknown()).nullish(),
});

export interface Metrica {
  readonly rotulo: string;
  readonly valor: string;
  /** Métrica que merece destaque visual: algo não entrou como devia. */
  readonly alerta?: boolean;
}

export function resumirResultado(resultado: unknown): readonly Metrica[] {
  const lido = esquemaResultado.safeParse(resultado);
  if (!lido.success) return [];

  const r = lido.data;
  const metricas: Metrica[] = [];

  const numero = (rotulo: string, valor: number | null | undefined, alerta = false): void => {
    if (typeof valor !== 'number' || valor === 0) return;
    metricas.push({ rotulo, valor: valor.toLocaleString(IDIOMA), ...(alerta ? { alerta } : {}) });
  };

  numero('gravados', r.gravados);
  numero('duplicados', r.duplicados);
  numero('rejeitados', r.rejeitados, true);
  numero('filhos', r.filhosEnfileirados);

  // Coluna não reconhecida não é erro do job — é o mapeamento de uma plataforma
  // envelhecendo. Aparece porque é o aviso mais cedo possível de que a próxima
  // importação vai perder um campo.
  const colunas = r.colunasNaoReconhecidas ?? [];
  if (colunas.length > 0) {
    metricas.push({
      rotulo: 'colunas ignoradas',
      valor: colunas.join(', '),
      alerta: true,
    });
  }

  const duplicados = r.camposDuplicados ?? [];
  if (duplicados.length > 0) {
    metricas.push({ rotulo: 'campos duplicados', valor: duplicados.join(', '), alerta: true });
  }

  return metricas;
}

// ─── Progresso ───────────────────────────────────────────────────────────────

const esquemaProgresso = z.object({
  linhasProcessadas: z.number(),
  totalDeLinhas: z.number().nullish(),
});

/** Progresso parcial como texto, quando houver. É o que mostra job vivo. */
export function resumirProgresso(progresso: unknown): string | null {
  const lido = esquemaProgresso.safeParse(progresso);
  if (!lido.success) return null;

  const { linhasProcessadas, totalDeLinhas } = lido.data;
  if (typeof totalDeLinhas !== 'number' || totalDeLinhas <= 0) {
    return `${linhasProcessadas.toLocaleString(IDIOMA)} linhas`;
  }
  const pct = Math.floor((linhasProcessadas / totalDeLinhas) * 100);
  return `${linhasProcessadas.toLocaleString(IDIOMA)} de ${totalDeLinhas.toLocaleString(IDIOMA)} linhas (${String(pct)}%)`;
}

// ─── Tempo ───────────────────────────────────────────────────────────────────

/*
 * Formatação de tempo mora em `ui/tempo.ts` desde que a tela do monitor passou a
 * precisar da mesma coisa. Reexportado aqui porque os componentes desta tela importam
 * daqui, e mudar dez pontos de importação para mover uma função seria ruído no diff.
 */
export { IDIOMA, formatarAbsoluto, formatarRelativo };

/** Duração legível. Job de 80 ms e job de 4 minutos aparecem na mesma coluna. */
export function formatarDuracao(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s.toLocaleString(IDIOMA, { maximumFractionDigits: s < 10 ? 1 : 0 })} s`;
  }
  const minutos = Math.floor(ms / 60_000);
  const segundos = Math.round((ms % 60_000) / 1000);
  return segundos === 0 ? `${String(minutos)} min` : `${String(minutos)} min ${String(segundos)} s`;
}

/**
 * Quanto o job levou, ou está levando.
 *
 * `null` quando nem começou. Job `rodando` mede contra `agora`, que é o que
 * mostra o job travado — duração que só cresce é o sintoma.
 */
export function duracaoDoJob(job: JobDetalhado, agora: Date): number | null {
  if (job.iniciadoEm === null) return null;
  const fim = job.terminadoEm ?? agora;
  return Math.max(0, fim.getTime() - job.iniciadoEm.getTime());
}

// ─── Tentativas ──────────────────────────────────────────────────────────────

/**
 * Tentativas como texto, só quando há o que dizer.
 *
 * Job de primeira tentativa não merece coluna preenchida; job na terceira de três
 * merece destaque, porque a próxima falha o encerra.
 */
export function descreverTentativas(job: JobDetalhado): { texto: string; alerta: boolean } | null {
  if (job.tentativas <= 1) return null;
  return {
    texto: `${String(job.tentativas)}/${String(job.maxTentativas)}`,
    alerta: job.tentativas >= job.maxTentativas,
  };
}

// ─── Util ────────────────────────────────────────────────────────────────────

/**
 * Recorta para caber em `maximo` caracteres, **contando a marca de corte**.
 *
 * A primeira versão cortava em `maximo - 1` e acrescentava três pontos, o que
 * devolvia `maximo + 2` — uma função de limite que estourava o próprio limite. O
 * teste pegou, e o defeito é do tipo que passaria despercebido para sempre num
 * `title` de célula.
 */
export const MARCA_DE_CORTE = '...';

export function recortar(texto: string, maximo: number): string {
  const limpo = texto.replace(/\s+/gu, ' ').trim();
  if (limpo.length <= maximo) return limpo;
  if (maximo <= MARCA_DE_CORTE.length) return limpo.slice(0, Math.max(0, maximo));
  return `${limpo.slice(0, maximo - MARCA_DE_CORTE.length).trimEnd()}${MARCA_DE_CORTE}`;
}

// ─── Avisos de ação ──────────────────────────────────────────────────────────

/**
 * Resultado de uma ação, como **código**, não como texto na URL.
 *
 * A ação termina em `redirect`, e o jeito fácil de levar a mensagem seria
 * `?aviso=Entrada+aceita`. Texto livre na URL significa que qualquer link
 * consegue fazer a tela dizer qualquer coisa — inclusive "3 registros
 * removidos". O React escapa o texto, então não é injeção; é mentira, que numa
 * tela de auditoria é pior.
 *
 * Com código, a tela só sabe dizer o que este arquivo prevê.
 */
export const CODIGOS_DE_AVISO = [
  'enfileirado',
  'ja_existia',
  'revisao',
  'sem_entrada',
  'grande',
  'reenfileirado',
  'processado',
  'nada_para_processar',
  'job_inexistente',
  'job_rodando',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tipo: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/**
 * Texto de um código de aviso.
 *
 * `quantidade` é o único dado que atravessa a URL, e é coagido para inteiro não
 * negativo — o resto é literal daqui.
 */
export function descreverAviso(
  codigo: string | undefined,
  quantidade: number | null = null,
): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  const n = quantidade === null || !Number.isInteger(quantidade) || quantidade < 0 ? 0 : quantidade;

  switch (codigo as CodigoDeAviso) {
    case 'enfileirado':
      return {
        tipo: 'ok',
        titulo: 'Entrada aceita',
        corpo: 'Está na fila. O processador da fila pega no próximo tique.',
      };
    case 'ja_existia':
      return {
        tipo: 'atencao',
        titulo: 'Esta entrada já estava na fila',
        corpo:
          'A chave de idempotência é a mesma, então nada foi duplicado e nada foi ' +
          'cobrado de novo. A entrada que já existia está na lista abaixo.',
      };
    case 'revisao':
      return {
        tipo: 'atencao',
        titulo: 'Entrada guardada, mas precisa de revisão',
        corpo:
          'A classificação ficou abaixo do limiar de confiança, então o sistema não ' +
          'gastou extração. Nada foi descartado: a entrada está em "revisar" com o motivo.',
      };
    case 'sem_entrada':
      return {
        tipo: 'erro',
        titulo: 'Nada foi enviado',
        corpo: 'Cole um link, uma lista de links ou um texto, ou escolha um arquivo.',
      };
    case 'grande':
      return {
        tipo: 'erro',
        titulo: 'Arquivo acima do limite do formulário',
        corpo:
          'Planilha grande entra pelo caminho de linha de comando, que lê do disco ' +
          'em vez de carregar o arquivo na memória do servidor.',
      };
    case 'reenfileirado':
      return {
        tipo: 'ok',
        titulo: 'Entrada de volta à fila',
        corpo: 'As tentativas voltaram a zero e o erro anterior foi limpo.',
      };
    case 'processado':
      return {
        tipo: 'ok',
        titulo: contagem(n, 'entrada processada', 'entradas processadas'),
        corpo: 'Execução manual, sem esperar o poller.',
      };
    case 'nada_para_processar':
      return {
        tipo: 'atencao',
        titulo: 'Não havia nada pronto para rodar',
        corpo:
          'A fila pode estar vazia, ou o que falhou pode estar aguardando o intervalo ' +
          'de nova tentativa.',
      };
    case 'job_inexistente':
      return {
        tipo: 'erro',
        titulo: 'Entrada não encontrada',
        corpo: 'Talvez tenha sido limpa.',
      };
    case 'job_rodando':
      return {
        tipo: 'erro',
        titulo: 'Entrada em execução',
        corpo: 'Não é seguro reenfileirar agora. Espere terminar ou o prazo de execução estourar.',
      };
  }
}

/**
 * Aviso de que há trabalho parado e possivelmente ninguém consumindo.
 *
 * O sistema **não sabe** se existe poller rodando: não há batimento gravado, e
 * inventar um estado de processo que não se mede seria pior que não dizer nada.
 * O que se sabe é o observável — há job pronto, e faz tempo que nenhum terminou.
 * O aviso diz isso, com as duas saídas possíveis, sem afirmar a causa.
 */
export const JANELA_DE_FILA_PARADA_MS = 60_000;

export function avisoDeFilaParada(params: {
  readonly prontos: number;
  readonly ultimoTermino: Date | null;
  readonly agora: Date;
}): string | null {
  if (params.prontos <= 0) return null;

  const quieto =
    params.ultimoTermino === null ||
    params.agora.getTime() - params.ultimoTermino.getTime() > JANELA_DE_FILA_PARADA_MS;
  if (!quieto) return null;

  const n = params.prontos;
  return (
    `${contagem(n, 'entrada', 'entradas')} ${n === 1 ? 'está pronta' : 'estão prontas'} para rodar ` +
    'e nada terminou no último minuto. Se nenhum processo estiver consumindo a fila, use ' +
    '"Processar agora" ou ligue o processador da fila.'
  );
}

/** Inteiro de parâmetro de URL, ou `null`. Nunca lança. */
export function inteiroDaUrl(bruto: string | undefined): number | null {
  if (bruto === undefined) return null;
  const valor = Number(bruto);
  return Number.isInteger(valor) && valor >= 0 ? valor : null;
}

/**
 * O término mais recente da lista.
 *
 * Alimenta o aviso de fila parada. Percorre em vez de consultar o banco de novo:
 * a lista dos últimos jobs já está carregada, e uma consulta a mais por
 * carregamento de tela, numa página que pode atualizar a cada cinco segundos, é
 * custo que não se paga por um dado que já está em mãos.
 */
export function ultimoTermino(jobs: readonly JobDetalhado[]): Date | null {
  let maior: Date | null = null;
  for (const job of jobs) {
    if (job.terminadoEm === null) continue;
    if (maior === null || job.terminadoEm.getTime() > maior.getTime()) maior = job.terminadoEm;
  }
  return maior;
}

// ─── Linhas rejeitadas ───────────────────────────────────────────────────────

/**
 * Schema tolerante de uma linha que a importação recusou.
 *
 * O executor guarda essas linhas em `resultado.rejeitadas` **de propósito**: é o
 * que permite corrigir três linhas à mão em vez de reimportar uma planilha de
 * quatro mil. Elas estavam no banco e não apareciam em nenhuma tela, o que é o
 * mesmo que não existirem para quem opera.
 */
const esquemaLinhaRejeitada = z.object({
  numeroDaLinha: z.number().nullish(),
  motivo: z.string().nullish(),
  problemas: z.array(z.string()).nullish(),
  /** A linha já mapeada para campo do domínio. Só as colunas reconhecidas. */
  bruto: z.record(z.string(), z.string()).nullish(),
  /** A linha como veio no arquivo, com nome de coluna original e na ordem. */
  original: z.array(z.object({ coluna: z.string(), valor: z.string() })).nullish(),
});

export interface LinhaRejeitadaParaTela {
  readonly numeroDaLinha: number | null;
  readonly motivo: string;
  readonly problemas: readonly string[];
  /** Pares coluna/valor, na ordem em que vieram. */
  readonly campos: readonly { readonly coluna: string; readonly valor: string }[];
  /**
   * Verdadeiro quando os campos vêm da linha original do arquivo, com o nome de
   * coluna que a pessoa vê na planilha. Falso quando só há a forma mapeada — job
   * gravado antes de a linha original passar a ser guardada.
   */
  readonly temColunasOriginais: boolean;
}

export function extrairRejeitadas(resultado: unknown): readonly LinhaRejeitadaParaTela[] {
  const lido = z.object({ rejeitadas: z.array(z.unknown()).nullish() }).safeParse(resultado);
  if (!lido.success) return [];

  const saida: LinhaRejeitadaParaTela[] = [];
  for (const bruta of lido.data.rejeitadas ?? []) {
    const linha = esquemaLinhaRejeitada.safeParse(bruta);
    if (!linha.success) continue;

    // A linha original tem precedência: é a que traz o nome de coluna da
    // planilha e as colunas que o mapeamento não reconheceu. `bruto` é o recurso
    // para job gravado antes de ela existir.
    const original = linha.data.original ?? [];
    const temColunasOriginais = original.length > 0;

    const campos = temColunasOriginais
      ? original
      : Object.entries(linha.data.bruto ?? {})
          // Coluna vazia é ruído de planilha: célula de sobra à direita da tabela.
          .filter(([coluna, valor]) => coluna.trim() !== '' || valor.trim() !== '')
          .map(([coluna, valor]) => ({ coluna, valor }));

    saida.push({
      numeroDaLinha: linha.data.numeroDaLinha ?? null,
      motivo: linha.data.motivo ?? 'sem motivo registrado',
      problemas: linha.data.problemas ?? [],
      campos,
      temColunasOriginais,
    });
  }
  return saida;
}

// ─── Payload cru ─────────────────────────────────────────────────────────────

/**
 * JSON legível de um valor do banco, para a tela de detalhe.
 *
 * Existe porque a tela de detalhe é a última linha de defesa: quando o resumo não
 * explica, a pessoa precisa ver o que está gravado. Corta o que for grande demais
 * em vez de despejar um megabyte no navegador — e diz que cortou, porque texto
 * truncado sem aviso é pior que texto cortado.
 */
export const MAX_JSON_NA_TELA = 20_000;

export function jsonLegivel(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  try {
    const texto = JSON.stringify(valor, null, 2);
    if (texto === undefined) return null;
    if (texto.length <= MAX_JSON_NA_TELA) return texto;
    return `${texto.slice(0, MAX_JSON_NA_TELA)}${String.fromCharCode(10)}[... cortado em ${String(MAX_JSON_NA_TELA)} caracteres de ${String(texto.length)}]`;
  } catch {
    // Ciclo não deveria acontecer em dado vindo de `jsonb`, mas a tela de
    // diagnóstico é justamente a que não pode quebrar por dado estranho.
    return '[não foi possível serializar o valor gravado]';
  }
}

/** Linha de "ficha" do job: rótulo e valor, já formatados. */
export function fichaDoJob(
  job: JobDetalhado,
  agora: Date,
): readonly { readonly rotulo: string; readonly valor: string }[] {
  const duracao = duracaoDoJob(job, agora);

  return [
    { rotulo: 'identificador', valor: job.id },
    { rotulo: 'tipo de job', valor: job.tipo },
    { rotulo: 'status', valor: ROTULO_DO_STATUS[job.status] },
    { rotulo: 'tentativas', valor: `${String(job.tentativas)} de ${String(job.maxTentativas)}` },
    { rotulo: 'criado', valor: formatarAbsoluto(job.criadoEm) },
    { rotulo: 'agendado para', valor: formatarAbsoluto(job.agendadoPara) },
    {
      rotulo: 'iniciado',
      valor: job.iniciadoEm === null ? 'nunca' : formatarAbsoluto(job.iniciadoEm),
    },
    {
      rotulo: 'terminado',
      valor: job.terminadoEm === null ? 'nunca' : formatarAbsoluto(job.terminadoEm),
    },
    { rotulo: 'duração', valor: duracao === null ? '—' : formatarDuracao(duracao) },
    // A chave é o que colapsa dois envios da mesma coisa num job só. Aparece
    // porque é a primeira coisa a conferir quando alguém pergunta por que uma
    // planilha "não importou de novo".
    { rotulo: 'chave de idempotência', valor: job.chaveIdempotencia },
  ];
}
