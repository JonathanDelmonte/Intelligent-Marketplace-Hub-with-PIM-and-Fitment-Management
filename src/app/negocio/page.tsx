/**
 * Tela "Meu negócio" — os dados do negócio, no aplicativo.
 *
 * Pedido do dono, em 24/09: estado, regime, documento e o quanto se vende por mês não
 * podem depender de alguém informar pelo chat. O que é do dono entra aqui; o que dá para
 * contar — vendas por plataforma — sai dos pedidos importados, e esta tela só mostra.
 *
 * ## O que muda quando um campo muda
 *
 * O regime decide a tabela de comissão e o imposto da margem (M8); o DAS é rateado pelas
 * unidades vendidas no mês; o teto e a data de abertura decidem o controle do MEI; e o
 * conjunto — estado, CNPJ, inscrição, certificado, vendas — decide o emissor de nota que
 * a tela fiscal recomenda. Cada campo diz isso na própria dica.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { lerAmbiente } from '@/config/ambiente';
import { TETO_MEI_ANUAL } from '@/dominio/fiscal/teto';
import { carregarPerfil } from '@/dominio/perfil';
import { RepositorioDoNegocio, inicioDaJanelaDoMes } from '@/dominio/perfil/negocio';
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import { banco } from '@/infra/banco/cliente';
import { formatarBRL } from '@/lib/dinheiro';
import { CAMINHO as CAMINHO_FISCAL } from '../fiscal/constantes';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { descreverAviso, resumoDasVendas, valoresGravados } from './apresentacao';
import { AvisoDaAcao } from './componentes';
import { FormularioDoNegocio } from './formulario-do-negocio';
import estilo from './negocio.module.css';

export const metadata: Metadata = { title: 'Meu negócio' };

/** Sempre dinâmica: as vendas do mês dependem da data de hoje. */
export const dynamic = 'force-dynamic';

export default async function PaginaDoNegocio({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  const repo = new RepositorioDoNegocio(db);
  const desde = inicioDaJanelaDoMes(new Date());

  const [dados, vendas] = await Promise.all([
    repo.ler(perfil.id),
    repo.vendasPorPlataforma(perfil.id, desde),
  ]);

  const codigo = parametros['r'];
  const aviso = descreverAviso(Array.isArray(codigo) ? codigo[0] : codigo);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Meu negócio</h1>
        <p className={estilo.subtitulo}>
          Os dados que mudam as contas do sistema: o regime decide a comissão e o imposto da margem,
          o teto controla o limite do MEI, e o conjunto decide qual emissor de nota usar. O que dá
          para contar, como as vendas do mês, o sistema conta sozinho.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="dados-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="dados-titulo">
          Dados do negócio
        </h2>
        {dados === null ? (
          <p className={estilo.vazio}>
            O perfil deste sistema não foi encontrado no banco. Rode a semeadura (npm run db:seed) e
            volte a esta tela.
          </p>
        ) : (
          <FormularioDoNegocio
            gravados={valoresGravados(dados)}
            tetoDoMei={formatarBRL(TETO_MEI_ANUAL)}
          />
        )}
      </section>

      <section aria-labelledby="vendas-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="vendas-titulo">
          Vendas dos últimos 30 dias
        </h2>
        <p className={estilo.resumo}>{resumoDasVendas(vendas)}</p>
        <ul className={estilo.painel}>
          {PLATAFORMAS.map((plataforma) => (
            <li className={estilo.cartao} key={plataforma}>
              <span className={estilo.cartaoNumero}>{vendas[plataforma]}</span>
              <span className={estilo.cartaoRotulo}>{ROTULO_DA_PLATAFORMA[plataforma]}</span>
            </li>
          ))}
        </ul>
        <p className={estilo.resumo}>
          É com esse número que a{' '}
          <Link className={estilo.link} href={`${CAMINHO_FISCAL}#emissor`}>
            tela fiscal recomenda o emissor de nota
          </Link>{' '}
          e que o DAS do MEI é rateado por peça.
        </p>
      </section>
    </main>
  );
}
