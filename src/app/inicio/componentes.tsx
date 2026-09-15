/**
 * Componentes da tela inicial. Servidor, sem estado, sem JavaScript no cliente.
 *
 * O que decidir texto, tom e ordem está em `apresentacao.ts`, com teste. Aqui só há
 * onde cada coisa fica.
 */
import Link from 'next/link';
import { portasPorGrupo } from '../navegacao';
import type { Pendencia } from './apresentacao';
import estilo from './inicio.module.css';

const CLASSE_DO_TOM: Readonly<Record<Pendencia['tom'], string>> = {
  agora: `${estilo.pendencia} ${estilo.pendenciaAgora}`,
  atencao: `${estilo.pendencia} ${estilo.pendenciaAtencao}`,
  calmo: estilo.pendencia,
};

/**
 * O número da linha.
 *
 * `—` para leitura que falhou, e não `0`: zero é uma afirmação sobre o banco, e aqui
 * não se sabe. Quantidade zero existe e aparece como zero, em cinza.
 */
function Numero({ quantidade }: { readonly quantidade: number | null }) {
  const fraco = quantidade === null || quantidade === 0;
  return (
    <span className={fraco ? `${estilo.numero} ${estilo.numeroFraco}` : estilo.numero}>
      {quantidade === null ? '—' : quantidade.toLocaleString('pt-BR')}
    </span>
  );
}

export function Pendencias({ itens }: { readonly itens: readonly Pendencia[] }) {
  return (
    <ul className={estilo.pendencias}>
      {itens.map((item) => (
        <li key={item.chave}>
          <Link className={CLASSE_DO_TOM[item.tom]} href={item.href}>
            <Numero quantidade={item.quantidade} />
            <span className={estilo.pendenciaTexto}>
              <span className={estilo.pendenciaTitulo}>{item.titulo}</span>
              <span className={estilo.pendenciaOQueE}>{item.oQueE}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * As portas do sistema, agrupadas pelo momento de trabalho.
 *
 * Ficam abaixo das pendências porque respondem outra pergunta: a de cima é "o que eu
 * faço agora", esta é "o que este sistema faz". A segunda é a de quem está aprendendo
 * — e a de quem quer ir a uma tela que ninguém está cobrando.
 */
export function Portas() {
  return (
    <>
      {portasPorGrupo().map((grupo) => (
        <section
          aria-labelledby={`grupo-${grupo.grupo}`}
          className={estilo.grupo}
          key={grupo.grupo}
        >
          <h3 className={estilo.grupoTitulo} id={`grupo-${grupo.grupo}`}>
            {grupo.titulo}
          </h3>
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
    </>
  );
}
