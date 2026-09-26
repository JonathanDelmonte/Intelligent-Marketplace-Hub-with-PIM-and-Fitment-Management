/**
 * O que a tela da cópia dos dados mostra, em funções puras.
 */
import { z } from 'zod';
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';
import type { ResumoDaCopia } from '@/infra/banco/formato-da-copia';

/**
 * O nome do arquivo: diz o que é e quando foi feito, na hora de quem usa, e as cópias
 * de dias diferentes ficam em ordem na pasta. Sem nome de sistema, que é configuração
 * (ADR 0003) — e o conteúdo já diz de qual sistema veio.
 */
export function nomeDoArquivoDaCopia(agora: Date, fuso: string = FUSO_PADRAO): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '00';
  return `copia-dos-dados-${parte('year')}-${parte('month')}-${parte('day')}-${parte('hour')}${parte('minute')}.sql.gz`;
}

/** Tamanho legível, em potências de mil, com vírgula: "840 KB", "12,3 MB". */
export function formatarTamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 bytes';
  if (bytes < 1000) return `${String(Math.round(bytes))} bytes`;
  const unidades = ['KB', 'MB', 'GB'] as const;
  let valor = bytes / 1000;
  let unidade = 0;
  while (valor >= 1000 && unidade < unidades.length - 1) {
    valor /= 1000;
    unidade += 1;
  }
  const casas = valor < 10 ? 1 : 0;
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: casas })} ${unidades[unidade] ?? 'GB'}`;
}

const IDIOMA = 'pt-BR';

/** "26/09/2026 às 12:30", na hora de quem usa; `null` quando a data não se lê. */
function dataEHora(iso: string, fuso: string): string | null {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const partes = new Intl.DateTimeFormat(IDIOMA, {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(quando);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('day')}/${parte('month')}/${parte('year')} às ${parte('hour')}:${parte('minute')}`;
}

/** A versão como o rodapé a mostra: os 7 primeiros caracteres do commit. */
function versaoCurta(versao: string | null): string | null {
  if (versao === null || versao === 'desconhecida') return null;
  return /^[0-9a-f]{40}$/.test(versao) ? versao.slice(0, 7) : versao;
}

function linhas(n: number): string {
  return `${n.toLocaleString(IDIOMA)} ${n === 1 ? 'linha' : 'linhas'}`;
}

/**
 * O que o arquivo escolhido tem, conferido no navegador antes de enviar: é assim que
 * quem restaura sabe que escolheu a cópia certa.
 */
export function descreverCopia(resumo: ResumoDaCopia, fuso: string = FUSO_PADRAO): string {
  const quando = resumo.geradaEm === null ? null : dataEHora(resumo.geradaEm, fuso);
  const versao = versaoCurta(resumo.versao);
  return [
    quando === null ? 'Cópia sem data' : `Cópia de ${quando}`,
    ...(versao === null ? [] : [`versão ${versao}`]),
    `${String(resumo.tabelas)} ${resumo.tabelas === 1 ? 'tabela' : 'tabelas'}, ${linhas(resumo.linhas)}`,
  ].join(' · ');
}

/** O que o servidor responde à restauração. É a fronteira entre a tela e a rota. */
export const esquemaDaRespostaDaRestauracao = z.discriminatedUnion('situacao', [
  z.object({
    situacao: z.literal('restaurada'),
    geradaEm: z.string().nullable(),
    versao: z.string().nullable(),
    tabelas: z.number().int().nonnegative(),
    linhas: z.number().int().nonnegative(),
    perfil: z.enum(['existia', 'renomeado', 'ausente', 'nao_conferido']),
  }),
  z.object({ situacao: z.literal('recusada'), motivo: z.string() }),
]);
export type RespostaDaRestauracao = z.infer<typeof esquemaDaRespostaDaRestauracao>;

export interface AvisoDaRestauracao {
  readonly tipo: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

function comMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * A resposta da restauração em texto para quem restaurou. Resposta que não é a esperada
 * — servidor fora, página de erro no lugar do JSON — vira "não voltou", sem prometer
 * que nada mudou: não há como saber.
 */
export function avisoDaRestauracao(
  resposta: unknown,
  fuso: string = FUSO_PADRAO,
): AvisoDaRestauracao {
  const lida = esquemaDaRespostaDaRestauracao.safeParse(resposta);
  if (!lida.success) {
    return {
      tipo: 'erro',
      titulo: 'A restauração não respondeu',
      corpo:
        'O servidor não disse como terminou. Confira os dados nas outras telas antes de tentar de novo.',
    };
  }
  const dado = lida.data;
  if (dado.situacao === 'recusada') {
    const motivo = comMaiuscula(dado.motivo.replace(/\.?$/, '.'));
    return {
      tipo: 'erro',
      titulo: 'A cópia não voltou',
      corpo: motivo.includes('Nada foi mudado') ? motivo : `${motivo} Nada foi mudado.`,
    };
  }

  const quando = dado.geradaEm === null ? null : dataEHora(dado.geradaEm, fuso);
  const base =
    `Os dados agora são os da cópia${quando === null ? '' : ` de ${quando}`}: ` +
    `${String(dado.tabelas)} ${dado.tabelas === 1 ? 'tabela' : 'tabelas'}, ${linhas(dado.linhas)}. ` +
    'As contas de acesso continuam as mesmas.';
  switch (dado.perfil) {
    case 'existia':
      return { tipo: 'ok', titulo: 'A cópia voltou', corpo: base };
    case 'renomeado':
      return {
        tipo: 'ok',
        titulo: 'A cópia voltou',
        corpo: `${base} A loja tinha outro nome de perfil na cópia, e passou a usar o deste sistema.`,
      };
    case 'ausente':
      return {
        tipo: 'atencao',
        titulo: 'A cópia voltou, sem o perfil da loja deste sistema',
        corpo: `${base} A cópia não tem perfil de loja com o nome que este sistema procura, e as telas da loja podem dar erro. Reiniciar o sistema cria um perfil novo e vazio; os dados da cópia continuam no perfil dela.`,
      };
    case 'nao_conferido':
      return {
        tipo: 'atencao',
        titulo: 'A cópia voltou',
        corpo: `${base} Não deu para conferir o perfil da loja depois: se alguma tela der erro, reinicie o sistema.`,
      };
  }
}
