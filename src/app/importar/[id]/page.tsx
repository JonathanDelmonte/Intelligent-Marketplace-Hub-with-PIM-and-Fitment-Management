/**
 * Detalhe de uma entrada.
 *
 * Existe para fechar um buraco que a lista deixava: o executor guarda em
 * `resultado.rejeitadas` **cada linha da planilha que não passou**, com a linha
 * original e o motivo, exatamente para permitir corrigir três linhas à mão em vez
 * de reimportar quatro mil. A lista mostrava só a contagem — o dado estava no
 * banco e não existia para quem opera.
 *
 * É também a tela de última instância: quando o resumo não explica, aqui aparece
 * o payload gravado como está. Por isso tudo que ela mostra passa por leitura
 * tolerante: job de dois meses atrás, escrito por outra versão do orquestrador,
 * tem que abrir.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { montarNucleo } from '@/infra/montagem';
import { CAMINHO } from '../constantes';
import {
  COR_DO_STATUS,
  EXPLICACAO_DO_STATUS,
  ROTULO_DO_STATUS,
  entradaAndando,
  extrairRejeitadas,
  fichaDoJob,
  jsonLegivel,
  resumirEntrada,
  resumirProgresso,
  resumirResultado,
  rotuloDoTipoDeEntrada,
  rotuloDoTipoDeJob,
} from '../apresentacao';
import { reenfileirar } from '../acoes';
import { AtualizacaoAutomatica } from '../atualizacao-automatica';
import { SinalVoltar } from '../../ui/sinais';
import estilo from '../importar.module.css';

export const metadata: Metadata = { title: 'Entrada' };
export const dynamic = 'force-dynamic';

export default async function PaginaDoJob({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const { fila } = montarNucleo();

  // Identificador que não é UUID faria a consulta lançar erro de sintaxe do
  // Postgres, e a tela responderia 500 para o que é só uma URL digitada errada.
  if (!ehUuid(id)) notFound();

  const job = await fila.buscarDetalhado(id);
  if (job === null) notFound();

  const agora = new Date();
  const entrada = resumirEntrada(job.entrada, job.tipo);
  const metricas = resumirResultado(job.resultado);
  const progresso = resumirProgresso(job.progresso);
  const rejeitadas = extrairRejeitadas(job.resultado);
  const payloadDaEntrada = jsonLegivel(job.entrada);
  const payloadDoResultado = jsonLegivel(job.resultado);

  return (
    <main className={estilo.pagina}>
      <Link href={CAMINHO} className={estilo.voltar}>
        <SinalVoltar />
        Voltar para a lista
      </Link>

      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>{entrada.titulo}</h1>
        <p className={estilo.subtitulo}>
          {entrada.tipoDeEntrada === null
            ? rotuloDoTipoDeJob(job.tipo)
            : rotuloDoTipoDeEntrada(entrada.tipoDeEntrada)}
          {entrada.site === null ? '' : ` · ${entrada.site}`}
          {entrada.confiancaBp === null
            ? ''
            : ` · confiança ${String(Math.round(entrada.confiancaBp / 100))}%`}
        </p>
        <p className={estilo.situacaoDoJob}>
          <span className={estilo.etiqueta} style={{ color: COR_DO_STATUS[job.status] }}>
            {ROTULO_DO_STATUS[job.status]}
          </span>
          <span className={estilo.situacaoExplicada}>{EXPLICACAO_DO_STATUS[job.status]}</span>
          <AtualizacaoAutomatica ativa={entradaAndando(job, agora)} />
        </p>
      </header>

      {job.erro === null ? null : (
        <section
          aria-labelledby="erro-titulo"
          className={job.status === 'pendente_revisao' ? estilo.caixaDeRevisao : estilo.caixaDeErro}
        >
          <h2 className={estilo.caixaTitulo} id="erro-titulo">
            {job.status === 'pendente_revisao' ? 'Por que está esperando revisão' : 'O erro'}
          </h2>
          <p className={estilo.caixaTexto}>{job.erro}</p>
        </section>
      )}

      <section aria-labelledby="ficha-titulo" className={estilo.bloco}>
        <div className={estilo.blocoTopo}>
          <h2 className={estilo.blocoTitulo} id="ficha-titulo">
            Ficha
          </h2>
          {job.status === 'rodando' ? null : (
            <form action={reenfileirar}>
              <input type="hidden" name="id" value={job.id} />
              <button type="submit" className={estilo.botaoSecundario}>
                {job.status === 'concluido' ? 'Rodar de novo' : 'Tentar de novo'}
              </button>
            </form>
          )}
        </div>
        <dl className={estilo.ficha}>
          {fichaDoJob(job, agora).map((item) => (
            <div key={item.rotulo} className={estilo.fichaItem}>
              <dt className={estilo.fichaRotulo}>{item.rotulo}</dt>
              <dd className={estilo.fichaValor}>{item.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      {metricas.length === 0 && progresso === null ? null : (
        <section aria-labelledby="resultado-titulo" className={estilo.bloco}>
          <h2 className={estilo.blocoTitulo} id="resultado-titulo">
            Resultado
          </h2>
          <ul className={estilo.metricas}>
            {progresso === null ? null : (
              <li className={estilo.detalheDaEntrada}>Progresso: {progresso}</li>
            )}
            {metricas.map((m) => (
              <li
                key={m.rotulo}
                className={m.alerta === true ? estilo.metricaAlerta : estilo.metrica}
              >
                {m.rotulo}: {m.valor}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejeitadas.length === 0 ? null : (
        <section aria-labelledby="recusadas-titulo" className={estilo.bloco}>
          <div className={estilo.blocoTopo}>
            <div>
              <h2 className={estilo.blocoTitulo} id="recusadas-titulo">
                Linhas recusadas
              </h2>
              <p className={estilo.blocoTexto}>
                Nada foi descartado. Cada linha aparece como veio no arquivo, com o motivo: é o que
                permite corrigir à mão sem importar a planilha inteira de novo.
              </p>
            </div>
            <span className={estilo.blocoNota}>
              {rejeitadas.length.toLocaleString('pt-BR')}{' '}
              {rejeitadas.length === 1 ? 'linha' : 'linhas'}
            </span>
          </div>
          {rejeitadas.map((linha, indice) => (
            <div
              key={`${String(linha.numeroDaLinha)}-${String(indice)}`}
              className={estilo.rejeitada}
            >
              <div className={estilo.rejeitadaCabecalho}>
                <span className={estilo.rejeitadaLinha}>
                  {linha.numeroDaLinha === null
                    ? 'Linha desconhecida'
                    : `Linha ${String(linha.numeroDaLinha)}`}
                </span>
                <span className={estilo.rejeitadaMotivo}>{linha.motivo}</span>
              </div>
              {linha.problemas.length === 0 ? null : (
                <ul className={estilo.listaDeProblemas}>
                  {linha.problemas.map((problema) => (
                    <li key={problema}>{problema}</li>
                  ))}
                </ul>
              )}
              {linha.temColunasOriginais ? null : (
                <p className={estilo.dicaDaLinha}>
                  Entrada gravada antes de a linha original passar a ser guardada: abaixo estão os
                  campos já mapeados, não os nomes de coluna do arquivo.
                </p>
              )}
              {linha.campos.length === 0 ? null : (
                <div className={estilo.rejeitadaCampos}>
                  {linha.campos.map((campo) => (
                    <div key={campo.coluna} className={estilo.rejeitadaCampo}>
                      <div className={estilo.rejeitadaColuna}>{campo.coluna}</div>
                      <div className={estilo.rejeitadaValor}>
                        {campo.valor === '' ? '(vazio)' : campo.valor}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {payloadDaEntrada === null ? null : (
        <section aria-labelledby="gravada-titulo" className={estilo.bloco}>
          <h2 className={estilo.blocoTitulo} id="gravada-titulo">
            Entrada gravada
          </h2>
          <pre className={estilo.codigo}>{payloadDaEntrada}</pre>
        </section>
      )}

      {payloadDoResultado === null ? null : (
        <section aria-labelledby="resultado-gravado-titulo" className={estilo.bloco}>
          <h2 className={estilo.blocoTitulo} id="resultado-gravado-titulo">
            Resultado gravado
          </h2>
          <pre className={estilo.codigo}>{payloadDoResultado}</pre>
        </section>
      )}
    </main>
  );
}

const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ehUuid(valor: string): boolean {
  return PADRAO_UUID.test(valor);
}
