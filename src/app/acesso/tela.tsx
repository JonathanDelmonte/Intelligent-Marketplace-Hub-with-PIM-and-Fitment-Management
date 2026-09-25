/**
 * A moldura das telas de acesso: o nome do sistema, o título e o formulário, no meio
 * da tela e sem a barra lateral.
 *
 * O `data-tela-de-acesso` é o que tira a barra: a casca vê o atributo (`:has`) e passa
 * a ter uma coluna só, e a barra não aparece nos caminhos públicos. Ninguém sem conta
 * precisa ver as portas do sistema.
 */
import type { ReactNode } from 'react';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';
import estilo from './acesso.module.css';

export function TelaDeAcesso({
  titulo,
  subtitulo,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly children: ReactNode;
}) {
  const marca = montarMarca(lerAmbiente());
  return (
    <main className={estilo.tela} data-tela-de-acesso="">
      <div className={estilo.cartao}>
        <p className={estilo.sistema}>{marca.nomeSistema}</p>
        <h1 className={estilo.titulo}>{titulo}</h1>
        <p className={estilo.subtitulo}>{subtitulo}</p>
        {children}
      </div>
    </main>
  );
}
