/**
 * Tela "Cópia dos dados" (ADR 0016): o banco inteiro num arquivo, baixado para o
 * computador de quem usa.
 *
 * Pedido do dono, em 25/09: o que puder ficar no computador de quem usa, fica lá. A
 * nuvem gratuita não faz cópia de segurança, e esta tela é a cópia que ela não faz —
 * sem custo, e sem depender de mais um serviço.
 *
 * Restaurar não é daqui: é pelo computador (`npm run copia:restaurar`) ou por qualquer
 * `psql`. Com o cadastro aberto (ADR 0015), um botão de restaurar na tela deixaria
 * qualquer conta trocar os dados de todo mundo.
 */
import type { Metadata } from 'next';
import { banco } from '@/infra/banco/cliente';
import { medirCopia } from '@/infra/banco/copia';
import { formatarTamanho } from './apresentacao';
import { CAMINHO_DO_DOWNLOAD } from './constantes';
import estilo from './copia.module.css';

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

      <section aria-labelledby="baixar-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="baixar-titulo">
          Baixar
        </h2>
        <div className={estilo.painel}>
          <div className={estilo.cartao}>
            <span className={estilo.cartaoRotulo}>Tabelas na cópia</span>
            <span className={estilo.cartaoNumero}>{medida.tabelas}</span>
          </div>
          <div className={estilo.cartao}>
            <span className={estilo.cartaoRotulo}>Tamanho no banco</span>
            <span className={estilo.cartaoNumero}>{formatarTamanho(medida.bytesNoBanco)}</span>
          </div>
        </div>
        <a className={estilo.botao} download href={CAMINHO_DO_DOWNLOAD}>
          Baixar a cópia
        </a>
        <p className={estilo.dica}>
          O arquivo sai comprimido, bem menor que o tamanho no banco. Guarde em mais de um lugar —
          um pendrive, um e-mail para você mesmo. Uma cópia por semana, e outra antes de mexer em
          muita coisa de uma vez, é um bom ritmo.
        </p>
      </section>

      <section aria-labelledby="conteudo-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="conteudo-titulo">
          O que vai, e o que fica de fora
        </h2>
        <ul className={estilo.lista}>
          <li>
            <strong>Vai tudo o que está no banco:</strong> produtos, anúncios, pedidos,
            fornecedores, compatibilidade, o histórico de preços, a fila de importação e o que a IA
            já leu — que assim não precisa ser pago de novo.
          </li>
          <li>
            <strong>As contas de acesso ficam de fora.</strong> Quem restaurar cria a conta de novo;
            a senha de ninguém viaja no arquivo.
          </li>
          <li>
            <strong>Os arquivos enviados também.</strong> Não estão no banco, e o original está com
            quem enviou.
          </li>
        </ul>
      </section>

      <section aria-labelledby="restaurar-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="restaurar-titulo">
          Como a cópia volta
        </h2>
        <p className={estilo.dica}>
          Pelo computador, com o sistema instalado e o banco de destino no arquivo de configuração.
          Primeiro o comando só confere o arquivo e diz o que ele tem; com <code>--sim</code>, ele
          troca os dados do banco pelos da cópia, numa vez só — se algo der errado no meio, nada
          muda.
        </p>
        <code className={estilo.comando}>npm run copia:restaurar -- copia-dos-dados.sql.gz</code>
        <p className={estilo.dica}>Sem o sistema, qualquer Postgres restaura o mesmo arquivo:</p>
        <code className={estilo.comando}>
          gunzip -c copia-dos-dados.sql.gz | psql &quot;endereço do banco&quot;
        </code>
      </section>
    </main>
  );
}
