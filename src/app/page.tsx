import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';
import { portasPorGrupo } from './navegacao';
import estilo from './pagina.module.css';

/**
 * Página inicial: as portas do sistema, agrupadas pelo momento de trabalho.
 *
 * Existia só para o shell do App Router ser verificável desde a fase 0. Virou índice
 * quando as telas passaram de uma, e por um motivo dito em voz alta pelo dono do
 * repositório: as telas existiam e não havia como chegar nelas sem digitar a URL.
 *
 * Os nomes internos ("jobs", "identidade") saíram na passada de vocabulário, e o
 * agrupamento é o resto do mesmo problema: nove cartões iguais, em ordem de
 * construção, obrigam a ler todos para achar o do dia. Agora a ordem é a do trabalho
 * — o que se faz hoje, o que alimenta o catálogo, o que protege de prejuízo.
 *
 * Não tem gate de conexão, e nenhuma tela do sistema pode ter — ADR 0002, regra 1.
 */

export default function Pagina() {
  const marca = montarMarca(lerAmbiente());

  return (
    <main className={estilo.pagina}>
      <h1 className={estilo.titulo}>{marca.nomeSistema}</h1>
      <p className={estilo.subtitulo}>Hub de operação e inteligência para venda em marketplaces.</p>

      {portasPorGrupo().map((grupo) => (
        <section
          aria-labelledby={`grupo-${grupo.grupo}`}
          className={estilo.grupo}
          key={grupo.grupo}
        >
          <h2 className={estilo.grupoTitulo} id={`grupo-${grupo.grupo}`}>
            {grupo.titulo}
          </h2>
          <ul className={estilo.portas}>
            {grupo.portas.map((porta) => (
              <li key={porta.href}>
                <Link className={estilo.porta} href={porta.href}>
                  <span className={estilo.portaTitulo}>{porta.rotulo}</span>
                  <span className={estilo.portaDescricao}>{porta.descricao}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
