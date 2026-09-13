import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { montarMarca } from '@/config/marca';
import { PORTAS } from './navegacao';
import estilo from './pagina.module.css';

/**
 * Página inicial: as portas do sistema, com nome de quem vende.
 *
 * Existia só para o shell do App Router ser verificável desde a fase 0. Virou índice
 * quando as telas passaram de uma, e por um motivo dito em voz alta pelo dono do
 * repositório: as telas existiam e não havia como chegar nelas sem digitar a URL —
 * e os nomes internos ("jobs", "identidade") não dizem nada para quem vende peça.
 *
 * Então cada porta tem o nome do trabalho que ela faz, e uma linha explicando. A
 * reforma de verdade da navegação vem depois, com as telas todas prontas; isto é o
 * mínimo para o sistema ser navegável.
 *
 * Não tem gate de conexão, e nenhuma tela do sistema pode ter — ADR 0002, regra 1.
 */

export default function Pagina() {
  const marca = montarMarca(lerAmbiente());

  return (
    <main className={estilo.pagina}>
      <h1 className={estilo.titulo}>{marca.nomeSistema}</h1>
      <p className={estilo.subtitulo}>Hub de operação e inteligência para venda em marketplaces.</p>

      <ul className={estilo.portas}>
        {PORTAS.filter((porta) => porta.descricao !== null).map((porta) => (
          <li key={porta.href}>
            <Link className={estilo.porta} href={porta.href}>
              <span className={estilo.portaTitulo}>{porta.rotulo}</span>
              <span className={estilo.portaDescricao}>{porta.descricao}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
