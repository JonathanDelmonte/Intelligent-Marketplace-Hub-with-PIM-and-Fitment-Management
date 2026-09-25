/**
 * Entrar (ADR 0011). Uma das quatro rotas que abrem sem conta.
 *
 * A volta vem da URL (`?volta=/catalogo`), posta pelo proxy quando alguém sem sessão
 * pediu uma tela; é lida por `lerDestino`, que só aceita caminho deste sistema.
 */
import type { Metadata } from 'next';
import { lerDestino } from '../acesso/caminhos';
import { FormularioDeEntrar } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';

export const metadata: Metadata = { title: 'Entrar' };

export default async function PaginaDeEntrar({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const busca = await searchParams;
  const bruto = busca['volta'];
  const volta = lerDestino(Array.isArray(bruto) ? bruto[0] : bruto);
  return (
    <TelaDeAcesso subtitulo="Entre com o e-mail e a senha da sua conta." titulo="Entrar">
      <FormularioDeEntrar volta={volta} />
    </TelaDeAcesso>
  );
}
