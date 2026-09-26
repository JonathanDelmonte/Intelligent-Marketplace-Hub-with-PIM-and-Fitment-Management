/**
 * Criar conta (ADR 0011 e 0015). Com código de cadastro configurado, toda conta nova o
 * pede: sem permissões, toda conta vê os mesmos dados. Sem código, qualquer um cria conta
 * — é a fase de teste.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { codigoExigido } from '@/dominio/acesso/codigo';
import { FormularioDeCadastro } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';

export const metadata: Metadata = { title: 'Criar conta' };

export default function PaginaDeCadastro() {
  const pedeCodigo = codigoExigido(lerAmbiente().CADASTRO_CODIGO);
  return (
    <TelaDeAcesso
      subtitulo={
        pedeCodigo
          ? 'Seu nome, e-mail e uma senha. O código de cadastro é o que protege este sistema de quem não foi convidado.'
          : 'Seu nome, e-mail e uma senha.'
      }
      titulo="Criar conta"
    >
      <FormularioDeCadastro pedeCodigo={pedeCodigo} />
    </TelaDeAcesso>
  );
}
