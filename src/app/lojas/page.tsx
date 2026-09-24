/**
 * Adicionar loja (ADR 0009): as lojas que o sistema atende, e as que estão a caminho.
 *
 * As atendidas já estão na barra — cada uma com a área dela, conectada ou não. As a
 * caminho aparecem com o que falta para entrarem, e sem botão de adicionar: uma área
 * de loja sem a tabela de comissão dela daria margem errada com cara de certa.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { estadoDaLoja, type EstadoDaLoja } from '@/dominio/lojas/estado';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { registroPadrao } from '@/plataformas/registro';
import { caminhoDaLoja } from '../navegacao';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { LOJAS_A_CAMINHO, O_QUE_UMA_LOJA_NOVA_PRECISA } from './candidatas';
import { IDENTIDADE_DA_LOJA } from './identidade';
import { Selo } from './selo';
import estilo from './lojas.module.css';

export const metadata: Metadata = { title: 'Adicionar loja' };

/** Sempre dinâmica: o estado de cada loja é de agora. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeLojas() {
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const numeros = await new RepositorioDeLojas(db).numeros(perfil.id);
  const registro = registroPadrao({
    plataformasComCredencial: numeros.filter((n) => n.conectada).map((n) => n.plataforma),
  });

  const estados = new Map<Plataforma, EstadoDaLoja>(
    numeros.map((n) => [n.plataforma, estadoDaLoja(n)]),
  );

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <div>
          <h1 className={estilo.titulo}>Adicionar loja</h1>
          <p className={estilo.subtitulo}>
            Cada loja tem uma área própria na barra, com o painel só dela. Conectar é opcional: sem
            integração, a área funciona com a planilha de pedidos da loja.
          </p>
        </div>
      </header>

      <section aria-labelledby="atendidas-titulo">
        <h2 className={estilo.secaoTitulo} id="atendidas-titulo">
          Já na barra
        </h2>
        <ul className={estilo.lojas}>
          {PLATAFORMAS.map((plataforma) => {
            const estado = estados.get(plataforma);
            return (
              <li key={plataforma}>
                <article className={estilo.loja}>
                  <div className={estilo.lojaCabecalho}>
                    <Selo identidade={IDENTIDADE_DA_LOJA[plataforma]} tamanho={40} />
                    <h3 className={estilo.lojaNome}>{ROTULO_DA_PLATAFORMA[plataforma]}</h3>
                  </div>
                  <p className={estilo.lojaTexto}>{registro.de(plataforma).comoConectar}</p>
                  <p className={`${estilo.lojaRodape} ${estilo.lojaNaBarra}`}>
                    {estado?.legenda ?? 'Sem dados'} ·{' '}
                    <Link href={caminhoDaLoja(plataforma)}>abrir a área</Link>
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="a-caminho-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="a-caminho-titulo">
          A caminho
        </h2>
        <ul className={estilo.lojas}>
          {LOJAS_A_CAMINHO.map((loja) => (
            <li key={loja.id}>
              <article className={estilo.loja}>
                <div className={estilo.lojaCabecalho}>
                  <Selo identidade={loja.identidade} tamanho={40} />
                  <h3 className={estilo.lojaNome}>{loja.nome}</h3>
                </div>
                <p className={estilo.lojaTexto}>
                  Entra com a planilha de pedidos e a comissão conferida. A integração vem depois,
                  se a loja abrir uma.
                </p>
                <p className={`${estilo.lojaRodape} ${estilo.lojaACaminho}`}>Ainda não atendida</p>
              </article>
            </li>
          ))}
        </ul>

        <div className={estilo.blocoAbaixo}>
          <h3 className={estilo.blocoTitulo}>O que uma loja nova precisa para entrar</h3>
          <ul>
            {O_QUE_UMA_LOJA_NOVA_PRECISA.map((item) => (
              <li className={estilo.caminhoTexto} key={item}>
                {item}
              </li>
            ))}
          </ul>
          <p className={estilo.dica}>
            O que acelera: uma planilha de pedidos exportada do painel da loja e o link da página de
            tarifas dela. Com isso a loja entra na barra, com a área, a visão geral e o assistente —
            sem tela nova.
          </p>
        </div>
      </section>
    </main>
  );
}
