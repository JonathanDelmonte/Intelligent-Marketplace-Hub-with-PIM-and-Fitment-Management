/**
 * Tela "Cópia dos dados" (ADR 0016): o banco inteiro num arquivo, baixado para o
 * computador de quem usa.
 *
 * Pedido do dono, em 25/09: o que puder ficar no computador de quem usa, fica lá. A
 * nuvem gratuita não faz cópia de segurança, e esta tela é a cópia que ela não faz —
 * sem custo, e sem depender de mais um serviço.
 *
 * E a cópia volta por aqui mesmo (ADR 0017): escolher o arquivo, ver o que ele tem,
 * confirmar. Pedido do dono, em 26/09: funcionar como o produto pronto funcionaria, mesmo
 * com o cadastro ainda aberto. O computador (`npm run copia:restaurar`) e qualquer `psql`
 * continuam restaurando o mesmo arquivo.
 */
import type { Metadata } from 'next';
import { banco } from '@/infra/banco/cliente';
import { medirCopia } from '@/infra/banco/copia';
import { formatarTamanho } from './apresentacao';
import { CAMINHO_DO_DOWNLOAD } from './constantes';
import { SinalCaixa, SinalCerto, SinalFechar } from '../ui/sinais';
import estilo from './copia.module.css';
import { RestaurarCopia } from './formulario-de-restaurar';

export const metadata: Metadata = { title: 'Cópia dos dados' };

/** Sempre dinâmica: o tamanho é o do banco agora. */
export const dynamic = 'force-dynamic';

export default async function PaginaDaCopia() {
  const medida = await medirCopia(banco());

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Cópia dos dados</h1>
        <p className={estilo.subtitulo}>
          O banco inteiro num arquivo, guardado no seu computador. A nuvem gratuita não faz cópia de
          segurança: se o banco de lá se perder, é este arquivo que traz os dados de volta.
        </p>
      </header>

      {/*
        O cartão escuro da tela: é a ação dela. Os dois números moram dentro dele, porque
        dizem o tamanho do que vai sair, e não são assunto à parte.
      */}
      <section aria-labelledby="baixar-titulo" className={estilo.baixar}>
        <div className={estilo.baixarTextos}>
          <span aria-hidden="true" className={estilo.baixarIcone}>
            <SinalCaixa />
          </span>
          <div>
            <h2 className={estilo.baixarTitulo} id="baixar-titulo">
              Baixar a cópia de agora
            </h2>
            <p className={estilo.baixarTexto}>
              O arquivo sai comprimido, bem menor que o tamanho no banco. Guarde em mais de um
              lugar: um pendrive, um e-mail para você mesmo.
            </p>
          </div>
        </div>
        <dl className={estilo.medidas}>
          <div>
            <dt>Tabelas na cópia</dt>
            <dd>{medida.tabelas}</dd>
          </div>
          <div>
            <dt>Tamanho no banco</dt>
            <dd>{formatarTamanho(medida.bytesNoBanco)}</dd>
          </div>
        </dl>
        <a className={estilo.botaoClaro} download href={CAMINHO_DO_DOWNLOAD}>
          Baixar a cópia
        </a>
      </section>

      <div className={estilo.grade}>
        <section aria-labelledby="restaurar-titulo" className={estilo.bloco}>
          <h2 className={estilo.blocoTitulo} id="restaurar-titulo">
            Restaurar uma cópia
          </h2>
          <p className={estilo.blocoTexto}>
            Troca todos os dados de agora pelos da cópia, numa vez só: se algo der errado no meio,
            nada muda. As contas de acesso continuam as mesmas. Quer guardar os dados de agora?{' '}
            <a download href={CAMINHO_DO_DOWNLOAD}>
              Baixe a cópia deles antes
            </a>
            .
          </p>
          <RestaurarCopia />
        </section>

        <div className={estilo.coluna}>
          <section aria-labelledby="conteudo-titulo" className={estilo.bloco}>
            <h2 className={estilo.blocoTitulo} id="conteudo-titulo">
              O que vai, e o que fica de fora
            </h2>
            <ul className={estilo.lista}>
              <li>
                <span aria-hidden="true" className={estilo.vai}>
                  <SinalCerto tamanho={12} />
                </span>
                <span>
                  <strong>Vai tudo o que está no banco:</strong> produtos, anúncios, pedidos,
                  fornecedores, compatibilidade, o histórico de preços, a fila de importação e o que
                  a IA já leu, que assim não precisa ser pago de novo.
                </span>
              </li>
              <li>
                <span aria-hidden="true" className={estilo.ficaFora}>
                  <SinalFechar tamanho={12} />
                </span>
                <span>
                  <strong>As contas de acesso ficam de fora.</strong> Quem restaurar cria a conta de
                  novo; a senha de ninguém viaja no arquivo.
                </span>
              </li>
              <li>
                <span aria-hidden="true" className={estilo.ficaFora}>
                  <SinalFechar tamanho={12} />
                </span>
                <span>
                  <strong>Os arquivos enviados também.</strong> Não estão no banco, e o original
                  está com quem enviou.
                </span>
              </li>
            </ul>
            <p className={estilo.nota}>
              Uma cópia por semana, e outra antes de mexer em muita coisa de uma vez, é um bom
              ritmo.
            </p>
          </section>

          <section aria-labelledby="sem-a-tela-titulo" className={estilo.bloco}>
            <h2 className={estilo.blocoTitulo} id="sem-a-tela-titulo">
              Sem esta tela
            </h2>
            <p className={estilo.blocoTexto}>
              No computador, com o sistema instalado, o comando abaixo confere o arquivo e diz o que
              ele tem; com <code>--sim</code> no fim, restaura.
            </p>
            <code className={estilo.comando}>
              npm run copia:restaurar -- copia-dos-dados.sql.gz
            </code>
            <p className={estilo.blocoTexto}>
              Sem o sistema, qualquer Postgres restaura o mesmo arquivo:
            </p>
            <code className={estilo.comando}>
              gunzip -c copia-dos-dados.sql.gz | psql &quot;endereço do banco&quot;
            </code>
          </section>
        </div>
      </div>
    </main>
  );
}
