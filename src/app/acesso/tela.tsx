/**
 * A moldura das telas de acesso: um cartão no meio da tela, sem a barra lateral, com o
 * nome do sistema e o que ele faz num painel escuro à esquerda, e o formulário à direita.
 *
 * O `data-tela-de-acesso` é o que tira a barra: a casca vê o atributo (`:has`) e passa
 * a ter uma coluna só, e a barra não aparece nos caminhos públicos. Ninguém sem conta
 * precisa ver as portas do sistema.
 */
import type { ReactNode } from 'react';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';
import { SinalCaixa, SinalCerto, SinalPercentual } from '../ui/sinais';
import estilo from './acesso.module.css';

/** A letra do quadrado do sistema, a mesma da barra lateral. */
function sigla(nomeSistema: string): string {
  return (nomeSistema.trim()[0] ?? '?').toLocaleUpperCase('pt-BR');
}

/**
 * O que o sistema faz, em três linhas, no painel escuro. É a primeira tela que alguém vê,
 * e um formulário sozinho não diz onde a pessoa está entrando.
 */
const O_QUE_FAZ = [
  { icone: <SinalCaixa />, texto: 'O que postar hoje, em ordem de prazo.' },
  { icone: <SinalPercentual />, texto: 'Quanto cobrar em cada loja para ganhar a sua margem.' },
  { icone: <SinalCerto />, texto: 'Em que aparelhos a peça serve, com a fonte de cada um.' },
] as const;

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
        <aside aria-label={marca.nomeSistema} className={estilo.painel}>
          <p className={estilo.sistema}>
            <span aria-hidden="true" className={estilo.sigla}>
              {sigla(marca.nomeSistema)}
            </span>
            {marca.nomeSistema}
          </p>
          <p className={estilo.chamada}>As suas lojas, os seus preços e o seu dia, num lugar só.</p>
          <ul className={estilo.pontos}>
            {O_QUE_FAZ.map((ponto) => (
              <li key={ponto.texto}>
                <span aria-hidden="true" className={estilo.pontoIcone}>
                  {ponto.icone}
                </span>
                {ponto.texto}
              </li>
            ))}
          </ul>
        </aside>
        <div className={estilo.formularioDaTela}>
          <h1 className={estilo.titulo}>{titulo}</h1>
          <p className={estilo.subtitulo}>{subtitulo}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
