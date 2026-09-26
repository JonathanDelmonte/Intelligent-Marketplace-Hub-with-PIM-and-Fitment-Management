/**
 * O que a tela da cópia dos dados mostra, em funções puras.
 */
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

/** Onde a cópia se baixa. A página e a rota leem daqui. */
export const CAMINHO_DO_DOWNLOAD = '/copia/baixar';

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
