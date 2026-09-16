/**
 * Tela de garimpo de oportunidade (M6 — fase 10).
 *
 * A pergunta que ela responde: **em que o agente gastou, e o que ele achou?**
 *
 * A fase 10 entregou a máquina — fronteira dirigida por hipótese, seleção por valor
 * por custo, teto obrigatório, parada por saturação, dossiê salvável em qualquer
 * ponto — e nada disso aparecia em lugar nenhum. Agente que gasta orçamento sem tela é
 * agente que gasta sem ninguém ver, e o erro caro deste módulo não é escolher a
 * hipótese errada: é não parar.
 *
 * A ordem da tela é a da honestidade. Primeiro **o que dá para investigar hoje**, porque
 * sem isso "nenhum achado" se lê como sinal sobre o alvo quando o que houve foi não ter
 * com que olhar. Depois os dossiês, com o estado de cada um, o motivo de parada e o
 * campo de teto para continuar. Por último, investigar um alvo novo.
 *
 * **Investigar é enfileirar.** Cada passo é uma chamada de ferramenta, então o laço roda
 * no poller e não dentro da ação: a tela responde na hora e o dossiê aparece preenchido
 * na próxima olhada. Das seis ferramentas, uma é chamável hoje — a base local —, e a
 * tela diz ferramenta por ferramenta o que falta para as outras existirem.
 */
import type { Metadata } from 'next';
import { lerAmbiente } from '@/config/ambiente';
import { FAMILIAS_DE_HIPOTESE, familiasPossiveis } from '@/dominio/prospector/hipoteses';
import { FERRAMENTAS_PRONTAS } from '@/dominio/prospector/registro';
import { RepositorioDeDossies } from '@/dominio/prospector/repositorio';
import { banco } from '@/infra/banco/cliente';
import { centavos } from '@/lib/dinheiro';
import estilo from './garimpo.module.css';
import { descreverAviso, reaisDoTeto, resumoDoGarimpo } from './apresentacao';
import { AvisoDaAcao, Dossies, Ferramentas, FormularioDeAlvo } from './componentes';
import { LIMITE_DE_DOSSIES } from './constantes';

export const metadata: Metadata = { title: 'Garimpo de oportunidade' };

/** Sempre dinâmica: pré-renderizar exigiria banco durante o `build`. */
export const dynamic = 'force-dynamic';

export default async function PaginaDeGarimpo({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const repo = new RepositorioDeDossies(banco());
  const ambiente = lerAmbiente();
  const agora = new Date();

  const [dossies, continuaveis] = await Promise.all([
    repo.ultimos(LIMITE_DE_DOSSIES),
    repo.valeContinuar(LIMITE_DE_DOSSIES),
  ]);

  const possiveis = familiasPossiveis(FERRAMENTAS_PRONTAS);

  const codigo = Array.isArray(parametros['r']) ? parametros['r'][0] : parametros['r'];
  const aviso = descreverAviso(codigo);

  // O teto sugerido é o mesmo padrão de orçamento de LLM do ambiente: é o mesmo bolso,
  // e dois padrões diferentes para a mesma coisa divergem na primeira vez que um muda.
  const tetoPadrao = reaisDoTeto(centavos(ambiente.LLM_ORCAMENTO_PADRAO_CENTAVOS));

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Garimpo de oportunidade</h1>
        <p className={estilo.subtitulo}>
          Varrer a internet inteira é caro e inútil. O que roda aqui é investigação dirigida: um
          alvo, sete perguntas que mudam decisão de compra e de venda, teto declarado antes de
          começar, e parada por ter terminado — não por ter esbarrado no limite.
        </p>
        <p className={estilo.resumo}>
          {resumoDoGarimpo({
            dossies: dossies.length,
            achados: dossies.reduce((soma, d) => soma + d.achados.length, 0),
            valeContinuar: continuaveis.length,
            familiasPossiveis: possiveis.length,
            familiasTotais: FAMILIAS_DE_HIPOTESE.length,
          })}
        </p>
      </header>

      {aviso !== null && <AvisoDaAcao aviso={aviso} />}

      <section aria-labelledby="ferramentas-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="ferramentas-titulo">
          O que dá para investigar hoje
        </h2>
        <p className={estilo.dica}>
          Cada pergunta depende de uma ferramenta, e ferramenta ausente é estado normal, não erro: o
          item fica na fronteira e não é escolhido, em vez de gastar um passo para descobrir no meio
          que não dava. Acrescentar uma ferramenta é registrar um investigador — e ela passa a
          aparecer aqui como disponível, sem mais nada.
        </p>
        <Ferramentas prontas={FERRAMENTAS_PRONTAS} />
      </section>

      <section aria-labelledby="dossies-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="dossies-titulo">
          Dossiês
        </h2>
        <p className={estilo.dica}>
          Um por alvo, e o parcial é o caminho normal: o dossiê é salvo a cada passo, então o teto —
          ou uma ferramenta que quebrou — interrompe sem perder o que já foi descoberto. Cada achado
          carrega a URL de onde veio: achado sem fonte não é auditável, e a tela marca quando isso
          acontece. Continuar é pedir um teto maior no próprio cartão.
        </p>
        <Dossies
          agora={agora}
          dossies={dossies}
          idsQueValeContinuar={continuaveis.map((d) => d.id)}
        />
      </section>

      <section aria-labelledby="alvo-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="alvo-titulo">
          Investigar um alvo
        </h2>
        <p className={estilo.dica}>
          Escreve o plano — as sete hipóteses e a fronteira, em ordem de valor por custo —, grava o
          teto e põe a investigação na fila. Alvo que já tem dossiê não é reaberto: o plano fica
          como está e a investigação continua de onde parou, com o teto que você pedir aqui.
        </p>
        <FormularioDeAlvo tetoPadrao={tetoPadrao} />
      </section>
    </main>
  );
}
