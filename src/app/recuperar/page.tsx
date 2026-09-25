/**
 * Trocar a senha esquecida (ADR 0011), com o código de cadastro como prova. Troca e
 * encerra as outras sessões da conta: quem troca a senha por desconfiança quer o outro
 * aparelho fora.
 */
import type { Metadata } from 'next';
import { FormularioDeRecuperar } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';

export const metadata: Metadata = { title: 'Esqueci a senha' };

export default function PaginaDeRecuperar() {
  return (
    <TelaDeAcesso
      subtitulo="Informe o e-mail da conta, a senha nova e o código de cadastro. As outras sessões da conta são encerradas."
      titulo="Trocar a senha"
    >
      <FormularioDeRecuperar />
    </TelaDeAcesso>
  );
}
