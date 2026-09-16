/**
 * A lateral de navegação.
 *
 * Substituiu a barra do topo, e o motivo está no cabeçalho de `casca.module.css`: com
 * quinze portas, o título do grupo não cabia em cima, e sem título o agrupamento por
 * momento de trabalho dependia de um traço vertical que ninguém lê como agrupamento.
 *
 * É o único componente de cliente da casca, e por um motivo só: saber **qual tela está
 * aberta** para marcá-la. Isso depende do caminho da URL, que no App Router só existe
 * no cliente (`usePathname`) — um layout de servidor não o recebe.
 *
 * O custo é um pedaço pequeno de JavaScript em toda página, e a alternativa era pior:
 * passar o caminho de cada `page.tsx` para o layout obrigaria quinze telas a lembrar de
 * fazer isso, e a que esquecesse ficaria sem marca nenhuma, silenciosamente.
 *
 * Nome do sistema vem por propriedade, do servidor: marca é configuração, e este
 * arquivo não pode ler `.env` (ADR 0003).
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { portaAtual, portasPorGrupo } from './navegacao';
import estilo from './casca.module.css';

/**
 * A inicial do nome do sistema, para o quadrado da marca.
 *
 * Do nome em runtime, e não de um arquivo: instalação sem logo cadastrado é o caso
 * comum, e quadrado vazio é pior que inicial. `toLocaleUpperCase('pt-BR')` porque a
 * inicial pode ser acentuada, e o `toUpperCase` sem locale erra em turco — que é o tipo
 * de detalhe que não custa nada acertar aqui.
 */
function sigla(nomeSistema: string): string {
  return (nomeSistema.trim()[0] ?? '?').toLocaleUpperCase('pt-BR');
}

export function Lateral({ nomeSistema }: { readonly nomeSistema: string }) {
  const caminho = usePathname();
  const atual = portaAtual(caminho);

  return (
    <div className={estilo.colunaLateral}>
      <aside className={estilo.lateral}>
        {/*
        O nome do sistema é o link para o início. A porta "Início" existe na lista e não
        aparece na navegação de propósito: dois caminhos para a mesma tela, um ao lado do
        outro, gastam espaço e não ensinam nada.
      */}
        <Link aria-current={caminho === '/' ? 'page' : undefined} className={estilo.marca} href="/">
          <span aria-hidden="true" className={estilo.sigla}>
            {sigla(nomeSistema)}
          </span>
          <span className={estilo.nomeDoSistema}>{nomeSistema}</span>
        </Link>

        <nav aria-label="Telas do sistema" className={estilo.navegacao}>
          {portasPorGrupo().map((grupo) => (
            <div className={estilo.grupo} key={grupo.grupo}>
              <h2 className={estilo.grupoTitulo} id={`lateral-${grupo.grupo}`}>
                {grupo.titulo}
              </h2>
              <ul aria-labelledby={`lateral-${grupo.grupo}`} className={estilo.portas}>
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
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
