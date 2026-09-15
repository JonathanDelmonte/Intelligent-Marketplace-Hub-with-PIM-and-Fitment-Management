/**
 * Tempo e idioma da interface, em um lugar.
 *
 * Nasceu dentro da tela de importação e saiu para cá quando a segunda tela precisou —
 * o monitor, que mostra "há 2 dias" ao lado de cada mudança de preço. Duas cópias de
 * formatação de tempo divergem do mesmo jeito que as trinta classes de estilo
 * divergiram: uma diz "ontem" e a outra "há 1 dia", e ninguém decidiu isso.
 */

/**
 * Idioma da interface.
 *
 * Ponto único: o vocabulário do negócio é português (CLAUDE.md, seção 4) e a
 * formatação de data e número segue o mesmo. Uma constante em vez de literal
 * espalhado porque o dia de ter outro idioma começa aqui.
 */
export const IDIOMA = 'pt-BR';

/**
 * Instante em tempo relativo.
 *
 * Numa lista o que se lê é "há 2 minutos", não "12/09/2026 09:14:46". O absoluto
 * continua disponível no `title` de cada célula, para quando a pergunta é comparar com
 * o horário de outra coisa.
 *
 * `numeric: 'auto'` de propósito: devolve "ontem" e "anteontem" em vez de "há 1 dia" e
 * "há 2 dias", que é como se fala. Vale saber que isso muda o texto, e por isso os dois
 * casos estão fixados em teste.
 */
export function formatarRelativo(quando: Date, agora: Date): string {
  const segundos = Math.round((quando.getTime() - agora.getTime()) / 1000);
  const absoluto = Math.abs(segundos);

  if (absoluto < 45) return 'agora';

  const formatador = new Intl.RelativeTimeFormat(IDIOMA, { numeric: 'auto' });
  if (absoluto < 3600) return formatador.format(Math.round(segundos / 60), 'minute');
  if (absoluto < 86_400) return formatador.format(Math.round(segundos / 3600), 'hour');
  return formatador.format(Math.round(segundos / 86_400), 'day');
}

export function formatarAbsoluto(quando: Date): string {
  return new Intl.DateTimeFormat(IDIOMA, { dateStyle: 'short', timeStyle: 'medium' }).format(
    quando,
  );
}
