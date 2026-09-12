/**
 * Tela do leitor de código de barras — M14, fase 4.
 *
 * A especificação chama de "a primeira função que gera dinheiro": capital de
 * R$ 50 a R$ 100, decisão baseada em dado, de pé na liquidação. E o segundo uso,
 * que é o que abre porta: escanear quarenta itens no balcão de um parceiro em
 * quinze minutos e saber quais valem anunciar — o que transforma a conversa de
 * consignação em proposta concreta no mesmo dia.
 *
 * O invólucro é servidor; o miolo é cliente. A divisão segue o que cada lado sabe
 * fazer: o servidor conhece o perfil e o tamanho da base, o cliente tem câmera,
 * armazenamento local e notícia de rede.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ConsultaDeGtin } from '@/dominio/leitor/consulta';
import { RepositorioDeLeituras } from '@/dominio/leitor/leituras';
import { carregarPerfil } from '@/dominio/perfil';
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { LIMITE_DO_HISTORICO } from './constantes';
import { contarCodigos, formatarReais } from './apresentacao';
import { Leitor } from './leitor';
import { RegistrarServiceWorker } from './registrar-sw';
import estilo from './leitor.module.css';

export const metadata: Metadata = { title: 'Leitor' };

/** Sempre dinâmica: lê banco, e `build` não deve precisar de banco. */
export const dynamic = 'force-dynamic';

export default async function PaginaDoLeitor() {
  const db = banco();
  const ambiente = lerAmbiente();

  const perfil = await carregarPerfil(db, ambiente.BANCADA_PERFIL_PADRAO);
  const [quantidadeNaBase, historico] = await Promise.all([
    new ConsultaDeGtin(db).quantidadeDeGtinsConhecidos(),
    new RepositorioDeLeituras(db).ultimas({ perfil: perfil.id, limite: LIMITE_DO_HISTORICO }),
  ]);

  return (
    <main className={estilo.pagina}>
      <RegistrarServiceWorker />

      <h1 className={estilo.titulo}>Leitor</h1>
      <p className={estilo.subtitulo}>
        Informe o custo, leia o código, decida. Funciona sem rede: a leitura fica no aparelho e sobe
        quando dá.
      </p>

      <Leitor quantidadeNaBase={quantidadeNaBase} />

      <section className={estilo.secao}>
        <h2 className={estilo.tituloDaSecao}>
          Últimas leituras{' '}
          {historico.length === 0 ? null : (
            <span className={estilo.leituraDetalhe}>({historico.length})</span>
          )}
        </h2>

        {historico.length === 0 ? (
          <p className={estilo.vazio}>
            nada lido ainda. O que você avaliar aqui fica registrado com a decisão, e é o que depois
            ensina o sistema.
          </p>
        ) : (
          <ul className={estilo.historico}>
            {historico.map((l) => (
              <li key={l.id} className={estilo.leitura}>
                <span>
                  <span className={estilo.leituraCodigo}>{l.gtin}</span>
                  <div className={estilo.leituraDetalhe}>
                    {l.veredito.replace(/_/gu, ' ')}
                    {l.custoUnitario === null ? '' : ` · custo ${formatarReais(l.custoUnitario)}`}
                    {l.precoDeReferencia === null
                      ? ''
                      : ` · praticado ${formatarReais(l.precoDeReferencia)}`}
                  </div>
                </span>
                <span className={estilo.leituraDetalhe}>
                  {l.decisao === null ? 'sem decisão' : l.decisao.replace(/_/gu, ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={estilo.ajuda} style={{ marginTop: '1.5rem' }}>
        A base tem {contarCodigos(quantidadeNaBase).replace(' na base', '')}. Ela cresce quando você
        importa planilha de exportação em <Link href="/jobs">jobs</Link> — sem base, o leitor lê o
        código e não tem com o que comparar.
      </p>
    </main>
  );
}
