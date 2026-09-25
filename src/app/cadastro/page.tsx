/**
 * Criar conta (ADR 0011). Pede o código de cadastro: sem permissões, toda conta vê os
 * mesmos dados, e o cadastro num endereço público não pode ser aberto a quem achar a tela.
 */
import type { Metadata } from 'next';
import { FormularioDeCadastro } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';

export const metadata: Metadata = { title: 'Criar conta' };

export default function PaginaDeCadastro() {
  return (
    <TelaDeAcesso
      subtitulo="Seu nome, e-mail e uma senha. O código de cadastro é o que protege este sistema de quem não foi convidado."
      titulo="Criar conta"
    >
      <FormularioDeCadastro />
    </TelaDeAcesso>
  );
}
