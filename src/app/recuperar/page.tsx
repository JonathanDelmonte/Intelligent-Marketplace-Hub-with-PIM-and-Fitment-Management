/**
 * Trocar a senha esquecida (ADR 0011 e 0015). Com código de cadastro configurado, ele é a
 * prova; sem código, a troca não pede prova, como o cadastro. Troca e encerra as outras
 * sessões da conta: quem troca a senha por desconfiança quer o outro aparelho fora.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { codigoExigido } from '@/dominio/acesso/codigo';
import { FormularioDeRecuperar } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';

export const metadata: Metadata = { title: 'Esqueci a senha' };

export default function PaginaDeRecuperar() {
  const pedeCodigo = codigoExigido(lerAmbiente().CADASTRO_CODIGO);
  return (
    <TelaDeAcesso
      subtitulo={
        pedeCodigo
          ? 'Informe o e-mail da conta, a senha nova e o código de cadastro. As outras sessões da conta são encerradas.'
          : 'Informe o e-mail da conta e a senha nova. As outras sessões da conta são encerradas.'
      }
      titulo="Trocar a senha"
    >
      <FormularioDeRecuperar pedeCodigo={pedeCodigo} />
    </TelaDeAcesso>
  );
}
