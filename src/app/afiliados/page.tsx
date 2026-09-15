/**
 * Tela de afiliados (M13 — 11.6).
 *
 * A pergunta que ela responde: **o que publicar no grupo, e quando?**
 *
 * As regras da fase 11 existiam sem tela: teto de oito por dia, 45 minutos entre uma
 * publicação e a próxima, conversão nula quando não houve clique. São regras com uma
 * razão só, e ela está na especificação: "grupo que posta 40 ofertas por dia é
 * silenciado pelos membros". Grupo silenciado não dá erro e não aparece em log —
 * continua recebendo publicação para ninguém.
 *
 * A ordem da tela é a de quem opera: primeiro se dá para publicar agora, depois a
 * fila, depois o que o grupo respondeu, e por último a oferta nova. Quem publica é a
 * pessoa, no aplicativo do grupo; o que o sistema faz é dizer a vez e guardar a hora.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { medirDesempenho, proximaPublicacao } from '@/dominio/afiliados/publicacao';
import { RepositorioDeOfertas } from '@/dominio/afiliados/repositorio';
import { banco } from '@/infra/banco/cliente';
import estilo from './afiliados.module.css';
import {
  descreverAviso,
  plataformasComTag,
  plataformasSemTag,
  resumoDaFila,
  tagsDoAmbiente,
  textoDaDecisao,
} from './apresentacao';
import {
  AvisoDaAcao,
  Decisao,
  Fila,
  FormularioDeOferta,
  PainelDeDesempenho,
  TagsQueFaltam,
} from './componentes';
import { LIMITE_DA_FILA } from './constantes';

export const metadata: Metadata = { title: 'Afiliados' };

/** Sempre dinâmica: a decisão é sobre o relógio de agora. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeAfiliados({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const repo = new RepositorioDeOfertas(banco());

  // Um `agora` para a tela inteira: o teto do dia e o "saiu há 20 minutos" de cada
  // linha têm de concordar, e duas leituras de relógio caem em lados diferentes da
  // virada do dia uma vez a cada tanto.
  const agora = new Date();

  // A contagem de pendentes vem do banco, e não do tamanho da fila carregada: a fila
  // tem teto de carregamento, e contar em cima dela diria "100" para sempre.
  const [ofertas, pendentes] = await Promise.all([repo.fila(LIMITE_DA_FILA), repo.pendentes()]);

  const decisao = proximaPublicacao(ofertas, { agora });
  const desempenho = medirDesempenho(ofertas);
  const tags = tagsDoAmbiente(lerAmbiente());

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Afiliados</h1>
        <p className={estilo.subtitulo}>
          Oferta de terceiro publicada com a sua tag. O teto e o espaçamento não são precaução: são
          a diferença entre um grupo que compra e um grupo em que todo mundo silenciou as
          notificações.
        </p>
        <p className={estilo.resumo}>{resumoDaFila({ pendentes, desempenho })}</p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="agora-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="agora-titulo">
          Publicar agora?
        </h2>
        <Decisao texto={textoDaDecisao(decisao)} />
      </section>

      <section aria-labelledby="fila-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="fila-titulo">
          A fila
        </h2>
        <p className={estilo.dica}>
          Ordenada por desconto real decrescente, porque o teto do dia existe e a última da fila
          pode não sair. &ldquo;Saiu no grupo&rdquo; guarda a hora — é dela que sai o intervalo até
          a próxima, e marcar duas vezes não a reescreve.
        </p>
        <Fila
          agora={agora}
          ofertas={ofertas}
          proximaId={decisao.tipo === 'publicar' ? decisao.oferta.id : null}
        />
      </section>

      <section aria-labelledby="resposta-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="resposta-titulo">
          O que o grupo respondeu
        </h2>
        <PainelDeDesempenho desempenho={desempenho} />
      </section>

      <section aria-labelledby="nova-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="nova-titulo">
          Acrescentar oferta
        </h2>
        <p className={estilo.dica}>
          A mediana de 90 dias é opcional e é o que mede o desconto: sem ela a oferta entra no fim
          da fila, porque não há desconto medido para ordenar.
        </p>
        <FormularioDeOferta disponiveis={plataformasComTag(tags)} />
        <TagsQueFaltam faltando={plataformasSemTag(tags)} />
      </section>
    </main>
  );
}
