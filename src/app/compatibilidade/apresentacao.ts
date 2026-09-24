/**
 * Tradução da compatibilidade para português de quem vende.
 *
 * Tudo aqui é função pura, e existe separado da tela pelo motivo de sempre: texto
 * que decide o que a pessoa entende merece teste, e componente React não é o lugar
 * de testar redação.
 *
 * ## A regra de vocabulário desta tela
 *
 * Nada de "pontos-base", "bp", "resolução", "job" ou "inferência" na tela. A
 * pessoa que usa isto vende peça de reposição; o que ela precisa saber é **em que
 * aparelhos a peça serve, o quanto isso está provado, e o que falta conferir**.
 * Os termos internos ficam no código, onde são úteis.
 */
import {
  ehInferida,
  ETIQUETA_DA_EVIDENCIA,
  FORCA_DA_EVIDENCIA,
  type Evidencia,
  type TipoDeEvidencia,
} from '@/dominio/compatibilidade/evidencia';
import { descreverRetencao, type MotivoDeRetencao } from '@/dominio/compatibilidade/ficha';
import { contagem } from '@/lib/texto';
import { LIMIAR_PUBLICACAO_BP, TOTAL_BP, type Decisao } from '@/dominio/compatibilidade/resolucao';

/** Confiança em porcentagem inteira, que é como a pessoa lê. */
export function emPorcento(bp: number): string {
  return `${String(Math.round((bp * 100) / TOTAL_BP))}%`;
}

export const ROTULOS_DE_CONFIANCA = ['confirmado', 'suficiente', 'indício', 'fraco'] as const;
export type RotuloDeConfianca = (typeof ROTULOS_DE_CONFIANCA)[number];

/** Palavra para a faixa de confiança. O número aparece ao lado, não sozinho. */
export function rotuloDaConfianca(bp: number): RotuloDeConfianca {
  if (bp >= 9_000) return 'confirmado';
  if (bp >= LIMIAR_PUBLICACAO_BP) return 'suficiente';
  if (bp >= 4_000) return 'indício';
  return 'fraco';
}

/**
 * Resume as evidências agrupando por tipo, com a contagem.
 *
 * "3 anúncios de concorrentes" diz mais que três linhas iguais, e é o formato em
 * que a pessoa consegue julgar se acredita. Evidência que não conta — anúncio
 * próprio, com força zero — aparece marcada, porque ela é justamente o que a
 * pessoa pode transformar em confirmação com um clique.
 */
export function resumoDasEvidencias(evidencias: readonly Evidencia[]): readonly string[] {
  const contagem = new Map<TipoDeEvidencia, { total: number; negativas: number }>();
  for (const e of evidencias) {
    const atual = contagem.get(e.tipo) ?? { total: 0, negativas: 0 };
    atual.total += 1;
    if (e.negativa) atual.negativas += 1;
    contagem.set(e.tipo, atual);
  }

  const partes: string[] = [];
  // Ordena pela força do **tipo**, não da evidência: a ordem da lista é sobre qual
  // classe de fonte pesa mais, e a força própria de uma inferência varia por linha.
  for (const [tipo, { total, negativas }] of [...contagem].sort(
    ([a], [b]) => FORCA_DA_EVIDENCIA[b] - FORCA_DA_EVIDENCIA[a],
  )) {
    const etiqueta = ETIQUETA_DA_EVIDENCIA[tipo];
    const base = total === 1 ? etiqueta : `${String(total)} × ${etiqueta}`;
    partes.push(negativas === 0 ? base : `${base} (diz que não serve)`);
  }
  return partes;
}

export interface OndeFoiDito {
  readonly fonte: string;
  readonly trecho: string;
  readonly url: string | null;
}

/**
 * Onde cada fonte disse o que disse: o trecho, e o link quando há. É o que a pessoa lê
 * para decidir na fila — "manual do fabricante (1)" não diz se o manual fala mesmo desta
 * peça. Só fonte do mundo; a inferência já se explica na frase da situação.
 */
export function ondeFoiDito(evidencias: readonly Evidencia[], limite = 3): readonly OndeFoiDito[] {
  return evidencias
    .filter((e) => !ehInferida(e.tipo) && e.tipo !== 'humano' && e.trecho !== null)
    .sort((a, b) => FORCA_DA_EVIDENCIA[b.tipo] - FORCA_DA_EVIDENCIA[a.tipo])
    .slice(0, limite)
    .map((e) => ({ fonte: ETIQUETA_DA_EVIDENCIA[e.tipo], trecho: e.trecho ?? '', url: e.url }));
}

/** A decisão em palavras, sem o vocabulário do banco. */
export function rotuloDaDecisao(decisao: Decisao): string {
  switch (decisao) {
    case 'serve':
      return 'serve';
    case 'nao_serve':
      return 'não serve';
    case 'indefinido':
      return 'ninguém confirmou';
  }
}

export interface LinhaParaTela {
  readonly decisao: Decisao;
  readonly confiancaBp: number;
  readonly conflito: string | null;
  readonly evidencias: readonly Evidencia[];
}

/**
 * Uma frase dizendo o que está acontecendo com a linha e o que falta.
 *
 * A ordem das perguntas é a que a pessoa faz: primeiro "isso vai para o anúncio?",
 * depois "por que não?". Conflito vem antes de qualquer coisa porque é o único caso
 * em que o sistema está avisando que **pode estar errado**.
 */
export function explicarSituacao(linha: LinhaParaTela): string {
  if (linha.conflito !== null) {
    return `As fontes discordam: ${linha.conflito}. Nada vai para o anúncio enquanto ninguém decidir.`;
  }
  if (linha.decisao === 'nao_serve') {
    return 'A evidência diz que não serve. Fica registrado para não sugerir por engano.';
  }
  if (linha.decisao === 'indefinido') {
    return 'Há evidência registrada, mas nenhuma que decida sozinha. Um clique seu resolve.';
  }
  if (linha.confiancaBp >= LIMIAR_PUBLICACAO_BP) {
    return 'Pronto para entrar na ficha do anúncio.';
  }
  const soInferida =
    linha.evidencias.length > 0 && linha.evidencias.every((e) => ehInferida(e.tipo));
  if (!soInferida) {
    return `Falta evidência: ${emPorcento(linha.confiancaBp)} de ${emPorcento(LIMIAR_PUBLICACAO_BP)} necessários.`;
  }
  // Irmão e linha vizinha são coisas diferentes, e a primeira versão chamava as
  // duas de "modelo irmão" — dirigindo a tela, o PA31G apareceu como "deduzido de
  // um modelo irmão" sendo outra linha de aparelho. É a distinção que os dois
  // fatores de confiança existem para fazer; apagá-la no texto apaga o motivo de a
  // confiança ser diferente.
  const temIrmao = linha.evidencias.some((e) => e.tipo === 'inferencia_familia');
  return temIrmao
    ? 'Deduzido de um modelo irmão — o mesmo aparelho em outra variação. É hipótese boa, e hipótese não publica: confirme ou descarte.'
    : 'Deduzido da linha vizinha de um modelo confirmado. Aparelho diferente, então é pista de onde olhar, não prova.';
}

/** Texto da retenção, para a lista do que não foi publicado. */
export function explicarRetencao(motivo: MotivoDeRetencao): string {
  return descreverRetencao(motivo);
}

export const CODIGOS_DE_AVISO = [
  'confirmado',
  'descartado',
  'aparelho_criado',
  'aparelho_repetido',
  'aparelho_incompleto',
  'coletado',
  'sem_coleta',
  'sem_anuncio',
  'linha_sumiu',
  'produto_de_outro_perfil',
  'fonte_lida',
  'fonte_para_conferir',
  'fonte_sem_codigo_do_produto',
  'fonte_longe_do_produto',
  'fonte_ambigua',
  'fonte_sem_aparelho',
  'fonte_vazia',
  'fonte_grande',
  'fonte_recusada',
  'fonte_sem_rede',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/**
 * Aviso depois de uma ação, sempre dizendo o que aconteceu de concreto.
 *
 * "Pronto" não é aviso: a pessoa precisa saber se a linha entrou na ficha, se
 * apenas ficou registrada, ou se nada mudou.
 */
export function descreverAviso(
  codigo: string | undefined,
  quantidade?: number,
  /** Segundo número, quando o aviso tem dois: os aparelhos com força, na leitura de fonte. */
  outra?: number,
): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'confirmado':
      return {
        tom: 'ok',
        titulo: 'Confirmado',
        corpo: 'Entra na ficha do anúncio, e nenhuma varredura automática desfaz isso.',
      };
    case 'descartado':
      return {
        tom: 'ok',
        titulo: 'Marcado como "não serve"',
        corpo: 'Fica registrado, para o sistema não sugerir esse modelo de novo.',
      };
    case 'aparelho_criado':
      return {
        tom: 'ok',
        titulo: 'Aparelho cadastrado',
        corpo:
          'Agora os anúncios já capturados que citarem esse modelo viram evidência sozinhos. Use “Procurar nos anúncios”.',
      };
    case 'aparelho_repetido':
      return {
        tom: 'atencao',
        titulo: 'Esse aparelho já estava cadastrado',
        corpo: 'Nada foi duplicado. Se o modelo estiver escrito diferente, corrija e cadastre.',
      };
    case 'aparelho_incompleto':
      return {
        tom: 'atencao',
        titulo: 'Faltou preencher',
        corpo: 'Tipo, marca e modelo são obrigatórios — sem os três não há como casar nada.',
      };
    case 'coletado':
      return {
        tom: 'ok',
        titulo: `Procura concluída${quantidade === undefined ? '' : `: ${contagem(quantidade, 'afirmação nova', 'afirmações novas')}`}`,
        corpo: 'O que dá para provar já está na ficha; o resto ficou esperando sua conferência.',
      };
    case 'sem_coleta':
      // Dois estados diferentes cabiam nesta mensagem, e a primeira versão juntava
      // os dois: dirigindo a tela, procurar duas vezes seguidas dizia "nenhum
      // anúncio cita um modelo cadastrado" com três anúncios citando e a ficha
      // cheia. Mensagem que manda conferir o que está certo custa mais que silêncio.
      return {
        tom: 'atencao',
        titulo: 'Nada mudou',
        corpo:
          'Os anúncios foram lidos e não havia afirmação nova — o que existia já estava na base.',
      };
    case 'sem_anuncio':
      return {
        tom: 'atencao',
        titulo: 'Nenhum anúncio para ler',
        corpo:
          'Nenhum produto seu tem anúncio capturado ainda. Importe uma planilha ou cole um link primeiro.',
      };
    case 'linha_sumiu':
      return {
        tom: 'atencao',
        titulo: 'Essa linha não existe mais',
        corpo: 'Alguém pode ter decidido antes. A lista abaixo já está atualizada.',
      };
    case 'produto_de_outro_perfil':
      return {
        tom: 'erro',
        titulo: 'Esse produto não é deste perfil',
        corpo:
          'A ficha abaixo é de outro produto — o de abertura. Escolha na lista antes de responder a um comprador: ficha errada com cara de ficha certa é o erro que esta tela existe para não deixar acontecer.',
      };
    case 'fonte_lida':
      return {
        tom: 'ok',
        titulo: `A fonte confirmou ${contagem(quantidade ?? 0, 'aparelho', 'aparelhos')}`,
        corpo:
          'Cada um entrou com a força da fonte: manual e página oficial vão direto para a ficha; catálogo e fórum somam com outras fontes até chegar ao corte.',
      };
    case 'fonte_para_conferir': {
      const comForca =
        outra === undefined || outra === 0
          ? ''
          : ` Mais ${contagem(outra, 'aparelho entrou', 'aparelhos entraram')} com a força da fonte.`;
      return {
        tom: 'atencao',
        titulo: `${contagem(quantidade ?? 0, 'aparelho espera', 'aparelhos esperam')} sua conferência`,
        corpo: `A fonte cita o aparelho, mas não cita o código deste produto — pode estar falando de outra peça. Está na fila, com o trecho, para você decidir.${comForca}`,
      };
    }
    case 'fonte_sem_codigo_do_produto':
      return {
        tom: 'atencao',
        titulo: 'O produto não tem código próprio no título',
        corpo:
          'Sem o código da peça, a fonte não tem como dizer que fala dela: o catálogo e o fórum citam muitas peças. Ponha o código no título do produto, na tela de produtos, e leia de novo.',
      };
    case 'fonte_longe_do_produto':
      return {
        tom: 'atencao',
        titulo: `${contagem(quantidade ?? 0, 'aparelho citado', 'aparelhos citados')} em trecho de outra peça`,
        corpo:
          'A fonte cita aparelhos cadastrados, mas na parte que fala de outro código de peça. Nada foi registrado para este produto.',
      };
    case 'fonte_ambigua':
      return {
        tom: 'atencao',
        titulo: `${contagem(quantidade ?? 0, 'código', 'códigos')} de mais de uma marca`,
        corpo:
          'A fonte cita um modelo que existe em duas marcas cadastradas, e não diz qual. Nada foi escolhido no escuro: cole um trecho que tenha a marca.',
      };
    case 'fonte_sem_aparelho':
      return {
        tom: 'atencao',
        titulo: 'Nenhum aparelho cadastrado aparece na fonte',
        corpo:
          'Ela foi lida inteira. Se os modelos dela não estão na lista de aparelhos abaixo, cadastre-os e leia de novo.',
      };
    case 'fonte_vazia':
      return {
        tom: 'atencao',
        titulo: 'Faltou a fonte',
        corpo: 'Envie o PDF, cole o link ou cole o texto — um dos três.',
      };
    case 'fonte_grande':
      return {
        tom: 'atencao',
        titulo: 'Arquivo grande demais',
        corpo:
          'O limite por envio é o mesmo da importação. Mande o link do PDF, ou só as páginas que falam da peça.',
      };
    case 'fonte_recusada':
      return {
        tom: 'atencao',
        titulo: 'Não deu para ler a fonte',
        corpo:
          'O site só abre no navegador, a página não existe, ou o PDF é imagem escaneada, sem texto. Baixe o PDF e envie, ou copie o texto e cole.',
      };
    case 'fonte_sem_rede':
      return {
        tom: 'atencao',
        titulo: 'O link não abriu agora',
        corpo:
          'A rede ou o site estão fora. Nada foi registrado: tente de novo mais tarde, ou envie o arquivo.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu para gravar',
        corpo: 'Nada foi alterado. Tente de novo; se repetir, o log do servidor tem o motivo.',
      };
  }
}

/** Diagnóstico do estado da base, para a tela não ficar muda quando está vazia. */
export function estadoDaBase(numeros: {
  readonly aparelhos: number;
  readonly publicaveis: number;
  readonly emRevisao: number;
  readonly skus: number;
}): Aviso | null {
  if (numeros.skus === 0) {
    return {
      tom: 'atencao',
      titulo: 'Nenhum produto seu no catálogo ainda',
      corpo:
        'A compatibilidade é sempre de um produto seu para um aparelho. Comece juntando ocorrências em um produto na tela de produtos repetidos.',
    };
  }
  if (numeros.aparelhos === 0) {
    return {
      tom: 'atencao',
      titulo: 'Nenhum aparelho cadastrado',
      corpo:
        'Cadastre o primeiro aparelho abaixo — marca e modelo, como está na etiqueta. Sem isso não há o que casar com os títulos dos anúncios.',
    };
  }
  if (numeros.publicaveis === 0 && numeros.emRevisao === 0) {
    return {
      tom: 'atencao',
      titulo: 'Aparelhos cadastrados, nenhuma afirmação ainda',
      corpo: 'Use “Procurar nos anúncios” para varrer o que já foi capturado.',
    };
  }
  return null;
}

/**
 * Nome do arquivo da ficha, a partir do título do produto.
 *
 * Título de produto tem acento, barra e parêntese, e nome de arquivo com isso
 * atravessa mal cabeçalho HTTP e pior ainda pen drive — então sai `ficha-refil-pa21g.csv`.
 * Título que não sobra nada depois da limpeza cai em `ficha.csv`, que é melhor que
 * `ficha-.csv`.
 */
export function nomeDoArquivoDaFicha(titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

  return base === '' ? 'ficha.csv' : `ficha-${base}.csv`;
}
