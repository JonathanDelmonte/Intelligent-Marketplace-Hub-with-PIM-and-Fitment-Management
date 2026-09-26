/**
 * Criar conta (ADR 0011 e 0014).
 *
 * Com código de cadastro configurado, toda conta nova o pede: sem permissões, toda conta
 * vê os mesmos dados. Sem código, a primeira conta entra sem pedir nada — é o dono
 * chegando ao sistema novo —, e o cadastro fecha em seguida.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { modoDoCadastro, type ModoDoCadastro } from '@/dominio/acesso/codigo';
import { RepositorioDeAcesso } from '@/dominio/acesso/repositorio';
import { banco } from '@/infra/banco/cliente';
import { CAMINHO_DE_ENTRAR } from '../acesso/constantes';
import { FormularioDeCadastro } from '../acesso/formularios';
import { TelaDeAcesso } from '../acesso/tela';
import estilo from '../acesso/acesso.module.css';

export const metadata: Metadata = { title: 'Criar conta' };

const SUBTITULO: Record<ModoDoCadastro, string> = {
  com_codigo:
    'Seu nome, e-mail e uma senha. O código de cadastro é o que protege este sistema de quem não foi convidado.',
  primeira_conta:
    'Seu nome, e-mail e uma senha. É a primeira conta deste sistema: depois dela, o cadastro fecha.',
  fechado:
    'A primeira conta já foi criada, e o cadastro fechou. Para abrir para mais gente, configure o código de cadastro (CADASTRO_CODIGO) no painel do Render ou no .env.',
};

/**
 * Sem banco, a tela mostra o formulário que o código configurado pede; a ação confere de
 * novo, com o banco, antes de criar qualquer conta.
 */
async function modoAtual(): Promise<ModoDoCadastro> {
  const configurado = lerAmbiente().CADASTRO_CODIGO;
  try {
    return modoDoCadastro(configurado, await new RepositorioDeAcesso(banco()).quantasContas());
  } catch {
    return modoDoCadastro(configurado, 0);
  }
}

export default async function PaginaDeCadastro() {
  const modo = await modoAtual();
  return (
    <TelaDeAcesso subtitulo={SUBTITULO[modo]} titulo="Criar conta">
      {modo === 'fechado' ? (
        <p className={estilo.alternativas}>
          <Link href={CAMINHO_DE_ENTRAR}>Entrar</Link>
        </p>
      ) : (
        <FormularioDeCadastro pedeCodigo={modo === 'com_codigo'} />
      )}
    </TelaDeAcesso>
  );
}
