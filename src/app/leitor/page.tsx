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
 *
 * No desenho aprovado (30/09): números no alto, o leitor à esquerda e, à direita, as
 * últimas leituras e de onde vem a comparação.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConsultaDeGtin } from '@/dominio/leitor/consulta';
import { ROTULO_DA_DECISAO, RepositorioDeLeituras } from '@/dominio/leitor/leituras';
import type { Veredito } from '@/dominio/leitor/veredito';
import { carregarPerfil } from '@/dominio/perfil';
import { lerAmbiente } from '@/config/ambiente';
import { banco } from '@/infra/banco/cliente';
import { contagem } from '@/lib/texto';
import { CAMINHO as CAMINHO_DA_IMPORTACAO } from '../importar/constantes';
import { FaixaDeNumeros } from '../ui/numeros';
import { SinalAvancar, SinalBusca, SinalEtiqueta, SinalFechar, SinalSacola } from '../ui/sinais';
import { formatarAbsoluto, formatarRelativo } from '../ui/tempo';
import { LIMITE_DO_HISTORICO } from './constantes';
import {
  CHAMADA_DO_VEREDITO,
  contarCodigos,
  detalheDaLeitura,
  numerosDoLeitor,
  type NumeroDoLeitor,
} from './apresentacao';
import { Leitor } from './leitor';
import { RegistrarServiceWorker } from './registrar-sw';
import estilo from './leitor.module.css';

export const metadata: Metadata = { title: 'Bipar na loja' };

/** Sempre dinâmica: lê banco, e `build` não deve precisar de banco. */
export const dynamic = 'force-dynamic';

const ICONE_DO_NUMERO: Readonly<Record<NumeroDoLeitor['chave'], ReactNode>> = {
  base: <SinalEtiqueta />,
  leituras: <SinalBusca />,
  comprei: <SinalSacola />,
  naoComprei: <SinalFechar />,
};

const CLASSE_DO_VEREDITO: Readonly<Record<Veredito, string>> = {
  compra: estilo.etiquetaOk,
  compra_com_ressalva: estilo.etiquetaAtencao,
  nao_compra: estilo.etiquetaAlerta,
  sem_dado_recente: estilo.etiqueta,
  sem_dado: estilo.etiqueta,
};

export default async function PaginaDoLeitor() {
  const db = banco();
  const ambiente = lerAmbiente();
  const agora = new Date();

  const perfil = await carregarPerfil(db, ambiente.BANCADA_PERFIL_PADRAO);
  const leituras = new RepositorioDeLeituras(db);
  const [quantidadeNaBase, historico, porDecisao] = await Promise.all([
    new ConsultaDeGtin(db).quantidadeDeGtinsConhecidos(),
    leituras.ultimas({ perfil: perfil.id, limite: LIMITE_DO_HISTORICO }),
    leituras.contagemPorDecisao({ perfil: perfil.id }),
  ]);

  return (
    <main className={estilo.pagina}>
      <RegistrarServiceWorker />

      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Bipar na loja</h1>
        <p className={estilo.subtitulo}>
          Informe o custo, leia o código, decida. Funciona sem rede: a leitura fica no aparelho e
          sobe quando dá.
        </p>
      </header>

      <div className={estilo.numeros}>
        <FaixaDeNumeros
          itens={numerosDoLeitor({ quantidadeNaBase, porDecisao }).map((numero) => ({
            rotulo: numero.rotulo,
            valor: numero.valor.toLocaleString('pt-BR'),
            nota: numero.nota,
            tom: numero.tom,
            icone: ICONE_DO_NUMERO[numero.chave],
            escuro: numero.chave === 'base',
          }))}
          rotulo="O leitor em números"
        />
      </div>

      <div className={estilo.grade}>
        <div className={estilo.coluna}>
          <Leitor quantidadeNaBase={quantidadeNaBase} />
        </div>

        <div className={estilo.coluna}>
          <section className={estilo.bloco}>
            <h2 className={estilo.blocoTitulo}>Últimas leituras</h2>
            <p className={estilo.blocoTexto}>
              {historico.length === 0
                ? 'Nada lido ainda. O que você avaliar aqui fica registrado com a decisão, e é o que depois ensina o sistema.'
                : `${contagem(historico.length, 'leitura', 'leituras')}, da mais nova para a mais velha. A lista mostra até ${String(LIMITE_DO_HISTORICO)}.`}
            </p>

            {historico.length === 0 ? null : (
              <ul className={estilo.historico}>
                {historico.map((l) => (
                  <li className={estilo.leitura} key={l.id}>
                    <div className={estilo.leituraTextos}>
                      <span className={estilo.leituraCodigo}>{l.gtin}</span>
                      <span className={estilo.leituraDetalhe}>
                        {detalheDaLeitura(l)} ·{' '}
                        <time dateTime={l.lidoEm.toISOString()} title={formatarAbsoluto(l.lidoEm)}>
                          {formatarRelativo(l.lidoEm, agora)}
                        </time>
                      </span>
                    </div>
                    <span className={CLASSE_DO_VEREDITO[l.veredito]}>
                      {CHAMADA_DO_VEREDITO[l.veredito]}
                    </span>
                    <span className={estilo.leituraDecisao}>
                      {l.decisao === null ? 'sem decisão' : ROTULO_DA_DECISAO[l.decisao]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={estilo.bloco}>
            <h2 className={estilo.blocoTitulo}>De onde vem a comparação</h2>
            <p className={estilo.blocoTexto}>
              A base tem {contarCodigos(quantidadeNaBase).replace(' na base', '')}, dos produtos que
              vieram nas planilhas de exportação importadas, e cresce a cada planilha nova. Sem
              base, o leitor lê o código e não tem com o que comparar.
            </p>
            <Link className={estilo.botaoMiudo} href={CAMINHO_DA_IMPORTACAO}>
              Importar planilha
              <SinalAvancar />
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
