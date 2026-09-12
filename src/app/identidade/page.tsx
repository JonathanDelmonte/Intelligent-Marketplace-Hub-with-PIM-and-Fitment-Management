/**
 * Tela de revisão de identidade — a "fila de revisão sua, de dois cliques" da
 * especificação (M3, etapa 5.5).
 *
 * O que esta tela existe para não deixar acontecer: agrupamento automático que
 * ninguém conferiu. A resolução decide sozinha o que é decidível sozinho, e **tudo
 * que fica na zona cinzenta chega aqui** — com a evidência à vista, a justificativa
 * de quem julgou, e os dois lados no mesmo formato para poderem ser comparados.
 *
 * Cada decisão tomada aqui vira exemplo para os julgamentos seguintes. É a única
 * tela do sistema em que o trabalho da pessoa deixa o sistema mais inteligente, e não
 * só mais cheio.
 */
import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { RepositorioDeExemplos } from '@/dominio/identidade/exemplos';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { produtoExterno } from '@/infra/banco/schema';
import { banco } from '@/infra/banco/cliente';
import { LIMITE_DA_FILA, LIMITE_DE_RESOLUCAO_MANUAL } from './constantes';
import { descreverAviso, estadoDaBase, inteiroDaUrl } from './apresentacao';
import { AvisoDaAcao, BotaoResolverAgora, Fila, Painel } from './componentes';
import estilo from './identidade.module.css';

export const metadata: Metadata = { title: 'Identidade' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeIdentidade({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const db = banco();
  const pares = new RepositorioDePares(db);
  const exemplos = new RepositorioDeExemplos(db);

  const [fila, contagem, contagemDeExemplos, totalDeOcorrencias] = await Promise.all([
    pares.fila(LIMITE_DA_FILA),
    pares.contarPorStatus(),
    exemplos.contar(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(produtoExterno)
      .then((linhas) => linhas[0]?.n ?? 0),
  ]);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo, inteiroDaUrl(parametros['n']));
  const avaliadas =
    contagem.automatico + contagem.pendente + contagem.resolvido + contagem.descartado;
  const estado = estadoDaBase({
    ocorrencias: totalDeOcorrencias,
    pendentes: contagem.pendente,
    avaliadas,
  });

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Identidade de produto</h1>
        <p className={estilo.subtitulo}>
          Duas ocorrências do mesmo produto, em fontes diferentes, viram um SKU só — e aí dá para
          ver qual fornecedor é mais barato e a que preço o mercado vende. O sistema junta o que
          consegue provar; o que sobra vem para cá.
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <Painel contagem={contagem} exemplos={contagemDeExemplos} ocorrencias={totalDeOcorrencias} />

      <section className={estilo.secao} aria-label="Executar a resolução">
        <BotaoResolverAgora limite={LIMITE_DE_RESOLUCAO_MANUAL} />
      </section>

      <section className={estilo.secao} aria-labelledby="fila-titulo">
        <h2 className={estilo.secaoTitulo} id="fila-titulo">
          Esperando decisão
        </h2>
        {estado !== null && <AvisoDaAcao aviso={estado} />}
        <Fila pares={fila} />
      </section>
    </main>
  );
}
