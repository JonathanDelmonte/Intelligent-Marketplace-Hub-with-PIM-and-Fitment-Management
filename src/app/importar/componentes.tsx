/**
 * Componentes da tela de importação.
 *
 * Tudo aqui é Server Component sem estado: recebe dados prontos e devolve marcação.
 * A lógica que decide o que dizer está em `apresentacao.ts`, que tem teste; estes
 * arquivos decidem só onde as coisas ficam na página.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { JobDetalhado, StatusJob } from '@/infra/fila/fila';
import { MAX_UPLOAD_ROTULO } from '@/config/limites';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { FaixaDeNumeros } from '../ui/numeros';
import { SinalAlerta, SinalCaixa, SinalCerto, SinalRelogio } from '../ui/sinais';
import { CAMINHO } from './constantes';
import {
  COR_DO_STATUS,
  IDIOMA,
  ROTULO_DO_STATUS,
  descreverTentativas,
  duracaoDoJob,
  formatarAbsoluto,
  formatarDuracao,
  formatarRelativo,
  resumirEntrada,
  rotuloDoTipoDeJob,
  resumirProgresso,
  resumirResultado,
  rotuloDoTipoDeEntrada,
  numerosDaImportacao,
  type Aviso,
  type NumeroDaImportacao,
} from './apresentacao';
import { enviarEntrada, processarAgora, reenfileirar } from './acoes';
import estilo from './importar.module.css';

// ─── Aviso da última ação ────────────────────────────────────────────────────

const CLASSE_DO_AVISO: Readonly<Record<Aviso['tipo'], string>> = {
  ok: estilo.aviso,
  atencao: estilo.avisoAtencao,
  erro: estilo.avisoErro,
};

export function AvisoDaAcao({ aviso }: { readonly aviso: Aviso }) {
  return (
    <div className={CLASSE_DO_AVISO[aviso.tipo]} role="status">
      <div className={estilo.avisoTitulo}>{aviso.titulo}</div>
      <p className={estilo.avisoCorpo}>{aviso.corpo}</p>
    </div>
  );
}

export function AvisoDeFilaParada({ texto }: { readonly texto: string }) {
  return (
    <div className={estilo.avisoAtencao} role="status">
      <div className={estilo.avisoTitulo}>Fila com trabalho parado</div>
      <p className={estilo.avisoCorpo}>{texto}</p>
    </div>
  );
}

// ─── Os números do alto ──────────────────────────────────────────────────────

const ICONE_DO_NUMERO: Readonly<Record<NumeroDaImportacao['chave'], ReactNode>> = {
  fila: <SinalCaixa />,
  rodando: <SinalRelogio />,
  concluido: <SinalCerto />,
  voce: <SinalAlerta />,
};

/** Os quatro números. O escuro é o de "precisam de você", que é a pergunta da tela. */
export function Painel({
  contagem,
  prontos,
}: {
  readonly contagem: Readonly<Record<StatusJob, number>>;
  readonly prontos: number;
}) {
  return (
    <FaixaDeNumeros
      itens={numerosDaImportacao(contagem, prontos).map((numero) => ({
        rotulo: numero.rotulo,
        valor: numero.valor.toLocaleString(IDIOMA),
        nota: numero.nota,
        tom: numero.tom,
        icone: ICONE_DO_NUMERO[numero.chave],
        escuro: numero.chave === 'voce',
      }))}
      rotulo="As entradas em números"
    />
  );
}

// ─── Campo único de entrada ──────────────────────────────────────────────────

/**
 * O campo único da especificação: "aceita qualquer coisa e faz a coisa certa".
 *
 * Um formulário, não dois. A escolha entre link, texto e arquivo é do
 * classificador, e obrigar a pessoa a escolher a aba certa antes de colar seria
 * transferir para ela um trabalho que o sistema sabe fazer.
 */
export function FormularioDeEntrada({ loja }: { readonly loja?: Plataforma | undefined } = {}) {
  return (
    <form action={enviarEntrada} className={estilo.formulario}>
      {loja !== undefined && <input name="loja" type="hidden" value={loja} />}
      <label htmlFor="texto" className={estilo.rotuloDoCampo}>
        Cole um link, uma lista de links ou um texto
      </label>
      <textarea
        id="texto"
        name="texto"
        rows={3}
        className={estilo.entrada}
        placeholder="https://produto.mercadolivre.com.br/MLB-..."
      />
      <div className={estilo.linhaDoFormulario}>
        <div className={estilo.arquivo}>
          <label htmlFor="arquivo" className={estilo.rotuloDoCampo}>
            Ou suba uma planilha de exportação
          </label>
          <input
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className={estilo.entradaDeArquivo}
            id="arquivo"
            name="arquivo"
            type="file"
          />
          <p className={estilo.dica}>
            CSV ou Excel, até {MAX_UPLOAD_ROTULO}. Nada é descartado: o original fica guardado.
          </p>
        </div>
        <button type="submit" className={estilo.botao}>
          Enviar
        </button>
      </div>
    </form>
  );
}

// ─── Tabela ──────────────────────────────────────────────────────────────────

export function TabelaDeJobs({
  jobs,
  agora,
  vazio,
}: {
  readonly jobs: readonly JobDetalhado[];
  readonly agora: Date;
  readonly vazio: string;
}) {
  if (jobs.length === 0) return <p className={estilo.vazio}>{vazio}</p>;

  return (
    <div className={estilo.rolagem}>
      <table className={estilo.tabela}>
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Entrada</th>
            <th scope="col">Situação</th>
            <th scope="col">Duração</th>
            <th scope="col">Resultado</th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <LinhaDeJob key={job.id} job={job} agora={agora} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaDeJob({ job, agora }: { readonly job: JobDetalhado; readonly agora: Date }) {
  const entrada = resumirEntrada(job.entrada, job.tipo);
  const metricas = resumirResultado(job.resultado);
  const progresso = resumirProgresso(job.progresso);
  const tentativas = descreverTentativas(job);
  const duracao = duracaoDoJob(job, agora);

  return (
    <tr>
      <td className={estilo.celulaTempo} title={formatarAbsoluto(job.criadoEm)}>
        {formatarRelativo(job.criadoEm, agora)}
        {/*
          O identificador curto é o link para o detalhe. Fica aqui, e não num
          botão "ver", porque é o mesmo valor que aparece no log estruturado como
          `jobId`, e quem chegou pelo log procura por ele.
        */}
        <div>
          <Link href={`${CAMINHO}/${job.id}`} className={estilo.linkDoJob} title={job.id}>
            {job.id.slice(0, 8)}
          </Link>
        </div>
      </td>

      <td className={estilo.celulaEntrada}>
        <div className={estilo.tituloDaEntrada}>{entrada.titulo}</div>
        <div className={estilo.detalheDaEntrada}>
          {entrada.tipoDeEntrada === null
            ? rotuloDoTipoDeJob(job.tipo)
            : rotuloDoTipoDeEntrada(entrada.tipoDeEntrada)}
          {entrada.site === null ? '' : ` · ${entrada.site}`}
          {entrada.confiancaBp === null
            ? ''
            : ` · confiança ${String(Math.round(entrada.confiancaBp / 100))}%`}
        </div>
      </td>

      <td>
        <span className={estilo.etiqueta} style={{ color: COR_DO_STATUS[job.status] }}>
          {ROTULO_DO_STATUS[job.status]}
        </span>
        {tentativas === null ? null : (
          <div
            className={tentativas.alerta ? estilo.metricaAlerta : estilo.detalheDaEntrada}
            title="tentativas usadas de tentativas permitidas"
          >
            tentativa {tentativas.texto}
          </div>
        )}
        {progresso === null ? null : <div className={estilo.detalheDaEntrada}>{progresso}</div>}
      </td>

      <td className={estilo.numero}>{duracao === null ? '—' : formatarDuracao(duracao)}</td>

      <td>
        {metricas.map((m) => (
          <div key={m.rotulo} className={m.alerta === true ? estilo.metricaAlerta : estilo.metrica}>
            {m.rotulo}: {m.valor}
          </div>
        ))}
        {/*
          O erro aparece por extenso, não truncado e não escondido em `title`. É a
          única exigência explícita que a especificação faz desta tela (seção 7), e
          erro que exige passar o mouse para ser lido não é erro visível.
        */}
        {job.erro === null ? null : (
          <div className={job.status === 'pendente_revisao' ? estilo.motivoDeRevisao : estilo.erro}>
            {job.erro}
          </div>
        )}
        {metricas.length === 0 && job.erro === null ? (
          <span className={estilo.detalheDaEntrada}>—</span>
        ) : null}
      </td>

      <td>
        {/*
          Só aparece para job parado. Job `rodando` não pode voltar à fila sem
          risco de duplicar trabalho, e job `pendente` já vai rodar — oferecer
          "tentar de novo" ali sugere que algo deu errado quando nada deu.
        */}
        {job.status === 'pendente' || job.status === 'rodando' ? null : (
          <form action={reenfileirar}>
            <input type="hidden" name="id" value={job.id} />
            <button type="submit" className={estilo.botaoSecundario}>
              {job.status === 'concluido' ? 'Rodar de novo' : 'Tentar de novo'}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

// ─── Execução manual ─────────────────────────────────────────────────────────

export function BotaoProcessarAgora({ limite }: { readonly limite: number }) {
  return (
    <form action={processarAgora}>
      <button
        type="submit"
        className={estilo.botaoSecundario}
        title={`processa até ${String(limite)} entradas nesta requisição`}
      >
        Processar agora
      </button>
    </form>
  );
}
