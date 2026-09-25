/**
 * A versão no ar, dita no rodapé (ADR 0010).
 *
 * A publicação é automática, e a pergunta que sobra é "a mudança já chegou lá?". A
 * resposta fica no pé de toda tela: a hora do commit que está no ar e o começo do hash
 * dele, que é o que aparece no GitHub. No computador não há versão publicada, e o
 * rodapé não diz nada.
 */
import { FUSO_PADRAO } from '@/dominio/pedidos/fila-do-dia';

export function descreverVersao(
  versao: string | undefined,
  versaoEm: string | undefined,
  fuso: string = FUSO_PADRAO,
): string | null {
  if (versao === undefined || versao === '') return null;
  const curta = versao.slice(0, 7);

  const quando = versaoEm === undefined ? null : new Date(versaoEm);
  if (quando === null || Number.isNaN(quando.getTime())) return `versão ${curta}`;

  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(quando);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
  }).format(quando);
  return `atualizado em ${dia} às ${hora} (${curta})`;
}
