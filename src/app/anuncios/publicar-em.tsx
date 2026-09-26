/**
 * "Publicar em": uma linha por loja, com a conta dela e a montagem do anúncio.
 *
 * A mesma ficha serve a todas as lojas (ADR 0009). O que muda de uma para outra é o
 * preço, porque a comissão muda, e por isso cada linha leva à conta do produto na loja
 * dela antes de montar.
 */
import Link from 'next/link';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import estilo from './publicar-em.module.css';

export interface LojaParaPublicar {
  readonly plataforma: Plataforma;
  readonly nota: string;
  /** A montagem do anúncio nesta loja. */
  readonly montar: string;
  /** A conta do produto, nesta loja: o preço de cada loja é outro. */
  readonly simular: string;
}

export function PublicarEm({ lojas }: { readonly lojas: readonly LojaParaPublicar[] }) {
  return (
    <ul className={estilo.publicar}>
      {lojas.map((loja) => (
        <li className={estilo.publicarLoja} key={loja.plataforma}>
          <Selo identidade={IDENTIDADE_DA_LOJA[loja.plataforma]} tamanho={32} />
          <span className={estilo.publicarTextos}>
            <span className={estilo.publicarNome}>{ROTULO_DA_PLATAFORMA[loja.plataforma]}</span>
            <span className={estilo.publicarNota}>{loja.nota}</span>
          </span>
          <span className={estilo.publicarAcoes}>
            <Link className={estilo.link} href={loja.simular}>
              Simular preço
            </Link>
            <Link className={estilo.botaoSecundario} href={loja.montar}>
              Montar anúncio
            </Link>
          </span>
        </li>
      ))}
    </ul>
  );
}
