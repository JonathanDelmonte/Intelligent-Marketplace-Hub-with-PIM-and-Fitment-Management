/**
 * A barra do topo.
 *
 * É o único componente de cliente da casca, e por um motivo só: saber **qual tela
 * está aberta** para marcá-la. Isso depende do caminho da URL, que no App Router só
 * existe no cliente (`usePathname`) — um layout de servidor não o recebe.
 *
 * O custo é um pedaço pequeno de JavaScript em toda página, e a alternativa era pior:
 * passar o caminho de cada `page.tsx` para o layout obrigaria dez telas a lembrar de
 * fazer isso, e a tela que esquecesse ficaria sem marca nenhuma, silenciosamente.
 *
 * Nome do sistema vem por propriedade, do servidor: marca é configuração, e este
 * arquivo não pode ler `.env` (ADR 0003).
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { portaAtual, portasPorGrupo } from './navegacao';
import estilo from './casca.module.css';

export function Barra({ nomeSistema }: { readonly nomeSistema: string }) {
  const caminho = usePathname();
  const atual = portaAtual(caminho);

  return (
    <header className={estilo.barra}>
      <div className={estilo.barraInterna}>
        {/*
          O nome do sistema é o link para o início. A porta "Início" existe na lista e
          não aparece aqui de propósito: dois caminhos para a mesma tela, um ao lado do
          outro, gastam espaço de barra e não ensinam nada.
        */}
        <Link aria-current={caminho === '/' ? 'page' : undefined} className={estilo.marca} href="/">
          {nomeSistema}
        </Link>

        <nav aria-label="Telas do sistema" className={estilo.navegacao}>
          {portasPorGrupo().map((grupo) => (
            <ul aria-label={grupo.titulo} className={estilo.grupo} key={grupo.grupo}>
              {grupo.portas.map((porta) => {
                const ehAtual = porta.href === atual?.href;
                return (
                  <li key={porta.href}>
                    <Link
                      aria-current={ehAtual ? 'page' : undefined}
                      className={ehAtual ? `${estilo.porta} ${estilo.portaAtual}` : estilo.porta}
                      href={porta.href}
                    >
                      {porta.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>
      </div>
    </header>
  );
}
