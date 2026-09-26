/**
 * A restauração que chega pela tela (ADR 0017): o arquivo enviado, lido enquanto chega,
 * vira a cópia restaurada — e o perfil da loja desta instalação, conferido.
 *
 * Separada da rota para poder ser testada contra o banco de teste: a rota confere a conta
 * e lê o ambiente, e isto só recebe o banco, o arquivo e o nome do perfil.
 */
import { ajustarPerfilDaInstalacao } from '@/dominio/perfil';
import type { Banco } from '@/infra/banco/cliente';
import { restaurarCopia } from '@/infra/banco/copia';
import { CopiaInvalida, linhasDoArquivo } from '@/infra/banco/formato-da-copia';
import type { RespostaDaRestauracao } from './apresentacao';

export async function restaurarDoNavegador(
  db: Banco,
  arquivo: ReadableStream<Uint8Array<ArrayBuffer>>,
  perfilDaInstalacao: string,
): Promise<RespostaDaRestauracao> {
  let resumo;
  try {
    resumo = await restaurarCopia(db, linhasDoArquivo(arquivo));
  } catch (erro) {
    if (erro instanceof CopiaInvalida) return { situacao: 'recusada', motivo: erro.message };
    throw erro;
  }

  // A cópia já voltou. Se o ajuste do perfil falhar, isso não a desfaz — e a resposta diz.
  const perfil = await ajustarPerfilDaInstalacao(db, perfilDaInstalacao).catch(
    () => 'nao_conferido' as const,
  );
  return { situacao: 'restaurada', ...resumo, perfil };
}
