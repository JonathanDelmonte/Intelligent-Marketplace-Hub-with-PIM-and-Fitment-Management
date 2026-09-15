/**
 * Tela do monitor (M15).
 *
 * Duas perguntas, nesta ordem:
 *
 * 1. **O que mudou?** Mudanças agrupadas por concorrente e semana, com a leitura da
 *    combinação — que é o ponto do monitor. Dez alertas do mesmo vendedor na mesma
 *    semana são uma história, não dez.
 * 2. **Vale publicar?** O veredito de queda real de cada oferta com série suficiente,
 *    contra a mediana de 90 dias. É o que separa desconto de encenação.
 *
 * A fase 11 entregou as regras sem tela, e a tela é onde a ordem das informações
 * importa. A ordem aqui é a de quem opera: primeiro o que não pode esperar, depois o
 * que dá dinheiro se for publicado hoje.
 */
import type { Metadata } from 'next';
import { agruparEventos } from '@/dominio/monitor/eventos';
import { avaliarQueda } from '@/dominio/monitor/queda';
import { RepositorioDoMonitor } from '@/dominio/monitor/repositorio';
import { banco } from '@/infra/banco/cliente';
import {
  descreverAviso,
  inteiroDaUrl,
  ordenarGrupos,
  ordenarQuedas,
  resumoDoMonitor,
  type QuedaNaTela,
} from './apresentacao';
import { AvisoDaAcao, Grupos, Quedas } from './componentes';
import { LIMITE_DE_EVENTOS, LIMITE_DE_QUEDAS } from './constantes';
import estilo from './monitor.module.css';

export const metadata: Metadata = { title: 'Monitor de preço' };

/** Sempre dinâmica: é o estado de agora, e pré-renderizar o congelaria. */
export const dynamic = 'force-dynamic';

export default async function PaginaDoMonitor({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const repo = new RepositorioDoMonitor(banco());

  // Um `agora` para a tela inteira: o agrupamento por semana e o tempo relativo de
  // cada linha têm de concordar, e duas leituras de relógio podem cair em lados
  // diferentes da virada do dia.
  const agora = new Date();

  const [eventos, candidatos] = await Promise.all([
    repo.naoLidos(LIMITE_DE_EVENTOS),
    repo.candidatosAQueda(LIMITE_DE_QUEDAS, { agora }),
  ]);

  const grupos = ordenarGrupos(agruparEventos(eventos));

  const quedas = ordenarQuedas(
    candidatos.map((c): QuedaNaTela => ({
      produtoExternoId: c.produtoExternoId,
      titulo: c.titulo,
      de: c.vendedor ?? c.plataformaOuSite ?? 'origem não informada',
      avaliacao: avaliarQueda(c.precoAtual, c.historico, { agora }),
    })),
  );

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo, inteiroDaUrl(parametros['n']));

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Monitor de preço</h1>
        <p className={estilo.subtitulo}>
          O que mudou no mercado desde a última vez que você olhou, agrupado por vendedor e semana.
          Mudança abaixo de 3% não entra: monitor que avisa de tudo é monitor desligado na segunda
          semana.
        </p>
        <p className={estilo.resumo}>
          {resumoDoMonitor({ grupos, ofertasComSerie: candidatos.length })}
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="mudancas-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="mudancas-titulo">
          O que mudou
        </h2>
        <Grupos agora={agora} grupos={grupos} />
      </section>

      <section aria-labelledby="quedas-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="quedas-titulo">
          Vale publicar?
        </h2>
        <p className={estilo.dica}>
          Desconto é contra a <strong>mediana dos últimos 90 dias</strong>, não contra o preço de
          ontem. É o que separa queda real de preço que subiu para depois &ldquo;baixar&rdquo;. A
          mediana é calculada sobre os preços diferentes já vistos — a série ganha um ponto quando o
          preço muda, e não a cada captura.
        </p>
        <Quedas quedas={quedas} />
      </section>
    </main>
  );
}
