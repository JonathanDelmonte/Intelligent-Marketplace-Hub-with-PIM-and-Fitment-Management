/**
 * Tela de importação — o campo único de entrada, e a observabilidade mínima que a
 * seção 7 da especificação exige:
 * "log estruturado e uma tela de últimos 100 jobs com erro visível".
 *
 * É também a primeira tela de verdade do sistema, e por isso define três coisas
 * que valem para as próximas:
 *
 * 1. **Nenhuma tela tem porta de conexão.** Não há plataforma ligada aqui, e a
 *    tela funciona igual (ADR 0002). O que não existe aparece como estado normal.
 * 2. **Nenhum literal de marca.** Nome do sistema vem de `config/marca.ts`.
 * 3. **O erro é conteúdo, não detalhe.** Job que falhou mostra o erro por extenso
 *    na linha, e job em revisão mostra o motivo. Esconder isso atrás de um clique
 *    é o que torna um sistema de ingestão inauditável em uma semana.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ehPlataforma } from '@/dominio/precificacao/tipos';
import { montarNucleo } from '@/infra/montagem';
import { ROTULO_DA_PLATAFORMA } from '../ui/rotulos';
import { CAMINHO, LIMITE_DA_LISTA, LIMITE_DE_PROCESSAMENTO_MANUAL } from './constantes';
import {
  avisoDeFilaParada,
  avisoDoPrazoNaNuvem,
  descreverAviso,
  haEntradaAndando,
  inteiroDaUrl,
  ultimoTermino,
  IDIOMA,
} from './apresentacao';
import {
  AvisoDaAcao,
  AvisoDeFilaParada,
  BotaoProcessarAgora,
  FormularioDeEntrada,
  Painel,
  TabelaDeJobs,
} from './componentes';
import { AtualizacaoAutomatica } from './atualizacao-automatica';
import estilo from './importar.module.css';

export const metadata: Metadata = { title: 'Importar' };

/**
 * Sempre dinâmica.
 *
 * Sem isto o Next tentaria pré-renderizar a página no `build`, o que significa
 * abrir conexão com o banco durante a compilação — e um `build` que precisa de
 * banco de produção para terminar é um `build` que falha na hora errada.
 */
export const dynamic = 'force-dynamic';

export default async function PaginaDeImportacao({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const codigo = typeof parametros['r'] === 'string' ? parametros['r'] : undefined;
  // Vindo do botão de importar da área de uma loja, o arquivo entra como daquela loja.
  const loja = ehPlataforma(parametros['loja']) ? parametros['loja'] : undefined;
  const quantidade = inteiroDaUrl(
    typeof parametros['n'] === 'string' ? parametros['n'] : undefined,
  );

  const { fila, armazenamento } = montarNucleo();

  const [contagem, prontos, jobs, emRevisao] = await Promise.all([
    fila.contagemPorStatus(),
    fila.quantidadePronta(),
    fila.ultimos(LIMITE_DA_LISTA),
    fila.aguardandoRevisao(LIMITE_DA_LISTA),
  ]);

  // Um "agora" só para a página inteira: duas chamadas a `new Date()` fariam
  // duas linhas com o mesmo instante mostrarem tempos relativos diferentes.
  const agora = new Date();

  const aviso = descreverAviso(codigo, quantidade);
  const filaParada = avisoDeFilaParada({ prontos, ultimoTermino: ultimoTermino(jobs), agora });
  const prazoNaNuvem = avisoDoPrazoNaNuvem(armazenamento.retencaoDias);

  return (
    <main className={estilo.pagina}>
      <h1 className={estilo.titulo}>Importar</h1>
      <p className={estilo.subtitulo}>
        Tudo que entra no sistema passa por aqui. Nada é descartado: entrada que o sistema não sabe
        tratar fica em <strong>revisar</strong>, com o motivo, esperando decisão humana.
      </p>

      {aviso === null ? null : <AvisoDaAcao aviso={aviso} />}
      {filaParada === null ? null : <AvisoDeFilaParada texto={filaParada} />}

      <Painel contagem={contagem} prontos={prontos} />

      <section className={estilo.secao}>
        <h2 className={estilo.tituloDaSecao}>
          {loja === undefined ? 'Nova entrada' : `Planilha da loja ${ROTULO_DA_PLATAFORMA[loja]}`}
        </h2>
        {loja !== undefined && (
          <p className={estilo.subtitulo}>
            A planilha que você subir aqui entra como da loja {ROTULO_DA_PLATAFORMA[loja]}, qualquer
            que seja o nome do arquivo. <Link href={CAMINHO}>Importar de outra origem</Link>
          </p>
        )}
        <FormularioDeEntrada loja={loja} />
        {prazoNaNuvem === null ? null : <p className={estilo.dica}>{prazoNaNuvem}</p>}
      </section>

      {emRevisao.length === 0 ? null : (
        <section className={estilo.secao}>
          <h2 className={estilo.tituloDaSecao}>
            Esperando revisão{' '}
            <span className={estilo.contadorDoTitulo}>
              ({emRevisao.length.toLocaleString(IDIOMA)})
            </span>
          </h2>
          <p className={estilo.dica} style={{ marginBottom: '0.75rem' }}>
            Não é erro. É entrada guardada que o sistema não conseguiu tratar sozinho — porque a
            classificação ficou fraca, ou porque o extrator daquele tipo ainda não existe.
          </p>
          <TabelaDeJobs jobs={emRevisao} agora={agora} vazio="Nada esperando revisão." />
        </section>
      )}

      <section className={estilo.secao}>
        <div className={estilo.acoesDaSecao}>
          <h2 className={estilo.tituloDaSecao} style={{ margin: 0 }}>
            Últimas {String(LIMITE_DA_LISTA)} entradas
          </h2>
          <div className={estilo.acoesDaSecao} style={{ gap: '1rem', marginBottom: 0 }}>
            <AtualizacaoAutomatica
              ativa={haEntradaAndando({ prontos, rodando: contagem.rodando })}
            />
            <BotaoProcessarAgora limite={LIMITE_DE_PROCESSAMENTO_MANUAL} />
          </div>
        </div>
        <TabelaDeJobs
          jobs={jobs}
          agora={agora}
          vazio="Nenhuma entrada ainda. Cole um link ou suba uma planilha acima."
        />
      </section>
    </main>
  );
}
