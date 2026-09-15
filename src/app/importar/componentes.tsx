/**
 * Componentes da tela de importação.
 *
 * Tudo aqui é Server Component sem estado: recebe dados prontos e devolve marcação.
 * A lógica que decide o que dizer está em `apresentacao.ts`, que tem teste; estes
 * arquivos decidem só onde as coisas ficam na página.
 */
import Link from 'next/link';
import { STATUS_JOB, type JobDetalhado, type StatusJob } from '@/infra/fila/fila';
import { MAX_UPLOAD_ROTULO } from '@/config/limites';
import { CAMINHO } from './constantes';
import {
  COR_DO_STATUS,
  IDIOMA,
  EXPLICACAO_DO_STATUS,
  ROTULO_DO_STATUS,
  descreverTentativas,
  duracaoDoJob,
  formatarAbsoluto,
  formatarDuracao,
  formatarRelativo,
  resumirEntrada,
  resumirProgresso,
  resumirResultado,
  rotuloDoTipoDeEntrada,
  type Aviso,
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

// ─── Painel de contagem ──────────────────────────────────────────────────────

export function Painel({
  contagem,
  prontos,
}: {
  readonly contagem: Readonly<Record<StatusJob, number>>;
  readonly prontos: number;
}) {
  return (
    <div className={estilo.painel}>
      {STATUS_JOB.map((status) => (
        <div key={status} className={estilo.cartao}>
          <div className={estilo.cartaoNumero} style={{ color: COR_DO_STATUS[status] }}>
            {contagem[status].toLocaleString(IDIOMA)}
          </div>
          <div className={estilo.cartaoRotulo}>{ROTULO_DO_STATUS[status]}</div>
          <div className={estilo.cartaoExplicacao}>{EXPLICACAO_DO_STATUS[status]}</div>
        </div>
      ))}
      <div className={estilo.cartao}>
        <div className={estilo.cartaoNumero}>{prontos.toLocaleString(IDIOMA)}</div>
        <div className={estilo.cartaoRotulo}>prontos agora</div>
        <div className={estilo.cartaoExplicacao}>
          na fila e com a hora de rodar já vencida — o que falhou espera o intervalo
        </div>
      </div>
    </div>
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
export function FormularioDeEntrada() {
  return (
    <form action={enviarEntrada} className={estilo.formulario}>
      <label htmlFor="texto" className={estilo.cartaoRotulo}>
        Cole um link, uma lista de links ou um texto
      </label>
      <textarea
        id="texto"
        name="texto"
        rows={3}
        className={estilo.campo}
        style={{ marginTop: '0.375rem' }}
        placeholder="https://produto.mercadolivre.com.br/MLB-..."
      />
      <div className={estilo.linhaDoFormulario}>
        <div>
          <input type="file" name="arquivo" accept=".csv,.tsv,.txt,.xlsx,.xls" />
          <p className={estilo.dica}>
            ou suba uma planilha de exportação, até {MAX_UPLOAD_ROTULO}. Nada é descartado: o
            original fica guardado por hash.
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
  if (jobs.length === 0) {
    return (
      <div className={estilo.envelopeDaTabela}>
        <p className={estilo.vazio}>{vazio}</p>
      </div>
    );
  }

  return (
    <div className={estilo.envelopeDaTabela}>
      <table className={estilo.tabela}>
        <thead>
          <tr>
            <th scope="col">quando</th>
            <th scope="col">entrada</th>
            <th scope="col">status</th>
            <th scope="col">duração</th>
            <th scope="col">resultado</th>
            <th scope="col">
              <span className="sr-only">ações</span>
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
  const entrada = resumirEntrada(job.entrada);
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
          `jobId` — quem chegou pelo log procura por ele.
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
          {entrada.tipoDeEntrada === null ? job.tipo : rotuloDoTipoDeEntrada(entrada.tipoDeEntrada)}
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
              {job.status === 'concluido' ? 'rodar de novo' : 'tentar de novo'}
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
